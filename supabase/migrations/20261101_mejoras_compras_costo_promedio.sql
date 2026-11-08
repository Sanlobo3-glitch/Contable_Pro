-- =============================================================================
-- InventarioPro · Mejoras en Compras (Banco/Tarjeta/Transferencia) y Costo Promedio
-- =============================================================================
-- Qué hace este script:
--   1. Permite registrar compras pagadas por EFECTIVO (sale de Caja), TARJETA o
--      TRANSFERENCIA (no mueve efectivo de Caja; contabiliza contra Bancos), o a
--      CRÉDITO (queda en Cuentas por pagar con fecha de vencimiento).
--   2. Calcula automáticamente el COSTO PROMEDIO PONDERADO al recibir compras
--      cuando el producto ya tiene unidades en stock (evitando distorsionar los
--      márgenes de Rentabilidad y cuadrando con la cuenta contable de Inventario).
--   3. Al anular una compra:
--      - Solo devuelve dinero a Caja si la compra original fue en efectivo.
--      - Recalcula limpiamente el costo anterior del producto al retirar las unidades.
--
-- Seguro de volver a ejecutar (idempotente).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Asegurar columnas y ampliar formas de pago permitidas en purchases
-- -----------------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'efectivo',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS credit_days integer;

ALTER TABLE public.purchases
  DROP CONSTRAINT IF EXISTS purchases_payment_method_check;

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_payment_method_check
  CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'credito'));

-- -----------------------------------------------------------------------------
-- 2. Contabilidad de compras: Efectivo -> Caja | Tarjeta/Transferencia -> Bancos | Crédito -> CxP
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acc_post_purchase(p_p public.purchases, p_estimated boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.acc_settings;
  v_date date;
  v_inv uuid;
  v_cred uuid;
  v_pay text := coalesce(p_p.payment_method, 'efectivo');
  v_memo text;
begin
  select * into s from public.acc_settings where company_id = p_p.company_id;
  if not found or not s.active or s.start_date is null then return null; end if;
  v_date := (p_p.created_at at time zone s.timezone)::date;
  if v_date < s.start_date or p_p.total <= 0 then return null; end if;

  v_inv := (s.map->>'inventario')::uuid;
  if v_inv is null then return null; end if;

  if v_pay = 'credito' then
    if to_regclass('public.cxp_settings') is not null then
      select account_id into v_cred from public.cxp_settings where company_id = p_p.company_id;
    end if;
    v_memo := 'Compra a crédito';
  elsif v_pay in ('tarjeta', 'transferencia') then
    v_cred := (s.map->>'bancos')::uuid;
    v_memo := 'Pago de compra (' || v_pay || ')';
  else
    v_cred := (s.map->>'caja')::uuid;
    v_memo := 'Pago de compra (efectivo)';
  end if;

  if v_cred is null then return null; end if;

  return public.acc_system_entry(
    p_p.company_id, v_date,
    'Compra a ' || coalesce(p_p.supplier_name, 'Proveedor general') ||
      case when p_estimated then ' (registrada con retraso)' else '' end,
    'compra', p_p.id, 'registro', 'C-' || substr(p_p.id::text, 1, 8),
    jsonb_build_array(
      jsonb_build_object('account_id', v_inv, 'debit', p_p.total),
      jsonb_build_object('account_id', v_cred, 'credit', p_p.total, 'memo', v_memo)));
end $function$;

REVOKE ALL ON FUNCTION public.acc_post_purchase(public.purchases, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acc_post_purchase(public.purchases, boolean) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Registrar compra con Efectivo / Tarjeta / Transferencia / Crédito + Costo Promedio
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_compra(uuid, jsonb);
DROP FUNCTION IF EXISTS public.registrar_compra(uuid, jsonb, text, integer);

CREATE OR REPLACE FUNCTION public.registrar_compra(
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text DEFAULT 'efectivo'::text,
  p_credit_days integer DEFAULT NULL::integer
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  e jsonb; v_prod products%rowtype; v_pid uuid;
  v_qty numeric; v_cost numeric; v_new_cost numeric; v_total numeric := 0;
  v_sup text; v_exp date; v_lot text; v_id uuid; v_items jsonb := '[]'::jsonb; v_new numeric;
  v_pay text := coalesce(p_payment_method, 'efectivo');
  v_limit numeric := 0; v_days integer := 30; v_due date := null; v_owed numeric := 0;
begin
  if v_pay not in ('efectivo', 'tarjeta', 'transferencia', 'credito') then
    raise exception 'Forma de pago de compra inválida';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra no tiene items';
  end if;

  if p_supplier_id is not null then
    select name into v_sup from suppliers where id = p_supplier_id and company_id = v_co;
    if not found then raise exception 'Proveedor no existe'; end if;
  end if;

  if v_pay = 'credito' then
    if p_supplier_id is null then
      raise exception 'Para registrar una compra a crédito debes elegir un proveedor registrado';
    end if;
    perform 1 from suppliers where id = p_supplier_id and company_id = v_co for update;
    if to_regclass('public.supplier_credit') is not null then
      select coalesce(credit_limit, 0), coalesce(credit_days, 30)
        into v_limit, v_days
        from supplier_credit
        where supplier_id = p_supplier_id and company_id = v_co;
      if not found then v_limit := 0; v_days := 30; end if;
    end if;

    if p_credit_days is not null then
      if p_credit_days < 0 or p_credit_days > 365 then
        raise exception 'Los días de plazo deben estar entre 0 y 365';
      end if;
      v_days := p_credit_days;
    end if;
    v_due := public._co_today(v_co) + v_days;
  end if;

  insert into purchases (company_id, supplier_id, supplier_name, items, total, status, payment_method, due_date, credit_days)
  values (v_co, p_supplier_id, v_sup, '[]', 0, 'recibida', v_pay, v_due, case when v_pay = 'credito' then v_days else null end)
  returning id into v_id;

  for e in select x from jsonb_array_elements(p_items) x order by x->>'product_id' loop
    v_pid  := _item_uuid(e, 'product_id');
    v_qty  := _item_num(e, 'quantity');
    v_cost := _item_num(e, 'cost');
    if v_qty <= 0 or v_cost < 0 then raise exception 'Cantidad o costo inválido'; end if;

    select * into v_prod from products where id = v_pid and company_id = v_co for update;
    if not found then raise exception 'Producto no existe'; end if;

    v_new := v_prod.stock + v_qty;
    -- Costo promedio ponderado cuando había existencias positivas; si estaba en 0 o negativo, usa el nuevo costo
    if v_prod.stock > 0 and v_new > 0 then
      v_new_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) + (v_qty * v_cost)) / v_new, 2);
    else
      v_new_cost := round(v_cost, 2);
    end if;

    update products set stock = v_new, cost = v_new_cost where id = v_prod.id;

    insert into kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id)
    values (v_co, v_prod.id, v_prod.name, 'entrada', v_qty, v_new, 'purchase', v_id);

    -- Productos con vencimiento: cada compra crea su lote con su costo real de compra
    v_exp := null; v_lot := null;
    if v_prod.tracks_expiry then
      if coalesce(e->>'expiry_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'El producto "%" maneja vencimiento: indica la fecha de vencimiento del lote', v_prod.name;
      end if;
      v_exp := (e->>'expiry_date')::date;
      if v_exp < public._co_today(v_co) then raise exception 'La fecha de vencimiento de "%" ya pasó', v_prod.name; end if;
      if v_exp > date '2100-01-01' then raise exception 'Fecha de vencimiento inválida para "%"', v_prod.name; end if;
      v_lot := coalesce(nullif(left(btrim(coalesce(e->>'lot_code', '')), 40), ''), 'S/L');
      insert into product_lots (company_id, product_id, lot_code, expiry_date, qty_initial, qty_remaining, cost, source_type, source_id)
      values (v_co, v_prod.id, v_lot, v_exp, v_qty, v_qty, v_cost, 'compra', v_id);
    end if;

    v_total := v_total + v_qty * v_cost;
    v_items := v_items || (jsonb_build_object(
      'product_id', v_prod.id, 'product_name', v_prod.name,
      'quantity', v_qty, 'cost', v_cost, 'prev_cost', v_prod.cost, 'subtotal', v_qty * v_cost)
      || case when v_exp is not null then jsonb_build_object('lot_code', v_lot, 'expiry_date', v_exp) else '{}'::jsonb end);
  end loop;

  if v_pay = 'credito' and v_limit > 0 then
    v_owed := public._supplier_owed(v_co, p_supplier_id);
    if v_owed + v_total > v_limit then
      raise exception 'Supera el cupo de crédito con este proveedor (cupo: %, debes: %, esta compra: %)',
        round(v_limit, 2), round(v_owed, 2), round(v_total, 2);
    end if;
  end if;

  update purchases set items = v_items, total = v_total where id = v_id;

  -- Solo las compras pagadas en efectivo salen de la caja física
  if v_pay = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_total, 'Compra - ' || coalesce(v_sup, 'Proveedor general'), 'purchase', v_id);
  end if;

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.registrar_compra(uuid, jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_compra(uuid, jsonb, text, integer) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Anular compra revirtiendo stock, costo promedio y caja (solo si fue efectivo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anular_compra(p_purchase_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid;
  v_purchase purchases%ROWTYPE;
  v_item record;
  v_prod products%ROWTYPE;
  v_new numeric;
  v_rev_cost numeric;
BEGIN
  v_co := public._ctx(ARRAY['admin', 'dueno']);

  SELECT *
  INTO v_purchase
  FROM purchases
  WHERE id = p_purchase_id
    AND company_id = v_co
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La compra no existe o no tienes permiso para acceder a ella';
  END IF;

  IF v_purchase.status = 'anulada' THEN
    RAISE EXCEPTION 'Esta compra ya fue anulada';
  END IF;

  IF v_purchase.status <> 'recibida' THEN
    RAISE EXCEPTION 'Solo se pueden anular compras recibidas';
  END IF;

  IF v_purchase.items IS NULL
    OR jsonb_typeof(v_purchase.items) <> 'array'
    OR jsonb_array_length(v_purchase.items) = 0 THEN
    RAISE EXCEPTION 'La compra no contiene artículos válidos';
  END IF;

  IF to_regclass('public.supplier_allocations') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM supplier_allocations a
      JOIN supplier_payments sp ON sp.id = a.payment_id
      WHERE a.purchase_id = v_purchase.id
        AND sp.status = 'activo'
    ) THEN
      RAISE EXCEPTION 'No se puede anular: esta compra ya tiene pagos o abonos registrados. Anula primero esos pagos en Cuentas por pagar.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM product_lots
    WHERE company_id = v_co AND source_type = 'compra' AND source_id = v_purchase.id
      AND qty_remaining < qty_initial
  ) THEN
    RAISE EXCEPTION 'No se puede anular: ya se vendió o dio de baja parte de los lotes de esta compra';
  END IF;
  UPDATE product_lots SET qty_remaining = 0
  WHERE company_id = v_co AND source_type = 'compra' AND source_id = v_purchase.id;

  FOR v_item IN
    SELECT
      (item->>'product_id')::uuid AS product_id,
      SUM((item->>'quantity')::numeric) AS quantity,
      SUM(coalesce((item->>'subtotal')::numeric, ((item->>'quantity')::numeric * (item->>'cost')::numeric))) AS total_cost,
      (array_agg((item->>'prev_cost')::numeric) FILTER (WHERE item ? 'prev_cost'))[1] AS prev_cost
    FROM jsonb_array_elements(v_purchase.items) AS item
    GROUP BY (item->>'product_id')::uuid
    ORDER BY (item->>'product_id')::uuid
  LOOP
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'La compra contiene una cantidad inválida';
    END IF;

    SELECT *
    INTO v_prod
    FROM products
    WHERE id = v_item.product_id
      AND company_id = v_co
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró un producto de esta compra';
    END IF;

    IF v_prod.stock < v_item.quantity THEN
      RAISE EXCEPTION
        'No se puede anular: el inventario actual de "%" es %, pero se necesitan % unidades para revertir la compra',
        v_prod.name, v_prod.stock, v_item.quantity;
    END IF;

    v_new := v_prod.stock - v_item.quantity;
    v_rev_cost := v_prod.cost;

    IF v_new > 0 THEN
      v_rev_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) - coalesce(v_item.total_cost, 0)) / v_new, 2);
      IF v_rev_cost <= 0 THEN
        v_rev_cost := coalesce(v_item.prev_cost, v_prod.cost);
      END IF;
    ELSIF v_item.prev_cost IS NOT NULL AND v_item.prev_cost >= 0 THEN
      v_rev_cost := round(v_item.prev_cost, 2);
    END IF;

    UPDATE products
    SET stock = v_new,
        cost = v_rev_cost
    WHERE id = v_prod.id
      AND company_id = v_co;

    INSERT INTO kardex (
      company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note
    ) VALUES (
      v_co, v_prod.id, v_prod.name, 'salida', v_item.quantity, v_new, 'purchase', v_purchase.id, 'Anulación de compra'
    );
  END LOOP;

  -- Solo compensar caja si la compra original fue en efectivo
  IF coalesce(v_purchase.payment_method, 'efectivo') = 'efectivo' THEN
    INSERT INTO cash_entries (
      company_id, type, amount, description, reference_type, reference_id
    ) VALUES (
      v_co, 'ingreso', v_purchase.total,
      'Reversión por anulación de compra - ' || COALESCE(v_purchase.supplier_name, 'Proveedor general'),
      'purchase', v_purchase.id
    );
  END IF;

  UPDATE purchases
  SET status = 'anulada'
  WHERE id = v_purchase.id
    AND company_id = v_co;

  RETURN v_purchase.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.anular_compra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_compra(uuid) TO authenticated, service_role;

COMMIT;
