
BEGIN;

-- =========================================================
-- 000023: PROTEGER DATOS PERSONALES DEL PERSONAL
-- Mantiene el acceso controlado mediante RPC autorizadas.
-- No modifica el trigger de suscripción.
-- =========================================================

DO $$
DECLARE
  v_rls boolean;
BEGIN
  IF to_regclass('public.staff_details') IS NULL THEN
    RAISE EXCEPTION 'No existe public.staff_details';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'staff_details';

  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RLS no está habilitado en staff_details';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff_details'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No existe la política global esperada';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff_details'
  ) <> 1 THEN
    RAISE EXCEPTION 'Hay políticas adicionales no auditadas';
  END IF;

  IF to_regprocedure('public.list_team()') IS NULL
     OR to_regprocedure(
       'public.save_staff_details(uuid,text,text,text,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Faltan las funciones autorizadas del equipo';
  END IF;

  IF NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = 'public.list_team()'::regprocedure
  ) OR NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public.save_staff_details(uuid,text,text,text,text,text)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Las funciones deben conservar SECURITY DEFINER';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.list_team()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.save_staff_details(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated no tiene EXECUTE en las funciones requeridas';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.staff_details'::regclass
      AND tgname = 'trg_company_subscription_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'No existe el trigger de protección de suscripción';
  END IF;
END;
$$;

-- Retirar el acceso global del administrador de plataforma.
DROP POLICY platform_admin_all
ON public.staff_details;

-- Impedir acceso directo a datos personales.
-- Las funciones SECURITY DEFINER mantienen el flujo autorizado.
REVOKE ALL PRIVILEGES
ON TABLE public.staff_details
FROM PUBLIC, anon, authenticated;

-- =========================================================
-- VERIFICACIÓN FINAL
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff_details'
  ) THEN
    RAISE EXCEPTION 'Quedaron políticas inesperadas en staff_details';
  END IF;

  IF has_table_privilege(
    'authenticated',
    'public.staff_details',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.staff_details',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.staff_details',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.staff_details',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'authenticated conserva permisos directos inesperados';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.list_team()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.save_staff_details(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Se perdió el acceso a las funciones autorizadas';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.staff_details'::regclass
      AND tgname = 'trg_company_subscription_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Se perdió el trigger de suscripción';
  END IF;
END;
$$;

COMMIT;
