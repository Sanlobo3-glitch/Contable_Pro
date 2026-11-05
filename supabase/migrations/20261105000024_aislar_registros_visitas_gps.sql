
BEGIN;

-- =========================================================
-- 000024: AISLAR REGISTROS DE VISITAS Y GPS
-- Mantiene la lectura de gestores de su propia empresa.
-- Las escrituras continúan mediante RPC autorizadas.
-- No concede acceso GPS al soporte técnico.
-- =========================================================

DO $$
DECLARE
  v_rls boolean;
BEGIN
  IF to_regclass('public.visits') IS NULL THEN
    RAISE EXCEPTION 'No existe public.visits';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'visits';

  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RLS no está habilitado en visits';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'visits'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Falta company_id UUID en visits';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'visits'
      AND policyname = 'visits_select_managers'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'No existe la política de lectura de gestores';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'visits'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No existe la política global esperada';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'visits'
  ) <> 2 THEN
    RAISE EXCEPTION 'Hay políticas adicionales no auditadas en visits';
  END IF;

  IF to_regprocedure(
    'public._record_visit(uuid,uuid,uuid,text,jsonb)'
  ) IS NULL
     OR to_regprocedure(
       'public.registrar_visita(uuid,jsonb,uuid,timestamp with time zone)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Faltan funciones de registro de visitas';
  END IF;

  IF NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public._record_visit(uuid,uuid,uuid,text,jsonb)'::regprocedure
  ) OR NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public.registrar_visita(uuid,jsonb,uuid,timestamp with time zone)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Las funciones de registro deben conservar SECURITY DEFINER';
  END IF;
END;
$$;

-- Retirar el acceso global de plataforma.
DROP POLICY platform_admin_all
ON public.visits;

-- =========================================================
-- VERIFICACIÓN FINAL
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'visits'
      AND policyname = 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION 'Sigue existiendo el acceso global a visits';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'visits'
      AND policyname = 'visits_select_managers'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Se perdió la política de lectura de gestores';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'visits'
  ) <> 1 THEN
    RAISE EXCEPTION 'El conjunto final de políticas no es el esperado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'visits'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Existe una política directa de escritura inesperada';
  END IF;

  IF NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public._record_visit(uuid,uuid,uuid,text,jsonb)'::regprocedure
  ) OR NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public.registrar_visita(uuid,jsonb,uuid,timestamp with time zone)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Se alteró la seguridad de las funciones de registro';
  END IF;
END;
$$;

COMMIT;
