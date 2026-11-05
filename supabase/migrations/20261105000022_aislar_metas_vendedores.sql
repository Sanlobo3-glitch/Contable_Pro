
BEGIN;

-- =========================================================
-- 000022: AISLAR METAS DE VENDEDORES
-- Retira el acceso global del administrador de plataforma.
-- No concede acceso directo a usuarios ni a soporte.
-- =========================================================

DO $$
DECLARE
  v_rls boolean;
BEGIN
  IF to_regclass('public.seller_goals') IS NULL THEN
    RAISE EXCEPTION 'No existe public.seller_goals';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'seller_goals';

  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RLS no está habilitado en seller_goals';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'seller_goals'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'No existe company_id UUID en seller_goals';
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
      'Hay políticas adicionales no auditadas en seller_goals';
  END IF;

  IF has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'DELETE'
  ) THEN
    RAISE EXCEPTION
      'authenticated tiene permisos directos inesperados en seller_goals';
  END IF;
END;
$$;

DROP POLICY platform_admin_all
ON public.seller_goals;

-- =========================================================
-- VERIFICACIÓN FINAL
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'seller_goals'
      AND policyname = 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION
      'Sigue existiendo platform_admin_all en seller_goals';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'seller_goals'
  ) THEN
    RAISE EXCEPTION
      'Se encontraron políticas inesperadas en seller_goals';
  END IF;

  IF has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.seller_goals',
    'DELETE'
  ) THEN
    RAISE EXCEPTION
      'Se detectaron permisos directos para authenticated';
  END IF;
END;
$$;

COMMIT;
