
BEGIN;

-- ============================================================
-- 000019: AISLAMIENTO DE CONFIGURACION DE EMPRESA
-- Tabla: public.company_config
-- Sin acceso tecnico directo
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.company_config') IS NULL THEN
    RAISE EXCEPTION 'No existe public.company_config';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'company_config'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no esta habilitado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_config'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Falta company_id UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_config'
      AND policyname = 'company_config_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Falta company_config_select';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_config'
      AND policyname = 'company_config_write'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'Falta company_config_write';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_config'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No se encontro platform_admin_all';
  END IF;
END;
$$;

-- Retirar acceso global del administrador de plataforma.
DROP POLICY platform_admin_all
ON public.company_config;

-- No crear politicas de soporte tecnico.
-- No modificar permisos ni politicas propias de empresa.

DO $$
DECLARE
  v_global integer;
  v_select integer;
  v_write integer;
  v_support integer;
BEGIN
  SELECT count(*) INTO v_global
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_config'
    AND policyname = 'platform_admin_all';

  IF v_global <> 0 THEN
    RAISE EXCEPTION 'Permanece el acceso global';
  END IF;

  SELECT count(*) INTO v_select
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_config'
    AND policyname = 'company_config_select'
    AND cmd = 'SELECT';

  IF v_select <> 1 THEN
    RAISE EXCEPTION 'No se preservo la lectura de empresa';
  END IF;

  SELECT count(*) INTO v_write
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_config'
    AND policyname = 'company_config_write'
    AND cmd = 'ALL';

  IF v_write <> 1 THEN
    RAISE EXCEPTION 'No se preservo la escritura de empresa';
  END IF;

  SELECT count(*) INTO v_support
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_config'
    AND policyname LIKE 'support_%';

  IF v_support <> 0 THEN
    RAISE EXCEPTION 'No se permite acceso tecnico en esta tabla';
  END IF;
END;
$$;

COMMIT;
