BEGIN;

-- ============================================================
-- 000016 - AISLAMIENTO Y SEGURIDAD DEL MODULO DE IA
-- Retira el bypass del administrador global.
-- Conserva las politicas propias de cada empresa y usuario.
-- No concede acceso de soporte a consultas ni datos de IA.
-- ============================================================

-- 1. PREVALIDACIONES
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'ai_cache',
    'ai_company_settings',
    'ai_proposals',
    'ai_queries',
    'ai_usage_daily'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Falta la tabla public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND rowsecurity = TRUE
    ) THEN
      RAISE EXCEPTION 'RLS no esta habilitado en public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
        AND data_type = 'uuid'
    ) THEN
      RAISE EXCEPTION 'Falta company_id UUID en public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = 'platform_admin_all'
        AND cmd = 'ALL'
    ) THEN
      RAISE EXCEPTION
        'No existe la politica platform_admin_all esperada en public.%',
        v_table;
    END IF;
  END LOOP;

  -- Comprobar que las politicas originales de empresa existen.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_company_settings'
      AND policyname = 'ai_company_settings_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Falta ai_company_settings_select';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_proposals'
      AND policyname = 'ai_proposals_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Falta ai_proposals_select';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_queries'
      AND policyname = 'ai_queries_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Falta ai_queries_select';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_usage_daily'
      AND policyname = 'ai_usage_daily_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Falta ai_usage_daily_select';
  END IF;
END;
$$;

-- ============================================================
-- 2. RETIRAR EL ACCESO GLOBAL DEL ADMINISTRADOR DE PLATAFORMA
-- ============================================================

DROP POLICY platform_admin_all ON public.ai_cache;
DROP POLICY platform_admin_all ON public.ai_company_settings;
DROP POLICY platform_admin_all ON public.ai_proposals;
DROP POLICY platform_admin_all ON public.ai_queries;
DROP POLICY platform_admin_all ON public.ai_usage_daily;

-- ============================================================
-- 3. VERIFICACIONES DE SEGURIDAD
-- ============================================================

DO $$
DECLARE
  v_remaining INTEGER;
  v_policy_count INTEGER;
BEGIN

  -- No debe quedar ningun bypass global.
  SELECT COUNT(*)
  INTO v_remaining
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'ai_cache',
      'ai_company_settings',
      'ai_proposals',
      'ai_queries',
      'ai_usage_daily'
    )
    AND policyname = 'platform_admin_all';

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION
      'Persisten % politicas platform_admin_all en tablas de IA',
      v_remaining;
  END IF;

  -- Deben conservarse las cuatro politicas originales.
  SELECT COUNT(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'ai_company_settings'
        AND policyname = 'ai_company_settings_select')
      OR
      (tablename = 'ai_proposals'
        AND policyname = 'ai_proposals_select')
      OR
      (tablename = 'ai_queries'
        AND policyname = 'ai_queries_select')
      OR
      (tablename = 'ai_usage_daily'
        AND policyname = 'ai_usage_daily_select')
    )
    AND cmd = 'SELECT';

  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION
      'Se esperaban 4 politicas originales de IA; encontradas: %',
      v_policy_count;
  END IF;

  -- ai_cache no debe tener privilegios directos para authenticated.
  IF has_table_privilege(
    'authenticated',
    'public.ai_cache',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.ai_cache',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.ai_cache',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.ai_cache',
    'DELETE'
  ) THEN
    RAISE EXCEPTION
      'ai_cache tiene privilegios directos inesperados para authenticated';
  END IF;

  -- Ninguna tabla de este grupo debe tener privilegios anon.
  IF
    has_table_privilege('anon', 'public.ai_cache', 'SELECT')
    OR has_table_privilege('anon', 'public.ai_company_settings', 'SELECT')
    OR has_table_privilege('anon', 'public.ai_proposals', 'SELECT')
    OR has_table_privilege('anon', 'public.ai_queries', 'SELECT')
    OR has_table_privilege('anon', 'public.ai_usage_daily', 'SELECT')
  THEN
    RAISE EXCEPTION
      'Se detectaron privilegios SELECT anon en tablas de IA';
  END IF;

END;
$$;

COMMIT;
