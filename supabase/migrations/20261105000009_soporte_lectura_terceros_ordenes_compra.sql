
BEGIN;

-- =========================================================
-- 000009: TERCEROS Y ORDENES DE COMPRA
--
-- Administrador central:
-- CRUD completo exclusivamente en su empresa de pruebas.
--
-- Usuarios empresariales:
-- Conservan sus políticas normales.
--
-- Soporte:
-- Solo SELECT con autorización temporal.
--
-- Requiere 000003.
-- =========================================================

-- 1. PREVALIDACIONES
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'customers',
    'suppliers',
    'supplier_credit',
    'purchase_orders',
    'purchase_order_items'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'No existe public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class
      WHERE oid = to_regclass('public.' || v_table)
        AND relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'RLS no habilitado en public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'Falta company_id en public.%', v_table;
    END IF;
  END LOOP;

  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Falta support_has_active_authorization. Requiere 000003';
  END IF;
END;
$$;

-- 2. CLIENTES
-- Eliminar acceso global anterior.
DROP POLICY IF EXISTS platform_admin_all ON public.customers;
DROP POLICY IF EXISTS platform_admin_company_all ON public.customers;
DROP POLICY IF EXISTS support_customers_select ON public.customers;

-- Control total central limitado a su empresa.
CREATE POLICY platform_admin_company_all
ON public.customers
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
);

-- Lectura temporal de soporte.
CREATE POLICY support_customers_select
ON public.customers
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'customers', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'customers', 'intervencion_asistida'
  )
);

-- 3. PROVEEDORES
DROP POLICY IF EXISTS platform_admin_all ON public.suppliers;
DROP POLICY IF EXISTS platform_admin_company_all ON public.suppliers;
DROP POLICY IF EXISTS support_suppliers_select ON public.suppliers;

CREATE POLICY platform_admin_company_all
ON public.suppliers
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
);

CREATE POLICY support_suppliers_select
ON public.suppliers
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'suppliers', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'suppliers', 'intervencion_asistida'
  )
);

-- 4. CREDITO DE PROVEEDORES
DROP POLICY IF EXISTS platform_admin_all ON public.supplier_credit;
DROP POLICY IF EXISTS platform_admin_company_all ON public.supplier_credit;
DROP POLICY IF EXISTS support_supplier_credit_select
ON public.supplier_credit;

CREATE POLICY platform_admin_company_all
ON public.supplier_credit
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
);

CREATE POLICY support_supplier_credit_select
ON public.supplier_credit
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'suppliers', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'suppliers', 'intervencion_asistida'
  )
);

-- 5. ORDENES DE COMPRA
DROP POLICY IF EXISTS platform_admin_company_all
ON public.purchase_orders;
DROP POLICY IF EXISTS support_purchase_orders_select
ON public.purchase_orders;

CREATE POLICY platform_admin_company_all
ON public.purchase_orders
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
);

CREATE POLICY support_purchase_orders_select
ON public.purchase_orders
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'purchaseorders', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'purchaseorders', 'intervencion_asistida'
  )
);

-- 6. DETALLES DE ORDENES DE COMPRA
DROP POLICY IF EXISTS platform_admin_company_all
ON public.purchase_order_items;
DROP POLICY IF EXISTS support_purchase_order_items_select
ON public.purchase_order_items;

CREATE POLICY platform_admin_company_all
ON public.purchase_order_items
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
);

CREATE POLICY support_purchase_order_items_select
ON public.purchase_order_items
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'purchaseorders', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'purchaseorders', 'intervencion_asistida'
  )
);

-- 7. VERIFICACION ESTRUCTURAL
DO $$
DECLARE
  v_count integer;
  v_table text;
  v_qual text;
  v_check text;
BEGIN
  -- Cinco políticas de administrador central.
  SELECT count(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'customers',
      'suppliers',
      'supplier_credit',
      'purchase_orders',
      'purchase_order_items'
    )
    AND policyname = 'platform_admin_company_all'
    AND cmd = 'ALL';

  IF v_count <> 5 THEN
    RAISE EXCEPTION
      'Se esperaban 5 políticas CRUD centrales; encontradas %',
      v_count;
  END IF;

  -- Cinco políticas de soporte.
  SELECT count(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'customers'
       AND policyname = 'support_customers_select')
      OR
      (tablename = 'suppliers'
       AND policyname = 'support_suppliers_select')
      OR
      (tablename = 'supplier_credit'
       AND policyname = 'support_supplier_credit_select')
      OR
      (tablename = 'purchase_orders'
       AND policyname = 'support_purchase_orders_select')
      OR
      (tablename = 'purchase_order_items'
       AND policyname = 'support_purchase_order_items_select')
    );

  IF v_count <> 5 THEN
    RAISE EXCEPTION
      'Se esperaban 5 políticas de soporte; encontradas %',
      v_count;
  END IF;

  -- Validar aislamiento de las cinco políticas centrales.
  FOREACH v_table IN ARRAY ARRAY[
    'customers',
    'suppliers',
    'supplier_credit',
    'purchase_orders',
    'purchase_order_items'
  ]
  LOOP
    SELECT qual, with_check
    INTO v_qual, v_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = v_table
      AND policyname = 'platform_admin_company_all';

    IF v_qual IS NULL
       OR v_check IS NULL
       OR v_qual NOT ILIKE '%is_platform_admin%'
       OR v_qual NOT ILIKE '%current_company_id%'
       OR v_check NOT ILIKE '%is_platform_admin%'
       OR v_check NOT ILIKE '%current_company_id%' THEN
      RAISE EXCEPTION
        'Aislamiento central incorrecto en %', v_table;
    END IF;
  END LOOP;

  -- No debe quedar el acceso global antiguo.
  SELECT count(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'customers',
      'suppliers',
      'supplier_credit'
    )
    AND policyname = 'platform_admin_all';

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'Persisten políticas globales de administrador';
  END IF;

  RAISE NOTICE
    '000009 validada: 5 políticas CRUD centrales, 5 de soporte y aislamiento por empresa';
END;
$$;

COMMIT;
