BEGIN;

-- ============================================================
-- 000018: AISLAMIENTO Y SOPORTE TECNICO DE CATEGORIAS
-- Administrador central: CRUD solo en su empresa actual.
-- Usuarios: conservar políticas empresariales.
-- Soporte: conservar lectura temporal autorizada.
-- ============================================================

DO $$
BEGIN
    IF to_regclass('public.categories') IS NULL THEN
        RAISE EXCEPTION 'No existe public.categories';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.categories'::regclass
          AND relrowsecurity = TRUE
    ) THEN
        RAISE EXCEPTION 'RLS no está activo';
    END IF;

    IF to_regprocedure('public.is_platform_admin()') IS NULL
       OR to_regprocedure('public.current_company_id()') IS NULL
       OR to_regprocedure(
          'public.support_has_active_authorization(uuid,text,text)'
       ) IS NULL THEN
        RAISE EXCEPTION 'Faltan funciones de seguridad';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public'
          AND tablename='categories'
          AND policyname='categories_select'
          AND cmd='SELECT'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public'
          AND tablename='categories'
          AND policyname='categories_write'
          AND cmd='ALL'
    ) THEN
        RAISE EXCEPTION 'Faltan políticas empresariales originales';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public'
          AND tablename='categories'
          AND policyname='support_categories_select'
          AND cmd='SELECT'
    ) THEN
        RAISE EXCEPTION 'Falta la política de soporte existente';
    END IF;
END;
$$;

-- Acceso central limitado a la empresa actual.
DROP POLICY IF EXISTS platform_admin_all
ON public.categories;

DROP POLICY IF EXISTS platform_admin_company_all
ON public.categories;

CREATE POLICY platform_admin_company_all
ON public.categories
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

-- Las políticas empresariales y de soporte existentes
-- permanecen intactas.

-- Verificaciones.
DO $$
DECLARE
    v_admin INTEGER;
    v_global INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_admin
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename='categories'
      AND policyname='platform_admin_company_all'
      AND cmd='ALL'
      AND qual LIKE '%is_platform_admin()%'
      AND qual LIKE '%current_company_id()%'
      AND with_check LIKE '%is_platform_admin()%'
      AND with_check LIKE '%current_company_id()%';

    IF v_admin <> 1 THEN
        RAISE EXCEPTION 'Política central aislada incorrecta';
    END IF;

    SELECT COUNT(*) INTO v_global
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename='categories'
      AND policyname='platform_admin_all';

    IF v_global <> 0 THEN
        RAISE EXCEPTION 'Persiste bypass global';
    END IF;

    IF NOT has_table_privilege('authenticated','public.categories','SELECT')
       OR NOT has_table_privilege('authenticated','public.categories','INSERT')
       OR NOT has_table_privilege('authenticated','public.categories','UPDATE')
       OR NOT has_table_privilege('authenticated','public.categories','DELETE')
    THEN
        RAISE EXCEPTION 'Faltan privilegios CRUD';
    END IF;

    IF has_table_privilege('anon','public.categories','SELECT')
       OR has_table_privilege('anon','public.categories','INSERT')
       OR has_table_privilege('anon','public.categories','UPDATE')
       OR has_table_privilege('anon','public.categories','DELETE')
       OR has_table_privilege('anon','public.categories','TRUNCATE')
       OR has_table_privilege('anon','public.categories','REFERENCES')
       OR has_table_privilege('anon','public.categories','TRIGGER')
    THEN
        RAISE EXCEPTION 'anon conserva privilegios inesperados';
    END IF;
END;
$$;

COMMIT;
