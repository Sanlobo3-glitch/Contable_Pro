-- ============================================================================
-- MIGRACIÓN 20261114000063: FASE A — IVA EN COMPRAS, SECUENCIA VERIFICABLE
-- EN KARDEX (seq + seq_verified + trigger), RLS RESTRINGIDO, FORMULARIO 300 Y CONCILIACIÓN
-- Idempotente, sin BEGIN/COMMIT propios.
-- ============================================================================

-- 1. Extensiones aditivas en public.purchases y secuencia verificable en public.kardex
alter table public.purchases add column if not exists tax_rate numeric;
alter table public.purchases add column if not exists tax_included boolean not null default false;
alter table public.purchases add column if not exists tax_status text not null default 'sin_iva';
alter table public.purchases add column if not exists recognized_cost numeric not null default 0;
alter table public.purchases add column if not exists iva_cost_inventory numeric not null default 0;
alter table public.purchases add column if not exists iva_cost_expense numeric not null default 0;
alter table public.purchases add column if not exists iva_classified_at timestamptz;
alter table public.purchases add column if not exists iva_classified_by uuid;
alter table public.purchases add column if not exists iva_classification_note text;

alter table public.kardex add column if not exists seq bigint;
alter table public.kardex add column if not exists seq_verified boolean not null default false;
alter table public.kardex alter column seq drop default;

create sequence if not exists public.kardex_seq as bigint start with 1 increment by 1;
revoke all on sequence public.kardex_seq from public, anon, authenticated;
grant all on sequence public.kardex_seq to postgres, service_role;

do $$
declare
  v_max_seq bigint;
  v_cur_val bigint;
  v_is_called boolean;
  v_target bigint;
begin
  select coalesce(max(seq), 0) into v_max_seq from public.kardex;
  select last_value, is_called into v_cur_val, v_is_called from public.kardex_seq;
  v_target := greatest(
    v_max_seq + 1,
    case when coalesce(v_is_called, false) then v_cur_val + 1 else v_cur_val end
  );
  perform setval('public.kardex_seq', v_target, false);
end $$;

create or replace function public._kardex_assign_seq()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.seq := nextval('public.kardex_seq');
    new.seq_verified := true;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not coalesce(old.seq_verified, false) and coalesce(new.seq_verified, false) then
      raise exception 'No se permite marcar como verificable un registro histórico de kardex';
    end if;
    if coalesce(old.seq_verified, false) and coalesce(new.seq_verified, false) and new.seq is distinct from old.seq then
      raise exception 'No se permite alterar la secuencia verificada de kardex';
    end if;
    return new;
  end if;

  return new;
end
$function$;

drop trigger if exists trg_kardex_assign_seq on public.kardex;
create trigger trg_kardex_assign_seq
  before insert or update on public.kardex
  for each row execute function public._kardex_assign_seq();

create index if not exists idx_kardex_company_prod_seq
  on public.kardex(company_id, product_id, seq_verified, seq);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.purchases'::regclass
      and conname = 'purchases_tax_status_check'
  ) then
    alter table public.purchases
      add constraint purchases_tax_status_check
      check (tax_status in ('sin_iva', 'descontable', 'pendiente', 'costo'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.purchases'::regclass
      and conname = 'purchases_tax_rate_non_negative'
  ) then
    alter table public.purchases
      add constraint purchases_tax_rate_non_negative
      check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.purchases'::regclass
      and conname = 'purchases_iva_cost_non_negative'
  ) then
    alter table public.purchases
      add constraint purchases_iva_cost_non_negative
      check (recognized_cost >= 0 and iva_cost_inventory >= 0 and iva_cost_expense >= 0);
  end if;
end $$;

update public.purchases
set tax_status = case when coalesce(tax, 0) > 0 then 'descontable' else 'sin_iva' end,
    recognized_cost = greatest(0, coalesce(subtotal, total - coalesce(tax, 0)))
where recognized_cost = 0
  and total > 0;

-- 2. Tabla de evidencia inmutable de reclasificaciones de IVA (solo lectura por RLS; escrituras solo vía RPC)
create table if not exists public.purchase_iva_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  from_status text not null check (from_status in ('pendiente')),
  to_status text not null check (to_status in ('descontable', 'costo')),
  original_subtotal numeric not null default 0 check (original_subtotal >= 0),
  original_tax numeric not null default 0 check (original_tax >= 0),
  tax_amount numeric not null check (tax_amount >= 0),
  previous_recognized_cost numeric not null default 0 check (previous_recognized_cost >= 0),
  new_recognized_cost numeric not null default 0 check (new_recognized_cost >= 0),
  amount_to_inventory numeric not null default 0 check (amount_to_inventory >= 0),
  amount_to_expense numeric not null default 0 check (amount_to_expense >= 0),
  product_adjustments jsonb not null default '[]'::jsonb,
  entry_id uuid references public.acc_entries(id) on delete set null,
  reversed_by_entry_id uuid references public.acc_entries(id) on delete set null,
  status text not null default 'aplicado' check (status in ('aplicado', 'reversado')),
  reason text,
  created_by uuid,
  created_by_name text,
  created_by_role text,
  created_at timestamptz not null default now(),
  reversed_at timestamptz
);

alter table public.purchase_iva_adjustments add column if not exists original_subtotal numeric not null default 0;
alter table public.purchase_iva_adjustments add column if not exists original_tax numeric not null default 0;
alter table public.purchase_iva_adjustments add column if not exists previous_recognized_cost numeric not null default 0;
alter table public.purchase_iva_adjustments add column if not exists new_recognized_cost numeric not null default 0;
alter table public.purchase_iva_adjustments add column if not exists created_by_name text;
alter table public.purchase_iva_adjustments add column if not exists created_by_role text;

create index if not exists idx_fk_purchase_iva_adj_company
  on public.purchase_iva_adjustments(company_id, created_at desc);
create index if not exists idx_fk_purchase_iva_adj_purchase
  on public.purchase_iva_adjustments(purchase_id);
create index if not exists idx_fk_purchase_iva_adj_entry
  on public.purchase_iva_adjustments(entry_id);

alter table public.purchase_iva_adjustments enable row level security;

drop policy if exists purchase_iva_adjustments_select on public.purchase_iva_adjustments;
drop policy if exists platform_admin_purchase_iva_adjustments_all on public.purchase_iva_adjustments;
drop policy if exists platform_admin_company_all on public.purchase_iva_adjustments;

create policy purchase_iva_adjustments_select
  on public.purchase_iva_adjustments
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

revoke all on table public.purchase_iva_adjustments from public, anon;
revoke insert, update, delete on table public.purchase_iva_adjustments from authenticated;
grant select on table public.purchase_iva_adjustments to authenticated;
grant all on table public.purchase_iva_adjustments to service_role;

-- 3. Plantilla contable genérica extendida con 1.1.06 (solo planes vacíos o con nodo 1.1 activo/debito)
create or replace function public.acc_seed_template(p_template text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.my_company();
  r record;
  v_n int := 0;
begin
  if not public.is_manager() or v_c is null then
    raise exception 'No autorizado';
  end if;
  if p_template <> 'generico' then
    raise exception 'Plantilla no disponible';
  end if;
  if exists (select 1 from public.acc_accounts where company_id = v_c) then
    raise exception 'Tu empresa ya tiene cuentas; la plantilla solo se aplica a un plan vacío';
  end if;

  for r in
    select * from (values
      ('1', 'ACTIVO', 'activo', 'debito', null, false),
      ('1.1', 'Activo corriente', 'activo', 'debito', '1', false),
      ('1.1.01', 'Caja', 'activo', 'debito', '1.1', true),
      ('1.1.02', 'Bancos', 'activo', 'debito', '1.1', true),
      ('1.1.03', 'Cuentas por cobrar clientes', 'activo', 'debito', '1.1', true),
      ('1.1.04', 'Inventario de mercancías', 'activo', 'debito', '1.1', true),
      ('1.1.05', 'Impuestos por recuperar', 'activo', 'debito', '1.1', true),
      ('1.1.06', 'IVA por clasificar en compras', 'activo', 'debito', '1.1', true),
      ('2', 'PASIVO', 'pasivo', 'credito', null, false),
      ('2.1', 'Pasivo corriente', 'pasivo', 'credito', '2', false),
      ('2.1.01', 'Cuentas por pagar proveedores', 'pasivo', 'credito', '2.1', true),
      ('2.1.02', 'Impuestos por pagar', 'pasivo', 'credito', '2.1', true),
      ('3', 'PATRIMONIO', 'patrimonio', 'credito', null, false),
      ('3.1.01', 'Capital', 'patrimonio', 'credito', '3', true),
      ('3.1.02', 'Resultados acumulados', 'patrimonio', 'credito', '3', true),
      ('3.1.03', 'Resultado del ejercicio', 'patrimonio', 'credito', '3', true),
      ('4', 'INGRESOS', 'ingreso', 'credito', null, false),
      ('4.1.01', 'Ventas', 'ingreso', 'credito', '4', true),
      ('4.1.02', 'Devoluciones en ventas', 'ingreso', 'debito', '4', true),
      ('5', 'COSTOS', 'costo', 'debito', null, false),
      ('5.1.01', 'Costo de ventas', 'costo', 'debito', '5', true),
      ('6', 'GASTOS', 'gasto', 'debito', null, false),
      ('6.1.01', 'Gastos operativos', 'gasto', 'debito', '6', true),
      ('6.1.02', 'Ajustes de inventario', 'gasto', 'debito', '6', true)
    ) as t(code, name, type, nature, parent, postable)
  loop
    insert into public.acc_accounts (company_id, code, name, type, nature, parent_id, is_postable)
    values (
      v_c,
      r.code,
      r.name,
      r.type,
      r.nature,
      (select a.id from public.acc_accounts a where a.company_id = v_c and a.code = r.parent),
      r.postable
    );
    v_n := v_n + 1;
  end loop;

  return v_n;
end
$function$;

do $$
begin
  insert into public.acc_accounts (company_id, code, name, type, nature, parent_id, is_postable, active)
  select p.company_id, '1.1.06', 'IVA por clasificar en compras', 'activo', 'debito', p.id, true, true
  from public.acc_accounts p
  where p.code = '1.1'
    and p.type = 'activo'
    and p.nature = 'debito'
    and not exists (
      select 1 from public.acc_accounts a
      where a.company_id = p.company_id and a.code = '1.1.06'
    );
end $$;

-- 4. Configuración contable con validación estricta de tipo/naturaleza para cuentas IVA
create or replace function public.acc_save_settings(p_map jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.my_company();
  k text;
  v text;
  v_acc public.acc_accounts%rowtype;
  v_cur jsonb;
begin
  if not public.is_manager() or v_c is null then
    raise exception 'No autorizado';
  end if;
  if p_map is null or jsonb_typeof(p_map) <> 'object' then
    raise exception 'Mapa de cuentas inválido';
  end if;

  for k, v in select key, value from jsonb_each_text(p_map) loop
    if k not in (
      'caja', 'bancos', 'ventas', 'impuestos', 'costo_ventas', 'inventario',
      'devoluciones', 'gastos', 'otros_ingresos', 'ajustes_inventario',
      'iva_descontable', 'iva_pendiente'
    ) then
      raise exception 'Clave de configuración desconocida: %', k;
    end if;

    if coalesce(btrim(v), '') <> '' then
      begin
        select * into v_acc
        from public.acc_accounts
        where id = v::uuid and company_id = v_c;
      exception when invalid_text_representation then
        raise exception 'El identificador de cuenta para "%" no es un UUID válido', k;
      end;

      if not found or not v_acc.is_postable or not v_acc.active then
        raise exception 'La cuenta elegida para "%" no existe, está inactiva o no admite movimientos', k;
      end if;

      if k in ('iva_descontable', 'iva_pendiente') then
        if v_acc.type <> 'activo' or v_acc.nature <> 'debito' then
          raise exception 'La cuenta para "%" debe ser de tipo activo y naturaleza debito (actual: % / %)',
            k, v_acc.type, v_acc.nature;
        end if;
      end if;
    end if;
  end loop;

  select coalesce(map, '{}'::jsonb) into v_cur
  from public.acc_settings
  where company_id = v_c;
  v_cur := coalesce(v_cur, '{}'::jsonb);

  for k, v in select key, value from jsonb_each_text(p_map) loop
    if coalesce(btrim(v), '') = '' then
      v_cur := v_cur - k;
    else
      v_cur := jsonb_set(v_cur, array[k], to_jsonb(btrim(v)), true);
    end if;
  end loop;

  insert into public.acc_settings (company_id, map)
  values (v_c, v_cur)
  on conflict (company_id) do update
    set map = v_cur,
        updated_at = now();
end
$function$;

-- 5. Helper estricto de cuenta IVA en compras (sin códigos quemados ni fallback)
create or replace function public._acc_resolve_purchase_vat_account(
  p_company uuid,
  p_role text
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_s public.acc_settings%rowtype;
  v_key text;
  v_acc_text text;
  v_acc_id uuid;
  v_acc public.acc_accounts%rowtype;
begin
  if p_role not in ('descontable', 'pendiente') then
    raise exception 'Rol de cuenta IVA inválido: %', coalesce(p_role, '<null>');
  end if;

  select * into v_s from public.acc_settings where company_id = p_company;
  if not found then
    raise exception 'No existe configuración contable para la empresa';
  end if;

  v_key := case when p_role = 'descontable' then 'iva_descontable' else 'iva_pendiente' end;
  v_acc_text := nullif(btrim(coalesce(v_s.map ->> v_key, '')), '');
  if v_acc_text is null then
    raise exception 'Falta configurar la cuenta contable "%". Operación detenida (sin asignación automática ni respaldo por defecto).', v_key;
  end if;

  begin
    v_acc_id := v_acc_text::uuid;
  exception when others then
    raise exception 'El identificador configurado en "%" no es un UUID válido', v_key;
  end;

  select * into v_acc
  from public.acc_accounts
  where id = v_acc_id and company_id = p_company;
  if not found then
    raise exception 'La cuenta configurada en "%" no pertenece a esta empresa', v_key;
  end if;

  if not v_acc.active or not v_acc.is_postable then
    raise exception 'La cuenta % (%) configurada en "%" está inactiva o no es imputable',
      v_acc.code, v_acc.name, v_key;
  end if;

  if v_acc.type <> 'activo' or v_acc.nature <> 'debito' then
    raise exception 'La cuenta % (%) configurada en "%" debe ser tipo activo y naturaleza debito (actual: % / %)',
      v_acc.code, v_acc.name, v_key, v_acc.type, v_acc.nature;
  end if;

  return v_acc.id;
end
$function$;

-- 6. Núcleo interno compartido para registrar compras con o sin IVA
create or replace function public._registrar_compra_impl(
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_credit_days integer,
  p_tax numeric,
  p_tax_status text,
  p_tax_rate numeric,
  p_tax_included boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno']);
  e jsonb;
  v_prod public.products%rowtype;
  v_pid uuid;
  v_qty numeric;
  v_raw_cost numeric;
  v_items_sum numeric := 0;
  v_line_count int := 0;
  v_idx int := 0;
  v_tax_rate numeric := p_tax_rate;
  v_tax_incl boolean := coalesce(p_tax_included, false);
  v_tax numeric;
  v_tax_status text := coalesce(nullif(btrim(coalesce(p_tax_status, '')), ''), 'sin_iva');
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_line_base numeric;
  v_line_tax numeric;
  v_rem_base numeric;
  v_rem_tax numeric;
  v_eff_unit_cost numeric;
  v_inv_add numeric;
  v_new_cost numeric;
  v_sup text;
  v_exp date;
  v_lot text;
  v_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_new numeric;
  v_pay text := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'efectivo');
  v_limit numeric := 0;
  v_days integer := 30;
  v_due date := null;
  v_owed numeric := 0;
  v_s public.acc_settings%rowtype;
  v_pur_date date;
begin
  if v_pay not in ('efectivo', 'tarjeta', 'transferencia', 'credito') then
    raise exception 'Forma de pago de compra inválida';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra no tiene items';
  end if;

  if p_tax is not null and (not public._es_finito(p_tax) or p_tax < 0) then
    raise exception 'El valor del IVA de compra no puede ser negativo ni inválido';
  end if;

  if v_tax_rate is not null and (not public._es_finito(v_tax_rate) or v_tax_rate < 0 or v_tax_rate > 100) then
    raise exception 'La tarifa de IVA debe estar entre 0 y 100';
  end if;

  if v_tax_status not in ('sin_iva', 'descontable', 'pendiente', 'costo') then
    raise exception 'Estado tributario de IVA inválido: %', v_tax_status;
  end if;

  for e in select x from jsonb_array_elements(p_items) x loop
    v_qty := public._item_num(e, 'quantity');
    v_raw_cost := public._item_num(e, 'cost');
    if v_qty <= 0 or v_raw_cost < 0 then
      raise exception 'Cantidad o costo inválido';
    end if;
    v_items_sum := v_items_sum + round(v_qty * v_raw_cost, 2);
    v_line_count := v_line_count + 1;
  end loop;
  v_items_sum := round(v_items_sum, 2);

  if p_tax is null then
    if coalesce(v_tax_rate, 0) > 0 and v_items_sum > 0 then
      if v_tax_incl then
        v_tax := round(v_items_sum - (v_items_sum / (1 + v_tax_rate / 100.0)), 2);
      else
        v_tax := round(v_items_sum * (v_tax_rate / 100.0), 2);
      end if;
    else
      v_tax := 0;
    end if;
  else
    v_tax := round(p_tax, 2);
    if v_tax = 0 and v_tax_incl and coalesce(v_tax_rate, 0) > 0 and v_items_sum > 0 then
      v_tax := round(v_items_sum - (v_items_sum / (1 + v_tax_rate / 100.0)), 2);
    end if;
  end if;

  if v_tax_incl then
    if v_tax > v_items_sum then
      raise exception 'El IVA incluido (%) no puede superar el total bruto (%)', v_tax, v_items_sum;
    end if;
    v_total := v_items_sum;
    v_subtotal := round(v_total - v_tax, 2);
  else
    v_subtotal := v_items_sum;
    v_total := round(v_subtotal + v_tax, 2);
  end if;

  if v_tax = 0 then
    v_tax_status := 'sin_iva';
  else
    if v_subtotal <= 0 then
      raise exception 'No se puede registrar IVA > 0 sobre base gravable igual o menor a 0';
    end if;
    if v_tax_status = 'sin_iva' then
      raise exception 'Una compra con IVA > 0 requiere estado descontable, pendiente o costo';
    end if;
  end if;

  if p_supplier_id is not null then
    select name into v_sup from public.suppliers where id = p_supplier_id and company_id = v_co;
    if not found then
      raise exception 'Proveedor no existe';
    end if;
  end if;

  if v_pay = 'credito' then
    if p_supplier_id is null then
      raise exception 'Para registrar una compra a crédito debes elegir un proveedor registrado';
    end if;
    perform 1 from public.suppliers where id = p_supplier_id and company_id = v_co for update;
    if to_regclass('public.supplier_credit') is not null then
      select coalesce(credit_limit, 0), coalesce(credit_days, 30)
        into v_limit, v_days
        from public.supplier_credit
        where supplier_id = p_supplier_id and company_id = v_co;
      if not found then
        v_limit := 0;
        v_days := 30;
      end if;
    end if;
    if p_credit_days is not null then
      if p_credit_days < 0 or p_credit_days > 365 then
        raise exception 'Los días de plazo deben estar entre 0 y 365';
      end if;
      v_days := p_credit_days;
    end if;
    v_due := public._co_today(v_co) + v_days;
  end if;

  select * into v_s from public.acc_settings where company_id = v_co;
  if v_s.company_id is not null and v_s.active and v_s.start_date is not null then
    v_pur_date := (now() at time zone v_s.timezone)::date;
    if v_pur_date >= v_s.start_date and v_total > 0 and v_tax > 0 and v_tax_status in ('descontable', 'pendiente') then
      perform public._acc_resolve_purchase_vat_account(v_co, v_tax_status);
    end if;
  end if;

  insert into public.purchases (
    company_id, supplier_id, supplier_name, items, total, subtotal, tax,
    tax_rate, tax_included, tax_status, recognized_cost,
    status, payment_method, due_date, credit_days
  ) values (
    v_co, p_supplier_id, v_sup, '[]'::jsonb, 0, v_subtotal, v_tax,
    v_tax_rate, v_tax_incl, v_tax_status,
    case when v_tax_status = 'costo' then v_total else v_subtotal end,
    'recibida', v_pay, v_due, case when v_pay = 'credito' then v_days else null end
  )
  returning id into v_id;

  v_rem_base := v_subtotal;
  v_rem_tax := v_tax;

  for e in select x from jsonb_array_elements(p_items) x order by x->>'product_id' loop
    v_idx := v_idx + 1;
    v_pid := public._item_uuid(e, 'product_id');
    v_qty := public._item_num(e, 'quantity');
    v_raw_cost := public._item_num(e, 'cost');

    select * into v_prod
    from public.products
    where id = v_pid and company_id = v_co
    for update;
    if not found then
      raise exception 'Producto no existe';
    end if;

    if v_idx = v_line_count then
      v_line_base := v_rem_base;
      v_line_tax := v_rem_tax;
    elsif v_items_sum > 0 then
      v_line_base := round(v_subtotal * (round(v_qty * v_raw_cost, 2) / v_items_sum), 2);
      v_line_tax := round(v_tax * (round(v_qty * v_raw_cost, 2) / v_items_sum), 2);
    else
      v_line_base := 0;
      v_line_tax := 0;
    end if;
    v_rem_base := v_rem_base - v_line_base;
    v_rem_tax := v_rem_tax - v_line_tax;

    v_inv_add := v_line_base + case when v_tax_status = 'costo' then v_line_tax else 0 end;
    v_eff_unit_cost := round(v_inv_add / v_qty, 4);

    v_new := v_prod.stock + v_qty;
    if v_prod.stock > 0 and v_new > 0 then
      v_new_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) + v_inv_add) / v_new, 2);
    else
      v_new_cost := round(v_eff_unit_cost, 2);
    end if;

    update public.products
    set stock = v_new,
        cost = v_new_cost
    where id = v_prod.id;

    insert into public.kardex (
      company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id
    ) values (
      v_co, v_prod.id, v_prod.name, 'entrada', v_qty, v_new, 'purchase', v_id
    );

    v_exp := null;
    v_lot := null;
    if v_prod.tracks_expiry then
      if coalesce(e->>'expiry_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'El producto "%" maneja vencimiento: indica la fecha de vencimiento del lote', v_prod.name;
      end if;
      v_exp := (e->>'expiry_date')::date;
      if v_exp < public._co_today(v_co) then
        raise exception 'La fecha de vencimiento de "%" ya pasó', v_prod.name;
      end if;
      if v_exp > date '2100-01-01' then
        raise exception 'Fecha de vencimiento inválida para "%"', v_prod.name;
      end if;
      v_lot := coalesce(nullif(left(btrim(coalesce(e->>'lot_code', '')), 40), ''), 'S/L');

      insert into public.product_lots (
        company_id, product_id, lot_code, expiry_date, qty_initial, qty_remaining, cost, source_type, source_id
      ) values (
        v_co, v_prod.id, v_lot, v_exp, v_qty, v_qty, v_eff_unit_cost, 'compra', v_id
      );
    end if;

    v_items := v_items || (
      jsonb_build_object(
        'product_id', v_prod.id,
        'product_name', v_prod.name,
        'quantity', v_qty,
        'cost', round(v_line_base / v_qty, 4),
        'unit_base_cost', round(v_line_base / v_qty, 4),
        'tax_amount', v_line_tax,
        'recognized_unit_cost', v_eff_unit_cost,
        'prev_cost', v_prod.cost,
        'subtotal', v_line_base,
        'line_total', v_line_base + v_line_tax
      ) || case when v_exp is not null then jsonb_build_object('lot_code', v_lot, 'expiry_date', v_exp) else '{}'::jsonb end
    );
  end loop;

  if v_pay = 'credito' and v_limit > 0 then
    v_owed := public._supplier_owed(v_co, p_supplier_id);
    if v_owed + v_total > v_limit then
      raise exception 'Supera el cupo de crédito con este proveedor (cupo: %, debes: %, esta compra: %)',
        round(v_limit, 2), round(v_owed, 2), round(v_total, 2);
    end if;
  end if;

  update public.purchases
  set items = v_items,
      total = v_total,
      subtotal = v_subtotal,
      tax = v_tax,
      recognized_cost = case when v_tax_status = 'costo' then v_total else v_subtotal end
  where id = v_id;

  if v_pay = 'efectivo' then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_total, 'Compra - ' || coalesce(v_sup, 'Proveedor general'), 'purchase', v_id);
  end if;

  return v_id;
end
$function$;

-- 7. Firmas públicas de registrar_compra sin ambigüedad (42725) y válidas (42P13)
create or replace function public.registrar_compra(
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text default 'efectivo'::text,
  p_credit_days integer default null::integer
)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select public._registrar_compra_impl(
    p_supplier_id, p_items, coalesce(p_payment_method, 'efectivo'), p_credit_days,
    0, 'sin_iva', null, false
  );
$function$;

create or replace function public.registrar_compra(
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_credit_days integer,
  p_tax numeric,
  p_tax_status text default 'descontable'::text,
  p_tax_rate numeric default null::numeric,
  p_tax_included boolean default false
)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select public._registrar_compra_impl(
    p_supplier_id, p_items, coalesce(p_payment_method, 'efectivo'), p_credit_days,
    p_tax, p_tax_status, p_tax_rate, coalesce(p_tax_included, false)
  );
$function$;

create or replace function public.registrar_compra_con_iva(
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text default 'efectivo'::text,
  p_credit_days integer default null::integer,
  p_tax numeric default null::numeric,
  p_tax_status text default 'sin_iva'::text,
  p_tax_rate numeric default null::numeric,
  p_tax_included boolean default false
)
returns uuid
language sql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select public._registrar_compra_impl(
    p_supplier_id, p_items, coalesce(p_payment_method, 'efectivo'), p_credit_days,
    p_tax, p_tax_status, p_tax_rate, coalesce(p_tax_included, false)
  );
$function$;

-- 8. Contabilización de compra con validación estricta de cuenta IVA
create or replace function public.acc_post_purchase(p_p purchases, p_estimated boolean default false)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  s public.acc_settings;
  v_date date;
  v_inv uuid;
  v_cred uuid;
  v_vat_acc uuid;
  v_pay text := coalesce(p_p.payment_method, 'efectivo');
  v_memo text;
  v_base numeric;
  v_tax numeric := round(coalesce(p_p.tax, 0), 2);
  v_status text := coalesce(p_p.tax_status, case when round(coalesce(p_p.tax, 0), 2) > 0 then 'descontable' else 'sin_iva' end);
  v_lines jsonb;
begin
  select * into s from public.acc_settings where company_id = p_p.company_id;
  if not found or not s.active or s.start_date is null then
    return null;
  end if;

  v_date := (p_p.created_at at time zone s.timezone)::date;
  if v_date < s.start_date or p_p.total <= 0 then
    return null;
  end if;

  v_inv := (s.map->>'inventario')::uuid;
  if v_inv is null then
    raise exception 'Falta configurar la cuenta de inventario para contabilizar la compra';
  end if;

  if v_pay = 'credito' then
    if to_regclass('public.cxp_settings') is not null then
      select account_id into v_cred from public.cxp_settings where company_id = p_p.company_id;
    end if;
    if v_cred is null then
      if p_estimated then
        return null;
      end if;
      raise exception 'Falta configurar la cuenta por pagar a proveedores para compras a crédito';
    end if;
    v_memo := 'Compra a crédito';
  elsif v_pay in ('tarjeta', 'transferencia') then
    v_cred := (s.map->>'bancos')::uuid;
    v_memo := 'Pago de compra (' || v_pay || ')';
  else
    v_cred := (s.map->>'caja')::uuid;
    v_memo := 'Pago de compra (efectivo)';
  end if;

  if v_cred is null then
    raise exception 'Falta configurar la cuenta de % para contabilizar la compra', v_pay;
  end if;

  v_base := round(coalesce(p_p.subtotal, p_p.total - v_tax), 2);

  if v_tax > 0 and v_status in ('descontable', 'pendiente') then
    v_vat_acc := public._acc_resolve_purchase_vat_account(p_p.company_id, v_status);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_inv, 'debit', v_base, 'memo', 'Base inventario'),
      jsonb_build_object(
        'account_id', v_vat_acc,
        'debit', v_tax,
        'memo', case when v_status = 'descontable' then 'IVA descontable en compra' else 'IVA por clasificar en compra' end
      ),
      jsonb_build_object('account_id', v_cred, 'credit', p_p.total, 'memo', v_memo)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_inv,
        'debit', p_p.total,
        'memo', case when v_tax > 0 then 'Inventario (incluye IVA al costo)' else 'Inventario' end
      ),
      jsonb_build_object('account_id', v_cred, 'credit', p_p.total, 'memo', v_memo)
    );
  end if;

  return public.acc_system_entry(
    p_p.company_id,
    v_date,
    'Compra a ' || coalesce(p_p.supplier_name, 'Proveedor general') ||
      case when p_estimated then ' (registrada con retraso)' else '' end,
    'compra',
    p_p.id,
    'registro',
    'C-' || substr(p_p.id::text, 1, 8),
    v_lines
  );
end
$function$;

-- 9. Reversión completa de asientos de compra ('registro' + 'reclasificacion_iva')
create or replace function public.acc_reverse_purchase_entries(
  p_company uuid,
  p_purchase_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_o public.acc_entries;
  v_new uuid;
  v_date date;
  v_tz text;
  v_cnt int := 0;
begin
  select timezone into v_tz from public.acc_settings where company_id = p_company;
  v_date := (now() at time zone coalesce(v_tz, 'America/Caracas'))::date;

  for v_o in
    select *
    from public.acc_entries
    where company_id = p_company
      and source_type = 'compra'
      and source_id = p_purchase_id
      and status = 'contabilizado'
    order by created_at desc, id desc
    for update
  loop
    if not public.acc_period_is_open(p_company, v_date) then
      raise exception 'El periodo actual está cerrado: no se puede registrar la reversión contable de la compra';
    end if;

    insert into public.acc_entries (
      company_id, number, entry_date, description, source_type, source_id,
      source_event, source_ref, reverses_entry_id, created_by
    ) values (
      p_company,
      public.acc_next_number(p_company, 'reverso'),
      v_date,
      'Reversión de ' || v_o.number || ': ' || p_reason,
      'reverso',
      v_o.id,
      'reverso',
      v_o.number,
      v_o.id,
      auth.uid()
    )
    returning id into v_new;

    insert into public.acc_lines (entry_id, company_id, account_id, debit, credit, memo)
    select v_new, p_company, l.account_id, l.credit, l.debit, l.memo
    from public.acc_lines l
    where l.entry_id = v_o.id;

    update public.acc_entries set status = 'contabilizado', posted_by = auth.uid() where id = v_new;
    update public.acc_entries set status = 'reversado' where id = v_o.id;

    update public.purchase_iva_adjustments
    set status = 'reversado',
        reversed_by_entry_id = v_new,
        reversed_at = now()
    where company_id = p_company
      and purchase_id = p_purchase_id
      and entry_id = v_o.id
      and status = 'aplicado';

    v_cnt := v_cnt + 1;
  end loop;

  return v_cnt;
end
$function$;

create or replace function public.acc_trg_purchases()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.status <> 'anulada' and new.status = 'anulada' then
    perform public.acc_reverse_purchase_entries(new.company_id, new.id, 'anulación de compra');
    return new;
  end if;

  if not exists (select 1 from public.acc_settings where company_id = new.company_id and active) then
    return new;
  end if;

  if jsonb_array_length(old.items) = 0 and jsonb_array_length(new.items) > 0 and new.status = 'recibida' then
    perform public.acc_post_purchase(new);
  end if;

  return new;
end
$function$;

-- 10. Reclasificación posterior de IVA usando kardex.seq para orden intratransaccional
create or replace function public.clasificar_iva_compra(
  p_purchase_id uuid,
  p_new_status text,
  p_reason text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._ctx(array['admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_pur public.purchases%rowtype;
  v_s public.acc_settings%rowtype;
  v_prof public.profiles%rowtype;
  v_has_dev_iva boolean;
  v_dev_count int := 0;
  v_pur_date date;
  v_reclass_date date;
  v_vat_pend uuid;
  v_vat_desc uuid;
  v_inv_acc_id uuid;
  v_cogs_acc_id uuid;
  v_inv_acc public.acc_accounts%rowtype;
  v_cogs_acc public.acc_accounts%rowtype;
  v_entry_id uuid;
  v_adj_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_item record;
  v_prod public.products%rowtype;
  v_k_seq bigint;
  v_k_cnt int := 0;
  v_k_verified boolean := false;
  v_other_moves int;
  v_returned_qty numeric := 0;
  v_returned_tax numeric := 0;
  v_net_qty numeric;
  v_net_line_tax numeric;
  v_lot_rem numeric;
  v_lot_sold numeric;
  v_qty_inv numeric;
  v_qty_cogs numeric;
  v_iva_inv numeric;
  v_iva_cogs numeric;
  v_tot_tax numeric := 0;
  v_tot_inv numeric := 0;
  v_tot_cogs numeric := 0;
  v_new_avg numeric;
  v_prev_avg numeric;
  v_prod_adj jsonb := '[]'::jsonb;
  v_lot record;
  v_lot_rem_tax numeric;
  v_lot_share numeric;
  v_lot_cnt int;
  v_lot_idx int;
  v_prev_rec_cost numeric;
  v_new_rec_cost numeric;
begin
  if p_new_status not in ('descontable', 'costo') then
    raise exception 'El nuevo estado fiscal debe ser descontable o costo';
  end if;

  select * into v_prof from public.profiles where id = auth.uid();

  select * into v_pur
  from public.purchases
  where id = p_purchase_id and company_id = v_co
  for update;
  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_pur.status <> 'recibida' then
    raise exception 'Solo se puede clasificar el IVA de compras recibidas';
  end if;
  if v_pur.tax_status <> 'pendiente' then
    raise exception 'La compra tiene estado fiscal "%" (solo se reclasifican compras en estado pendiente)', v_pur.tax_status;
  end if;
  if coalesce(v_pur.tax, 0) <= 0 then
    raise exception 'La compra no tiene IVA pendiente por clasificar';
  end if;
  if v_pur.items is null or jsonb_typeof(v_pur.items) <> 'array' or jsonb_array_length(v_pur.items) = 0 then
    raise exception 'La compra no tiene items válidos';
  end if;

  if exists (
    select 1 from public.purchase_iva_adjustments
    where company_id = v_co and purchase_id = v_pur.id and status = 'aplicado'
  ) or exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
      and source_event = 'reclasificacion_iva' and status = 'contabilizado'
  ) then
    raise exception 'Esta compra ya registra una reclasificación fiscal de IVA vigente';
  end if;

  select * into v_s from public.acc_settings where company_id = v_co;
  if not found or not v_s.active or v_s.start_date is null then
    raise exception 'La contabilidad automática no está activa: no se puede reclasificar el IVA sin garantizar el asiento contable';
  end if;

  v_pur_date := (v_pur.created_at at time zone v_s.timezone)::date;
  if v_pur_date < v_s.start_date then
    raise exception 'La compra (%) es anterior a la fecha de inicio contable (%): no se puede reclasificar automáticamente',
      v_pur_date, v_s.start_date;
  end if;

  if not exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
      and source_event = 'registro' and status = 'contabilizado'
  ) then
    raise exception 'La compra no tiene asiento contable inicial activo; contabiliza pendientes antes de reclasificar el IVA';
  end if;

  v_reclass_date := (now() at time zone v_s.timezone)::date;
  if not public.acc_period_is_open(v_co, v_reclass_date) then
    raise exception 'El periodo contable actual está cerrado: no se puede registrar la reclasificación del IVA';
  end if;

  v_vat_pend := public._acc_resolve_purchase_vat_account(v_co, 'pendiente');
  if p_new_status = 'descontable' then
    v_vat_desc := public._acc_resolve_purchase_vat_account(v_co, 'descontable');
  else
    begin
      v_inv_acc_id := nullif(btrim(coalesce(v_s.map->>'inventario', '')), '')::uuid;
    exception when others then
      v_inv_acc_id := null;
    end;
    if v_inv_acc_id is null then
      raise exception 'Falta configurar cuenta de inventario para reclasificar IVA al costo';
    end if;
    select * into v_inv_acc from public.acc_accounts where id = v_inv_acc_id and company_id = v_co;
    if not found or not v_inv_acc.active or not v_inv_acc.is_postable or v_inv_acc.type <> 'activo' or v_inv_acc.nature <> 'debito' then
      raise exception 'La cuenta de inventario configurada es inválida, inactiva, no imputable o de naturaleza incorrecta';
    end if;

    begin
      v_cogs_acc_id := nullif(btrim(coalesce(v_s.map->>'costo_ventas', '')), '')::uuid;
    exception when others then
      v_cogs_acc_id := null;
    end;
    if v_cogs_acc_id is null then
      raise exception 'Falta configurar cuenta de costo de ventas para reclasificar IVA al costo';
    end if;
    select * into v_cogs_acc from public.acc_accounts where id = v_cogs_acc_id and company_id = v_co;
    if not found or not v_cogs_acc.active or not v_cogs_acc.is_postable or v_cogs_acc.type <> 'costo' or v_cogs_acc.nature <> 'debito' then
      raise exception 'La cuenta de costo de ventas configurada es inválida, inactiva, no imputable o de naturaleza incorrecta';
    end if;
  end if;

  v_has_dev_iva := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_devolutions' and column_name = 'tax_amount'
  );
  select count(*) into v_dev_count
  from public.purchase_devolutions
  where company_id = v_co and purchase_id = v_pur.id and status = 'activa';
  if v_dev_count > 0 and not v_has_dev_iva then
    raise exception 'Esta compra tiene devoluciones activas: aplica primero la migración 000064 para reclasificar IVA con devoluciones.';
  end if;

  for v_item in
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::numeric) as bought_qty,
      sum(coalesce((item->>'tax_amount')::numeric, 0)) as explicit_tax,
      sum(coalesce((item->>'subtotal')::numeric, (item->>'quantity')::numeric * (item->>'cost')::numeric)) as line_sub
    from jsonb_array_elements(v_pur.items) as item
    group by (item->>'product_id')::uuid
    order by (item->>'product_id')::uuid
  loop
    select * into v_prod
    from public.products
    where id = v_item.product_id and company_id = v_co
    for update;
    if not found then
      raise exception 'Producto % no encontrado al clasificar IVA', v_item.product_id;
    end if;

    v_returned_qty := 0;
    v_returned_tax := 0;
    if v_dev_count > 0 and v_has_dev_iva then
      execute $q$
        select coalesce(sum(quantity), 0), coalesce(sum(tax_amount), 0)
        from public.purchase_devolutions
        where company_id = $1 and purchase_id = $2 and product_id = $3 and status = 'activa'
      $q$ into v_returned_qty, v_returned_tax using v_co, v_pur.id, v_prod.id;
    end if;

    v_net_qty := v_item.bought_qty - v_returned_qty;
    if v_net_qty <= 0 then
      continue;
    end if;

    v_net_line_tax := round(
      case
        when v_item.explicit_tax > 0 then v_item.explicit_tax - v_returned_tax
        when coalesce(v_pur.subtotal, 0) > 0 then (v_pur.tax * (v_item.line_sub / v_pur.subtotal)) - v_returned_tax
        else 0
      end,
      2
    );
    if v_net_line_tax <= 0 then
      continue;
    end if;

    v_tot_tax := v_tot_tax + v_net_line_tax;
    v_qty_inv := 0;
    v_qty_cogs := 0;
    v_iva_inv := 0;
    v_iva_cogs := 0;

    if p_new_status = 'costo' then
      if v_prod.tracks_expiry then
        select coalesce(sum(qty_remaining), 0) into v_lot_rem
        from public.product_lots
        where company_id = v_co and source_type = 'compra' and source_id = v_pur.id and product_id = v_prod.id;

        select coalesce(sum(m.qty - m.restored), 0) into v_lot_sold
        from public.sale_lot_moves m
        join public.product_lots l on l.id = m.lot_id
        where l.company_id = v_co and l.source_type = 'compra' and l.source_id = v_pur.id and l.product_id = v_prod.id;

        if abs(v_net_qty - (v_lot_rem + v_lot_sold)) > 0.001 then
          raise exception 'El lote de "%" tuvo ajustes manuales o bajas fuera de ventas/devoluciones; no se automatiza IVA al costo', v_prod.name;
        end if;
        if v_prod.stock < v_lot_rem then
          raise exception 'Stock global de "%" (%) menor al saldo del lote (%)', v_prod.name, v_prod.stock, v_lot_rem;
        end if;

        v_qty_inv := v_lot_rem;
        v_qty_cogs := v_lot_sold;
      else
        select count(*), coalesce(bool_and(seq_verified), false), max(seq)
        into v_k_cnt, v_k_verified, v_k_seq
        from public.kardex
        where company_id = v_co and product_id = v_prod.id
          and reference_type = 'purchase' and reference_id = v_pur.id and type = 'entrada';

        if v_k_cnt = 0 or not v_k_verified or v_k_seq is null then
          raise exception 'Compra histórica o sin secuencia verificable en kardex para "%": orden cronológico anterior a la migración no reconstruible; reclasifica manualmente.', v_prod.name;
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
              where pd.id = k.reference_id and pd.purchase_id = v_pur.id
            )
          );

        if v_other_moves > 0 or v_prod.stock < v_net_qty then
          raise exception 'Sin trazabilidad por lote para "%" tras movimientos posteriores a la compra (ventas, ajustes u otras compras). No se usa stock global; reclasifica manualmente.', v_prod.name;
        end if;

        v_qty_inv := v_net_qty;
        v_qty_cogs := 0;
      end if;

      v_iva_inv := round(v_net_line_tax * (v_qty_inv / v_net_qty), 2);
      v_iva_cogs := round(v_net_line_tax - v_iva_inv, 2);
      v_tot_inv := v_tot_inv + v_iva_inv;
      v_tot_cogs := v_tot_cogs + v_iva_cogs;
    end if;

    v_prev_avg := coalesce(v_prod.cost, 0);
    v_new_avg := v_prev_avg;
    if p_new_status = 'costo' and v_iva_inv > 0 and v_prod.stock > 0 then
      v_new_avg := round(((v_prod.stock * v_prev_avg) + v_iva_inv) / v_prod.stock, 2);
      update public.products set cost = v_new_avg where id = v_prod.id;

      if v_prod.tracks_expiry and v_qty_inv > 0 then
        select count(*) into v_lot_cnt
        from public.product_lots
        where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
          and product_id = v_prod.id and qty_remaining > 0;
        v_lot_rem_tax := v_iva_inv;
        v_lot_idx := 0;
        for v_lot in
          select id, qty_remaining
          from public.product_lots
          where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
            and product_id = v_prod.id and qty_remaining > 0
          order by expiry_date asc, created_at asc, id asc
          for update
        loop
          v_lot_idx := v_lot_idx + 1;
          if v_lot_idx = v_lot_cnt then
            v_lot_share := v_lot_rem_tax;
          else
            v_lot_share := round(v_iva_inv * (v_lot.qty_remaining / v_qty_inv), 2);
          end if;
          v_lot_rem_tax := v_lot_rem_tax - v_lot_share;
          update public.product_lots
          set cost = round(cost + (v_lot_share / qty_remaining), 4)
          where id = v_lot.id;
        end loop;
      end if;
    end if;

    v_prod_adj := v_prod_adj || jsonb_build_object(
      'product_id', v_prod.id,
      'product_name', v_prod.name,
      'net_qty', v_net_qty,
      'qty_inventory', v_qty_inv,
      'qty_cogs', v_qty_cogs,
      'iva_total', v_net_line_tax,
      'iva_inventory', v_iva_inv,
      'iva_expense', v_iva_cogs,
      'prev_avg_cost', v_prev_avg,
      'new_avg_cost', v_new_avg
    );
  end loop;

  if v_tot_tax <= 0 then
    raise exception 'El saldo neto de IVA pendiente de esta compra es 0 (posiblemente ya devuelto en su totalidad)';
  end if;

  if p_new_status = 'descontable' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_vat_desc, 'debit', v_tot_tax, 'memo', 'IVA compra confirmado descontable'),
      jsonb_build_object('account_id', v_vat_pend, 'credit', v_tot_tax, 'memo', 'Reclasificación desde IVA por clasificar')
    );
  else
    if v_tot_inv > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_inv_acc.id, 'debit', v_tot_inv, 'memo', 'IVA no descontable capitalizado en inventario')
      );
    end if;
    if v_tot_cogs > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cogs_acc.id, 'debit', v_tot_cogs, 'memo', 'IVA no descontable asignado a unidades ya vendidas')
      );
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_vat_pend, 'credit', v_tot_tax, 'memo', 'Reclasificación IVA por clasificar al costo')
    );
  end if;

  v_entry_id := public.acc_system_entry(
    v_co,
    v_reclass_date,
    'Reclasificación IVA compra C-' || substr(v_pur.id::text, 1, 8) || ' (' || p_new_status || ')',
    'compra',
    v_pur.id,
    'reclasificacion_iva',
    'RIVA-' || substr(v_pur.id::text, 1, 8),
    v_lines
  );

  v_prev_rec_cost := coalesce(v_pur.recognized_cost, coalesce(v_pur.subtotal, v_pur.total - coalesce(v_pur.tax, 0)));
  v_new_rec_cost := coalesce(v_pur.subtotal, v_pur.total - coalesce(v_pur.tax, 0)) +
    case when p_new_status = 'costo' then v_tot_inv else 0 end;

  update public.purchases
  set tax_status = p_new_status,
      iva_classified_at = now(),
      iva_classified_by = auth.uid(),
      iva_classification_note = nullif(left(btrim(coalesce(p_reason, '')), 240), ''),
      iva_cost_inventory = case when p_new_status = 'costo' then v_tot_inv else 0 end,
      iva_cost_expense = case when p_new_status = 'costo' then v_tot_cogs else 0 end,
      recognized_cost = v_new_rec_cost
  where id = v_pur.id and company_id = v_co;

  insert into public.purchase_iva_adjustments (
    company_id, purchase_id, from_status, to_status,
    original_subtotal, original_tax, tax_amount,
    previous_recognized_cost, new_recognized_cost,
    amount_to_inventory, amount_to_expense,
    product_adjustments, entry_id, reason,
    created_by, created_by_name, created_by_role
  ) values (
    v_co, v_pur.id, 'pendiente', p_new_status,
    coalesce(v_pur.subtotal, greatest(0, v_pur.total - coalesce(v_pur.tax, 0))),
    coalesce(v_pur.tax, 0),
    v_tot_tax,
    v_prev_rec_cost,
    v_new_rec_cost,
    v_tot_inv,
    v_tot_cogs,
    v_prod_adj,
    v_entry_id,
    nullif(left(btrim(coalesce(p_reason, '')), 240), ''),
    auth.uid(),
    coalesce(nullif(btrim(v_prof.full_name), ''), v_prof.email),
    v_prof.role
  )
  returning id into v_adj_id;

  return v_adj_id;
end
$function$;

-- 11. anular_compra usando kardex.seq
create or replace function public.anular_compra(p_purchase_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid;
  v_purchase public.purchases%rowtype;
  v_item record;
  v_prod public.products%rowtype;
  v_new numeric;
  v_rev_cost numeric;
  v_adj_inv numeric := 0;
  v_item_inv_total numeric := 0;
  v_tz text;
  v_rev_date date;
  v_lot_count int := 0;
  v_k_seq bigint;
  v_k_cnt int := 0;
  v_k_verified boolean := false;
  v_other_moves int := 0;
begin
  v_co := public._ctx(array['admin', 'dueno']);

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id and company_id = v_co
  for update;

  if not found then
    raise exception 'La compra no existe o no tienes permiso para acceder a ella';
  end if;
  if v_purchase.status = 'anulada' then
    raise exception 'Esta compra ya fue anulada';
  end if;
  if v_purchase.status <> 'recibida' then
    raise exception 'Solo se pueden anular compras recibidas';
  end if;
  if v_purchase.items is null or jsonb_typeof(v_purchase.items) <> 'array' or jsonb_array_length(v_purchase.items) = 0 then
    raise exception 'La compra no contiene artículos válidos';
  end if;
  if coalesce(v_purchase.iva_cost_expense, 0) > 0 then
    raise exception 'No se puede anular: parte del IVA de esta compra ya se imputó a costo de ventas por unidades vendidas';
  end if;

  if to_regclass('public.purchase_devolutions') is not null then
    if exists (
      select 1 from public.purchase_devolutions
      where company_id = v_co and purchase_id = v_purchase.id and status = 'activa'
    ) then
      raise exception 'No se puede anular: esta compra ya tiene devoluciones parciales a proveedor. Anula primero esas devoluciones en el módulo Devoluciones.';
    end if;
  end if;

  if to_regclass('public.supplier_allocations') is not null then
    if exists (
      select 1
      from public.supplier_allocations a
      join public.supplier_payments sp on sp.id = a.payment_id
      where a.purchase_id = v_purchase.id and sp.status = 'activo'
    ) then
      raise exception 'No se puede anular: esta compra ya tiene pagos o abonos registrados. Anula primero esos pagos en Cuentas por pagar.';
    end if;
  end if;

  select timezone into v_tz from public.acc_settings where company_id = v_co;
  v_rev_date := (now() at time zone coalesce(v_tz, 'America/Caracas'))::date;
  if exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id and status = 'contabilizado'
  ) and not public.acc_period_is_open(v_co, v_rev_date) then
    raise exception 'El periodo contable actual está cerrado: no se puede anular ni revertir el asiento de la compra';
  end if;

  for v_item in
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::numeric) as quantity
    from jsonb_array_elements(v_purchase.items) as item
    group by (item->>'product_id')::uuid
    order by (item->>'product_id')::uuid
  loop
    if v_item.quantity <= 0 then
      raise exception 'La compra contiene una cantidad inválida';
    end if;

    select * into v_prod
    from public.products
    where id = v_item.product_id and company_id = v_co
    for update;
    if not found then
      raise exception 'No se encontró un producto de esta compra';
    end if;

    if v_prod.stock < v_item.quantity then
      raise exception 'No se puede anular: el inventario actual de "%" es %, pero se necesitan % unidades para revertir la compra',
        v_prod.name, v_prod.stock, v_item.quantity;
    end if;

    if v_prod.tracks_expiry then
      select count(*) into v_lot_count
      from public.product_lots
      where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id and product_id = v_prod.id;

      if v_lot_count = 0 then
        raise exception 'No se puede anular "%": faltan los lotes originales de la compra para verificar trazabilidad', v_prod.name;
      end if;

      if exists (
        select 1 from public.product_lots
        where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id
          and product_id = v_prod.id and qty_remaining < qty_initial
      ) or exists (
        select 1
        from public.sale_lot_moves m
        join public.product_lots l on l.id = m.lot_id
        where l.company_id = v_co and l.source_type = 'compra' and l.source_id = v_purchase.id
          and l.product_id = v_prod.id and (m.qty - m.restored) > 0
      ) then
        raise exception 'No se puede anular: ya se vendió o dio de baja parte de los lotes de "%" de esta compra', v_prod.name;
      end if;
    else
      select count(*), coalesce(bool_and(seq_verified), false), max(seq)
      into v_k_cnt, v_k_verified, v_k_seq
      from public.kardex
      where company_id = v_co and product_id = v_prod.id
        and reference_type = 'purchase' and reference_id = v_purchase.id and type = 'entrada';

      if v_k_cnt = 0 or not v_k_verified or v_k_seq is null then
        raise exception 'No se puede anular "%": compra histórica o sin secuencia verificable en kardex (orden cronológico no reconstruible)', v_prod.name;
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
            where pd.id = k.reference_id and pd.purchase_id = v_purchase.id and pd.status = 'anulada'
          )
        );

      if v_other_moves > 0 then
        raise exception 'No se puede anular "%" sin control de lote: existen ventas, ajustes o recompras posteriores en kardex que mezclaron sus unidades', v_prod.name;
      end if;
    end if;
  end loop;

  update public.product_lots
  set qty_remaining = 0
  where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id;

  for v_item in
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::numeric) as quantity,
      sum(coalesce((item->>'subtotal')::numeric, ((item->>'quantity')::numeric * (item->>'cost')::numeric))) as base_cost,
      sum(coalesce((item->>'tax_amount')::numeric, 0)) as explicit_tax,
      (array_agg((item->>'prev_cost')::numeric) filter (where item ? 'prev_cost'))[1] as prev_cost
    from jsonb_array_elements(v_purchase.items) as item
    group by (item->>'product_id')::uuid
    order by (item->>'product_id')::uuid
  loop
    select * into v_prod
    from public.products
    where id = v_item.product_id and company_id = v_co;

    select coalesce(sum((pa->>'iva_inventory')::numeric), 0)
    into v_adj_inv
    from public.purchase_iva_adjustments adj,
         jsonb_array_elements(adj.product_adjustments) pa
    where adj.company_id = v_co
      and adj.purchase_id = v_purchase.id
      and adj.status = 'aplicado'
      and adj.to_status = 'costo'
      and (pa->>'product_id')::uuid = v_prod.id;

    if v_adj_inv > 0 then
      v_item_inv_total := v_item.base_cost + v_adj_inv;
    elsif v_purchase.tax_status = 'costo' and v_purchase.iva_classified_at is null then
      v_item_inv_total := v_item.base_cost + case
        when v_item.explicit_tax > 0 then v_item.explicit_tax
        when coalesce(v_purchase.subtotal, 0) > 0 then round(coalesce(v_purchase.tax, 0) * (v_item.base_cost / v_purchase.subtotal), 2)
        else coalesce(v_purchase.tax, 0)
      end;
    else
      v_item_inv_total := v_item.base_cost;
    end if;

    v_new := v_prod.stock - v_item.quantity;
    v_rev_cost := v_prod.cost;
    if v_new > 0 then
      v_rev_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) - coalesce(v_item_inv_total, 0)) / v_new, 2);
      if v_rev_cost <= 0 then
        v_rev_cost := coalesce(v_item.prev_cost, v_prod.cost);
      end if;
    elsif v_item.prev_cost is not null and v_item.prev_cost >= 0 then
      v_rev_cost := round(v_item.prev_cost, 2);
    end if;

    update public.products
    set stock = v_new,
        cost = v_rev_cost
    where id = v_prod.id and company_id = v_co;

    insert into public.kardex (
      company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note
    ) values (
      v_co, v_prod.id, v_prod.name, 'salida', v_item.quantity, v_new, 'purchase', v_purchase.id, 'Anulación de compra'
    );
  end loop;

  if coalesce(v_purchase.payment_method, 'efectivo') = 'efectivo' then
    insert into public.cash_entries (
      company_id, type, amount, description, reference_type, reference_id
    ) values (
      v_co,
      'ingreso',
      v_purchase.total,
      'Reversión por anulación de compra - ' || coalesce(v_purchase.supplier_name, 'Proveedor general'),
      'purchase',
      v_purchase.id
    );
  end if;

  update public.purchases
  set status = 'anulada'
  where id = v_purchase.id and company_id = v_co;

  return v_purchase.id;
end
$function$;

-- 12. Protección en 000063 sobre devoluciones de compras con IVA mientras no se aplique 000064
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
  v_returned numeric := 0;
  v_unit_cost numeric := 0;
  v_amount numeric := 0;
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
  r_lot record;
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
  if coalesce(v_pur.tax, 0) > 0 then
    raise exception 'Esta compra tiene IVA (%): aplica la migración 000064 para registrar devoluciones con IVA sin descuadres contables o fiscales.', v_pur.tax;
  end if;

  select
    coalesce(sum((it->>'quantity')::numeric), 0),
    coalesce(sum(coalesce((it->>'subtotal')::numeric, (it->>'quantity')::numeric * (it->>'cost')::numeric)), 0)
  into v_bought, v_bought_amt
  from jsonb_array_elements(v_pur.items) it
  where (it->>'product_id')::uuid = p_product_id;

  if v_bought <= 0 then
    raise exception 'Ese producto no pertenece a esta compra';
  end if;

  select coalesce(sum(quantity), 0) into v_returned
  from public.purchase_devolutions
  where company_id = v_co and purchase_id = p_purchase_id and product_id = p_product_id and status = 'activa';

  if v_returned + p_quantity > v_bought + 0.0001 then
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
      order by expiry_date asc, created_at asc
      for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, r_lot.qty_remaining);
      update public.product_lots set qty_remaining = qty_remaining - v_take where id = r_lot.id;
      v_left := v_left - v_take;
    end loop;
  else
    select count(*), coalesce(bool_and(seq_verified), false), max(seq)
    into v_k_cnt, v_k_verified, v_k_seq
    from public.kardex
    where company_id = v_co and product_id = v_prod.id
      and reference_type = 'purchase' and reference_id = p_purchase_id and type = 'entrada';

    if v_k_cnt = 0 or not v_k_verified or v_k_seq is null then
      raise exception 'No se puede devolver "%" sin control de lote: compra histórica o sin secuencia verificable en kardex', v_prod.name;
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
      raise exception 'No se puede devolver "%" sin control de lote: existen ventas, ajustes o compras posteriores en kardex', v_prod.name;
    end if;
  end if;

  v_new := v_prod.stock - p_quantity;
  v_rev_cost := v_prod.cost;
  if v_new > 0 then
    v_rev_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) - v_amount) / v_new, 2);
    if v_rev_cost <= 0 then
      v_rev_cost := v_prod.cost;
    end if;
  end if;

  update public.products set stock = v_new, cost = v_rev_cost where id = v_prod.id;
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.purchase_devolutions (
    company_id, purchase_id, supplier_id, supplier_name,
    product_id, product_name, quantity, unit_cost, amount,
    refund_method, reason, status, created_by, created_by_name
  ) values (
    v_co, v_pur.id, v_pur.supplier_id, v_pur.supplier_name,
    v_prod.id, v_prod.name, p_quantity, round(v_unit_cost, 2), v_amount,
    v_refund, left(btrim(p_reason), 240), 'activa', auth.uid(), v_name
  )
  returning id into v_id;

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

-- 13. Formulario 300 corregido: aislamiento estricto y filtrado p.tax_status = 'pendiente' en v_dev_*_pend
create or replace function public.dian_calcular_formulario_300(
  p_company_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cur_co uuid := public.current_company_id();
  v_ing_grav_19 numeric := 0;
  v_ing_grav_5 numeric := 0;
  v_ing_excl numeric := 0;
  v_iva_gen_19 numeric := 0;
  v_iva_gen_5 numeric := 0;
  v_dev_ventas numeric := 0;
  v_compras_grav_desc numeric := 0;
  v_iva_desc_compras numeric := 0;
  v_reclass_base_desc numeric := 0;
  v_reclass_iva_desc numeric := 0;
  v_compras_pend_base numeric := 0;
  v_iva_pend_compras numeric := 0;
  v_compras_costo_base numeric := 0;
  v_iva_costo_compras numeric := 0;
  v_compras_sin_iva numeric := 0;
  v_dev_base_desc numeric := 0;
  v_dev_iva_desc numeric := 0;
  v_dev_base_pend numeric := 0;
  v_dev_iva_pend numeric := 0;
  v_dev_base_costo numeric := 0;
  v_dev_iva_costo numeric := 0;
  v_dev_base_sin_iva numeric := 0;
  v_iva_neto_desc numeric := 0;
  v_saldo_pagar numeric := 0;
  v_saldo_favor numeric := 0;
  v_has_dev_iva boolean;
  v_acc_active boolean := false;
  v_acc_start date;
  v_acc_tz text := 'America/Caracas';
  v_unposted_pur int := 0;
  v_unposted_dev int := 0;
begin
  if auth.uid() is null
     or v_cur_co is null
     or p_company_id is null
     or p_company_id is distinct from v_cur_co
     or not exists (
       select 1 from public.profiles pr
       where pr.id = auth.uid() and pr.active = true and pr.company_id = v_cur_co
     ) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 0 then coalesce(s.subtotal, s.total) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.tax_amount, 0) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.tax_amount, 0) else 0 end), 0)
  into v_ing_grav_19, v_ing_grav_5, v_ing_excl, v_iva_gen_19, v_iva_gen_5
  from public.sales s
  where s.company_id = p_company_id
    and s.created_at >= p_start_date
    and s.created_at < p_end_date
    and s.status <> 'anulada';

  select coalesce(sum(d.amount), 0) into v_dev_ventas
  from public.devolutions d
  where d.company_id = p_company_id
    and d.created_at >= p_start_date
    and d.created_at < p_end_date;

  -- 1. Compras nacidas directamente como descontable + pendientes/costo/sin_iva del período
  select
    coalesce(sum(case when p.tax_status = 'descontable' and p.iva_classified_at is null
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'descontable' and p.iva_classified_at is null
      then coalesce(p.tax, 0) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'pendiente'
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'pendiente'
      then coalesce(p.tax, 0) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'costo'
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'costo'
      then coalesce(p.tax, 0) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'sin_iva'
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0)
  into
    v_compras_grav_desc, v_iva_desc_compras,
    v_compras_pend_base, v_iva_pend_compras,
    v_compras_costo_base, v_iva_costo_compras,
    v_compras_sin_iva
  from public.purchases p
  where p.company_id = p_company_id
    and p.created_at >= p_start_date
    and p.created_at < p_end_date
    and p.status = 'recibida';

  -- 2. Reclasificaciones 'pendiente' -> 'descontable' por fecha efectiva de clasificación (adj.created_at)
  v_has_dev_iva := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_devolutions' and column_name = 'tax_amount'
  );

  if v_has_dev_iva then
    execute $q$
      select
        coalesce(sum(greatest(0,
          coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) -
          coalesce((
            select sum(coalesce(pd.subtotal, pd.amount))
            from public.purchase_devolutions pd
            where pd.company_id = adj.company_id
              and pd.purchase_id = adj.purchase_id
              and pd.status = 'activa'
              and pd.tax_status_snapshot = 'pendiente'
              and pd.created_at <= adj.created_at
          ), 0)
        )), 0),
        coalesce(sum(adj.tax_amount), 0)
      from public.purchase_iva_adjustments adj
      join public.purchases p on p.id = adj.purchase_id
      where adj.company_id = $1
        and adj.status = 'aplicado'
        and adj.to_status = 'descontable'
        and p.status = 'recibida'
        and adj.created_at >= $2
        and adj.created_at < $3
    $q$ into v_reclass_base_desc, v_reclass_iva_desc using p_company_id, p_start_date, p_end_date;

    -- 3. Devoluciones en el período: descontables por snapshot; pendientes/costo/sin_iva alineadas al estado vigente
    execute $q$
      select
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'descontable'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0),
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'descontable'
          then coalesce(pd.tax_amount, 0) else 0 end), 0),
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'pendiente' and p.tax_status = 'pendiente'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0),
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'pendiente' and p.tax_status = 'pendiente'
          then coalesce(pd.tax_amount, 0) else 0 end), 0),
        coalesce(sum(case when p.tax_status = 'costo'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0),
        coalesce(sum(case when p.tax_status = 'costo'
          then coalesce(pd.tax_amount, 0) else 0 end), 0),
        coalesce(sum(case when p.tax_status = 'sin_iva'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0)
      from public.purchase_devolutions pd
      join public.purchases p on p.id = pd.purchase_id
      where pd.company_id = $1
        and pd.created_at >= $2
        and pd.created_at < $3
        and pd.status = 'activa'
        and p.status = 'recibida'
    $q$ into
      v_dev_base_desc, v_dev_iva_desc,
      v_dev_base_pend, v_dev_iva_pend,
      v_dev_base_costo, v_dev_iva_costo,
      v_dev_base_sin_iva
    using p_company_id, p_start_date, p_end_date;
  else
    select
      coalesce(sum(coalesce(p.subtotal, p.total - coalesce(p.tax, 0))), 0),
      coalesce(sum(adj.tax_amount), 0)
    into v_reclass_base_desc, v_reclass_iva_desc
    from public.purchase_iva_adjustments adj
    join public.purchases p on p.id = adj.purchase_id
    where adj.company_id = p_company_id
      and adj.status = 'aplicado'
      and adj.to_status = 'descontable'
      and p.status = 'recibida'
      and adj.created_at >= p_start_date
      and adj.created_at < p_end_date;
  end if;

  v_compras_grav_desc := greatest(0, v_compras_grav_desc + v_reclass_base_desc - v_dev_base_desc);
  v_iva_neto_desc := greatest(0, v_iva_desc_compras + v_reclass_iva_desc - v_dev_iva_desc);
  v_compras_pend_base := greatest(0, v_compras_pend_base - v_dev_base_pend);
  v_iva_pend_compras := greatest(0, v_iva_pend_compras - v_dev_iva_pend);
  v_compras_costo_base := greatest(0, v_compras_costo_base - v_dev_base_costo);
  v_iva_costo_compras := greatest(0, v_iva_costo_compras - v_dev_iva_costo);
  v_compras_sin_iva := greatest(0, v_compras_sin_iva - v_dev_base_sin_iva);

  select active, start_date, timezone
  into v_acc_active, v_acc_start, v_acc_tz
  from public.acc_settings
  where company_id = p_company_id;

  if coalesce(v_acc_active, false) and v_acc_start is not null then
    select count(*) into v_unposted_pur
    from public.purchases p
    where p.company_id = p_company_id
      and p.status = 'recibida'
      and jsonb_array_length(p.items) > 0
      and p.created_at >= p_start_date
      and p.created_at < p_end_date
      and (p.created_at at time zone v_acc_tz)::date >= v_acc_start
      and not exists (
        select 1 from public.acc_entries e
        where e.company_id = p_company_id and e.source_type = 'compra'
          and e.source_id = p.id and e.source_event = 'registro'
          and e.status = 'contabilizado'
      );

    select count(*) into v_unposted_dev
    from public.purchase_devolutions pd
    where pd.company_id = p_company_id
      and pd.status = 'activa'
      and pd.created_at >= p_start_date
      and pd.created_at < p_end_date
      and (pd.created_at at time zone v_acc_tz)::date >= v_acc_start
      and not exists (
        select 1 from public.acc_entries e
        where e.company_id = p_company_id and e.source_type = 'devolucion_compra'
          and e.source_id = pd.id and e.source_event = 'registro'
          and e.status = 'contabilizado'
      );
  end if;

  if (v_iva_gen_19 + v_iva_gen_5) >= v_iva_neto_desc then
    v_saldo_pagar := (v_iva_gen_19 + v_iva_gen_5) - v_iva_neto_desc;
    v_saldo_favor := 0;
  else
    v_saldo_favor := v_iva_neto_desc - (v_iva_gen_19 + v_iva_gen_5);
    v_saldo_pagar := 0;
  end if;

  return jsonb_build_object(
    'casilla_30_ingresos_gravados_19', round(v_ing_grav_19, 0),
    'casilla_31_ingresos_gravados_5', round(v_ing_grav_5, 0),
    'casilla_28_ingresos_excluidos', round(v_ing_excl, 0),
    'casilla_41_total_ingresos_brutos', round(v_ing_grav_19 + v_ing_grav_5 + v_ing_excl, 0),
    'casilla_43_devoluciones_ventas', round(v_dev_ventas, 0),
    'casilla_42_total_ingresos_netos', round(v_ing_grav_19 + v_ing_grav_5 + v_ing_excl - v_dev_ventas, 0),
    'casilla_59_iva_generado_19', round(v_iva_gen_19, 0),
    'casilla_60_iva_generado_5', round(v_iva_gen_5, 0),
    'casilla_65_total_iva_generado', round(v_iva_gen_19 + v_iva_gen_5, 0),
    'casilla_66_compras_gravadas', round(v_compras_grav_desc, 0),
    'casilla_74_iva_descontable_compras', round(v_iva_neto_desc, 0),
    'casilla_83_total_iva_descontable', round(v_iva_neto_desc, 0),
    'casilla_84_saldo_a_pagar', round(v_saldo_pagar, 0),
    'casilla_85_saldo_a_favor', round(v_saldo_favor, 0),
    'compras_sin_iva_base', round(v_compras_sin_iva, 0),
    'compras_iva_pendiente_base', round(v_compras_pend_base, 0),
    'iva_compras_pendiente', round(v_iva_pend_compras, 0),
    'compras_iva_costo_base', round(v_compras_costo_base, 0),
    'iva_compras_costo', round(v_iva_costo_compras, 0),
    'devoluciones_compras_iva_descontable', round(v_dev_iva_desc, 0),
    'compras_sin_contabilizar_count', v_unposted_pur,
    'devoluciones_compra_sin_contabilizar_count', v_unposted_dev,
    'es_borrador_no_conciliado', (not coalesce(v_acc_active, false) or v_unposted_pur > 0 or v_unposted_dev > 0 or v_iva_pend_compras > 0)
  );
end;
$function$;

-- 14. acc_reconcile() sin omisión de categorías ni greatest(0, ...) que oculte descuadres
create or replace function public.acc_reconcile()
returns table(code text, label text, operational numeric, accounting numeric, difference numeric, note text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.my_company();
  s public.acc_settings;
  a numeric;
  b numeric;
  k int;
  x uuid;
  v_iva_desc uuid;
  v_iva_pend uuid;
  v_dev_inv numeric := 0;
  v_dev_desc numeric := 0;
  v_dev_pend numeric := 0;
  v_other_vat numeric := 0;
  v_has_dev_iva boolean;
begin
  if not public.is_manager() or v_c is null then
    raise exception 'No autorizado';
  end if;

  select * into s from public.acc_settings where company_id = v_c;
  if not found or s.start_date is null then
    raise exception 'Configura y activa la contabilidad automática antes de conciliar';
  end if;

  v_has_dev_iva := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_devolutions' and column_name = 'tax_amount'
  );

  -- 1. Ventas sin impuesto
  select coalesce(sum(x2.total - x2.tax_amount), 0) into a
  from public.sales x2
  where x2.company_id = v_c and x2.status = 'completada'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.credit - l.debit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'venta'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'ventas')::uuid;

  code := 'ventas'; label := 'Ventas sin impuesto'; operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0'; return next;

  -- 2. Ventas pendientes de contabilizar
  select count(*) into k from public.sales x2
  where x2.company_id = v_c and x2.status = 'completada' and jsonb_array_length(x2.items) > 0
    and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'venta'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  code := 'ventas_pendientes'; label := 'Ventas sin contabilizar (cantidad)'; operational := k; accounting := 0;
  difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;

  -- 3. Compras recibidas originales
  select coalesce(sum(
    coalesce(x2.subtotal, x2.total - coalesce(x2.tax, 0))
    + case when x2.tax_status = 'costo' and x2.iva_classified_at is null then coalesce(x2.tax, 0) else 0 end
  ), 0) into a
  from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'compra'
    and e.source_event = 'registro'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'compras'; label := 'Compras recibidas (registro original en inventario)';
  operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0 (excluye IVA descontable/pendiente y reclasificaciones posteriores)'; return next;

  -- 4. Reclasificaciones de IVA capitalizadas en inventario remanente (siempre emitida)
  select coalesce(sum(adj.amount_to_inventory), 0) into a
  from public.purchase_iva_adjustments adj
  where adj.company_id = v_c
    and adj.status = 'aplicado'
    and adj.to_status = 'costo'
    and (adj.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'compra'
    and e.source_event = 'reclasificacion_iva'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'compras_reclasificacion_inv';
  label := 'IVA reclasificado a inventario remanente';
  operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0 (IVA no descontable de unidades aún en inventario)'; return next;

  -- 5. Devoluciones a proveedores (salida de inventario, siempre emitida)
  if v_has_dev_iva then
    execute $q$
      select coalesce(sum(coalesce(pd.inventory_credit,
        case when pd.tax_status_snapshot = 'costo' then pd.amount else coalesce(pd.subtotal, pd.amount - coalesce(pd.tax_amount, 0)) end
      )), 0)
      from public.purchase_devolutions pd
      where pd.company_id = $1 and pd.status = 'activa'
        and (pd.created_at at time zone $2)::date >= $3
    $q$ into v_dev_inv using v_c, s.timezone, s.start_date;
  else
    select coalesce(sum(pd.amount), 0) into v_dev_inv
    from public.purchase_devolutions pd
    where pd.company_id = v_c and pd.status = 'activa'
      and (pd.created_at at time zone s.timezone)::date >= s.start_date;
  end if;

  select coalesce(sum(l.credit - l.debit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'devolucion_compra'
    and e.source_event = 'registro'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'devoluciones_compra_inv';
  label := 'Devoluciones a proveedor (crédito a inventario)';
  operational := v_dev_inv; accounting := b; difference := v_dev_inv - b;
  note := 'Debe ser 0'; return next;

  -- 6. IVA reclasificado a costo de ventas (unidades vendidas, siempre emitida)
  select coalesce(sum(adj.amount_to_expense), 0) into a
  from public.purchase_iva_adjustments adj
  where adj.company_id = v_c
    and adj.status = 'aplicado'
    and adj.to_status = 'costo'
    and (adj.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'compra'
    and e.source_event = 'reclasificacion_iva'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'costo_ventas')::uuid;

  code := 'iva_compras_costo_gasto';
  label := 'IVA reclasificado a costo de ventas (unidades vendidas)';
  operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0 (diferenciado del inventario remanente)'; return next;

  -- 7. IVA descontable neto vigente en compras (siempre emitida; sin greatest(0) y alineado a devoluciones >= start_date)
  begin
    v_iva_desc := nullif(btrim(coalesce(s.map->>'iva_descontable', '')), '')::uuid;
  exception when others then
    v_iva_desc := null;
  end;

  select coalesce(sum(x2.tax), 0) into a
  from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida' and x2.tax_status = 'descontable'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  if v_has_dev_iva then
    execute $q$
      select coalesce(sum(pd.tax_amount), 0)
      from public.purchase_devolutions pd
      join public.purchases p on p.id = pd.purchase_id
      where pd.company_id = $1 and pd.status = 'activa'
        and p.status = 'recibida'
        and p.tax_status = 'descontable'
        and (pd.created_at at time zone $2)::date >= $3
    $q$ into v_dev_desc using v_c, s.timezone, s.start_date;
  end if;
  a := a - v_dev_desc;

  if v_iva_desc is not null then
    select coalesce(sum(l.debit - l.credit), 0) into b
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type in ('compra', 'devolucion_compra')
      and e.entry_date >= s.start_date
      and l.account_id = v_iva_desc;
  else
    b := 0;
  end if;

  code := 'iva_compras_descontable';
  label := 'IVA descontable en compras (neto vigente desde inicio)';
  operational := a; accounting := b; difference := a - b;
  note := case when v_iva_desc is null then 'Configura la cuenta iva_descontable en Config. contable' else 'Debe ser 0' end;
  return next;

  -- 8. IVA pendiente neto vigente en compras (siempre emitida)
  begin
    v_iva_pend := nullif(btrim(coalesce(s.map->>'iva_pendiente', '')), '')::uuid;
  exception when others then
    v_iva_pend := null;
  end;

  select coalesce(sum(x2.tax), 0) into a
  from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida' and x2.tax_status = 'pendiente'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  if v_has_dev_iva then
    execute $q$
      select coalesce(sum(pd.tax_amount), 0)
      from public.purchase_devolutions pd
      join public.purchases p on p.id = pd.purchase_id
      where pd.company_id = $1 and pd.status = 'activa'
        and p.status = 'recibida'
        and p.tax_status = 'pendiente'
        and (pd.created_at at time zone $2)::date >= $3
    $q$ into v_dev_pend using v_c, s.timezone, s.start_date;
  end if;
  a := a - v_dev_pend;

  if v_iva_pend is not null then
    select coalesce(sum(l.debit - l.credit), 0) into b
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type in ('compra', 'devolucion_compra')
      and e.entry_date >= s.start_date
      and l.account_id = v_iva_pend;
  else
    b := 0;
  end if;

  code := 'iva_compras_pendiente';
  label := 'IVA de compras por clasificar (pendiente desde inicio)';
  operational := a; accounting := b; difference := a - b;
  note := case when v_iva_pend is null then 'Configura la cuenta iva_pendiente en Config. contable' else 'Debe ser 0' end;
  return next;

  if v_iva_desc is not null or v_iva_pend is not null then
    select coalesce(sum(l.debit - l.credit), 0) into v_other_vat
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type not in ('compra', 'devolucion_compra', 'reverso')
      and e.entry_date >= s.start_date
      and l.account_id in (v_iva_desc, v_iva_pend);
    if abs(v_other_vat) >= 0.01 then
      code := 'iva_compras_otros_asientos';
      label := 'Asientos manuales u otros en cuentas IVA de compras';
      operational := 0; accounting := v_other_vat; difference := -v_other_vat;
      note := 'Saldo proveniente de asientos no originados en compras/devoluciones desde start_date';
      return next;
    end if;
  end if;

  -- 9. Compras pendientes de contabilizar
  select count(*) into k from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida' and jsonb_array_length(x2.items) > 0
    and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'compra'
        and e.source_id = x2.id and e.source_event = 'registro'
        and e.status = 'contabilizado'
    );
  if k > 0 then
    code := 'compras_pendientes'; label := 'Compras sin contabilizar (cantidad)'; operational := k; accounting := 0;
    difference := k; note := 'Si compraste a crédito, elige la cuenta en Cuentas por pagar o usa "Contabilizar pendientes"'; return next;
  end if;

  -- 10. Devoluciones de ventas pendientes
  select count(*) into k from public.devolutions x2
  where x2.company_id = v_c and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'devolucion'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  code := 'devoluciones_pendientes'; label := 'Devoluciones de ventas sin contabilizar (cantidad)'; operational := k;
  accounting := 0; difference := k; note := 'Debe ser 0'; return next;

  -- 11. Devoluciones a proveedores pendientes
  select count(*) into k from public.purchase_devolutions x2
  where x2.company_id = v_c and x2.status = 'activa' and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'devolucion_compra'
        and e.source_id = x2.id and e.source_event = 'registro'
        and e.status = 'contabilizado'
    );
  if k > 0 then
    code := 'devoluciones_compra_pendientes'; label := 'Devoluciones a proveedores sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
  end if;

  -- 12. Gastos operativos pendientes
  select count(*) into k from public.expenses x2
  where x2.company_id = v_c and x2.status = 'activo' and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'gasto'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  if k > 0 then
    code := 'gastos_pendientes'; label := 'Gastos operativos sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Configura la cuenta de Gastos en Config. contable y usa "Contabilizar pendientes"'; return next;
  end if;

  -- 13. Ajustes de stock pendientes
  select count(*) into k from public.kardex x2
  where x2.company_id = v_c and x2.reference_type = 'ajuste' and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'ajuste_stock'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  code := 'ajustes_pendientes'; label := 'Ajustes de stock sin contabilizar (cantidad)'; operational := k;
  accounting := 0; difference := k;
  note := 'Si hay pendientes, configura la cuenta de ajustes de inventario'; return next;

  -- 14. Caja (sin contar asientos reversados)
  select coalesce(sum(case when c.type = 'ingreso' then c.amount else -c.amount end), 0) into a
  from public.cash_entries c
  where c.company_id = v_c and (c.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.status = 'contabilizado'
    and e.source_type <> 'reverso'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'caja')::uuid;

  code := 'caja'; label := 'Movimiento de caja desde el inicio'; operational := a; accounting := b;
  difference := a - b; note := 'Debe ser 0 cuando no haya movimientos pendientes'; return next;

  -- 15. Caja manual y arqueos pendientes
  select coalesce(sum(case when c.type = 'ingreso' then c.amount else -c.amount end), 0) into a
  from public.cash_entries c
  where c.company_id = v_c and (c.reference_type is null or c.reference_type = 'arqueo')
    and (c.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type in ('caja', 'arqueo')
        and e.source_id = c.id and e.source_event = 'registro'
    );
  code := 'caja_pendiente'; label := 'Caja manual y arqueos sin contabilizar'; operational := a; accounting := 0;
  difference := a; note := 'Si hay pendientes, configura Gastos y Otros ingresos'; return next;

  -- 16. Inventario físico remanente vs saldo contable de inventario
  select coalesce(sum(p.stock * p.cost), 0) into a from public.products p where p.company_id = v_c;
  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.status = 'contabilizado'
    and e.source_type <> 'reverso'
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'inventario'; label := 'Inventario remanente'; operational := a; accounting := b; difference := a - b;
  note := 'Valorado al costo promedio. La contabilidad empieza en cero salvo que cargues un asiento de apertura';
  return next;

  -- 17. Cartera CxC
  select account_id into x from public.cxc_settings where company_id = v_c;
  if x is not null then
    select coalesce(sum(public._sale_balance(f.id)), 0) into a from public.sales f
    where f.company_id = v_c and f.status = 'completada'
      and (
        f.payment_method = 'fiado'
        or exists (select 1 from public.sale_payments sp where sp.sale_id = f.id and sp.method = 'fiado')
      )
      and (f.created_at at time zone s.timezone)::date >= s.start_date;

    select coalesce(sum(l.debit - l.credit), 0) into b
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type <> 'reverso'
      and l.account_id = x;

    code := 'cartera'; label := 'Cartera de clientes (fiado)'; operational := a; accounting := b;
    difference := a - b;
    note := 'Debe ser 0 cuando no haya pendientes';
    return next;

    select count(*) into k from public.credit_payments y
    where y.company_id = v_c and y.status = 'activo' and (y.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (
        select 1 from public.acc_entries e
        where e.company_id = v_c and e.source_type = 'abono'
          and e.source_id = y.id and e.source_event = 'registro'
      );
    code := 'abonos_pendientes'; label := 'Abonos de clientes sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
  end if;

  -- 18. Cuentas por pagar CxP
  if to_regclass('public.cxp_settings') is not null then
    select account_id into x from public.cxp_settings where company_id = v_c;
    if x is not null then
      select coalesce(sum(public._purchase_balance(f.id)), 0) into a from public.purchases f
      where f.company_id = v_c and f.payment_method = 'credito' and f.status = 'recibida'
        and (f.created_at at time zone s.timezone)::date >= s.start_date;

      select coalesce(sum(l.credit - l.debit), 0) into b
      from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
      where e.company_id = v_c
        and e.status = 'contabilizado'
        and e.source_type <> 'reverso'
        and l.account_id = x;

      code := 'cuentas_por_pagar'; label := 'Cuentas por pagar a proveedores'; operational := a; accounting := b;
      difference := a - b;
      note := 'Debe ser 0 cuando no haya pendientes';
      return next;

      select count(*) into k from public.supplier_payments y
      where y.company_id = v_c and y.status = 'activo' and (y.created_at at time zone s.timezone)::date >= s.start_date
        and not exists (
          select 1 from public.acc_entries e
          where e.company_id = v_c and e.source_type = 'pago_proveedor'
            and e.source_id = y.id and e.source_event = 'registro'
        );
      code := 'pagos_proveedor_pendientes'; label := 'Pagos a proveedores sin contabilizar (cantidad)'; operational := k;
      accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
    end if;
  end if;
end
$function$;

-- 15. Endurecimiento de privilegios (REVOKE / GRANT)
revoke all on function public._kardex_assign_seq() from public, anon, authenticated;
grant execute on function public._kardex_assign_seq() to postgres, service_role;

revoke all on function public._acc_resolve_purchase_vat_account(uuid, text) from public, anon, authenticated;
grant execute on function public._acc_resolve_purchase_vat_account(uuid, text) to postgres, service_role;

revoke all on function public._registrar_compra_impl(uuid, jsonb, text, integer, numeric, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public._registrar_compra_impl(uuid, jsonb, text, integer, numeric, text, numeric, boolean) to postgres, service_role;

revoke all on function public.acc_reverse_purchase_entries(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.acc_reverse_purchase_entries(uuid, uuid, text) to postgres, service_role;

revoke all on function public.acc_post_purchase(purchases, boolean) from public, anon, authenticated;
grant execute on function public.acc_post_purchase(purchases, boolean) to postgres, service_role;

revoke all on function public.registrar_compra(uuid, jsonb, text, integer) from public, anon;
grant execute on function public.registrar_compra(uuid, jsonb, text, integer) to authenticated, service_role;

revoke all on function public.registrar_compra(uuid, jsonb, text, integer, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.registrar_compra(uuid, jsonb, text, integer, numeric, text, numeric, boolean) to authenticated, service_role;

revoke all on function public.registrar_compra_con_iva(uuid, jsonb, text, integer, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.registrar_compra_con_iva(uuid, jsonb, text, integer, numeric, text, numeric, boolean) to authenticated, service_role;

revoke all on function public.clasificar_iva_compra(uuid, text, text) from public, anon;
grant execute on function public.clasificar_iva_compra(uuid, text, text) to authenticated, service_role;

revoke all on function public.anular_compra(uuid) from public, anon;
grant execute on function public.anular_compra(uuid) to authenticated, service_role;

revoke all on function public.acc_seed_template(text) from public, anon;
grant execute on function public.acc_seed_template(text) to authenticated, service_role;

revoke all on function public.acc_save_settings(jsonb) from public, anon;
grant execute on function public.acc_save_settings(jsonb) to authenticated, service_role;

revoke all on function public.dian_calcular_formulario_300(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.dian_calcular_formulario_300(uuid, timestamptz, timestamptz) to authenticated, service_role;

revoke all on function public.acc_reconcile() from public, anon;
grant execute on function public.acc_reconcile() to authenticated, service_role;

select public.sql_registrar_migracion(
  '20261114000063_fase_a_iva_compras_contabilidad',
  'Fase A IVA compras: cuentas estrictas, kardex.seq verificable, RLS solo lectura en ajustes, reclasificación, Form 300 y conciliación',
  '20261114000063_fase_a_iva_compras_contabilidad.sql'
);
