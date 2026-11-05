-- =============================================================================
-- InventarioPro · Módulo de Cuentas por Pagar (Compras a Crédito y Abonos)
-- =============================================================================
-- Qué hace este script:
--   1. Permite registrar compras de CONTADO (igual que hoy, sale de caja) o a
--      CRÉDITO (no sale de caja, queda deuda con el proveedor y fecha de vencimiento).
--   2. Crea las tablas de Cuentas por Pagar (cxp_settings, supplier_credit,
--      supplier_payments, supplier_allocations) siguiendo el mismo diseño de
--      Cartera de clientes (fiado).
--   3. Permite registrar abonos/pagos a proveedores en efectivo, tarjeta o
--      transferencia (aplicados primero a la compra más antigua). El efectivo
--      descuenta de caja; tarjeta y transferencia van por bancos.
--   4. Impide anular una compra que tenga abonos activos (hasta anular esos abonos)
--      y evita devolver dinero a caja al anular una compra que fue a crédito.
--   5. Conecta Cuentas por Pagar con Contabilidad automática y Conciliación
--      (cuenta de Proveedores por pagar, asientos de compras a crédito y pagos).
--
-- Seguro de volver a ejecutar (idempotente). Las compras de contado existentes
-- y nuevas conservan exactamente el mismo comportamiento.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas en purchases (retrocompatibles: por defecto 'efectivo')
-- -----------------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'efectivo',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS credit_days integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchases_payment_method_check'
      AND conrelid = 'public.purchases'::regclass
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_payment_method_check
      CHECK (payment_method IN ('efectivo', 'credito'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchases_company_credit
  ON public.purchases (company_id, supplier_id, created_at)
  WHERE payment_method = 'credito' AND status = 'recibida';

-- -----------------------------------------------------------------------------
-- 2. Tablas de Cuentas por Pagar
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cxp_settings (
  company_id uuid PRIMARY KEY,
  account_id uuid REFERENCES public.acc_accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_credit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  credit_limit numeric NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  credit_days integer NOT NULL DEFAULT 30 CHECK (credit_days >= 0 AND credit_days <= 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('efectivo', 'tarjeta', 'transferencia')),
  note text,
  status text NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'anulado')),
  client_uuid uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, client_uuid)
);

CREATE TABLE IF NOT EXISTS public.supplier_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  payment_id uuid NOT NULL REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_company_supplier
  ON public.supplier_payments (company_id, supplier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_allocations_purchase
  ON public.supplier_allocations (purchase_id);

CREATE INDEX IF NOT EXISTS idx_supplier_allocations_payment
  ON public.supplier_allocations (payment_id);

-- -----------------------------------------------------------------------------
-- 3. Seguridad RLS y Triggers (mismo esquema que credit_payments)
-- -----------------------------------------------------------------------------
ALTER TABLE public.cxp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cxp_settings_select ON public.cxp_settings;
CREATE POLICY cxp_settings_select ON public.cxp_settings
  FOR SELECT USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS supplier_credit_select ON public.supplier_credit;
CREATE POLICY supplier_credit_select ON public.supplier_credit
  FOR SELECT USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;
CREATE POLICY supplier_payments_select ON public.supplier_payments
  FOR SELECT USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS supplier_allocations_select ON public.supplier_allocations;
CREATE POLICY supplier_allocations_select ON public.supplier_allocations
  FOR SELECT USING (company_id = public.current_company_id());

DROP TRIGGER IF EXISTS supplier_payments_audit ON public.supplier_payments;
CREATE TRIGGER supplier_payments_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

DROP TRIGGER IF EXISTS supplier_payments_check_subscription ON public.supplier_payments;
CREATE TRIGGER supplier_payments_check_subscription
  BEFORE INSERT OR DELETE OR UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.assert_can_write();

-- -----------------------------------------------------------------------------
-- 4. Funciones internas de saldo por pagar (_purchase_balance y _supplier_owed)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._purchase_balance(p_purchase_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN coalesce(p.payment_method, 'efectivo') <> 'credito' OR p.status <> 'recibida' THEN 0::numeric
    ELSE greatest(
      p.total - coalesce((
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

CREATE OR REPLACE FUNCTION public._supplier_owed(p_co uuid, p_supplier uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT coalesce(sum(public._purchase_balance(p.id)), 0)
  FROM public.purchases p
  WHERE p.company_id = p_co
    AND p.supplier_id = p_supplier
    AND p.payment_method = 'credito'
    AND p.status = 'recibida'
$function$;

REVOKE ALL ON FUNCTION public._supplier_owed(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._supplier_owed(uuid, uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Contabilidad: compras (contado y crédito) + pagos a proveedores
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
  v_memo text;
begin
  select * into s from public.acc_settings where company_id = p_p.company_id;
  if not found or not s.active or s.start_date is null then return null; end if;
  v_date := (p_p.created_at at time zone s.timezone)::date;
  if v_date < s.start_date or p_p.total <= 0 then return null; end if;

  v_inv := (s.map->>'inventario')::uuid;
  if v_inv is null then return null; end if;

  if coalesce(p_p.payment_method, 'efectivo') = 'credito' then
    select account_id into v_cred from public.cxp_settings where company_id = p_p.company_id;
    v_memo := 'Compra a crédito';
  else
    v_cred := (s.map->>'caja')::uuid;
    v_memo := 'Pago de compra';
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

CREATE OR REPLACE FUNCTION public.acc_post_supplier_payment(p_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.supplier_payments;
  s public.acc_settings;
  v_date date;
  v_cxp uuid;
  v_pay uuid;
  v_exp uuid;
  v_in numeric := 0;
  v_out numeric := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into p from public.supplier_payments where id = p_payment_id;
  if not found or p.status <> 'activo' then return null; end if;
  select * into s from public.acc_settings where company_id = p.company_id;
  if not found or not s.active or s.start_date is null then return null; end if;
  v_date := (p.created_at at time zone s.timezone)::date;
  if v_date < s.start_date then return null; end if;

  select account_id into v_cxp from public.cxp_settings where company_id = p.company_id;
  v_pay := case when p.method = 'efectivo' then (s.map->>'caja')::uuid else (s.map->>'bancos')::uuid end;
  v_exp := (s.map->>'gastos')::uuid;
  if v_cxp is null or v_pay is null then return null; end if;

  -- Lo aplicado a compras anteriores al inicio contable no tiene pasivo contabilizado
  select coalesce(sum(a.amount) filter (where (pu.created_at at time zone s.timezone)::date >= s.start_date), 0),
         coalesce(sum(a.amount) filter (where (pu.created_at at time zone s.timezone)::date <  s.start_date), 0)
    into v_in, v_out
  from public.supplier_allocations a
  join public.purchases pu on pu.id = a.purchase_id
  where a.payment_id = p.id;

  if v_out > 0 and v_exp is null then return null; end if;

  if v_in > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_cxp, 'debit', v_in));
  end if;
  if v_out > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_exp, 'debit', v_out,
      'memo', 'Pago de compras anteriores al inicio contable'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_id', v_pay, 'credit', p.amount,
    'memo', 'Pago a proveedor (' || p.method || ')'));

  if jsonb_array_length(v_lines) < 2 then return null; end if;

  return public.acc_system_entry(
    p.company_id, v_date,
    'Pago a proveedor' || coalesce(': ' || (select name from public.suppliers where id = p.supplier_id), ''),
    'pago_proveedor', p.id, 'registro', 'PP-' || substr(p.id::text, 1, 8), v_lines);
end $function$;

REVOKE ALL ON FUNCTION public.acc_post_supplier_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acc_post_supplier_payment(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. Configuración de cuenta contable CxP, Contabilizar pendientes y Conciliar
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cxp_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_acc uuid;
  v_active boolean := false;
  a acc_accounts%rowtype;
begin
  select account_id into v_acc from cxp_settings where company_id = v_co;
  select coalesce(active, false) into v_active from acc_settings where company_id = v_co;
  if v_acc is not null then
    select * into a from acc_accounts where id = v_acc and company_id = v_co;
  end if;
  return jsonb_build_object(
    'account_id', v_acc,
    'account_code', a.code,
    'account_name', a.name,
    'accounting_active', coalesce(v_active, false)
  );
end $function$;

REVOKE ALL ON FUNCTION public.cxp_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cxp_config() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cxp_save_account(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_res jsonb := null;
begin
  if p_account is not null and not exists (
    select 1 from acc_accounts where id = p_account and company_id = v_co and is_postable and active
  ) then
    raise exception 'La cuenta elegida no existe, está inactiva o no admite movimientos';
  end if;
  insert into cxp_settings (company_id, account_id) values (v_co, p_account)
  on conflict (company_id) do update set account_id = excluded.account_id, updated_at = now();
  if p_account is not null and exists (select 1 from acc_settings where company_id = v_co and active) then
    begin
      v_res := public.acc_post_pending();
    exception when others then
      v_res := null;
    end;
  end if;
  return coalesce(v_res, '{}'::jsonb);
end $function$;

REVOKE ALL ON FUNCTION public.cxp_save_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cxp_save_account(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acc_post_pending()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_c uuid := public.my_company(); s public.acc_settings;
  r public.sales; q public.purchases; d public.devolutions; c public.cash_entries; k public.kardex;
  pp public.credit_payments; sp public.supplier_payments;
  v_s int := 0; v_p int := 0; v_d int := 0; v_k int := 0; v_a int := 0; v_ab int := 0; v_pp int := 0;
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

  return jsonb_build_object(
    'ventas', v_s, 'compras', v_p, 'devoluciones', v_d,
    'caja', v_k, 'ajustes', v_a, 'abonos', v_ab, 'pagos_proveedor', v_pp
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
  code := 'devoluciones_pendientes'; label := 'Devoluciones sin contabilizar (cantidad)'; operational := k;
  accounting := 0; difference := k; note := 'Debe ser 0'; return next;

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
  note := 'Valorado al último costo. La contabilidad empieza en cero salvo que cargues un asiento de apertura';
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
    note := 'Debe ser 0 cuando no haya pendientes. Una devolución con descuento o impuesto puede dejar una diferencia pequeña';
    return next;

    select count(*) into k from public.credit_payments y
    where y.company_id = v_c and y.status = 'activo' and (y.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'abono'
    and e.source_id = y.id and e.source_event = 'registro');
    code := 'abonos_pendientes'; label := 'Abonos de clientes sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
  end if;

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
end $function$;

REVOKE ALL ON FUNCTION public.acc_reconcile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acc_reconcile() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Registrar compra (contado y crédito) y Anular compra (protegida)
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
  v_qty numeric; v_cost numeric; v_total numeric := 0;
  v_sup text; v_exp date; v_lot text; v_id uuid; v_items jsonb := '[]'::jsonb; v_new numeric;
  v_pay text := coalesce(p_payment_method, 'efectivo');
  v_limit numeric := 0; v_days integer := 30; v_due date := null; v_owed numeric := 0;
begin
  if v_pay not in ('efectivo', 'credito') then
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
    select coalesce(credit_limit, 0), coalesce(credit_days, 30)
      into v_limit, v_days
      from supplier_credit
      where supplier_id = p_supplier_id and company_id = v_co;
    if not found then v_limit := 0; v_days := 30; end if;

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
    update products set stock = v_new, cost = v_cost where id = v_prod.id;

    insert into kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id)
    values (v_co, v_prod.id, v_prod.name, 'entrada', v_qty, v_new, 'purchase', v_id);

    -- Productos con vencimiento: cada compra crea su lote
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
      'quantity', v_qty, 'cost', v_cost, 'subtotal', v_qty * v_cost)
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

  if v_pay = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_total, 'Compra - ' || coalesce(v_sup, 'Proveedor general'), 'purchase', v_id);
  end if;

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.registrar_compra(uuid, jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_compra(uuid, jsonb, text, integer) TO authenticated, service_role;

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
BEGIN
  -- Solo administradores y dueños de empresa.
  v_co := public._ctx(ARRAY['admin', 'dueno']);

  -- Bloquear la compra para evitar anulaciones simultáneas.
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

  -- Si la compra tiene abonos activos, exigir anular primero esos abonos.
  IF EXISTS (
    SELECT 1
    FROM supplier_allocations a
    JOIN supplier_payments sp ON sp.id = a.payment_id
    WHERE a.purchase_id = v_purchase.id
      AND sp.status = 'activo'
  ) THEN
    RAISE EXCEPTION 'No se puede anular: esta compra ya tiene pagos o abonos registrados. Anula primero esos pagos en Cuentas por pagar.';
  END IF;

  -- Lotes de esta compra: solo se puede anular si todavía están completos.
  IF EXISTS (
    SELECT 1 FROM product_lots
    WHERE company_id = v_co AND source_type = 'compra' AND source_id = v_purchase.id
      AND qty_remaining < qty_initial
  ) THEN
    RAISE EXCEPTION 'No se puede anular: ya se vendió o dio de baja parte de los lotes de esta compra';
  END IF;
  UPDATE product_lots SET qty_remaining = 0
  WHERE company_id = v_co AND source_type = 'compra' AND source_id = v_purchase.id;

  -- Agrupar artículos repetidos y procesarlos en orden.
  FOR v_item IN
    SELECT
      (item->>'product_id')::uuid AS product_id,
      SUM((item->>'quantity')::numeric) AS quantity
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

    UPDATE products
    SET stock = v_new
    WHERE id = v_prod.id
      AND company_id = v_co;

    INSERT INTO kardex (
      company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note
    ) VALUES (
      v_co, v_prod.id, v_prod.name, 'salida', v_item.quantity, v_new, 'purchase', v_purchase.id, 'Anulación de compra'
    );
  END LOOP;

  -- Solo compensar caja si la compra original fue de contado (efectivo).
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

-- -----------------------------------------------------------------------------
-- 8. Consultas y operaciones de Cuentas por Pagar (espejo de Cartera)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cuentas_por_pagar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_today date := public._co_today(v_co);
  v_res jsonb;
begin
  with b as (
    select p.supplier_id, p.id, p.due_date, public._purchase_balance(p.id) as bal
    from purchases p
    where p.company_id = v_co
      and p.payment_method = 'credito'
      and p.status = 'recibida'
      and p.supplier_id is not null
  ), agg as (
    select s.id, s.name, s.document, s.phone,
           coalesce(sum(b.bal), 0) as owed,
           coalesce(sum(b.bal) filter (where b.due_date is not null and b.due_date < v_today), 0) as overdue,
           min(b.due_date) filter (where b.bal > 0.004) as oldest_due,
           (count(b.id) filter (where b.bal > 0.004))::int as open_purchases,
           coalesce(sc.credit_limit, 0) as credit_limit,
           coalesce(sc.credit_days, 30) as credit_days,
           (select max(sp.created_at) from supplier_payments sp where sp.supplier_id = s.id and sp.status = 'activo') as last_payment
    from suppliers s
    left join b on b.supplier_id = s.id
    left join supplier_credit sc on sc.supplier_id = s.id and sc.company_id = v_co
    where s.company_id = v_co
    group by s.id, s.name, s.document, s.phone, sc.credit_limit, sc.credit_days
    having coalesce(sum(b.bal), 0) > 0.004 or coalesce(sc.credit_limit, 0) > 0
  )
  select jsonb_build_object(
    'today', v_today,
    'total_owed', coalesce((select sum(owed) from agg), 0),
    'total_overdue', coalesce((select sum(overdue) from agg), 0),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'supplier_id', id, 'name', name, 'document', document, 'phone', phone,
        'owed', owed, 'overdue', overdue, 'oldest_due', oldest_due, 'open_purchases', open_purchases,
        'credit_limit', credit_limit, 'credit_days', credit_days, 'last_payment', last_payment
      ) order by overdue desc, owed desc, name)
      from agg
    ), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $function$;

REVOKE ALL ON FUNCTION public.cuentas_por_pagar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuentas_por_pagar() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cuenta_por_pagar_proveedor(p_supplier_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_today date := public._co_today(v_co);
  sup suppliers%rowtype;
  v_limit numeric := 0;
  v_days integer := 30;
  v_owed numeric := 0;
  v_overdue numeric := 0;
  v_purchases jsonb;
  v_payments jsonb;
begin
  select * into sup from suppliers where id = p_supplier_id and company_id = v_co;
  if not found then raise exception 'Proveedor no existe'; end if;

  select coalesce(credit_limit, 0), coalesce(credit_days, 30)
    into v_limit, v_days
    from supplier_credit
    where supplier_id = p_supplier_id and company_id = v_co;
  if not found then v_limit := 0; v_days := 30; end if;

  with b as (
    select p.id, p.total, p.due_date, p.created_at,
           public._purchase_balance(p.id) as bal,
           case when p.due_date is not null and p.due_date < v_today then (v_today - p.due_date)::int else 0 end as days_overdue
    from purchases p
    where p.company_id = v_co
      and p.supplier_id = p_supplier_id
      and p.payment_method = 'credito'
      and p.status = 'recibida'
  )
  select coalesce(sum(bal), 0),
         coalesce(sum(bal) filter (where due_date is not null and due_date < v_today), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'total', total, 'balance', bal, 'due_date', due_date,
           'created_at', created_at, 'days_overdue', days_overdue
         ) order by created_at asc, id asc) filter (where bal > 0.004), '[]'::jsonb)
    into v_owed, v_overdue, v_purchases
  from b;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sp.id, 'amount', sp.amount, 'method', sp.method, 'status', sp.status,
    'note', sp.note, 'by', sp.created_by_name, 'created_at', sp.created_at
  ) order by sp.created_at desc), '[]'::jsonb)
    into v_payments
  from (
    select * from supplier_payments
    where company_id = v_co and supplier_id = p_supplier_id
    order by created_at desc
    limit 50
  ) sp;

  return jsonb_build_object(
    'supplier', jsonb_build_object('id', sup.id, 'name', sup.name, 'phone', sup.phone, 'document', sup.document),
    'owed', v_owed,
    'overdue', v_overdue,
    'credit_limit', v_limit,
    'credit_days', v_days,
    'purchases', v_purchases,
    'payments', v_payments
  );
end $function$;

REVOKE ALL ON FUNCTION public.cuenta_por_pagar_proveedor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuenta_por_pagar_proveedor(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guardar_credito_proveedor(p_supplier uuid, p_limit numeric, p_days integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
begin
  if not exists (select 1 from suppliers where id = p_supplier and company_id = v_co) then
    raise exception 'Proveedor no existe';
  end if;
  if not public._es_finito(p_limit) or p_limit < 0 then
    raise exception 'El cupo debe ser 0 o mayor';
  end if;
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'Los días de plazo deben estar entre 0 y 365';
  end if;

  insert into supplier_credit (company_id, supplier_id, credit_limit, credit_days, updated_at)
  values (v_co, p_supplier, round(p_limit, 2), p_days, now())
  on conflict (company_id, supplier_id) do update
    set credit_limit = excluded.credit_limit,
        credit_days = excluded.credit_days,
        updated_at = now();
end $function$;

REVOKE ALL ON FUNCTION public.guardar_credito_proveedor(uuid, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_credito_proveedor(uuid, numeric, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_supplier_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'efectivo'::text,
  p_note text DEFAULT NULL::text,
  p_client_id uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_amount numeric;
  v_sup text;
  v_owed numeric;
  v_id uuid;
  v_left numeric;
  v_alloc numeric;
  v_name text;
  r record;
begin
  if p_client_id is not null then
    select id into v_id from supplier_payments where company_id = v_co and client_uuid = p_client_id;
    if found then return v_id; end if;
  end if;

  if not public._es_finito(p_amount) or p_amount <= 0 then
    raise exception 'El pago debe ser mayor que cero';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount < 0.01 then
    raise exception 'El pago debe ser mayor que cero';
  end if;
  if coalesce(p_method, '') not in ('efectivo', 'tarjeta', 'transferencia') then
    raise exception 'Método de pago inválido';
  end if;

  select name into v_sup from suppliers where id = p_supplier_id and company_id = v_co for update;
  if not found then raise exception 'Proveedor no existe'; end if;

  v_owed := public._supplier_owed(v_co, p_supplier_id);
  if v_owed <= 0 then raise exception 'No tienes deuda pendiente con este proveedor'; end if;
  if v_amount > v_owed + 0.005 then
    raise exception 'El pago (%) es mayor que lo que debes al proveedor (%)', v_amount, round(v_owed, 2);
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  insert into supplier_payments (company_id, supplier_id, amount, method, note, client_uuid, created_by, created_by_name)
  values (
    v_co, p_supplier_id, v_amount, p_method,
    nullif(left(btrim(coalesce(p_note, '')), 300), ''),
    p_client_id, auth.uid(), v_name
  )
  returning id into v_id;

  -- Se aplica primero a la compra a crédito más antigua (FIFO)
  v_left := v_amount;
  for r in
    select p.id, public._purchase_balance(p.id) as bal
    from purchases p
    where p.company_id = v_co
      and p.supplier_id = p_supplier_id
      and p.payment_method = 'credito'
      and p.status = 'recibida'
    order by p.created_at, p.id
    for update of p
  loop
    exit when v_left <= 0.004;
    if r.bal > 0.004 then
      v_alloc := least(v_left, r.bal);
      insert into supplier_allocations (company_id, payment_id, purchase_id, amount)
      values (v_co, v_id, r.id, v_alloc);
      v_left := v_left - v_alloc;
    end if;
  end loop;

  if v_left > 0.01 then
    raise exception 'No se pudo aplicar el pago completo';
  end if;

  if p_method = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_amount, 'Pago a proveedor - ' || coalesce(v_sup, 'Proveedor'), 'pago_proveedor', v_id);
  end if;

  -- Si la contabilidad falla o falta elegir la cuenta contable, el pago igual queda registrado (pendiente)
  begin
    perform public.acc_post_supplier_payment(v_id);
  exception when others then
    null;
  end;

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.registrar_pago_proveedor(uuid, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid, numeric, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anular_pago_proveedor(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  p supplier_payments%rowtype;
  v_sup text;
begin
  select * into p from supplier_payments where id = p_payment_id and company_id = v_co for update;
  if not found then raise exception 'El pago no existe'; end if;
  if p.status = 'anulado' then raise exception 'Este pago ya está anulado'; end if;

  select name into v_sup from suppliers where id = p.supplier_id and company_id = v_co;

  update supplier_payments set status = 'anulado' where id = p.id;

  if p.method = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'ingreso', p.amount, 'Anulación pago a proveedor - ' || coalesce(v_sup, 'Proveedor'), 'anulacion_pago_proveedor', p.id);
  end if;

  perform public.acc_reverse_source(v_co, 'pago_proveedor', p.id, 'anulación de pago a proveedor');
end $function$;

REVOKE ALL ON FUNCTION public.anular_pago_proveedor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_pago_proveedor(uuid) TO authenticated, service_role;

COMMIT;
