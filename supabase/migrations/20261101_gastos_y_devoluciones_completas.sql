-- =============================================================================
-- InventarioPro · Gastos Operativos Categorizados + Devoluciones Completas
-- =============================================================================
-- Qué hace este script:
--   1. Crea el módulo de GASTOS OPERATIVOS (expense_categories, expenses):
--      - Pagos en Efectivo (salen de Caja), Tarjeta o Transferencia (van por Bancos
--        sin descuadrar el efectivo físico de Caja).
--      - Categorías precargadas y editables (Arriendo, Servicios, Nómina, Fletes, etc.),
--        con opción de vincular cada categoría a una cuenta específica del Plan de Cuentas.
--      - Contabilización automática en el Estado de Resultados y reversión al anular.
--   2. Mejora DEVOLUCIONES DE CLIENTES (devolutions):
--      - Calcula el monto exacto proporcional incluyendo descuentos e impuestos de la venta.
--      - Permite elegir cómo se reembolsó una venta de contado (Efectivo, Transferencia o
--        Tarjeta), y en ventas fiadas descuenta directamente de Cartera.
--   3. Crea DEVOLUCIONES A PROVEEDORES (purchase_devolutions):
--      - Descuenta stock, kardex y lotes de la compra original recalculando el costo promedio.
--      - Descuenta de la deuda en Cuentas por pagar (si fue a crédito), ingresa a Caja
--        (si el proveedor devolvió efectivo) o contabiliza contra Bancos (transferencia/tarjeta).
--      - Permite anular una devolución a proveedor si se registró por error.
--   4. Conecta todo con Contabilidad automática (acc_post_pending y acc_reconcile).
--
-- Seguro de volver a ejecutar (idempotente).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. MÓDULO DE GASTOS OPERATIVOS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  name text NOT NULL,
  account_id uuid REFERENCES public.acc_accounts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  category_name text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('efectivo', 'tarjeta', 'transferencia')),
  expense_date date NOT NULL,
  description text NOT NULL,
  beneficiary text,
  reference text,
  status text NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'anulado')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_company_created
  ON public.expenses (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_categories_company
  ON public.expense_categories (company_id, name);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_categories_select ON public.expense_categories;
CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT USING (company_id = public.current_company_id());

DROP TRIGGER IF EXISTS expenses_audit ON public.expenses;
CREATE TRIGGER expenses_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

DROP TRIGGER IF EXISTS expenses_check_subscription ON public.expenses;
CREATE TRIGGER expenses_check_subscription
  BEFORE INSERT OR DELETE OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.assert_can_write();

DROP TRIGGER IF EXISTS expense_categories_check_subscription ON public.expense_categories;
CREATE TRIGGER expense_categories_check_subscription
  BEFORE INSERT OR DELETE OR UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.assert_can_write();

-- Semilla automática de categorías habituales por empresa
CREATE OR REPLACE FUNCTION public.asegurar_categorias_gasto()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(null);
begin
  if exists (select 1 from expense_categories where company_id = v_co) then
    return;
  end if;

  insert into expense_categories (company_id, name)
  values
    (v_co, 'Arriendo y local'),
    (v_co, 'Servicios públicos'),
    (v_co, 'Nómina y comisiones'),
    (v_co, 'Transporte y fletes'),
    (v_co, 'Mantenimiento y reparaciones'),
    (v_co, 'Papelería y aseo'),
    (v_co, 'Publicidad y ventas'),
    (v_co, 'Impuestos y tasas'),
    (v_co, 'Comisiones bancarias'),
    (v_co, 'Otros gastos')
  on conflict (company_id, name) do nothing;
end $function$;

REVOKE ALL ON FUNCTION public.asegurar_categorias_gasto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asegurar_categorias_gasto() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guardar_categoria_gasto(
  p_id uuid,
  p_name text,
  p_account_id uuid DEFAULT NULL::uuid,
  p_active boolean DEFAULT true
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_clean text := left(btrim(coalesce(p_name, '')), 80);
  v_out uuid;
begin
  if v_clean = '' then
    raise exception 'Escribe el nombre de la categoría de gasto';
  end if;

  if p_account_id is not null and not exists (
    select 1 from acc_accounts
    where id = p_account_id and company_id = v_co and is_postable and active
  ) then
    raise exception 'La cuenta contable elegida no existe, está inactiva o no admite movimientos';
  end if;

  if p_id is null then
    insert into expense_categories (company_id, name, account_id, active)
    values (v_co, v_clean, p_account_id, coalesce(p_active, true))
    on conflict (company_id, name) do update
      set account_id = excluded.account_id,
          active = excluded.active
    returning id into v_out;
  else
    update expense_categories
       set name = v_clean,
           account_id = p_account_id,
           active = coalesce(p_active, true)
     where id = p_id and company_id = v_co
     returning id into v_out;
    if not found then
      raise exception 'Categoría de gasto no encontrada';
    end if;
  end if;

  return v_out;
end $function$;

REVOKE ALL ON FUNCTION public.guardar_categoria_gasto(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_categoria_gasto(uuid, text, uuid, boolean) TO authenticated, service_role;

-- Contabilización automática de un gasto operativo
CREATE OR REPLACE FUNCTION public.acc_post_expense(p_expense_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  g public.expenses;
  s public.acc_settings;
  v_date date;
  v_deb uuid := null;
  v_cred uuid := null;
  v_cat_acc uuid := null;
begin
  select * into g from public.expenses where id = p_expense_id;
  if not found or g.status <> 'activo' then return null; end if;

  select * into s from public.acc_settings where company_id = g.company_id;
  if not found or not s.active or s.start_date is null then return null; end if;

  v_date := (g.created_at at time zone s.timezone)::date;
  if v_date < s.start_date or g.amount <= 0 then return null; end if;

  if g.category_id is not null then
    select ec.account_id into v_cat_acc
    from public.expense_categories ec
    join public.acc_accounts a on a.id = ec.account_id
    where ec.id = g.category_id
      and ec.company_id = g.company_id
      and a.company_id = g.company_id
      and a.is_postable
      and a.active;
  end if;

  v_deb := coalesce(v_cat_acc, (s.map->>'gastos')::uuid);
  v_cred := case when g.method = 'efectivo' then (s.map->>'caja')::uuid else (s.map->>'bancos')::uuid end;
  if v_deb is null or v_cred is null then return null; end if;

  return public.acc_system_entry(
    g.company_id,
    v_date,
    'Gasto (' || g.category_name || '): ' || g.description,
    'gasto',
    g.id,
    'registro',
    'G-' || substr(g.id::text, 1, 8),
    jsonb_build_array(
      jsonb_build_object('account_id', v_deb, 'debit', g.amount, 'memo', g.category_name),
      jsonb_build_object('account_id', v_cred, 'credit', g.amount, 'memo', 'Pago de gasto (' || g.method || ')')
    )
  );
end $function$;

REVOKE ALL ON FUNCTION public.acc_post_expense(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acc_post_expense(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_gasto(
  p_category_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'efectivo'::text,
  p_description text DEFAULT ''::text,
  p_beneficiary text DEFAULT NULL::text,
  p_reference text DEFAULT NULL::text,
  p_expense_date date DEFAULT NULL::date
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(null);
  v_cat expense_categories%rowtype;
  v_amt numeric;
  v_desc text := left(btrim(coalesce(p_description, '')), 240);
  v_ben text := nullif(left(btrim(coalesce(p_beneficiary, '')), 120), '');
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 80), '');
  v_date date;
  v_name text;
  v_id uuid;
begin
  if not public._es_finito(p_amount) or p_amount <= 0 then
    raise exception 'El monto del gasto debe ser mayor a cero';
  end if;
  v_amt := round(p_amount, 2);
  if v_amt < 0.01 then
    raise exception 'El monto del gasto debe ser mayor a cero';
  end if;
  if coalesce(p_method, '') not in ('efectivo', 'tarjeta', 'transferencia') then
    raise exception 'Forma de pago de gasto inválida';
  end if;
  if v_desc = '' then
    raise exception 'Escribe el concepto o descripción del gasto';
  end if;

  select * into v_cat
  from expense_categories
  where id = p_category_id and company_id = v_co and active;
  if not found then
    raise exception 'Selecciona una categoría de gasto activa';
  end if;

  v_date := coalesce(p_expense_date, public._co_today(v_co));
  select full_name into v_name from profiles where id = auth.uid();

  insert into expenses (
    company_id, category_id, category_name, amount, method, expense_date,
    description, beneficiary, reference, status, created_by, created_by_name
  ) values (
    v_co, v_cat.id, v_cat.name, v_amt, p_method, v_date,
    v_desc, v_ben, v_ref, 'activo', auth.uid(), v_name
  )
  returning id into v_id;

  if p_method = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_amt, 'Gasto (' || v_cat.name || ') - ' || v_desc, 'gasto', v_id);
  end if;

  begin
    perform public.acc_post_expense(v_id);
  exception when others then
    null;
  end;

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.registrar_gasto(uuid, numeric, text, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_gasto(uuid, numeric, text, text, text, text, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anular_gasto(p_expense_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  g expenses%rowtype;
begin
  select * into g from expenses where id = p_expense_id and company_id = v_co for update;
  if not found then raise exception 'El gasto no existe'; end if;
  if g.status = 'anulado' then raise exception 'Este gasto ya fue anulado'; end if;

  update expenses set status = 'anulado' where id = g.id;

  if g.method = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'ingreso', g.amount, 'Anulación de gasto - ' || g.description, 'anulacion_gasto', g.id);
  end if;

  perform public.acc_reverse_source(v_co, 'gasto', g.id, 'anulación de gasto');
end $function$;

REVOKE ALL ON FUNCTION public.anular_gasto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_gasto(uuid) TO authenticated, service_role;


-- =============================================================================
-- 2. MEJORAS EN DEVOLUCIONES DE CLIENTES (VENTAS)
-- =============================================================================

ALTER TABLE public.devolutions
  ADD COLUMN IF NOT EXISTS refund_method text;

ALTER TABLE public.devolutions
  DROP CONSTRAINT IF EXISTS devolutions_refund_method_check;

ALTER TABLE public.devolutions
  ADD CONSTRAINT devolutions_refund_method_check
  CHECK (refund_method IS NULL OR refund_method IN ('efectivo', 'tarjeta', 'transferencia', 'cartera'));

CREATE OR REPLACE FUNCTION public.acc_post_devolution(p_d public.devolutions, p_estimated boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.acc_settings;
  v_sale public.sales;
  v_date date;
  v_tax numeric := 0;
  v_rev numeric;
  v_cost numeric := 0;
  v_pay uuid;
  v_ref_method text;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into s from public.acc_settings where company_id = p_d.company_id;
  if not found or not s.active or s.start_date is null then return null; end if;
  v_date := (p_d.created_at at time zone s.timezone)::date;
  if v_date < s.start_date or p_d.amount <= 0 then return null; end if;

  select * into v_sale from public.sales where id = p_d.sale_id and company_id = p_d.company_id;
  if not found then return null; end if;

  if coalesce(v_sale.tax_amount, 0) > 0 and coalesce(v_sale.total, 0) > 0 then
    v_tax := round(p_d.amount * v_sale.tax_amount / v_sale.total, 2);
  end if;
  v_rev := p_d.amount - v_tax;

  v_ref_method := coalesce(
    p_d.refund_method,
    case when v_sale.payment_method = 'fiado' then 'cartera' else coalesce(v_sale.payment_method, 'efectivo') end
  );

  if v_ref_method = 'cartera' then
    select account_id into v_pay from public.cxc_settings where company_id = p_d.company_id;
    if v_pay is null then return null; end if;
  elsif v_ref_method = 'efectivo' then
    v_pay := (s.map->>'caja')::uuid;
  else
    v_pay := (s.map->>'bancos')::uuid;
  end if;
  if v_pay is null then return null; end if;

  select coalesce(p.cost, 0) * p_d.quantity into v_cost
  from public.products p where p.id = p_d.product_id and p.company_id = p_d.company_id;
  v_cost := round(coalesce(v_cost, 0), 2);

  if v_rev > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', coalesce((s.map->>'devoluciones')::uuid, (s.map->>'ventas')::uuid), 'debit', v_rev));
  end if;
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', (s.map->>'impuestos')::uuid, 'debit', v_tax));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_id', v_pay,
    'credit', p_d.amount,
    'memo', case when v_ref_method = 'cartera' then 'Reducción de cartera' else 'Reembolso (' || v_ref_method || ')' end
  ));
  if v_cost > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', (s.map->>'inventario')::uuid, 'debit', v_cost, 'memo', 'Costo promedio del producto'),
      jsonb_build_object('account_id', (s.map->>'costo_ventas')::uuid, 'credit', v_cost)
    );
  end if;

  return public.acc_system_entry(
    p_d.company_id, v_date, 'Devolución: ' || p_d.product_name,
    'devolucion', p_d.id, 'registro', 'D-' || substr(p_d.id::text, 1, 8), v_lines
  );
end $function$;

REVOKE ALL ON FUNCTION public.acc_post_devolution(public.devolutions, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acc_post_devolution(public.devolutions, boolean) TO service_role;

DROP FUNCTION IF EXISTS public.registrar_devolucion(uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS public.registrar_devolucion(uuid, uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.registrar_devolucion(
  p_sale_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_refund_method text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(null);
  v_sale sales%rowtype;
  v_prod products%rowtype;
  v_sold numeric;
  v_sold_amount numeric;
  v_all_items numeric;
  v_returned numeric;
  v_amount numeric;
  v_new numeric;
  v_id uuid;
  v_bal numeric;
  v_refund text;
begin
  if not public._es_finito(p_quantity) or p_quantity <= 0 then
    raise exception 'Cantidad inválida';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select * into v_sale from sales where id = p_sale_id and company_id = v_co for update;
  if not found then raise exception 'Venta no existe'; end if;
  if v_sale.status = 'anulada' then raise exception 'La venta está anulada'; end if;

  select coalesce(sum((x->>'quantity')::numeric), 0), coalesce(sum((x->>'subtotal')::numeric), 0)
    into v_sold, v_sold_amount
  from jsonb_array_elements(v_sale.items) x
  where (x->>'product_id')::uuid = p_product_id;
  if v_sold = 0 then raise exception 'Ese producto no pertenece a la venta'; end if;

  select coalesce(sum((x->>'subtotal')::numeric), 0)
    into v_all_items
  from jsonb_array_elements(v_sale.items) x;

  select coalesce(sum(quantity), 0) into v_returned from devolutions
  where sale_id = p_sale_id and product_id = p_product_id and company_id = v_co;
  if p_quantity > v_sold - v_returned then
    raise exception 'Solo quedan % unidad(es) por devolver de este producto', v_sold - v_returned;
  end if;

  -- Monto proporcional exacto incluyendo descuentos e impuestos de la venta
  if v_all_items > 0 and v_sale.total >= 0 then
    v_amount := round((p_quantity * v_sold_amount / v_sold) * (v_sale.total / v_all_items), 2);
  else
    v_amount := round(p_quantity * v_sold_amount / v_sold, 2);
  end if;

  if v_sale.payment_method = 'fiado' then
    v_refund := 'cartera';
    if exists (
      select 1 from credit_allocations a
      join credit_payments p on p.id = a.payment_id
      where a.sale_id = p_sale_id and p.status = 'activo'
    ) then
      v_bal := public._sale_balance(p_sale_id);
      if v_amount > v_bal + 0.005 then
        raise exception 'Esta venta a crédito ya tiene abonos y la devolución (%) supera lo que aún se debe (%). Anula primero los abonos o devuelve menos.',
          v_amount, round(v_bal, 2);
      end if;
    end if;
  else
    v_refund := coalesce(nullif(btrim(coalesce(p_refund_method, '')), ''), coalesce(v_sale.payment_method, 'efectivo'));
    if v_refund not in ('efectivo', 'tarjeta', 'transferencia') then
      raise exception 'Forma de reembolso inválida';
    end if;
  end if;

  select * into v_prod from products where id = p_product_id and company_id = v_co for update;
  if not found then raise exception 'El producto ya no existe'; end if;

  v_new := v_prod.stock + p_quantity;
  update products set stock = v_new where id = v_prod.id;

  insert into devolutions (company_id, sale_id, product_id, product_name, quantity, amount, reason, refund_method)
  values (v_co, p_sale_id, v_prod.id, v_prod.name, p_quantity, v_amount, trim(p_reason), v_refund)
  returning id into v_id;

  insert into kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id)
  values (v_co, v_prod.id, v_prod.name, 'entrada', p_quantity, v_new, 'devolution', v_id);

  if v_prod.tracks_expiry then
    perform public._lot_restore(v_co, p_sale_id, v_prod.id, p_quantity);
  end if;

  -- Solo sale dinero físico de Caja si el reembolso al cliente fue en efectivo
  if v_refund = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_amount, 'Devolución - ' || v_prod.name, 'devolution', v_id);
  end if;

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.registrar_devolucion(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion(uuid, uuid, numeric, text, text) TO authenticated, service_role;


-- =============================================================================
-- 3. DEVOLUCIONES A PROVEEDORES (COMPRAS)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.purchase_devolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL CHECK (unit_cost >= 0),
  amount numeric NOT NULL CHECK (amount >= 0),
  refund_method text NOT NULL CHECK (refund_method IN ('efectivo', 'tarjeta', 'transferencia', 'credito')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'anulada')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_devolutions_company
  ON public.purchase_devolutions (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_devolutions_purchase
  ON public.purchase_devolutions (purchase_id)
  WHERE status = 'activa';

ALTER TABLE public.purchase_devolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_devolutions_select ON public.purchase_devolutions;
CREATE POLICY purchase_devolutions_select ON public.purchase_devolutions
  FOR SELECT USING (company_id = public.current_company_id());

DROP TRIGGER IF EXISTS purchase_devolutions_audit ON public.purchase_devolutions;
CREATE TRIGGER purchase_devolutions_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.purchase_devolutions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

DROP TRIGGER IF EXISTS purchase_devolutions_check_subscription ON public.purchase_devolutions;
CREATE TRIGGER purchase_devolutions_check_subscription
  BEFORE INSERT OR DELETE OR UPDATE ON public.purchase_devolutions
  FOR EACH ROW EXECUTE FUNCTION public.assert_can_write();

-- Actualizar cálculo de saldo de compras a crédito para descontar devoluciones a crédito
CREATE OR REPLACE FUNCTION public._purchase_balance(p_purchase_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN coalesce(p.payment_method, 'efectivo') <> 'credito' OR p.status <> 'recibida' THEN 0::numeric
    ELSE greatest(
      p.total
      - coalesce((
          SELECT sum(pd.amount)
          FROM public.purchase_devolutions pd
          WHERE pd.purchase_id = p.id
            AND pd.status = 'activa'
            AND pd.refund_method = 'credito'
        ), 0)
      - coalesce((
          SELECT sum(a.amount)
          FROM public.supplier_allocations a
          JOIN public.supplier_payments sp ON sp.id = a.payment_id
          WHERE a.purchase_id = p.id AND sp.status = 'activo'
        ), 0),
      0
    )
  END
  FROM public.purchases p
  WHERE p.id = p_purchase_id
$function$;

REVOKE ALL ON FUNCTION public._purchase_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._purchase_balance(uuid) TO service_role;

-- Contabilización automática de devolución a proveedor
CREATE OR REPLACE FUNCTION public.acc_post_purchase_devolution(p_dev_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d public.purchase_devolutions;
  s public.acc_settings;
  v_date date;
  v_inv uuid;
  v_deb uuid;
  v_memo text;
begin
  select * into d from public.purchase_devolutions where id = p_dev_id;
  if not found or d.status <> 'activa' then return null; end if;

  select * into s from public.acc_settings where company_id = d.company_id;
  if not found or not s.active or s.start_date is null then return null; end if;

  v_date := (d.created_at at time zone s.timezone)::date;
  if v_date < s.start_date or d.amount <= 0 then return null; end if;

  v_inv := (s.map->>'inventario')::uuid;
  if v_inv is null then return null; end if;

  if d.refund_method = 'credito' then
    if to_regclass('public.cxp_settings') is not null then
      select account_id into v_deb from public.cxp_settings where company_id = d.company_id;
    end if;
    v_memo := 'Descuento en cuenta por pagar';
  elsif d.refund_method = 'efectivo' then
    v_deb := (s.map->>'caja')::uuid;
    v_memo := 'Reintegro en efectivo de proveedor';
  else
    v_deb := (s.map->>'bancos')::uuid;
    v_memo := 'Reintegro bancario de proveedor (' || d.refund_method || ')';
  end if;

  if v_deb is null then return null; end if;

  return public.acc_system_entry(
    d.company_id,
    v_date,
    'Devolución a proveedor (' || coalesce(d.supplier_name, 'Proveedor general') || '): ' || d.product_name,
    'devolucion_compra',
    d.id,
    'registro',
    'DC-' || substr(d.id::text, 1, 8),
    jsonb_build_array(
      jsonb_build_object('account_id', v_deb, 'debit', d.amount, 'memo', v_memo),
      jsonb_build_object('account_id', v_inv, 'credit', d.amount, 'memo', d.product_name)
    )
  );
end $function$;

REVOKE ALL ON FUNCTION public.acc_post_purchase_devolution(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acc_post_purchase_devolution(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_devolucion_compra(
  p_purchase_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_refund_method text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_pur purchases%rowtype;
  v_prod products%rowtype;
  v_bought numeric := 0;
  v_bought_amt numeric := 0;
  v_returned numeric := 0;
  v_unit_cost numeric := 0;
  v_amount numeric := 0;
  v_refund text;
  v_bal numeric := 0;
  v_new numeric := 0;
  v_rev_cost numeric := 0;
  v_lot_avail numeric := 0;
  v_left numeric := 0;
  v_take numeric := 0;
  v_name text;
  v_id uuid;
  r_lot record;
begin
  if not public._es_finito(p_quantity) or p_quantity <= 0 then
    raise exception 'Cantidad inválida';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'El motivo de la devolución es obligatorio';
  end if;

  select * into v_pur from purchases where id = p_purchase_id and company_id = v_co for update;
  if not found then raise exception 'La compra no existe'; end if;
  if v_pur.status = 'anulada' then raise exception 'No se puede devolver sobre una compra anulada'; end if;
  if v_pur.status <> 'recibida' then raise exception 'Solo se pueden devolver compras recibidas'; end if;

  select coalesce(sum((x->>'quantity')::numeric), 0),
         coalesce(sum(coalesce((x->>'subtotal')::numeric, ((x->>'quantity')::numeric * (x->>'cost')::numeric))), 0)
    into v_bought, v_bought_amt
  from jsonb_array_elements(v_pur.items) x
  where (x->>'product_id')::uuid = p_product_id;

  if v_bought <= 0 then
    raise exception 'Ese producto no pertenece a la compra seleccionada';
  end if;

  select coalesce(sum(quantity), 0)
    into v_returned
  from purchase_devolutions
  where company_id = v_co and purchase_id = p_purchase_id and product_id = p_product_id and status = 'activa';

  if p_quantity > v_bought - v_returned then
    raise exception 'Solo quedan % unidad(es) disponibles para devolver en esta compra', v_bought - v_returned;
  end if;

  v_unit_cost := round(v_bought_amt / v_bought, 4);
  v_amount := round(p_quantity * v_bought_amt / v_bought, 2);

  v_refund := coalesce(nullif(btrim(coalesce(p_refund_method, '')), ''), coalesce(v_pur.payment_method, 'efectivo'));
  if v_refund not in ('efectivo', 'tarjeta', 'transferencia', 'credito') then
    raise exception 'Forma de reintegro de proveedor inválida';
  end if;

  if v_refund = 'credito' then
    if coalesce(v_pur.payment_method, 'efectivo') <> 'credito' then
      raise exception 'Solo puedes descontar de Cuentas por pagar cuando la compra original fue a crédito';
    end if;
    v_bal := public._purchase_balance(p_purchase_id);
    if v_amount > v_bal + 0.005 then
      raise exception 'La devolución (%) supera el saldo pendiente de esta compra (%). Elige reintegro en efectivo o transferencia, o anula antes el pago al proveedor.',
        v_amount, round(v_bal, 2);
    end if;
  end if;

  select * into v_prod from products where id = p_product_id and company_id = v_co for update;
  if not found then raise exception 'El producto ya no existe'; end if;
  if v_prod.stock < p_quantity then
    raise exception 'Stock actual insuficiente de "%" (en inventario: %, a devolver: %)', v_prod.name, v_prod.stock, p_quantity;
  end if;

  -- Si el producto maneja lotes/vencimientos, descontar de los lotes creados por esta compra
  if v_prod.tracks_expiry then
    select coalesce(sum(qty_remaining), 0) into v_lot_avail
    from product_lots
    where company_id = v_co and source_type = 'compra' and source_id = p_purchase_id and product_id = p_product_id;

    if v_lot_avail < p_quantity then
      raise exception 'Solo quedan % unidad(es) disponibles en el lote de esta compra para devolver', v_lot_avail;
    end if;

    v_left := p_quantity;
    for r_lot in
      select id, qty_remaining
      from product_lots
      where company_id = v_co and source_type = 'compra' and source_id = p_purchase_id
        and product_id = p_product_id and qty_remaining > 0
      order by expiry_date asc, created_at asc
      for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, r_lot.qty_remaining);
      update product_lots set qty_remaining = qty_remaining - v_take where id = r_lot.id;
      v_left := v_left - v_take;
    end loop;
  end if;

  v_new := v_prod.stock - p_quantity;
  v_rev_cost := v_prod.cost;
  if v_new > 0 then
    v_rev_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) - v_amount) / v_new, 2);
    if v_rev_cost <= 0 then v_rev_cost := v_prod.cost; end if;
  end if;

  update products set stock = v_new, cost = v_rev_cost where id = v_prod.id;

  select full_name into v_name from profiles where id = auth.uid();

  insert into purchase_devolutions (
    company_id, purchase_id, supplier_id, supplier_name,
    product_id, product_name, quantity, unit_cost, amount,
    refund_method, reason, status, created_by, created_by_name
  ) values (
    v_co, v_pur.id, v_pur.supplier_id, v_pur.supplier_name,
    v_prod.id, v_prod.name, p_quantity, round(v_unit_cost, 2), v_amount,
    v_refund, left(btrim(p_reason), 240), 'activa', auth.uid(), v_name
  )
  returning id into v_id;

  insert into kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note)
  values (v_co, v_prod.id, v_prod.name, 'salida', p_quantity, v_new, 'purchase_devolution', v_id, 'Devolución a proveedor: ' || left(btrim(p_reason), 120));

  if v_refund = 'efectivo' and v_amount > 0 then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'ingreso', v_amount, 'Devolución a proveedor - ' || v_prod.name, 'purchase_devolution', v_id);
  end if;

  begin
    perform public.acc_post_purchase_devolution(v_id);
  exception when others then
    null;
  end;

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.registrar_devolucion_compra(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_compra(uuid, uuid, numeric, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anular_devolucion_compra(p_dev_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  d purchase_devolutions%rowtype;
  v_prod products%rowtype;
  v_new numeric;
  v_new_cost numeric;
  v_left numeric;
  v_room numeric;
  r_lot record;
begin
  select * into d from purchase_devolutions where id = p_dev_id and company_id = v_co for update;
  if not found then raise exception 'La devolución a proveedor no existe'; end if;
  if d.status = 'anulada' then raise exception 'Esta devolución ya fue anulada'; end if;

  select * into v_prod from products where id = d.product_id and company_id = v_co for update;
  if not found then raise exception 'El producto ya no existe'; end if;

  v_new := v_prod.stock + d.quantity;
  if v_prod.stock > 0 and v_new > 0 then
    v_new_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) + d.amount) / v_new, 2);
  else
    v_new_cost := round(d.unit_cost, 2);
  end if;

  update products set stock = v_new, cost = v_new_cost where id = v_prod.id;

  if v_prod.tracks_expiry then
    v_left := d.quantity;
    for r_lot in
      select id, qty_initial, qty_remaining
      from product_lots
      where company_id = v_co and source_type = 'compra' and source_id = d.purchase_id
        and product_id = d.product_id and qty_remaining < qty_initial
      order by expiry_date desc, created_at desc
      for update
    loop
      exit when v_left <= 0;
      v_room := least(v_left, r_lot.qty_initial - r_lot.qty_remaining);
      update product_lots set qty_remaining = qty_remaining + v_room where id = r_lot.id;
      v_left := v_left - v_room;
    end loop;
  end if;

  update purchase_devolutions set status = 'anulada' where id = d.id;

  insert into kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note)
  values (v_co, v_prod.id, v_prod.name, 'entrada', d.quantity, v_new, 'purchase_devolution', d.id, 'Anulación devolución a proveedor');

  if d.refund_method = 'efectivo' and d.amount > 0 then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', d.amount, 'Anulación devolución a proveedor - ' || d.product_name, 'anulacion_devolucion_compra', d.id);
  end if;

  perform public.acc_reverse_source(v_co, 'devolucion_compra', d.id, 'anulación de devolución a proveedor');
end $function$;

REVOKE ALL ON FUNCTION public.anular_devolucion_compra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_devolucion_compra(uuid) TO authenticated, service_role;

-- Proteger anular_compra cuando existan devoluciones parciales activas
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

  IF to_regclass('public.purchase_devolutions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM purchase_devolutions
      WHERE company_id = v_co AND purchase_id = v_purchase.id AND status = 'activa'
    ) THEN
      RAISE EXCEPTION 'No se puede anular: esta compra ya tiene devoluciones parciales a proveedor. Anula primero esas devoluciones en el módulo Devoluciones.';
    END IF;
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


-- =============================================================================
-- 4. CONCILIACIÓN Y CONTABILIZACIÓN DE PENDIENTES
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acc_post_pending()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_c uuid := public.my_company();
  s public.acc_settings;
  r public.sales;
  q public.purchases;
  d public.devolutions;
  c public.cash_entries;
  k public.kardex;
  pp public.credit_payments;
  sp public.supplier_payments;
  ex public.expenses;
  pd public.purchase_devolutions;
  v_s int := 0; v_p int := 0; v_d int := 0; v_k int := 0; v_a int := 0;
  v_ab int := 0; v_pp int := 0; v_g int := 0; v_dc int := 0;
begin
  if not public.is_manager() or v_c is null then raise exception 'No autorizado'; end if;
  select * into s from public.acc_settings where company_id = v_c;
  if not found or not s.active then raise exception 'Activa primero la contabilidad automática'; end if;

  for r in
    select * from public.sales x
    where x.company_id = v_c and x.status = 'completada' and jsonb_array_length(x.items) > 0
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'venta'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_sale(r, true) is not null then v_s := v_s + 1; end if;
  end loop;

  for q in
    select * from public.purchases x
    where x.company_id = v_c and x.status = 'recibida' and jsonb_array_length(x.items) > 0
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'compra'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_purchase(q, true) is not null then v_p := v_p + 1; end if;
  end loop;

  for d in
    select * from public.devolutions x
    where x.company_id = v_c and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'devolucion'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_devolution(d, true) is not null then v_d := v_d + 1; end if;
  end loop;

  for c in
    select * from public.cash_entries x
    where x.company_id = v_c and (x.reference_type is null or x.reference_type = 'arqueo')
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c
        and e.source_type in ('caja', 'arqueo') and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_cash(c, true) is not null then v_k := v_k + 1; end if;
  end loop;

  for k in
    select * from public.kardex x
    where x.company_id = v_c and x.reference_type = 'ajuste'
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'ajuste_stock'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_adjustment(k, true) is not null then v_a := v_a + 1; end if;
  end loop;

  for pp in
    select * from public.credit_payments x
    where x.company_id = v_c and x.status = 'activo'
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'abono'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_payment(pp.id) is not null then v_ab := v_ab + 1; end if;
  end loop;

  if to_regclass('public.supplier_payments') is not null then
    for sp in
      select * from public.supplier_payments x
      where x.company_id = v_c and x.status = 'activo'
        and (x.created_at at time zone s.timezone)::date >= s.start_date
        and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'pago_proveedor'
          and e.source_id = x.id and e.source_event = 'registro')
      order by x.created_at
    loop
      if public.acc_post_supplier_payment(sp.id) is not null then v_pp := v_pp + 1; end if;
    end loop;
  end if;

  for ex in
    select * from public.expenses x
    where x.company_id = v_c and x.status = 'activo'
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'gasto'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_expense(ex.id) is not null then v_g := v_g + 1; end if;
  end loop;

  for pd in
    select * from public.purchase_devolutions x
    where x.company_id = v_c and x.status = 'activa'
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'devolucion_compra'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_purchase_devolution(pd.id) is not null then v_dc := v_dc + 1; end if;
  end loop;

  return jsonb_build_object(
    'ventas', v_s, 'compras', v_p, 'devoluciones', v_d,
    'caja', v_k, 'ajustes', v_a, 'abonos', v_ab,
    'pagos_proveedor', v_pp, 'gastos', v_g, 'devoluciones_compra', v_dc
  );
end $function$;

REVOKE ALL ON FUNCTION public.acc_post_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acc_post_pending() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acc_reconcile()
 RETURNS TABLE(code text, label text, operational numeric, accounting numeric, difference numeric, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_c uuid := public.my_company(); s public.acc_settings; a numeric; b numeric; k int; x uuid;
begin
  if not public.is_manager() or v_c is null then raise exception 'No autorizado'; end if;
  select * into s from public.acc_settings where company_id = v_c;
  if not found or s.start_date is null then
    raise exception 'Configura y activa la contabilidad automática antes de conciliar';
  end if;

  select coalesce(sum(x.total - x.tax_amount), 0) into a from public.sales x
  where x.company_id = v_c and x.status = 'completada' and (x.created_at at time zone s.timezone)::date >= s.start_date;
  select coalesce(sum(l.credit - l.debit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c and e.source_type = 'venta' and e.status = 'contabilizado'
  and l.account_id = (s.map->>'ventas')::uuid;
  code := 'ventas'; label := 'Ventas sin impuesto'; operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0'; return next;

  select count(*) into k from public.sales x
  where x.company_id = v_c and x.status = 'completada' and jsonb_array_length(x.items) > 0
  and (x.created_at at time zone s.timezone)::date >= s.start_date
  and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'venta'
  and e.source_id = x.id and e.source_event = 'registro');
  code := 'ventas_pendientes'; label := 'Ventas sin contabilizar (cantidad)'; operational := k; accounting := 0;
  difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;

  select coalesce(sum(x.total), 0) into a from public.purchases x
  where x.company_id = v_c and x.status = 'recibida' and (x.created_at at time zone s.timezone)::date >= s.start_date;
  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c and e.source_type = 'compra' and e.status = 'contabilizado'
  and l.account_id = (s.map->>'inventario')::uuid;
  code := 'compras'; label := 'Compras recibidas'; operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0'; return next;

  select count(*) into k from public.purchases x
  where x.company_id = v_c and x.status = 'recibida' and jsonb_array_length(x.items) > 0
  and (x.created_at at time zone s.timezone)::date >= s.start_date
  and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'compra'
  and e.source_id = x.id and e.source_event = 'registro');
  if k > 0 then
    code := 'compras_pendientes'; label := 'Compras sin contabilizar (cantidad)'; operational := k; accounting := 0;
    difference := k; note := 'Si compraste a crédito, elige la cuenta en Cuentas por pagar o usa "Contabilizar pendientes"'; return next;
  end if;

  select count(*) into k from public.devolutions x
  where x.company_id = v_c and (x.created_at at time zone s.timezone)::date >= s.start_date
  and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'devolucion'
  and e.source_id = x.id and e.source_event = 'registro');
  code := 'devoluciones_pendientes'; label := 'Devoluciones de ventas sin contabilizar (cantidad)'; operational := k;
  accounting := 0; difference := k; note := 'Debe ser 0'; return next;

  select count(*) into k from public.purchase_devolutions x
  where x.company_id = v_c and x.status = 'activa' and (x.created_at at time zone s.timezone)::date >= s.start_date
  and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'devolucion_compra'
  and e.source_id = x.id and e.source_event = 'registro');
  if k > 0 then
    code := 'devoluciones_compra_pendientes'; label := 'Devoluciones a proveedores sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
  end if;

  select count(*) into k from public.expenses x
  where x.company_id = v_c and x.status = 'activo' and (x.created_at at time zone s.timezone)::date >= s.start_date
  and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'gasto'
  and e.source_id = x.id and e.source_event = 'registro');
  if k > 0 then
    code := 'gastos_pendientes'; label := 'Gastos operativos sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Configura la cuenta de Gastos en Config. contable y usa "Contabilizar pendientes"'; return next;
  end if;

  select count(*) into k from public.kardex x
  where x.company_id = v_c and x.reference_type = 'ajuste' and (x.created_at at time zone s.timezone)::date >= s.start_date
  and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'ajuste_stock'
  and e.source_id = x.id and e.source_event = 'registro');
  code := 'ajustes_pendientes'; label := 'Ajustes de stock sin contabilizar (cantidad)'; operational := k;
  accounting := 0; difference := k;
  note := 'Si hay pendientes, configura la cuenta de ajustes de inventario'; return next;

  select coalesce(sum(case when c.type = 'ingreso' then c.amount else -c.amount end), 0) into a
  from public.cash_entries c
  where c.company_id = v_c and (c.created_at at time zone s.timezone)::date >= s.start_date;
  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c and e.status in ('contabilizado', 'reversado') and e.entry_date >= s.start_date
  and l.account_id = (s.map->>'caja')::uuid;
  code := 'caja'; label := 'Movimiento de caja desde el inicio'; operational := a; accounting := b;
  difference := a - b; note := 'Debe ser 0 cuando no haya movimientos pendientes'; return next;

  select coalesce(sum(case when c.type = 'ingreso' then c.amount else -c.amount end), 0) into a
  from public.cash_entries c
  where c.company_id = v_c and (c.reference_type is null or c.reference_type = 'arqueo')
  and (c.created_at at time zone s.timezone)::date >= s.start_date
  and not exists (select 1 from public.acc_entries e where e.company_id = v_c
  and e.source_type in ('caja', 'arqueo') and e.source_id = c.id and e.source_event = 'registro');
  code := 'caja_pendiente'; label := 'Caja manual y arqueos sin contabilizar'; operational := a; accounting := 0;
  difference := a; note := 'Si hay pendientes, configura Gastos y Otros ingresos'; return next;

  select coalesce(sum(p.stock * p.cost), 0) into a from public.products p where p.company_id = v_c;
  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c and e.status in ('contabilizado', 'reversado')
  and l.account_id = (s.map->>'inventario')::uuid;
  code := 'inventario'; label := 'Inventario'; operational := a; accounting := b; difference := a - b;
  note := 'Valorado al costo promedio. La contabilidad empieza en cero salvo que cargues un asiento de apertura';
  return next;

  select account_id into x from public.cxc_settings where company_id = v_c;
  if x is not null then
    select coalesce(sum(public._sale_balance(f.id)), 0) into a from public.sales f
    where f.company_id = v_c and f.payment_method = 'fiado' and f.status = 'completada'
    and (f.created_at at time zone s.timezone)::date >= s.start_date;
    select coalesce(sum(l.debit - l.credit), 0) into b
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c and e.status in ('contabilizado', 'reversado') and l.account_id = x;
    code := 'cartera'; label := 'Cartera de clientes (fiado)'; operational := a; accounting := b;
    difference := a - b;
    note := 'Debe ser 0 cuando no haya pendientes';
    return next;

    select count(*) into k from public.credit_payments y
    where y.company_id = v_c and y.status = 'activo' and (y.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'abono'
    and e.source_id = y.id and e.source_event = 'registro');
    code := 'abonos_pendientes'; label := 'Abonos de clientes sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
  end if;

  if to_regclass('public.cxp_settings') is not null then
    select account_id into x from public.cxp_settings where company_id = v_c;
    if x is not null then
      select coalesce(sum(public._purchase_balance(f.id)), 0) into a from public.purchases f
      where f.company_id = v_c and f.payment_method = 'credito' and f.status = 'recibida'
      and (f.created_at at time zone s.timezone)::date >= s.start_date;
      select coalesce(sum(l.credit - l.debit), 0) into b
      from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
      where e.company_id = v_c and e.status in ('contabilizado', 'reversado') and l.account_id = x;
      code := 'cuentas_por_pagar'; label := 'Cuentas por pagar a proveedores'; operational := a; accounting := b;
      difference := a - b;
      note := 'Debe ser 0 cuando no haya pendientes';
      return next;

      select count(*) into k from public.supplier_payments y
      where y.company_id = v_c and y.status = 'activo' and (y.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'pago_proveedor'
      and e.source_id = y.id and e.source_event = 'registro');
      code := 'pagos_proveedor_pendientes'; label := 'Pagos a proveedores sin contabilizar (cantidad)'; operational := k;
      accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
    end if;
  end if;
end $function$;

REVOKE ALL ON FUNCTION public.acc_reconcile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acc_reconcile() TO authenticated, service_role;

COMMIT;
