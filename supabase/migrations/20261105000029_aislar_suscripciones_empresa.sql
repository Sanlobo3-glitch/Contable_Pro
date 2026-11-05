
BEGIN;

-- =========================================================
-- 000029: AISLAR SUSCRIPCIONES POR EMPRESA
-- Retira el bypass de administrador global en dos tablas.
-- Conserva los accesos propios de cada empresa y sus roles.
-- No modifica RPC, funciones, grants ni datos.
-- =========================================================

DO $$
DECLARE
  v_count integer;
BEGIN
  -- 1. Preflight: tablas y RLS
  IF to_regclass('public.company_subscriptions') IS NULL THEN
    RAISE EXCEPTION 'Preflight: falta company_subscriptions';
  END IF;

  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE EXCEPTION 'Preflight: falta subscriptions';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.company_subscriptions'::regclass
  ) THEN
    RAISE EXCEPTION 'Preflight: RLS deshabilitado en company_subscriptions';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.subscriptions'::regclass
  ) THEN
    RAISE EXCEPTION 'Preflight: RLS deshabilitado en subscriptions';
  END IF;

  -- 2. Preflight: columnas company_id UUID
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Preflight: company_subscriptions.company_id no es UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Preflight: subscriptions.company_id no es UUID';
  END IF;

  -- 3. Preflight: políticas esperadas
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_subscriptions'
      AND policyname = 'company_subscriptions_read'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Preflight: falta company_subscriptions_read';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscriptions'
      AND policyname = 'subscriptions_company_read'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Preflight: falta subscriptions_company_read';
  END IF;

  -- No continuar si existen políticas adicionales
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_subscriptions';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Preflight: company_subscriptions tiene % políticas; se esperaba 1',
      v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'subscriptions';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Preflight: subscriptions tiene % políticas; se esperaba 1',
      v_count;
  END IF;
END;
$$;

-- =========================================================
-- 4. COMPANY_SUBSCRIPTIONS
-- Conserva lectura de la suscripción de la propia empresa.
-- Elimina únicamente el bypass de administrador global.
-- =========================================================

DROP POLICY company_subscriptions_read
ON public.company_subscriptions;

CREATE POLICY company_subscriptions_read
ON public.company_subscriptions
FOR SELECT
TO authenticated
USING (
  company_id = public.my_company()
);

-- =========================================================
-- 5. SUBSCRIPTIONS
-- Conserva lectura para administradores de su empresa.
-- Elimina únicamente el bypass de administrador global.
-- =========================================================

DROP POLICY subscriptions_company_read
ON public.subscriptions;

CREATE POLICY subscriptions_company_read
ON public.subscriptions
FOR SELECT
TO authenticated
USING (
  company_id = public.my_company()
  AND public.is_manager()
);

-- =========================================================
-- 6. Verificación final
-- =========================================================

DO $$
DECLARE
  v_count integer;
  v_qual text;
BEGIN
  -- company_subscriptions: una política de lectura
  SELECT count(*), max(qual)
  INTO v_count, v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_subscriptions'
    AND policyname = 'company_subscriptions_read'
    AND cmd = 'SELECT'
    AND 'authenticated' = ANY(roles);

  IF v_count <> 1 OR v_qual NOT ILIKE '%my_company%' THEN
    RAISE EXCEPTION
      'Verificación fallida: company_subscriptions_read';
  END IF;

  IF v_qual ILIKE '%is_platform_admin%' THEN
    RAISE EXCEPTION
      'Verificación fallida: bypass global en company_subscriptions';
  END IF;

  -- subscriptions: una política de lectura
  SELECT count(*), max(qual)
  INTO v_count, v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'subscriptions'
    AND policyname = 'subscriptions_company_read'
    AND cmd = 'SELECT'
    AND 'authenticated' = ANY(roles);

  IF v_count <> 1
     OR v_qual NOT ILIKE '%my_company%'
     OR v_qual NOT ILIKE '%is_manager%' THEN
    RAISE EXCEPTION
      'Verificación fallida: subscriptions_company_read';
  END IF;

  IF v_qual ILIKE '%is_platform_admin%' THEN
    RAISE EXCEPTION
      'Verificación fallida: bypass global en subscriptions';
  END IF;

  -- Confirmar que no aparecieron políticas adicionales
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('company_subscriptions', 'subscriptions');

  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'Verificación fallida: se esperaban 2 políticas y existen %',
      v_count;
  END IF;
END;
$$;

COMMIT;
