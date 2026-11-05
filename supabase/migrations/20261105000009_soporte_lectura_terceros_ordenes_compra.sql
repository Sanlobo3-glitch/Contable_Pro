
BEGIN;

-- =========================================================
-- 000009: SOPORTE DE LECTURA PARA TERCEROS Y ORDENES
-- Requiere 000003.
-- No concede escritura al equipo técnico.
-- =========================================================

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
      RAISE EXCEPTION 'No existe la tabla public.%', v_table;
    END IF;

    IF NOT (
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = to_regclass('public.' || v_table)
    ) THEN
      RAISE EXCEPTION 'RLS no está habilitado en public.%', v_table;
    END IF;
  END LOOP;

  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Falta support_has_active_authorization. Aplicar primero 000003';
  END IF;
END;
$$;

-- 1. CLIENTES
-- Se conserva customers_company para los usuarios de la empresa.
-- Se elimina el acceso global de plataforma.

DROP POLICY IF EXISTS platform_admin_all ON public.customers;

CREATE POLICY support_customers_select
ON public.customers
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'customers',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'customers',
    'intervencion_asistida'
  )
);

-- 2. PROVEEDORES
-- Se conservan suppliers_select y suppliers_write.

DROP POLICY IF EXISTS platform_admin_all ON public.suppliers;

CREATE POLICY support_suppliers_select
ON public.suppliers
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'suppliers',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'suppliers',
    'intervencion_asistida'
  )
);

-- 3. CREDITO DE PROVEEDORES
-- Se conserva supplier_credit_select.

DROP POLICY IF EXISTS platform_admin_all ON public.supplier_credit;

CREATE POLICY support_supplier_credit_select
ON public.supplier_credit
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'suppliers',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'suppliers',
    'intervencion_asistida'
  )
);

-- 4. ORDENES DE COMPRA
-- La política normal purchase_orders_select se conserva.

CREATE POLICY support_purchase_orders_select
ON public.purchase_orders
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'purchaseorders',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'purchaseorders',
    'intervencion_asistida'
  )
);

-- 5. DETALLE DE ORDENES DE COMPRA
-- La política normal purchase_order_items_select se conserva.

CREATE POLICY support_purchase_order_items_select
ON public.purchase_order_items
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'purchaseorders',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'purchaseorders',
    'intervencion_asistida'
  )
);

-- 6. VERIFICACIONES
DO $$
DECLARE
  v_count integer;
  v_global_count integer;
BEGIN
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
      'Se esperaban 5 políticas de soporte; encontradas: %',
      v_count;
  END IF;

  SELECT count(*)
  INTO v_global_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'customers',
      'suppliers',
      'supplier_credit'
    )
    AND policyname = 'platform_admin_all';

  IF v_global_count <> 0 THEN
    RAISE EXCEPTION
      'Persisten políticas de acceso global en terceros';
  END IF;
END;
$$;

COMMIT;
