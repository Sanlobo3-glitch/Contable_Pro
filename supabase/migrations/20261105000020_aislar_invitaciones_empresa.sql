BEGIN;

-- ============================================================
-- 000020: AISLAMIENTO DE INVITACIONES POR EMPRESA
-- Administrador central: CRUD solo en su empresa actual.
-- Gestores: conservar lectura empresarial.
-- Soporte técnico: sin acceso directo.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.company_invites') IS NULL THEN
    RAISE EXCEPTION 'No existe public.company_invites';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.company_invites'::regclass
      AND relrowsecurity = TRUE
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_invites'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Falta company_id UUID';
  END IF;

  IF to_regprocedure('public.is_platform_admin()') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
  THEN
    RAISE EXCEPTION 'Faltan funciones de seguridad';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_invites'
      AND policyname = 'company_invites_select'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Falta la política de lectura empresarial';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_invites'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No existe la política global esperada';
  END IF;
END;
$$;

-- 1. Eliminar el acceso global.

DROP POLICY platform_admin_all
ON public.company_invites;

-- 2. Administrador central:
-- CRUD limitado a la empresa actual.

DROP POLICY IF EXISTS platform_admin_company_all
ON public.company_invites;

CREATE POLICY platform_admin_company_all
ON public.company_invites
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  AND company_id = (
    SELECT public.current_company_id()
  )
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id = (
    SELECT public.current_company_id()
  )
);

-- 3. Permisos CRUD a nivel de tabla.
-- RLS mantiene el aislamiento de filas.

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.company_invites
TO authenticated;

-- 4. Anon no debe tener acceso.

REVOKE ALL PRIVILEGES
ON TABLE public.company_invites
FROM anon;

-- 5. Verificaciones finales.

DO $$
DECLARE
  v_admin INTEGER;
  v_global INTEGER;
  v_select INTEGER;
  v_support INTEGER;
BEGIN

  SELECT COUNT(*) INTO v_admin
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_invites'
    AND policyname = 'platform_admin_company_all'
    AND cmd = 'ALL'
    AND qual LIKE '%is_platform_admin()%'
    AND qual LIKE '%current_company_id()%'
    AND with_check LIKE '%is_platform_admin()%'
    AND with_check LIKE '%current_company_id()%';

  IF v_admin <> 1 THEN
    RAISE EXCEPTION 'Falta política CRUD central aislada';
  END IF;

  SELECT COUNT(*) INTO v_global
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_invites'
    AND policyname = 'platform_admin_all';

  IF v_global <> 0 THEN
    RAISE EXCEPTION 'Persiste el acceso global';
  END IF;

  SELECT COUNT(*) INTO v_select
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_invites'
    AND policyname = 'company_invites_select'
    AND cmd = 'SELECT';

  IF v_select <> 1 THEN
    RAISE EXCEPTION 'Se perdió la lectura empresarial';
  END IF;

  SELECT COUNT(*) INTO v_support
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_invites'
    AND policyname LIKE 'support_%';

  IF v_support <> 0 THEN
    RAISE EXCEPTION 'No se permite soporte directo en invitaciones';
  END IF;

  IF NOT has_table_privilege(
    'authenticated','public.company_invites','SELECT'
  ) OR NOT has_table_privilege(
    'authenticated','public.company_invites','INSERT'
  ) OR NOT has_table_privilege(
    'authenticated','public.company_invites','UPDATE'
  ) OR NOT has_table_privilege(
    'authenticated','public.company_invites','DELETE'
  ) THEN
    RAISE EXCEPTION 'Faltan permisos CRUD authenticated';
  END IF;

  IF has_table_privilege(
    'anon','public.company_invites','SELECT'
  ) OR has_table_privilege(
    'anon','public.company_invites','INSERT'
  ) OR has_table_privilege(
    'anon','public.company_invites','UPDATE'
  ) OR has_table_privilege(
    'anon','public.company_invites','DELETE'
  ) THEN
    RAISE EXCEPTION 'anon conserva permisos inesperados';
  END IF;

END;
$$;

COMMIT;
