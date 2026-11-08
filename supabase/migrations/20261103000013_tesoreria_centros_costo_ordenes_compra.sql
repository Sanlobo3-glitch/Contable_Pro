-- =============================================================================
-- InventarioPro · Tesorería/Presupuesto, Centros de Costo y Órdenes de Compra
-- =============================================================================
-- Qué habilita esta migración:
--   1. CENTROS DE COSTO POR SUCURSAL:
--      - Añade branch_id opcional a sales, purchases, expenses y acc_entries.
--      - Función segura asignar_centro_costo_operacion(...) para imputar
--        ingresos, compras y gastos por unidad de negocio / sede.
--   2. PRESUPUESTO MAESTRO MENSUAL (financial_budgets):
--      - Metas de ingresos y techos presupuestarios de compras, gastos y nómina
--        por mes y sucursal (o consolidado corporativo).
--   3. ÓRDENES DE COMPRA Y RECEPCIÓN AUDITADA (purchase_orders, purchase_order_items):
--      - Ciclo formal: draft -> approved -> sent -> partial / received / cancelled.
--      - Recepción auditada en bodega conectada transaccionalmente con
--        registrar_compra (Kardex, costo promedio, lotes, Caja/CxP y Contabilidad)
--        y con warehouse_stock / warehouse_movements.
--
-- Idempotente: seguro de ejecutar múltiples veces en Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CENTROS DE COSTO POR SUCURSAL EN OPERACIONES EXISTENTES
-- =============================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.acc_entries ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_company_branch ON public.sales (company_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_purchases_company_branch ON public.purchases (company_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_company_branch ON public.expenses (company_id, branch_id);

CREATE OR REPLACE FUNCTION public.asignar_centro_costo_operacion(
  p_table text,
  p_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
BEGIN
  IF p_branch_id IS NOT NULL THEN
    PERFORM 1 FROM public.branches WHERE id = p_branch_id AND company_id = v_co;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La sucursal indicada no pertenece a tu empresa';
    END IF;
  END IF;

  IF p_table = 'expenses' THEN
    UPDATE public.expenses SET branch_id = p_branch_id WHERE id = p_id AND company_id = v_co;
  ELSIF p_table = 'purchases' THEN
    UPDATE public.purchases SET branch_id = p_branch_id WHERE id = p_id AND company_id = v_co;
  ELSIF p_table = 'sales' THEN
    UPDATE public.sales SET branch_id = p_branch_id WHERE id = p_id AND company_id = v_co;
  ELSIF p_table = 'acc_entries' THEN
    UPDATE public.acc_entries SET branch_id = p_branch_id WHERE id = p_id AND company_id = v_co;
  ELSE
    RAISE EXCEPTION 'Tabla no soportada para imputación de centro de costo: %', p_table;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.asignar_centro_costo_operacion(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignar_centro_costo_operacion(text, uuid, uuid) TO authenticated, service_role;


-- =============================================================================
-- 2. PRESUPUESTO MAESTRO MENSUAL (financial_budgets)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.financial_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  period_month date NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('ingreso_ventas', 'costo_compras', 'gasto_operativo', 'nomina')),
  category_name text NOT NULL,
  budget_amount numeric(14,2) NOT NULL CHECK (budget_amount >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_budgets_company_month
  ON public.financial_budgets (company_id, period_month, branch_id);

ALTER TABLE public.financial_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_budgets_select ON public.financial_budgets;
CREATE POLICY financial_budgets_select ON public.financial_budgets
  FOR SELECT USING (company_id = public.current_company_id());

DROP TRIGGER IF EXISTS financial_budgets_check_subscription ON public.financial_budgets;
CREATE TRIGGER financial_budgets_check_subscription
  BEFORE INSERT OR DELETE OR UPDATE ON public.financial_budgets
  FOR EACH ROW EXECUTE FUNCTION public.assert_can_write();

CREATE OR REPLACE FUNCTION public.upsert_financial_budget(
  p_id uuid DEFAULT NULL,
  p_period_month date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_kind text DEFAULT 'gasto_operativo',
  p_category_name text DEFAULT NULL,
  p_budget_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
  v_month date := date_trunc('month', COALESCE(p_period_month, current_date))::date;
  v_id uuid;
BEGIN
  IF COALESCE(btrim(p_category_name), '') = '' THEN
    RAISE EXCEPTION 'Indica el rubro o categoría del presupuesto';
  END IF;
  IF COALESCE(p_budget_amount, -1) < 0 THEN
    RAISE EXCEPTION 'El monto presupuestado debe ser mayor o igual a cero';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.financial_budgets
       SET period_month = v_month,
           branch_id = p_branch_id,
           kind = p_kind,
           category_name = btrim(p_category_name),
           budget_amount = round(p_budget_amount, 2),
           notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
           updated_at = now()
     WHERE id = p_id AND company_id = v_co
     RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.financial_budgets (
    company_id, period_month, branch_id, kind, category_name, budget_amount, notes, created_by
  ) VALUES (
    v_co, v_month, p_branch_id, p_kind, btrim(p_category_name), round(p_budget_amount, 2),
    NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_financial_budget(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
BEGIN
  DELETE FROM public.financial_budgets WHERE id = p_id AND company_id = v_co;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_financial_budget(uuid, date, uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_financial_budget(uuid, date, uuid, text, text, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_financial_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_financial_budget(uuid) TO authenticated, service_role;


-- =============================================================================
-- 3. ÓRDENES DE COMPRA Y RECEPCIÓN AUDITADA EN BODEGA
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  po_number text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  target_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'partial', 'received', 'cancelled')),
  payment_terms text NOT NULL DEFAULT 'credito' CHECK (payment_terms IN ('efectivo', 'transferencia', 'tarjeta', 'credito')),
  credit_days integer NOT NULL DEFAULT 30 CHECK (credit_days >= 0 AND credit_days <= 365),
  expected_date date,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  linked_purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  created_by uuid,
  created_by_name text,
  approved_by_name text,
  approved_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  sku text,
  ordered_qty numeric(14,2) NOT NULL CHECK (ordered_qty > 0),
  received_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  rejected_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  lot_code text,
  expiry_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_created
  ON public.purchase_orders (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po
  ON public.purchase_order_items (company_id, po_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS purchase_order_items_select ON public.purchase_order_items;
CREATE POLICY purchase_order_items_select ON public.purchase_order_items
  FOR SELECT USING (company_id = public.current_company_id());

DROP TRIGGER IF EXISTS purchase_orders_check_subscription ON public.purchase_orders;
CREATE TRIGGER purchase_orders_check_subscription
  BEFORE INSERT OR DELETE OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.assert_can_write();

CREATE OR REPLACE FUNCTION public.crear_orden_compra(
  p_supplier_id uuid,
  p_items jsonb,
  p_branch_id uuid DEFAULT NULL,
  p_target_warehouse_id uuid DEFAULT NULL,
  p_payment_terms text DEFAULT 'credito',
  p_credit_days integer DEFAULT 30,
  p_expected_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_auto_approve boolean DEFAULT FALSE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
  v_po_id uuid;
  v_seq integer;
  v_po_number text;
  v_sup_name text := 'Proveedor general';
  v_actor_name text;
  v_total numeric(14,2) := 0;
  v_item jsonb;
  v_prod record;
  v_qty numeric;
  v_cost numeric;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto a la orden de compra';
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT name INTO v_sup_name FROM public.suppliers WHERE id = p_supplier_id AND company_id = v_co;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Proveedor no válido para esta empresa';
    END IF;
  END IF;

  SELECT COALESCE(full_name, email, 'Usuario') INTO v_actor_name
    FROM public.users WHERE id = auth.uid();

  SELECT COUNT(*) + 1 INTO v_seq FROM public.purchase_orders WHERE company_id = v_co;
  v_po_number := 'OC-' || lpad(v_seq::text, 4, '0');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((v_item->>'ordered_qty')::numeric, (v_item->>'quantity')::numeric, 0);
    v_cost := COALESCE((v_item->>'unit_cost')::numeric, (v_item->>'cost')::numeric, 0);
    IF v_qty <= 0 OR v_cost < 0 THEN
      RAISE EXCEPTION 'Cantidad y costo deben ser válidos en cada renglón';
    END IF;
    v_total := v_total + round(v_qty * v_cost, 2);
  END LOOP;

  INSERT INTO public.purchase_orders (
    company_id, po_number, supplier_id, supplier_name, branch_id, target_warehouse_id,
    status, payment_terms, credit_days, expected_date, subtotal, total, notes,
    created_by, created_by_name,
    approved_by_name, approved_at
  ) VALUES (
    v_co, v_po_number, p_supplier_id, v_sup_name, p_branch_id, p_target_warehouse_id,
    CASE WHEN p_auto_approve THEN 'approved' ELSE 'draft' END,
    COALESCE(p_payment_terms, 'credito'),
    COALESCE(p_credit_days, 30),
    p_expected_date, v_total, v_total,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    auth.uid(), v_actor_name,
    CASE WHEN p_auto_approve THEN v_actor_name ELSE NULL END,
    CASE WHEN p_auto_approve THEN now() ELSE NULL END
  )
  RETURNING id INTO v_po_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, name, sku INTO v_prod
      FROM public.products
     WHERE id = (v_item->>'product_id')::uuid AND company_id = v_co;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado en el catálogo de la empresa';
    END IF;

    v_qty := COALESCE((v_item->>'ordered_qty')::numeric, (v_item->>'quantity')::numeric, 0);
    v_cost := COALESCE((v_item->>'unit_cost')::numeric, (v_item->>'cost')::numeric, 0);

    INSERT INTO public.purchase_order_items (
      company_id, po_id, product_id, product_name, sku, ordered_qty, unit_cost
    ) VALUES (
      v_co, v_po_id, v_prod.id, v_prod.name, v_prod.sku, v_qty, v_cost
    );
  END LOOP;

  RETURN v_po_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_orden_compra(
  p_po_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
  v_cur text;
  v_actor text;
BEGIN
  SELECT status INTO v_cur FROM public.purchase_orders WHERE id = p_po_id AND company_id = v_co FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;
  IF v_cur IN ('received', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede modificar una orden ya cerrada o cancelada';
  END IF;
  IF p_status NOT IN ('approved', 'sent', 'cancelled') THEN
    RAISE EXCEPTION 'Estado de transición inválido';
  END IF;

  SELECT COALESCE(full_name, email, 'Usuario') INTO v_actor FROM public.users WHERE id = auth.uid();

  UPDATE public.purchase_orders
     SET status = p_status,
         approved_by_name = CASE WHEN p_status = 'approved' THEN v_actor ELSE approved_by_name END,
         approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END,
         updated_at = now()
   WHERE id = p_po_id AND company_id = v_co;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recibir_orden_compra(
  p_po_id uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_payment_method text DEFAULT NULL,
  p_credit_days integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
  v_po record;
  v_line jsonb;
  v_item record;
  v_rec_now numeric;
  v_rej_now numeric;
  v_unit_cost numeric;
  v_purchase_items jsonb := '[]'::jsonb;
  v_purchase_id uuid;
  v_all_fulfilled boolean := true;
  v_wh uuid;
  v_before numeric;
  v_after numeric;
  v_method text;
  v_days integer;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id AND company_id = v_co FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;
  IF v_po.status IN ('received', 'cancelled') THEN
    RAISE EXCEPTION 'Esta orden de compra ya fue recibida o cancelada';
  END IF;

  v_wh := COALESCE(p_warehouse_id, v_po.target_warehouse_id);
  v_method := COALESCE(p_payment_method, v_po.payment_terms, 'credito');
  v_days := COALESCE(p_credit_days, v_po.credit_days, 30);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_item
      FROM public.purchase_order_items
     WHERE id = (v_line->>'item_id')::uuid AND po_id = p_po_id AND company_id = v_co
     FOR UPDATE;

    IF NOT FOUND THEN CONTINUE; END IF;

    v_rec_now := GREATEST(0, COALESCE((v_line->>'received_now')::numeric, 0));
    v_rej_now := GREATEST(0, COALESCE((v_line->>'rejected_now')::numeric, 0));
    v_unit_cost := GREATEST(0, COALESCE((v_line->>'unit_cost')::numeric, v_item.unit_cost));

    IF v_rec_now > 0 THEN
      v_purchase_items := v_purchase_items || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'product_id', v_item.product_id,
          'product_name', v_item.product_name,
          'quantity', v_rec_now,
          'cost', v_unit_cost,
          'subtotal', round(v_rec_now * v_unit_cost, 2),
          'lot_code', NULLIF(btrim(COALESCE(v_line->>'lot_code', '')), ''),
          'expiry_date', NULLIF(btrim(COALESCE(v_line->>'expiry_date', '')), '')
        ))
      );
    END IF;

    UPDATE public.purchase_order_items
       SET received_qty = received_qty + v_rec_now,
           rejected_qty = rejected_qty + v_rej_now,
           unit_cost = v_unit_cost,
           lot_code = COALESCE(NULLIF(btrim(COALESCE(v_line->>'lot_code', '')), ''), lot_code),
           expiry_date = COALESCE(NULLIF(btrim(COALESCE(v_line->>'expiry_date', '')), '')::date, expiry_date)
     WHERE id = v_item.id;
  END LOOP;

  IF jsonb_array_length(v_purchase_items) = 0 THEN
    RAISE EXCEPTION 'Indica al menos una unidad recibida conforme para ingresar al inventario';
  END IF;

  -- Registra la compra oficial (actualiza products.stock, costo promedio, Kardex, lotes, Caja/CxP y Contabilidad)
  IF v_method = 'credito' THEN
    v_purchase_id := public.registrar_compra(v_po.supplier_id, v_purchase_items, v_method, v_days);
  ELSIF v_method <> 'efectivo' THEN
    v_purchase_id := public.registrar_compra(v_po.supplier_id, v_purchase_items, v_method);
  ELSE
    v_purchase_id := public.registrar_compra(v_po.supplier_id, v_purchase_items);
  END IF;

  UPDATE public.purchases
     SET branch_id = v_po.branch_id,
         warehouse_id = v_wh
   WHERE id = v_purchase_id AND company_id = v_co;

  -- Si hay bodega destino, ingresa existencias también en warehouse_stock y kardex de bodega
  IF v_wh IS NOT NULL THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_purchase_items) LOOP
      v_rec_now := (v_line->>'quantity')::numeric;
      INSERT INTO public.warehouse_stock (company_id, warehouse_id, product_id, quantity, reserved_quantity)
      VALUES (v_co, v_wh, (v_line->>'product_id')::uuid, 0, 0)
      ON CONFLICT (warehouse_id, product_id) DO NOTHING;

      SELECT quantity INTO v_before
        FROM public.warehouse_stock
       WHERE warehouse_id = v_wh AND product_id = (v_line->>'product_id')::uuid
       FOR UPDATE;

      v_after := COALESCE(v_before, 0) + v_rec_now;

      UPDATE public.warehouse_stock
         SET quantity = v_after, updated_at = now()
       WHERE warehouse_id = v_wh AND product_id = (v_line->>'product_id')::uuid;

      INSERT INTO public.warehouse_movements (
        company_id, warehouse_id, product_id, movement_type,
        quantity_delta, quantity_before, quantity_after,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_co, v_wh, (v_line->>'product_id')::uuid, 'entry',
        v_rec_now, COALESCE(v_before, 0), v_after,
        'purchase_order', v_po.id, 'Recepción ' || v_po.po_number, auth.uid()
      );
    END LOOP;
  END IF;

  SELECT bool_and((received_qty + rejected_qty) >= ordered_qty)
    INTO v_all_fulfilled
    FROM public.purchase_order_items
   WHERE po_id = p_po_id AND company_id = v_co;

  UPDATE public.purchase_orders
     SET status = CASE WHEN COALESCE(v_all_fulfilled, true) THEN 'received' ELSE 'partial' END,
         target_warehouse_id = COALESCE(v_wh, target_warehouse_id),
         linked_purchase_id = v_purchase_id,
         received_at = now(),
         updated_at = now()
   WHERE id = p_po_id AND company_id = v_co;

  RETURN v_purchase_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cambiar_estado_orden_compra(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_orden_compra(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) TO authenticated, service_role;

COMMIT;
