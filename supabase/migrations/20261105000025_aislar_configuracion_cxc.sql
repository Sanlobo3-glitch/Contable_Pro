
BEGIN;

-- =========================================================
-- 000025: AISLAR CONFIGURACION DE CUENTAS POR COBRAR
-- Conserva la lectura de la propia empresa.
-- Mantiene las RPC de configuración.
-- No concede acceso a soporte técnico.
-- =========================================================

DO $$
DECLARE
  v_rls boolean;
BEGIN
  IF to_regclass('public.cxc_settings') IS NULL THEN
    RAISE EXCEPTION 'No existe public.cxc_settings';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'cxc_settings';

  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RLS no está habilitado en cxc_settings';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxc_settings'
      AND policyname = 'cxc_settings_select'
      AND cmd = 'SELECT'
      AND qual = '(company_id = current_company_id())'
  ) THEN
    RAISE EXCEPTION 'La política original de lectura no coincide';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxc_settings'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No existe la política global esperada';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxc_settings'
  ) <> 2 THEN
    RAISE EXCEPTION 'Hay políticas adicionales no auditadas';
  END IF;

  IF has_table_privilege(
    'anon',
    'public.cxc_settings',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.cxc_settings',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.cxc_settings',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.cxc_settings',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'Hay privilegios directos inesperados';
  END IF;

  IF to_regprocedure('public.cxc_config()') IS NULL
     OR to_regprocedure('public.cxc_save_account(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltan las funciones de configuración CXC';
  END IF;

  IF NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = 'public.cxc_config()'::regprocedure
  ) OR NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = 'public.cxc_save_account(uuid)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Las funciones deben conservar SECURITY DEFINER';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.cxc_config()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.cxc_save_account(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Falta EXECUTE en las funciones CXC';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.cxc_settings'::regclass
      AND tgname = 'cxc_settings_check_subscription'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.cxc_settings'::regclass
      AND tgname = 'trg_company_subscription_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Faltan triggers originales de protección';
  END IF;
END;
$$;

-- Eliminar únicamente el acceso global.
DROP POLICY platform_admin_all
ON public.cxc_settings;

-- =========================================================
-- VERIFICACION FINAL
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxc_settings'
      AND policyname = 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION 'Sigue existiendo el acceso global';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxc_settings'
      AND policyname = 'cxc_settings_select'
      AND cmd = 'SELECT'
      AND qual = '(company_id = current_company_id())'
  ) THEN
    RAISE EXCEPTION 'Se perdió el aislamiento por empresa';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxc_settings'
  ) <> 1 THEN
    RAISE EXCEPTION 'El conjunto final de políticas es inesperado';
  END IF;

  IF has_table_privilege(
    'anon',
    'public.cxc_settings',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.cxc_settings',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.cxc_settings',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.cxc_settings',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'Se detectaron privilegios directos inesperados';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.cxc_config()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.cxc_save_account(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Se perdió el acceso a las funciones CXC';
  END IF;
END;
$$;

COMMIT;
