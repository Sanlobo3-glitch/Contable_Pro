-- ============================================================================
-- MIGRACIÓN 20261114000064: DEVOLUCIONES PARCIALES DE COMPRAS CON IVA,
-- TRAZABILIDAD EXACTA DE LOTES Y SECUENCIA VERIFICABLE EN KARDEX
-- Dependencia obligatoria: 20261114000063_fase_a_iva_compras_contabilidad.
-- Idempotente, sin BEGIN/COMMIT propios.
-- ============================================================================

-- 1. Verificación dura de prerequisitos (000063 aplicada)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'tax_status'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kardex' and column_name = 'seq'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kardex' and column_name = 'seq_verified'
  ) or to_regclass('public.kardex_seq') is null
    or to_regclass('public.purchase_iva_adjustments') is null then
    raise exception 'Dependencia faltante: aplica primero la migración 20261114000063 antes de ejecutar 000064.';
  end if;
end $$;

-- 2. Columnas fiscales aditivas en purchase_devolutions
alter table public.purchase_devolutions add column if not exists subtotal numeric;
alter table public.purchase_devolutions add column if not exists tax_amount numeric not null default 0;
alter table public.purchase_devolutions add column if not exists tax_status_snapshot text not null default 'sin_iva';
alter table public.purchase_devolutions add column if not exists inventory_credit numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.purchase_devolutions'::regclass
      and conname = 'purchase_devolutions_tax_non_negative'
  ) then
    alter table public.purchase_devolutions
      add constraint purchase_devolutions_tax_non_negative check (tax_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.purchase_devolutions'::regclass
      and conname = 'purchase_devolutions_tax_status_check'
  ) then
    alter table public.purchase_devolutions
      add constraint purchase_devolutions_tax_status_check
      check (tax_status_snapshot in ('sin_iva', 'descontable', 'pendiente', 'costo'));
  end if;
end $$;

update public.purchase_devolutions
set subtotal = coalesce(subtotal, amount),
    inventory_credit = coalesce(inventory_credit, amount)
where subtotal is null or inventory_credit is null;

-- 3. Tabla de detalle exacto de lotes consumidos por cada devolución (RLS solo lectura; escrituras solo vía RPC)
create table if not exists public.purchase_devolution_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  devolution_id uuid not null references public.purchase_devolutions(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  lot_id uuid not null references public.product_lots(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (devolution_id, lot_id)
);

create index if not exists idx_fk_purchase_dev_lots_company
  on public.purchase_devolution_lots(company_id, created_at desc);
create index if not exists idx_fk_purchase_dev_lots_lot
  on public.purchase_devolution_lots(lot_id);

alter table public.purchase_devolution_lots enable row level security;

drop policy if exists purchase_devolution_lots_select on public.purchase_devolution_lots;
drop policy if exists platform_admin_purchase_dev_lots_all on public.purchase_devolution_lots;
drop policy if exists platform_admin_company_all on public.purchase_devolution_lots;

create policy purchase_devolution_lots_select
  on public.purchase_devolution_lots
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

revoke all on table public.purchase_devolution_lots from public, anon;
revoke insert, update, delete on table public.purchase_devolution_lots from authenticated;
grant select on table public.purchase_devolution_lots to authenticated;
grant all on table public.purchase_devolution_lots to service_role;

-- 4. Contabilización de devolución de compra con separación estricta de IVA
create or replace function public.acc_post_purchase_devolution(p_dev_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  d public.purchase_devolutions;
  s public.acc_settings;
  v_date date;
  v_inv uuid;
  v_deb uuid;
  v_vat_acc uuid;
  v_memo text;
  v_inv_credit numeric;
  v_tax numeric;
  v_lines jsonb;
begin
  select * into d from public.purchase_devolutions where id = p_dev_id;
  if not found or d.status <> 'activa' then
    return null;
  end if;

  select * into s from public.acc_settings where company_id = d.company_id;
  if not found or not s.active or s.start_date is null then
    return null;
  end if;

  v_date := (d.created_at at time zone s.timezone)::date;
  if v_date < s.start_date or d.amount <= 0 then
    return null;
  end if;

  v_inv := (s.map->>'inventario')::uuid;
  if v_inv is null then
    raise exception 'Falta configurar cuenta de inventario para contabilizar la devolución de compra';
  end if;

  if d.refund_method = 'credito' then
    if to_regclass('public.cxp_settings') is not null then
      select account_id into v_deb from public.cxp_settings where company_id = d.company_id;
    end if;
    if v_deb is null then
      raise exception 'Falta configurar la cuenta por pagar a proveedores para devolución a crédito';
    end if;
    v_memo := 'Descuento en cuenta por pagar';
  elsif d.refund_method = 'efectivo' then
    v_deb := (s.map->>'caja')::uuid;
    v_memo := 'Reintegro en efectivo de proveedor';
  else
    v_deb := (s.map->>'bancos')::uuid;
    v_memo := 'Reintegro bancario de proveedor (' || d.refund_method || ')';
  end if;

  if v_deb is null then
    raise exception 'Falta configurar cuenta de % para contabilizar devolución', d.refund_method;
  end if;

  v_tax := round(coalesce(d.tax_amount, 0), 2);
  v_inv_credit := round(coalesce(
    d.inventory_credit,
    case when d.tax_status_snapshot = 'costo' then d.amount else coalesce(d.subtotal, d.amount - v_tax) end
  ), 2);

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_deb, 'debit', d.amount, 'memo', v_memo),
    jsonb_build_object('account_id', v_inv, 'credit', v_inv_credit, 'memo', d.product_name)
  );

  if v_tax > 0 and d.tax_status_snapshot in ('descontable', 'pendiente') then
    v_vat_acc := public._acc_resolve_purchase_vat_account(d.company_id, d.tax_status_snapshot);
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_vat_acc,
        'credit', v_tax,
        'memo', 'Reversión IVA por devolución en compra (' || d.tax_status_snapshot || ')'
      )
    );
  end if;

  return public.acc_system_entry(
    d.company_id,
    v_date,
    'Devolución a proveedor (' || coalesce(d.supplier_name, 'Proveedor general') || '): ' || d.product_name,
    'devolucion_compra',
    d.id,
    'registro',
    'DC-' || substr(d.id::text, 1, 8),
    v_lines
  );
end
$function$;

-- 5. registrar_devolucion_compra con prorrata de base e IVA y orden por kardex.seq
create or replace function public.registrar_devolucion_compra(
  p_purchase_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_refund_method text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  v_pur public.purchases%rowtype;
  v_prod public.products%rowtype;
  v_s public.acc_settings%rowtype;
  v_bought numeric := 0;
  v_bought_amt numeric := 0;
  v_bought_tax_expl numeric := 0;
  v_bought_tax numeric := 0;
  v_returned numeric := 0;
  v_returned_amt numeric := 0;
  v_returned_tax numeric := 0;
  v_dev_base numeric := 0;
  v_dev_tax numeric := 0;
  v_amount numeric := 0;
  v_inv_credit numeric := 0;
  v_unit_inv_cost numeric := 0;
  v_refund text;
  v_new numeric;
  v_rev_cost numeric;
  v_bal numeric := 0;
  v_id uuid;
  v_name text;
  v_lot_avail numeric := 0;
  v_left numeric := 0;
  v_take numeric := 0;
  v_k_seq bigint;
  v_k_cnt int := 0;
  v_k_verified boolean := false;
  v_other_moves int := 0;
  v_taken_lots jsonb := '[]'::jsonb;
  r_lot record;
  r_taken record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad a devolver debe ser mayor que cero';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la devolución al proveedor';
  end if;

  select * into v_pur
  from public.purchases
  where id = p_purchase_id and company_id = v_co
  for update;
  if not found then
    raise exception 'La compra no existe';
  end if;
  if v_pur.status = 'anulada' then
    raise exception 'Esta compra está anulada';
  end if;

  select
    coalesce(sum((it->>'quantity')::numeric), 0),
    coalesce(sum(coalesce((it->>'subtotal')::numeric, (it->>'quantity')::numeric * (it->>'cost')::numeric)), 0),
    coalesce(sum(coalesce((it->>'tax_amount')::numeric, 0)), 0)
  into v_bought, v_bought_amt, v_bought_tax_expl
  from jsonb_array_elements(v_pur.items) it
  where (it->>'product_id')::uuid = p_product_id;

  if v_bought <= 0 then
    raise exception 'Ese producto no pertenece a esta compra';
  end if;

  if v_bought_tax_expl > 0 then
    v_bought_tax := round(v_bought_tax_expl, 2);
  elsif coalesce(v_pur.tax, 0) > 0 and coalesce(v_pur.subtotal, 0) > 0 then
    v_bought_tax := round(v_pur.tax * (v_bought_amt / v_pur.subtotal), 2);
  else
    v_bought_tax := 0;
  end if;

  select
    coalesce(sum(quantity), 0),
    coalesce(sum(coalesce(subtotal, amount)), 0),
    coalesce(sum(coalesce(tax_amount, 0)), 0)
  into v_returned, v_returned_amt, v_returned_tax
  from public.purchase_devolutions
  where company_id = v_co and purchase_id = p_purchase_id and product_id = p_product_id and status = 'activa';

  if v_returned + p_quantity > v_bought + 0.0001 then
    raise exception 'Solo quedan % unidad(es) disponibles para devolver en esta compra', v_bought - v_returned;
  end if;

  if abs((v_returned + p_quantity) - v_bought) <= 0.0001 then
    v_dev_base := greatest(0, round(v_bought_amt - v_returned_amt, 2));
    v_dev_tax := greatest(0, round(v_bought_tax - v_returned_tax, 2));
  else
    v_dev_base := round(p_quantity * (v_bought_amt / v_bought), 2);
    v_dev_tax := round(p_quantity * (v_bought_tax / v_bought), 2);
  end if;

  v_amount := round(v_dev_base + v_dev_tax, 2);
  v_inv_credit := case
    when v_pur.tax_status = 'costo' then v_amount
    else v_dev_base
  end;
  v_unit_inv_cost := round(v_inv_credit / p_quantity, 4);

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
      raise exception 'La devolución (%) supera el saldo pendiente de esta compra (%).', v_amount, round(v_bal, 2);
    end if;
  end if;

  select * into v_prod
  from public.products
  where id = p_product_id and company_id = v_co
  for update;
  if not found then
    raise exception 'El producto ya no existe';
  end if;
  if v_prod.stock < p_quantity then
    raise exception 'Stock actual insuficiente de "%" (en inventario: %, a devolver: %)', v_prod.name, v_prod.stock, p_quantity;
  end if;

  if v_prod.tracks_expiry then
    select coalesce(sum(qty_remaining), 0) into v_lot_avail
    from public.product_lots
    where company_id = v_co and source_type = 'compra' and source_id = p_purchase_id and product_id = p_product_id;

    if v_lot_avail < p_quantity then
      raise exception 'Solo quedan % unidad(es) disponibles en el lote de esta compra para devolver', v_lot_avail;
    end if;

    v_left := p_quantity;
    for r_lot in
      select id, qty_remaining
      from public.product_lots
      where company_id = v_co and source_type = 'compra' and source_id = p_purchase_id
        and product_id = p_product_id and qty_remaining > 0
      order by expiry_date asc, created_at asc, id asc
      for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, r_lot.qty_remaining);
      update public.product_lots set qty_remaining = qty_remaining - v_take where id = r_lot.id;
      v_taken_lots := v_taken_lots || jsonb_build_array(jsonb_build_object('lot_id', r_lot.id, 'quantity', v_take));
      v_left := v_left - v_take;
    end loop;
  else
    select count(*), coalesce(bool_and(seq_verified), false), max(seq)
    into v_k_cnt, v_k_verified, v_k_seq
    from public.kardex
    where company_id = v_co and product_id = v_prod.id
      and reference_type = 'purchase' and reference_id = p_purchase_id and type = 'entrada';

    if v_k_cnt = 0 or not v_k_verified or v_k_seq is null then
      raise exception 'No se puede devolver "%" sin control de lote: compra histórica o sin secuencia verificable en kardex (orden cronológico no reconstruible)', v_prod.name;
    end if;

    select count(*) into v_other_moves
    from public.kardex k
    where k.company_id = v_co
      and k.product_id = v_prod.id
      and k.seq_verified = true
      and k.seq > v_k_seq
      and not (
        k.reference_type = 'purchase_devolution'
        and exists (
          select 1 from public.purchase_devolutions pd
          where pd.id = k.reference_id and pd.purchase_id = p_purchase_id
        )
      );

    if v_other_moves > 0 then
      raise exception 'No se puede devolver "%" sin control de lote: existen ventas, ajustes o compras posteriores en kardex que alteran trazabilidad o costo promedio', v_prod.name;
    end if;
  end if;

  v_new := v_prod.stock - p_quantity;
  v_rev_cost := v_prod.cost;
  if v_new > 0 then
    v_rev_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) - v_inv_credit) / v_new, 2);
    if v_rev_cost <= 0 then
      v_rev_cost := v_prod.cost;
    end if;
  end if;

  update public.products set stock = v_new, cost = v_rev_cost where id = v_prod.id;
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.purchase_devolutions (
    company_id, purchase_id, supplier_id, supplier_name,
    product_id, product_name, quantity, unit_cost, amount,
    subtotal, tax_amount, tax_status_snapshot, inventory_credit,
    refund_method, reason, status, created_by, created_by_name
  ) values (
    v_co, v_pur.id, v_pur.supplier_id, v_pur.supplier_name,
    v_prod.id, v_prod.name, p_quantity, round(v_unit_inv_cost, 2), v_amount,
    v_dev_base, v_dev_tax, v_pur.tax_status, v_inv_credit,
    v_refund, left(btrim(p_reason), 240), 'activa', auth.uid(), v_name
  )
  returning id into v_id;

  if jsonb_array_length(v_taken_lots) > 0 then
    for r_taken in select elem from jsonb_array_elements(v_taken_lots) as t(elem) loop
      insert into public.purchase_devolution_lots (
        company_id, devolution_id, purchase_id, product_id, lot_id, quantity
      ) values (
        v_co, v_id, v_pur.id, v_prod.id, (r_taken.elem->>'lot_id')::uuid, (r_taken.elem->>'quantity')::numeric
      );
    end loop;
  end if;

  insert into public.kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note)
  values (v_co, v_prod.id, v_prod.name, 'salida', p_quantity, v_new, 'purchase_devolution', v_id, 'Devolución a proveedor: ' || left(btrim(p_reason), 120));

  if v_refund = 'efectivo' and v_amount > 0 then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'ingreso', v_amount, 'Devolución a proveedor - ' || v_prod.name, 'purchase_devolution', v_id);
  end if;

  select * into v_s from public.acc_settings where company_id = v_co;
  if v_s.company_id is not null and v_s.active and v_s.start_date is not null then
    perform public.acc_post_purchase_devolution(v_id);
  end if;

  return v_id;
end
$function$;

-- 6. anular_devolucion_compra: restauración exacta con/sin lotes y bloqueo si no hay trazabilidad suficiente
create or replace function public.anular_devolucion_compra(p_dev_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  d public.purchase_devolutions%rowtype;
  v_pur public.purchases%rowtype;
  v_prod public.products%rowtype;
  v_inv_amt numeric;
  v_new numeric;
  v_new_cost numeric;
  v_tz text;
  v_rev_date date;
  v_restored_sum numeric := 0;
  v_dev_seq bigint;
  v_dev_cnt int := 0;
  v_dev_verified boolean := false;
  v_other_moves int := 0;
  r_dl record;
  v_lot public.product_lots%rowtype;
begin
  select * into d
  from public.purchase_devolutions
  where id = p_dev_id and company_id = v_co
  for update;
  if not found then
    raise exception 'La devolución a proveedor no existe';
  end if;
  if d.status = 'anulada' then
    raise exception 'Esta devolución ya fue anulada';
  end if;

  select * into v_pur
  from public.purchases
  where id = d.purchase_id and company_id = v_co
  for update;
  if not found then
    raise exception 'La compra asociada a esta devolución no existe';
  end if;
  if v_pur.status = 'anulada' then
    raise exception 'No se puede anular esta devolución porque la compra origen ya está anulada';
  end if;
  if v_pur.tax_status is distinct from coalesce(d.tax_status_snapshot, v_pur.tax_status) then
    raise exception 'No se puede anular esta devolución porque el estado fiscal de la compra cambió de "%" a "%" tras devolver.',
      d.tax_status_snapshot, v_pur.tax_status;
  end if;

  select timezone into v_tz from public.acc_settings where company_id = v_co;
  v_rev_date := (now() at time zone coalesce(v_tz, 'America/Caracas'))::date;
  if exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'devolucion_compra' and source_id = d.id
      and source_event = 'registro' and status = 'contabilizado'
  ) and not public.acc_period_is_open(v_co, v_rev_date) then
    raise exception 'El periodo contable actual está cerrado: no se puede anular la devolución de compra';
  end if;

  select * into v_prod
  from public.products
  where id = d.product_id and company_id = v_co
  for update;
  if not found then
    raise exception 'El producto ya no existe';
  end if;

  if v_prod.tracks_expiry then
    select coalesce(sum(quantity), 0) into v_restored_sum
    from public.purchase_devolution_lots
    where company_id = v_co and devolution_id = d.id;

    if abs(v_restored_sum - d.quantity) > 0.0001 then
      raise exception 'Falta trazabilidad exacta de lotes en purchase_devolution_lots para anular esta devolución (esperado %, registrado %)',
        d.quantity, v_restored_sum;
    end if;

    for r_dl in
      select dl.lot_id, dl.quantity
      from public.purchase_devolution_lots dl
      where dl.company_id = v_co and dl.devolution_id = d.id
      order by dl.lot_id
      for update
    loop
      select * into v_lot
      from public.product_lots
      where id = r_dl.lot_id and company_id = v_co
      for update;
      if not found then
        raise exception 'El lote original % de la devolución ya no existe', r_dl.lot_id;
      end if;
      if v_lot.qty_remaining + r_dl.quantity > v_lot.qty_initial + 0.0001 then
        raise exception 'Restaurar % unidad(es) excede la cantidad inicial del lote (%)', r_dl.quantity, v_lot.lot_code;
      end if;
      update public.product_lots
      set qty_remaining = qty_remaining + r_dl.quantity
      where id = v_lot.id;
    end loop;
  else
    select count(*), coalesce(bool_and(seq_verified), false), max(seq)
    into v_dev_cnt, v_dev_verified, v_dev_seq
    from public.kardex
    where company_id = v_co and product_id = v_prod.id
      and reference_type = 'purchase_devolution' and reference_id = d.id and type = 'salida';

    if v_dev_cnt = 0 or not v_dev_verified or v_dev_seq is null then
      raise exception 'No se puede anular la devolución de "%" sin control de lote: registro histórico o sin secuencia verificable en kardex', v_prod.name;
    end if;

    select count(*) into v_other_moves
    from public.kardex k
    where k.company_id = v_co
      and k.product_id = v_prod.id
      and k.seq_verified = true
      and k.seq > v_dev_seq;

    if v_other_moves > 0 then
      raise exception 'No se puede anular la devolución de "%" sin control de lote: existen movimientos posteriores en kardex que alteraron el inventario o costo promedio', v_prod.name;
    end if;
  end if;

  v_inv_amt := coalesce(
    d.inventory_credit,
    case when d.tax_status_snapshot = 'costo' then d.amount else coalesce(d.subtotal, d.amount - coalesce(d.tax_amount, 0)) end
  );

  v_new := v_prod.stock + d.quantity;
  if v_prod.stock > 0 and v_new > 0 then
    v_new_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) + v_inv_amt) / v_new, 2);
  else
    v_new_cost := round(v_inv_amt / d.quantity, 2);
  end if;

  update public.products set stock = v_new, cost = v_new_cost where id = d.product_id;
  update public.purchase_devolutions set status = 'anulada' where id = d.id;

  insert into public.kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note)
  values (v_co, v_prod.id, v_prod.name, 'entrada', d.quantity, v_new, 'purchase_devolution', d.id, 'Anulación devolución a proveedor');

  if d.refund_method = 'efectivo' and d.amount > 0 then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', d.amount, 'Anulación devolución a proveedor - ' || d.product_name, 'anulacion_devolucion_compra', d.id);
  end if;

  perform public.acc_reverse_source(v_co, 'devolucion_compra', d.id, 'anulación de devolución a proveedor');
end
$function$;

revoke all on function public.acc_post_purchase_devolution(uuid) from public, anon, authenticated;
grant execute on function public.acc_post_purchase_devolution(uuid) to postgres, service_role;

revoke all on function public.registrar_devolucion_compra(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.registrar_devolucion_compra(uuid, uuid, numeric, text, text) to authenticated, service_role;

revoke all on function public.anular_devolucion_compra(uuid) from public, anon;
grant execute on function public.anular_devolucion_compra(uuid) to authenticated, service_role;

select public.sql_registrar_migracion(
  '20261114000064_devoluciones_compra_con_iva',
  'Devoluciones parciales con IVA, RLS solo lectura en purchase_devolution_lots, kardex.seq verificable y anulación blindada',
  '20261114000064_devoluciones_compra_con_iva.sql'
);
