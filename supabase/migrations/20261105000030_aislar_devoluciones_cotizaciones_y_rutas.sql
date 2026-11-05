
BEGIN;

-- =========================================================
-- 000030: AISLAMIENTO DE DEVOLUCIONES, COTIZACIONES Y RUTAS
--
-- Retira el acceso global del administrador de plataforma.
-- Restringe tres políticas PUBLIC a authenticated.
-- Revoca privilegios directos de anon en esas tres tablas.
--
-- Conserva políticas empresariales, permisos authenticated,
-- triggers, funciones y datos.
-- =========================================================

DO $$
DECLARE
  v_table text;
  v_count integer;
  v_policy text;
  v_tables text[] := ARRAY[
    'devolutions',
    'purchase_devolutions',
    'quotations',
    'route_dispatch_items',
    'route_dispatches',
    'route_plans',
    'route_stops',
    'sale_lot_moves'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP

    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Preflight: falta la tabla %', v_table;
    END IF;

    IF NOT (
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = to_regclass(format('public.%I', v_table))
    ) THEN
      RAISE EXCEPTION 'Preflight: RLS deshabilitado en %', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
        AND data_type = 'uuid'
    ) THEN
      RAISE EXCEPTION 'Preflight: falta company_id UUID en %', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = 'platform_admin_all'
        AND cmd = 'ALL'
    ) THEN
      RAISE EXCEPTION 'Preflight: falta platform_admin_all en %', v_table;
    END IF;

    SELECT count(*) INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = v_table;

    IF v_count <> 2 THEN
      RAISE EXCEPTION
        'Preflight: % tiene % políticas; se esperaban 2',
        v_table, v_count;
    END IF;

  END LOOP;

  -- Políticas empresariales que deben conservarse.
  FOREACH v_policy IN ARRAY ARRAY[
    'devolutions_select',
    'purchase_devolutions_select',
    'quotations_company',
    'route_dispatch_items_select',
    'route_dispatches_select',
    'route_plans_select',
    'route_stops_select',
    'sale_lot_moves_select'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname = v_policy
    ) THEN
      RAISE EXCEPTION 'Preflight: falta política %', v_policy;
    END IF;
  END LOOP;
END;
$$;

-- =========================================================
-- 1. Retirar las políticas globales
-- =========================================================

DROP POLICY platform_admin_all ON public.devolutions;
DROP POLICY platform_admin_all ON public.purchase_devolutions;
DROP POLICY platform_admin_all ON public.quotations;
DROP POLICY platform_admin_all ON public.route_dispatch_items;
DROP POLICY platform_admin_all ON public.route_dispatches;
DROP POLICY platform_admin_all ON public.route_plans;
DROP POLICY platform_admin_all ON public.route_stops;
DROP POLICY platform_admin_all ON public.sale_lot_moves;

-- =========================================================
-- 2. Restringir políticas PUBLIC a authenticated
-- =========================================================

DROP POLICY purchase_devolutions_select
ON public.purchase_devolutions;

CREATE POLICY purchase_devolutions_select
ON public.purchase_devolutions
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
);

DROP POLICY route_dispatch_items_select
ON public.route_dispatch_items;

CREATE POLICY route_dispatch_items_select
ON public.route_dispatch_items
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
);

DROP POLICY route_dispatches_select
ON public.route_dispatches;

CREATE POLICY route_dispatches_select
ON public.route_dispatches
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND (
    seller_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('dueno', 'admin')
        AND p.active = true
    )
  )
);

-- =========================================================
-- 3. Revocar privilegios directos de anon
-- =========================================================

REVOKE ALL PRIVILEGES
ON TABLE
  public.purchase_devolutions,
  public.route_dispatches,
  public.route_dispatch_items
FROM anon;

-- =========================================================
-- 4. Verificaciones finales
-- =========================================================

DO $$
DECLARE
  v_table text;
  v_count integer;
  v_tables text[] := ARRAY[
    'devolutions',
    'purchase_devolutions',
    'quotations',
    'route_dispatch_items',
    'route_dispatches',
    'route_plans',
    'route_stops',
    'sale_lot_moves'
  ];
BEGIN
  -- Ninguna política global debe permanecer.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY(v_tables)
    AND policyname = 'platform_admin_all';

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'Verificación fallida: quedan % políticas globales',
      v_count;
  END IF;

  -- Deben permanecer exactamente dos políticas por tabla:
  -- la política empresarial y la política global ya retirada.
  -- Después del cambio debe quedar una por tabla.
  FOREACH v_table IN ARRAY v_tables LOOP

    SELECT count(*) INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = v_table;

    IF v_count <> 1 THEN
      RAISE EXCEPTION
        'Verificación fallida: % tiene % políticas; se esperaba 1',
        v_table, v_count;
    END IF;

  END LOOP;

  -- Confirmar que las tres políticas restringidas son authenticated.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_devolutions'
      AND policyname = 'purchase_devolutions_select'
      AND roles = ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION
      'Verificación fallida: purchase_devolutions_select';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'route_dispatch_items'
      AND policyname = 'route_dispatch_items_select'
      AND roles = ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION
      'Verificación fallida: route_dispatch_items_select';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'route_dispatches'
      AND policyname = 'route_dispatches_select'
      AND roles = ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION
      'Verificación fallida: route_dispatches_select';
  END IF;

  -- Confirmar que anon no conserva privilegios directos.
  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (
        'purchase_devolutions',
        'route_dispatches',
        'route_dispatch_items'
      )
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION
      'Verificación fallida: anon conserva privilegios';
  END IF;

END;
$$;

COMMIT;
