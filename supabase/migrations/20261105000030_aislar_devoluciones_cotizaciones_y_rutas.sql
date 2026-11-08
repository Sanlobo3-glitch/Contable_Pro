BEGIN;

-- ============================================================
-- 000030: AISLAMIENTO DE DEVOLUCIONES, COTIZACIONES Y RUTAS
-- Administrador central: CRUD únicamente en su empresa.
-- Conserva las políticas empresariales existentes.
-- ============================================================

DO $$
DECLARE
  v_table text;
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
    IF to_regclass(format('public.%I',v_table)) IS NULL THEN
      RAISE EXCEPTION 'Falta tabla %',v_table;
    END IF;

    IF NOT (
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid=to_regclass(format('public.%I',v_table))
    ) THEN
      RAISE EXCEPTION 'RLS deshabilitado en %',v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=v_table
        AND column_name='company_id'
        AND data_type='uuid'
    ) THEN
      RAISE EXCEPTION 'Falta company_id UUID en %',v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname='public'
        AND tablename=v_table
        AND policyname='platform_admin_all'
        AND cmd='ALL'
        AND roles=ARRAY['authenticated']::name[]
    ) THEN
      RAISE EXCEPTION 'No existe platform_admin_all esperada en %',v_table;
    END IF;

    IF (
      SELECT count(*)
      FROM pg_policies
      WHERE schemaname='public'
        AND tablename=v_table
    ) <> 2 THEN
      RAISE EXCEPTION 'Número inesperado de políticas en %',v_table;
    END IF;
  END LOOP;

  IF to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'Faltan funciones de autorización';
  END IF;
END;
$$;

-- Retirar el bypass global.
DROP POLICY platform_admin_all ON public.devolutions;
DROP POLICY platform_admin_all ON public.purchase_devolutions;
DROP POLICY platform_admin_all ON public.quotations;
DROP POLICY platform_admin_all ON public.route_dispatch_items;
DROP POLICY platform_admin_all ON public.route_dispatches;
DROP POLICY platform_admin_all ON public.route_plans;
DROP POLICY platform_admin_all ON public.route_stops;
DROP POLICY platform_admin_all ON public.sale_lot_moves;

-- Administrador central: CRUD limitado a su propia empresa.
CREATE POLICY platform_admin_company_all
ON public.devolutions
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

CREATE POLICY platform_admin_company_all
ON public.purchase_devolutions
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

CREATE POLICY platform_admin_company_all
ON public.quotations
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

CREATE POLICY platform_admin_company_all
ON public.route_dispatch_items
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

CREATE POLICY platform_admin_company_all
ON public.route_dispatches
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

CREATE POLICY platform_admin_company_all
ON public.route_plans
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

CREATE POLICY platform_admin_company_all
ON public.route_stops
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

CREATE POLICY platform_admin_company_all
ON public.sale_lot_moves
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id=public.current_company_id()
);

-- Restringir las políticas que estaban asignadas a PUBLIC.
DROP POLICY purchase_devolutions_select
ON public.purchase_devolutions;

CREATE POLICY purchase_devolutions_select
ON public.purchase_devolutions
FOR SELECT TO authenticated
USING (company_id=public.current_company_id());

DROP POLICY route_dispatch_items_select
ON public.route_dispatch_items;

CREATE POLICY route_dispatch_items_select
ON public.route_dispatch_items
FOR SELECT TO authenticated
USING (company_id=public.current_company_id());

DROP POLICY route_dispatches_select
ON public.route_dispatches;

CREATE POLICY route_dispatches_select
ON public.route_dispatches
FOR SELECT TO authenticated
USING (
  company_id=public.current_company_id()
  AND (
    seller_id=auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id=auth.uid()
        AND p.role IN ('dueno','admin')
        AND p.active=true
    )
  )
);

-- Anon no debe acceder directamente a estas tablas.
REVOKE ALL PRIVILEGES
ON TABLE
  public.purchase_devolutions,
  public.route_dispatches,
  public.route_dispatch_items
FROM anon;

-- Verificación final.
DO $$
DECLARE
  v_table text;
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
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public'
        AND tablename=v_table
        AND policyname='platform_admin_all'
    ) THEN
      RAISE EXCEPTION 'Permiso global todavía presente en %',v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public'
        AND tablename=v_table
        AND policyname='platform_admin_company_all'
        AND cmd='ALL'
        AND roles=ARRAY['authenticated']::name[]
        AND qual ILIKE '%company_id%'
        AND qual ILIKE '%current_company_id%'
        AND with_check ILIKE '%company_id%'
        AND with_check ILIKE '%current_company_id%'
    ) THEN
      RAISE EXCEPTION 'Falta política CRUD aislada en %',v_table;
    END IF;

    IF (
      SELECT count(*)
      FROM pg_policies
      WHERE schemaname='public'
        AND tablename=v_table
    ) <> 2 THEN
      RAISE EXCEPTION 'Cantidad inesperada de políticas en %',v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN (
        'purchase_devolutions',
        'route_dispatches',
        'route_dispatch_items'
      )
      AND grantee='anon'
  ) THEN
    RAISE EXCEPTION 'Anon conserva privilegios directos';
  END IF;
END;
$$;

COMMIT;
