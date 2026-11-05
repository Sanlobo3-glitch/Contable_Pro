
-- =============================================================================
-- 000029 - AISLAR SUSCRIPCIONES POR EMPRESA
-- VERSIÓN CORREGIDA
--
-- Elimina el bypass global platform_admin_all.
-- Conserva las restricciones de lectura por empresa y rol.
-- No modifica funciones RPC, grants ni datos.
-- =============================================================================

BEGIN;

-- 1. PREFLIGHT: tablas, RLS y columnas.

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'company_subscriptions',
    'subscriptions'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'No existe public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'RLS no está habilitado en %', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
        AND data_type = 'uuid'
    ) THEN
      RAISE EXCEPTION 'Falta company_id UUID en %', v_table;
    END IF;
  END LOOP;
END;
$$;

-- 2. PREFLIGHT: confirmar las dos políticas originales por tabla.

DO $$
DECLARE
  v_table text;
  v_tenant_policy text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'company_subscriptions',
    'subscriptions'
  ]
  LOOP
    v_tenant_policy :=
      CASE
        WHEN v_table = 'company_subscriptions'
          THEN 'company_subscriptions_read'
        ELSE 'subscriptions_company_read'
      END;

    IF (
      SELECT count(*)
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
    ) <> 2 THEN
      RAISE EXCEPTION
        'Preflight: % no tiene exactamente las dos políticas esperadas',
        v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = v_tenant_policy
        AND cmd = 'SELECT'
        AND roles = ARRAY['authenticated']::name[]
    ) THEN
      RAISE EXCEPTION
        'Preflight: falta la política de lectura %',
        v_tenant_policy;
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
        'Preflight: falta platform_admin_all en %',
        v_table;
    END IF;
  END LOOP;
END;
$$;

-- 3. RETIRAR LOS BYPASS GLOBALES.

DROP POLICY platform_admin_all
ON public.company_subscriptions;

DROP POLICY platform_admin_all
ON public.subscriptions;

-- 4. RECONSTRUIR LECTURA DE SUSCRIPCIONES DE LA EMPRESA.

DROP POLICY company_subscriptions_read
ON public.company_subscriptions;

CREATE POLICY company_subscriptions_read
ON public.company_subscriptions
FOR SELECT
TO authenticated
USING (
  company_id = public.my_company()
);

-- 5. RECONSTRUIR LECTURA DE SUSCRIPCIONES PARA GESTORES.

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

-- 6. VERIFICACIONES FINALES.

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_subscriptions';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'company_subscriptions debe conservar una política; encontradas: %',
      v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_subscriptions'
      AND policyname = 'company_subscriptions_read'
      AND cmd = 'SELECT'
      AND qual = '(company_id = my_company())'
  ) THEN
    RAISE EXCEPTION
      'La política company_subscriptions_read no quedó correctamente aislada';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'subscriptions';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'subscriptions debe conservar una política; encontradas: %',
      v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscriptions'
      AND policyname = 'subscriptions_company_read'
      AND cmd = 'SELECT'
      AND qual = '(company_id = my_company()) AND is_manager()'
  ) THEN
    RAISE EXCEPTION
      'La política subscriptions_company_read no quedó correctamente aislada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('company_subscriptions', 'subscriptions')
      AND policyname = 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION
      'Todavía existe platform_admin_all en las tablas de suscripciones';
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- FIN 000029 CORREGIDA
-- =============================================================================
