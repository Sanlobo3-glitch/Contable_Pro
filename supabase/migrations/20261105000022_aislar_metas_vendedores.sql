
BEGIN;

-- ============================================================
-- 000022: AISLAR METAS DE VENDEDORES
-- Administrador central: CRUD solo en su empresa actual.
-- Usuarios ordinarios y soporte: sin acceso directo.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.seller_goals') IS NULL THEN
    RAISE EXCEPTION 'No existe public.seller_goals';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.seller_goals'::regclass
      AND relrowsecurity = TRUE
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'seller_goals'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'company_id UUID no existe';
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
      AND tablename = 'seller_goals'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No existe la política global esperada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'seller_goals'
      AND policyname <> 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION
      'Hay políticas adicionales no auditadas';
  END IF;

  IF has_table_privilege(
    'authenticated','public.seller_goals','SELECT'
  ) OR has_table_privilege(
    'authenticated','public.seller_goals','INSERT'
  ) OR has_table_privilege(
    'authenticated','public.seller_goals','UPDATE'
  ) OR has_table_privilege(
    'authenticated','public.seller_goals','DELETE'
  ) THEN
    RAISE EXCEPTION
      'authenticated tiene permisos directos previos inesperados';
  END IF;
END;
$$;

-- 1. Retirar acceso global.

DROP POLICY platform_admin_all
ON public.seller_goals;

-- 2. Acceso CRUD del administrador central,
-- exclusivamente dentro de su empresa actual.

CREATE POLICY platform_admin_company_all
ON public.seller_goals
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

-- 3. Permisos de tabla.
-- RLS limita las filas al administrador central autorizado.

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.seller_goals
TO authenticated;

REVOKE ALL PRIVILEGES
ON TABLE public.seller_goals
FROM anon;

-- 4. Verificación final.

DO $$
DECLARE
  v_policy integer;
  v_global integer;
BEGIN
  SELECT count(*)
  INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'seller_goals'
    AND policyname = 'platform_admin_company_all'
    AND cmd = 'ALL'
    AND qual LIKE '%is_platform_admin()%'
    AND qual LIKE '%current_company_id()%'
    AND with_check LIKE '%is_platform_admin()%'
    AND with_check LIKE '%current_company_id()%';

  IF v_policy <> 1 THEN
    RAISE EXCEPTION
      'No existe la política CRUD central aislada';
  END IF;

  SELECT count(*)
  INTO v_global
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'seller_goals'
    AND policyname = 'platform_admin_all';

  IF v_global <> 0 THEN
    RAISE EXCEPTION 'Persiste la política global';
  END IF;

  IF NOT has_table_privilege(
    'authenticated','public.seller_goals','SELECT'
  ) OR NOT has_table_privilege(
    'authenticated','public.seller_goals','INSERT'
  ) OR NOT has_table_privilege(
    'authenticated','public.seller_goals','UPDATE'
  ) OR NOT has_table_privilege(
    'authenticated','public.seller_goals','DELETE'
  ) THEN
    RAISE EXCEPTION 'Faltan permisos CRUD authenticated';
  END IF;

  IF has_table_privilege(
    'anon','public.seller_goals','SELECT'
  ) OR has_table_privilege(
    'anon','public.seller_goals','INSERT'
  ) OR has_table_privilege(
    'anon','public.seller_goals','UPDATE'
  ) OR has_table_privilege(
    'anon','public.seller_goals','DELETE'
  ) THEN
    RAISE EXCEPTION 'anon conserva permisos inesperados';
  END IF;
END;
$$;

COMMIT;
