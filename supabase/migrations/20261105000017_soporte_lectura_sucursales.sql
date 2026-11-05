Ruta: "supabase/migrations/20261105000017_soporte_lectura_sucursales.sql"

BEGIN;

-- ============================================================
-- 000017: AISLAMIENTO DE SUCURSALES
-- Administrador central limitado a su empresa de prueba.
-- Soporte técnico: lectura temporal autorizada.
-- Módulo real: warehouses
-- ============================================================

-- 1. PREVALIDACIONES
DO $$
BEGIN
    IF to_regclass('public.branches') IS NULL THEN
        RAISE EXCEPTION 'No existe public.branches';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.branches'::regclass
          AND relrowsecurity = TRUE
    ) THEN
        RAISE EXCEPTION 'RLS no está activo en branches';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'branches'
          AND column_name = 'company_id'
          AND data_type = 'uuid'
    ) THEN
        RAISE EXCEPTION 'branches.company_id UUID no existe';
    END IF;

    IF to_regprocedure('public.is_platform_admin()') IS NULL
       OR to_regprocedure('public.current_company_id()') IS NULL
       OR to_regprocedure('public.support_has_active_authorization(uuid,text,text)') IS NULL
    THEN
        RAISE EXCEPTION 'Faltan funciones de seguridad requeridas';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'branches'
          AND policyname = 'branches_company_access'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'No existe branches_company_access';
    END IF;
END;
$$;

-- 2. ELIMINAR BYPASS GLOBAL
DROP POLICY IF EXISTS platform_admin_all
ON public.branches;

-- 3. ADMINISTRADOR CENTRAL: CRUD SOLO EN SU EMPRESA ACTUAL
DROP POLICY IF EXISTS platform_admin_company_all
ON public.branches;

CREATE POLICY platform_admin_company_all
ON public.branches
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

-- 4. SOPORTE TÉCNICO: SOLO SELECT CON AUTORIZACIÓN ACTIVA
DROP POLICY IF EXISTS support_read_branches
ON public.branches;

CREATE POLICY support_read_branches
ON public.branches
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'warehouses',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'warehouses',
        'intervencion_asistida'
    )
);

-- 5. PRIVILEGIOS
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.branches
TO authenticated;

REVOKE ALL PRIVILEGES
ON TABLE public.branches
FROM anon;

-- 6. VERIFICACIONES
DO $$
DECLARE
    v_global INTEGER;
    v_admin INTEGER;
    v_support INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_global
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
      AND policyname = 'platform_admin_all';

    IF v_global <> 0 THEN
        RAISE EXCEPTION 'Persiste el acceso global del administrador';
    END IF;

    SELECT COUNT(*) INTO v_admin
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
      AND policyname = 'platform_admin_company_all'
      AND cmd = 'ALL'
      AND qual LIKE '%is_platform_admin()%'
      AND qual LIKE '%current_company_id()%'
      AND with_check LIKE '%is_platform_admin()%'
      AND with_check LIKE '%current_company_id()%';

    IF v_admin <> 1 THEN
        RAISE EXCEPTION 'La política central aislada no quedó configurada';
    END IF;

    SELECT COUNT(*) INTO v_support
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
      AND policyname = 'support_read_branches'
      AND cmd = 'SELECT';

    IF v_support <> 1 THEN
        RAISE EXCEPTION 'Falta la política SELECT de soporte';
    END IF;

    IF NOT has_table_privilege('authenticated','public.branches','SELECT')
       OR NOT has_table_privilege('authenticated','public.branches','INSERT')
       OR NOT has_table_privilege('authenticated','public.branches','UPDATE')
       OR NOT has_table_privilege('authenticated','public.branches','DELETE')
    THEN
        RAISE EXCEPTION 'Faltan privilegios CRUD authenticated';
    END IF;

    IF has_table_privilege('anon','public.branches','SELECT')
       OR has_table_privilege('anon','public.branches','INSERT')
       OR has_table_privilege('anon','public.branches','UPDATE')
       OR has_table_privilege('anon','public.branches','DELETE')
       OR has_table_privilege('anon','public.branches','TRUNCATE')
       OR has_table_privilege('anon','public.branches','REFERENCES')
       OR has_table_privilege('anon','public.branches','TRIGGER')
    THEN
        RAISE EXCEPTION 'anon conserva privilegios en branches';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'branches'
          AND policyname = 'branches_company_access'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'Se perdió la política empresarial original';
    END IF;
END;
$$;

COMMIT;
