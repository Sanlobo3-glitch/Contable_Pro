-- supabase/migrations/20261118000068_cierre_bloqueantes_etapa1.sql
-- Corrección integral de bloqueantes de Etapa 1 (auditoría técnica sobre commit 8ae6aa2)
-- Idempotente, sin BEGIN/COMMIT. No altera migraciones históricas ya publicadas.
--   1. Bloqueante 1 (Auditoría contable): elimina EXCEPTION WHEN OTHERS THEN NULL en
--      acc_reopen_period y acc_close_period; si falla audit_log, toda la operación hace rollback.
--   2. Bloqueante 2 (Atomicidad CxP): elimina silenciamiento de fallos en
--      registrar_pago_proveedor y cxp_save_account; acc_post_supplier_payment conserva
--      omisión legítima solo si la contabilidad está inactiva o la fecha < start_date, y
--      falla con excepción clara si está activa con start_date NULL, falta cuenta o falla
--      el asiento (igual en cxp_save_account y acc_post_pending).
--   3. Bloqueante 3 (Separación Creación vs Aprobación OC + Numeración Concurrente):
--      impide que el rol 'comprador' autoapruebe en crear_orden_compra (p_auto_approve = true -> 42501)
--      o apruebe en cambiar_estado_orden_compra (p_status = 'approved' -> 42501); solo roles
--      autorizados por la matriz ('admin', 'dueno', 'admin_empresa') pueden aprobar. Corrige
--      public.users -> public.profiles, usa _require_company_roles y reemplaza count(*)+1 por
--      contador atómico por empresa (purchase_order_counters) + UNIQUE (company_id, po_number).
--   4. Bloqueante 4 (Máquina de estados OC): bloquea transiciones ilegales en
--      cambiar_estado_orden_compra ('draft'->'sent', 'partial'->'cancelled'/'approved'/'sent',
--      'received'/'cancelled'->*).
--   5. Bloqueante 5 (RLS y privilegios directos en acc_*): revoca DML directo de
--      authenticated/anon/public en acc_accounts, acc_entries, acc_lines, acc_periods,
--      acc_closings, acc_settings y acc_counters; reemplaza platform_admin_company_all (ALL)
--      por platform_admin_company_select (SELECT únicamente en su empresa activa y perfil activo).

-- =============================================================================
-- 0. HELPER BASE (COMPATIBILIDAD CON BASE VIVA Y MIGRACIÓN 000065)
-- =============================================================================

create or replace function public._require_company_roles(p_roles text[])
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public.current_company_id();
  v_ok boolean := false;
begin
  if auth.uid() is null or v_co is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.active = true
      and pr.company_id = v_co
      and (p_roles is null or pr.role = any(p_roles))
  ) into v_ok;

  if not v_ok then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return v_co;
end
$function$;

-- =============================================================================
-- 1. BLOQUEANTE 1: AUDITORÍA OBLIGATORIA Y ATÓMICA EN CIERRE Y REAPERTURA
-- =============================================================================

create or replace function public.acc_close_period(
  p_year integer,
  p_month integer,
  p_notes text default null::text,
  p_ack boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_c uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'gerente']);
  v_start date;
  v_end date;
  v_err int;
  v_warn int;
  v_checks jsonb;
  v_tb jsonb;
  v_d numeric;
  v_cr numeric;
  v_id uuid;
  v_name text;
begin
  if p_year is null or p_year < 2000 or p_year > 2100 or p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'Periodo contable inválido (año: %, mes: %)', p_year, p_month;
  end if;

  select
    count(*) filter (where k.status = 'error'),
    count(*) filter (where k.status = 'aviso'),
    coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
  into v_err, v_warn, v_checks
  from public.acc_close_check(p_year, p_month) k;

  if v_err > 0 then
    raise exception 'No se puede cerrar: hay % verificación(es) con error. Revisa la lista previa al cierre', v_err;
  end if;
  if v_warn > 0 and not coalesce(p_ack, false) then
    raise exception 'Hay % aviso(s) sin confirmar: revísalos y confirma el cierre', v_warn;
  end if;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  select
    coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb),
    coalesce(sum(t.period_debit), 0),
    coalesce(sum(t.period_credit), 0)
  into v_tb, v_d, v_cr
  from public.acc_trial_balance(v_start, v_end) t;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
  into v_name
  from public.profiles
  where id = auth.uid();

  insert into public.acc_periods (company_id, year, month, status, closed_at, closed_by)
  values (v_c, p_year, p_month, 'cerrado', now(), auth.uid())
  on conflict (company_id, year, month) do update
    set status = 'cerrado',
        closed_at = now(),
        closed_by = auth.uid();

  insert into public.acc_closings (
    company_id, year, month, notes, checks, trial_balance, totals, closed_by, closed_by_name
  ) values (
    v_c, p_year, p_month, nullif(btrim(p_notes), ''), v_checks, v_tb,
    jsonb_build_object('debitos', v_d, 'creditos', v_cr), auth.uid(), v_name
  )
  returning id into v_id;

  insert into public.audit_log (
    company_id, user_id, user_name, action, table_name, record_id, detail
  ) values (
    v_c,
    auth.uid(),
    v_name,
    'cierre_contable',
    'acc_closings',
    v_id,
    jsonb_build_object('year', p_year, 'month', p_month)
  );

  return v_id;
end
$function$;

create or replace function public.acc_reopen_period(
  p_year integer,
  p_month integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_c uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
  v_name text;
  v_id uuid;
begin
  if p_year is null or p_year < 2000 or p_year > 2100 or p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'Periodo contable inválido (año: %, mes: %)', p_year, p_month;
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la reapertura';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
  into v_name
  from public.profiles
  where id = auth.uid();

  select id into v_id
  from public.acc_closings
  where company_id = v_c
    and year = p_year
    and month = p_month
    and status = 'cerrado'
  for update;

  if not found then
    raise exception 'Ese periodo no está cerrado';
  end if;

  if exists (
    select 1 from public.acc_periods p
    where p.company_id = v_c
      and p.status = 'cerrado'
      and (p.year, p.month) > (p_year, p_month)
  ) then
    raise exception 'Reabre primero los periodos posteriores, del más reciente al más antiguo';
  end if;

  update public.acc_periods
     set status = 'abierto',
         closed_at = null,
         closed_by = null
   where company_id = v_c
     and year = p_year
     and month = p_month;

  update public.acc_closings
     set status = 'reabierto',
         reopened_by = auth.uid(),
         reopened_by_name = v_name,
         reopened_at = now(),
         reopen_reason = btrim(p_reason)
   where id = v_id;

  insert into public.audit_log (
    company_id, user_id, user_name, action, table_name, record_id, detail
  ) values (
    v_c,
    auth.uid(),
    v_name,
    'reapertura_contable',
    'acc_closings',
    v_id,
    jsonb_build_object('year', p_year, 'month', p_month, 'motivo', btrim(p_reason))
  );
end
$function$;

-- =============================================================================
-- 2. BLOQUEANTE 2: ATOMICIDAD DE CXP Y CONTABILIZACIÓN DE PAGOS A PROVEEDOR
-- =============================================================================

create or replace function public.acc_post_supplier_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  p public.supplier_payments;
  s public.acc_settings;
  v_tz text;
  v_date date;
  v_cxp uuid;
  v_pay uuid;
  v_exp uuid;
  v_in numeric := 0;
  v_out numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_pay_key text;
begin
  select * into p from public.supplier_payments where id = p_payment_id;
  if not found or p.status <> 'activo' then
    return null;
  end if;

  select * into s from public.acc_settings where company_id = p.company_id;
  if not found or not coalesce(s.active, false) then
    return null;
  end if;

  if s.start_date is null then
    raise exception 'Configuración contable incompleta: la contabilidad está activa pero falta definir la fecha de inicio (start_date)';
  end if;

  if p.created_at is null then
    raise exception 'No se puede contabilizar el pago a proveedor % porque carece de fecha de creación', p.id;
  end if;

  v_tz := coalesce(nullif(btrim(s.timezone), ''), 'America/Bogota');
  v_date := (p.created_at at time zone v_tz)::date;
  if v_date < s.start_date then
    return null;
  end if;

  if to_regclass('public.cxp_settings') is not null then
    select account_id into v_cxp from public.cxp_settings where company_id = p.company_id;
  end if;

  v_pay_key := case when p.method = 'efectivo' then 'caja' else 'bancos' end;
  begin
    v_pay := nullif(btrim(coalesce(s.map->>v_pay_key, '')), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'La cuenta configurada para "%" en Config. contable no es válida', v_pay_key;
  end;

  begin
    v_exp := nullif(btrim(coalesce(s.map->>'gastos', '')), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'La cuenta configurada para "gastos" en Config. contable no es válida';
  end;

  -- Lo aplicado a compras anteriores al inicio contable no tiene pasivo contabilizado
  select
    coalesce(sum(a.amount) filter (where (pu.created_at at time zone v_tz)::date >= s.start_date), 0),
    coalesce(sum(a.amount) filter (where (pu.created_at at time zone v_tz)::date <  s.start_date), 0)
  into v_in, v_out
  from public.supplier_allocations a
  join public.purchases pu on pu.id = a.purchase_id
  where a.payment_id = p.id
    and a.company_id = p.company_id
    and pu.company_id = p.company_id;

  if v_in > 0 and v_cxp is null then
    raise exception 'Falta configurar la cuenta por pagar a proveedores para contabilizar el pago';
  end if;

  if v_pay is null then
    raise exception 'Falta configurar la cuenta de "%" en Config. contable para contabilizar el pago a proveedor', v_pay_key;
  end if;

  if v_out > 0 and v_exp is null then
    raise exception 'Falta configurar la cuenta de "gastos" para contabilizar pagos a compras anteriores al inicio contable';
  end if;

  if v_in > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_cxp, 'debit', v_in));
  end if;

  if v_out > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_exp,
      'debit', v_out,
      'memo', 'Pago de compras anteriores al inicio contable'
    ));
  end if;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_id', v_pay,
    'credit', p.amount,
    'memo', 'Pago a proveedor (' || p.method || ')'
  ));

  if jsonb_array_length(v_lines) < 2 or abs(round(v_in + v_out, 2) - round(p.amount, 2)) > 0.01 then
    raise exception 'No se pudo construir un asiento contable cuadrado para el pago a proveedor %', p.id;
  end if;

  return public.acc_system_entry(
    p.company_id,
    v_date,
    'Pago a proveedor' || coalesce(': ' || (select name from public.suppliers where id = p.supplier_id and company_id = p.company_id), ''),
    'pago_proveedor',
    p.id,
    'registro',
    'PP-' || substr(p.id::text, 1, 8),
    v_lines
  );
end
$function$;

create or replace function public.acc_post_pending()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_c uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'gerente']);
  s public.acc_settings;
  v_tz text;
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
  select * into s from public.acc_settings where company_id = v_c;
  if not found or not coalesce(s.active, false) or s.start_date is null then
    raise exception 'Activa y configura la fecha de inicio de la contabilidad automática antes de contabilizar pendientes';
  end if;

  v_tz := coalesce(nullif(btrim(s.timezone), ''), 'America/Bogota');

  for r in
    select * from public.sales x
    where x.company_id = v_c and x.status = 'completada' and jsonb_array_length(x.items) > 0
      and (x.created_at at time zone v_tz)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'venta'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_sale(r, true) is not null then v_s := v_s + 1; end if;
  end loop;

  for q in
    select * from public.purchases x
    where x.company_id = v_c and x.status = 'recibida' and jsonb_array_length(x.items) > 0
      and (x.created_at at time zone v_tz)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'compra'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_purchase(q, true) is not null then v_p := v_p + 1; end if;
  end loop;

  for d in
    select * from public.devolutions x
    where x.company_id = v_c and (x.created_at at time zone v_tz)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'devolucion'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_devolution(d, true) is not null then v_d := v_d + 1; end if;
  end loop;

  for c in
    select * from public.cash_entries x
    where x.company_id = v_c and (x.reference_type is null or x.reference_type = 'arqueo')
      and (x.created_at at time zone v_tz)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c
        and e.source_type in ('caja', 'arqueo') and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_cash(c, true) is not null then v_k := v_k + 1; end if;
  end loop;

  for k in
    select * from public.kardex x
    where x.company_id = v_c and x.reference_type = 'ajuste'
      and (x.created_at at time zone v_tz)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'ajuste_stock'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_adjustment(k, true) is not null then v_a := v_a + 1; end if;
  end loop;

  for pp in
    select * from public.credit_payments x
    where x.company_id = v_c and x.status = 'activo'
      and (x.created_at at time zone v_tz)::date >= s.start_date
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
        and (x.created_at at time zone v_tz)::date >= s.start_date
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
      and (x.created_at at time zone v_tz)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'gasto'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_expense(ex.id) is not null then v_g := v_g + 1; end if;
  end loop;

  for pd in
    select * from public.purchase_devolutions x
    where x.company_id = v_c and x.status = 'activa'
      and (x.created_at at time zone v_tz)::date >= s.start_date
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
end
$function$;

create or replace function public.registrar_pago_proveedor(
  p_supplier_id uuid,
  p_amount numeric,
  p_method text default 'efectivo'::text,
  p_note text default null::text,
  p_client_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
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
    select id into v_id
    from public.supplier_payments
    where company_id = v_co and client_uuid = p_client_id;
    if found then
      return v_id;
    end if;
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

  select name into v_sup
  from public.suppliers
  where id = p_supplier_id and company_id = v_co
  for update;
  if not found then
    raise exception 'Proveedor no existe';
  end if;

  v_owed := public._supplier_owed(v_co, p_supplier_id);
  if v_owed <= 0 then
    raise exception 'No tienes deuda pendiente con este proveedor';
  end if;
  if v_amount > v_owed + 0.005 then
    raise exception 'El pago (%) es mayor que lo que debes al proveedor (%)', v_amount, round(v_owed, 2);
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
  into v_name
  from public.profiles
  where id = auth.uid();

  insert into public.supplier_payments (
    company_id, supplier_id, amount, method, note, client_uuid, created_by, created_by_name
  ) values (
    v_co, p_supplier_id, v_amount, p_method,
    nullif(left(btrim(coalesce(p_note, '')), 300), ''),
    p_client_id, auth.uid(), v_name
  )
  returning id into v_id;

  v_left := v_amount;
  for r in
    select p.id, public._purchase_balance(p.id) as bal
    from public.purchases p
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
      insert into public.supplier_allocations (company_id, payment_id, purchase_id, amount)
      values (v_co, v_id, r.id, v_alloc);
      v_left := v_left - v_alloc;
    end if;
  end loop;

  if v_left > 0.01 then
    raise exception 'No se pudo aplicar el pago completo';
  end if;

  if p_method = 'efectivo' then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_amount, 'Pago a proveedor - ' || coalesce(v_sup, 'Proveedor'), 'pago_proveedor', v_id);
  end if;

  -- Sin EXCEPTION WHEN OTHERS: si la contabilidad está activa y en fecha >= start_date,
  -- cualquier error de contabilización revierte íntegramente el pago, sus asignaciones y caja.
  perform public.acc_post_supplier_payment(v_id);

  return v_id;
end
$function$;

create or replace function public.cxp_save_account(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
  v_res jsonb := null;
begin
  if p_account is not null
     and not exists (
       select 1
       from public.acc_accounts
       where id = p_account
         and company_id = v_co
         and is_postable = true
         and active = true
     ) then
    raise exception 'La cuenta elegida no existe, está inactiva o no admite movimientos';
  end if;

  insert into public.cxp_settings (company_id, account_id)
  values (v_co, p_account)
  on conflict (company_id)
  do update set
    account_id = excluded.account_id,
    updated_at = now();

  -- Sin EXCEPTION WHEN OTHERS: si la contabilidad está activa (incluso si falta start_date)
  -- o si acc_post_pending falla al contabilizar movimientos pendientes, el error se propaga
  -- y revierte cxp_settings atómicamente.
  if p_account is not null
     and exists (
       select 1
       from public.acc_settings
       where company_id = v_co
         and active = true
     ) then
    v_res := public.acc_post_pending();
  end if;

  return coalesce(v_res, '{}'::jsonb);
end
$function$;

-- =============================================================================
-- 3. BLOQUEANTES 3 Y 4: ÓRDENES DE COMPRA (SEPARACIÓN CREACIÓN/APROBACIÓN,
--    NUMERACIÓN ATÓMICA CONCURRENTE Y MÁQUINA DE ESTADOS)
-- =============================================================================

create table if not exists public.purchase_order_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_seq integer not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now()
);

alter table public.purchase_order_counters enable row level security;

revoke all on table public.purchase_order_counters from public, anon, authenticated;
grant all on table public.purchase_order_counters to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'purchase_orders'
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by k.ord)
        from unnest(c.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = array['company_id', 'po_number']
  ) and not exists (
    select 1
    from pg_index idx
    join pg_class tc on tc.oid = idx.indrelid
    join pg_namespace n on n.oid = tc.relnamespace
    where n.nspname = 'public'
      and tc.relname = 'purchase_orders'
      and idx.indisunique
      and (
        select array_agg(a.attname::text order by k.ord)
        from unnest(idx.indkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = tc.oid and a.attnum = k.attnum
      ) = array['company_id', 'po_number']
  ) then
    alter table public.purchase_orders
      add constraint uq_purchase_orders_company_po_number unique (company_id, po_number);
  end if;
end $$;

create or replace function public.crear_orden_compra(
  p_supplier_id uuid,
  p_items jsonb,
  p_branch_id uuid default null::uuid,
  p_target_warehouse_id uuid default null::uuid,
  p_payment_terms text default 'credito'::text,
  p_credit_days integer default 30,
  p_expected_date date default null::date,
  p_notes text default null::text,
  p_auto_approve boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'comprador']);
  v_actor_role text;
  v_actor_name text;
  v_target_wh record;
  v_po_id uuid;
  v_base_seq integer;
  v_seq integer;
  v_po_number text;
  v_sup_name text := 'Proveedor general';
  v_total numeric(14,2) := 0;
  v_item jsonb;
  v_prod record;
  v_qty numeric;
  v_cost numeric;
  v_terms text := coalesce(nullif(btrim(coalesce(p_payment_terms, '')), ''), 'credito');
  v_days integer := coalesce(p_credit_days, 30);
begin
  select pr.role, coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Usuario')
  into v_actor_role, v_actor_name
  from public.profiles pr
  where pr.id = auth.uid()
    and pr.active = true
    and pr.company_id = v_co;

  -- Bloqueante 3: un rol creador no aprobador (ej. comprador) no puede autoaprobar una OC
  if coalesce(p_auto_approve, false) and v_actor_role not in ('admin', 'dueno', 'admin_empresa') then
    raise exception 'No autorizado: el rol % no puede autoaprobar órdenes de compra', v_actor_role
      using errcode = '42501';
  end if;

  if v_terms not in ('credito', 'transferencia', 'efectivo', 'tarjeta') then
    raise exception 'Condición de pago inválida en orden de compra: %', v_terms;
  end if;

  if v_days < 0 or v_days > 365 then
    raise exception 'Los días de crédito deben estar entre 0 y 365';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la orden de compra';
  end if;

  if p_supplier_id is not null then
    select name into v_sup_name from public.suppliers where id = p_supplier_id and company_id = v_co;
    if not found then
      raise exception 'Proveedor no válido para esta empresa';
    end if;
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and company_id = v_co
  ) then
    raise exception 'Sucursal no válida para esta empresa';
  end if;

  if p_target_warehouse_id is not null then
    select w.id, w.company_id, w.branch_id, w.active
      into v_target_wh
      from public.warehouses w
     where w.id = p_target_warehouse_id;

    if not found or v_target_wh.company_id is distinct from v_co or not coalesce(v_target_wh.active, false) then
      raise exception 'Bodega destino inválida, inactiva o de otra empresa';
    end if;

    if p_branch_id is not null and v_target_wh.branch_id is distinct from p_branch_id then
      raise exception 'La bodega destino no pertenece a la sucursal de la orden de compra';
    end if;
  end if;

  -- Numeración atómica por empresa (tolerante a concurrencia, órdenes históricas o anuladas)
  select greatest(
    coalesce((
      select max((regexp_match(po.po_number, '^OC-([0-9]{1,9})$'))[1]::integer)
      from public.purchase_orders po
      where po.company_id = v_co
        and po.po_number ~ '^OC-[0-9]{1,9}$'
    ), 0),
    (select count(*)::integer from public.purchase_orders po where po.company_id = v_co)
  )
  into v_base_seq;

  insert into public.purchase_order_counters (company_id, last_seq, updated_at)
  values (v_co, v_base_seq + 1, now())
  on conflict (company_id) do update
    set last_seq = greatest(public.purchase_order_counters.last_seq, v_base_seq) + 1,
        updated_at = now()
  returning last_seq into v_seq;

  v_po_number := 'OC-' || case
    when v_seq < 10000 then lpad(v_seq::text, 4, '0')
    else v_seq::text
  end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'ordered_qty')::numeric, (v_item->>'quantity')::numeric, 0);
    v_cost := coalesce((v_item->>'unit_cost')::numeric, (v_item->>'cost')::numeric, 0);
    if not public._es_finito(v_qty) or not public._es_finito(v_cost) or v_qty <= 0 or v_cost < 0 then
      raise exception 'Cantidad y costo deben ser válidos en cada renglón';
    end if;
    v_total := v_total + round(v_qty * v_cost, 2);
  end loop;

  insert into public.purchase_orders (
    company_id, po_number, supplier_id, supplier_name, branch_id, target_warehouse_id,
    status, payment_terms, credit_days, expected_date, subtotal, total, notes,
    created_by, created_by_name,
    approved_by_name, approved_at
  ) values (
    v_co, v_po_number, p_supplier_id, v_sup_name, p_branch_id, p_target_warehouse_id,
    case when coalesce(p_auto_approve, false) then 'approved' else 'draft' end,
    v_terms,
    v_days,
    p_expected_date, v_total, v_total,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), v_actor_name,
    case when coalesce(p_auto_approve, false) then v_actor_name else null end,
    case when coalesce(p_auto_approve, false) then now() else null end
  )
  returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select id, name, sku into v_prod
    from public.products
    where id = (v_item->>'product_id')::uuid and company_id = v_co;
    if not found then
      raise exception 'Producto no encontrado en el catálogo de la empresa';
    end if;

    v_qty := coalesce((v_item->>'ordered_qty')::numeric, (v_item->>'quantity')::numeric, 0);
    v_cost := coalesce((v_item->>'unit_cost')::numeric, (v_item->>'cost')::numeric, 0);

    insert into public.purchase_order_items (
      company_id, po_id, product_id, product_name, sku, ordered_qty, unit_cost
    ) values (
      v_co, v_po_id, v_prod.id, v_prod.name, v_prod.sku, v_qty, v_cost
    );
  end loop;

  return v_po_id;
end;
$function$;

create or replace function public.cambiar_estado_orden_compra(
  p_po_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'comprador']);
  v_actor_role text;
  v_actor text;
  v_cur text;
begin
  select pr.role, coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Usuario')
  into v_actor_role, v_actor
  from public.profiles pr
  where pr.id = auth.uid()
    and pr.active = true
    and pr.company_id = v_co;

  -- Bloqueante 3: solo roles autorizados por la matriz pueden aprobar una orden de compra
  if p_status = 'approved' and v_actor_role not in ('admin', 'dueno', 'admin_empresa') then
    raise exception 'No autorizado: el rol % no puede aprobar órdenes de compra', v_actor_role
      using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('approved', 'sent', 'cancelled') then
    raise exception 'Estado de transición inválido';
  end if;

  select status into v_cur
  from public.purchase_orders
  where id = p_po_id and company_id = v_co
  for update;

  if not found then
    raise exception 'Orden de compra no encontrada';
  end if;

  -- Bloqueante 4: máquina estricta de estados para órdenes de compra
  if v_cur in ('received', 'cancelled') then
    raise exception 'No se puede modificar una orden ya cerrada o cancelada';
  end if;

  if v_cur = 'partial' then
    raise exception 'No se puede cambiar el estado ni cancelar una orden de compra con recepción parcial';
  end if;

  if v_cur = 'draft' and p_status not in ('approved', 'cancelled') then
    raise exception 'Una orden en borrador debe aprobarse antes de marcarse como enviada';
  end if;

  if v_cur = 'approved' and p_status not in ('sent', 'cancelled') then
    raise exception 'Transición inválida desde orden aprobada hacia "%"', p_status;
  end if;

  if v_cur = 'sent' and p_status <> 'cancelled' then
    raise exception 'Una orden enviada solo admite recepción en bodega o cancelación previa a recibir';
  end if;

  update public.purchase_orders
     set status = p_status,
         approved_by_name = case when p_status = 'approved' then v_actor else approved_by_name end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         updated_at = now()
   where id = p_po_id and company_id = v_co;
end;
$function$;

-- =============================================================================
-- 4. BLOQUEANTE 5: CIERRE DE ESCRITURA DIRECTA Y PLATFORM_ADMIN EN TABLAS acc_*
-- =============================================================================

drop policy if exists platform_admin_company_all on public.acc_accounts;
drop policy if exists platform_admin_company_select on public.acc_accounts;
create policy platform_admin_company_select on public.acc_accounts
  for select to authenticated
  using (
    public.is_platform_admin()
    and company_id = (select public.current_company_id())
    and exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = acc_accounts.company_id
    )
  );

drop policy if exists platform_admin_company_all on public.acc_entries;
drop policy if exists platform_admin_company_select on public.acc_entries;
create policy platform_admin_company_select on public.acc_entries
  for select to authenticated
  using (
    public.is_platform_admin()
    and company_id = (select public.current_company_id())
    and exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = acc_entries.company_id
    )
  );

drop policy if exists platform_admin_company_all on public.acc_lines;
drop policy if exists platform_admin_company_select on public.acc_lines;
create policy platform_admin_company_select on public.acc_lines
  for select to authenticated
  using (
    public.is_platform_admin()
    and company_id = (select public.current_company_id())
    and exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = acc_lines.company_id
    )
  );

drop policy if exists platform_admin_company_all on public.acc_periods;
drop policy if exists platform_admin_company_select on public.acc_periods;
create policy platform_admin_company_select on public.acc_periods
  for select to authenticated
  using (
    public.is_platform_admin()
    and company_id = (select public.current_company_id())
    and exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = acc_periods.company_id
    )
  );

drop policy if exists platform_admin_company_all on public.acc_closings;
drop policy if exists platform_admin_company_select on public.acc_closings;
create policy platform_admin_company_select on public.acc_closings
  for select to authenticated
  using (
    public.is_platform_admin()
    and company_id = (select public.current_company_id())
    and exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = acc_closings.company_id
    )
  );

drop policy if exists platform_admin_company_all on public.acc_settings;
drop policy if exists platform_admin_company_select on public.acc_settings;
create policy platform_admin_company_select on public.acc_settings
  for select to authenticated
  using (
    public.is_platform_admin()
    and company_id = (select public.current_company_id())
    and exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = acc_settings.company_id
    )
  );

revoke all on table
  public.acc_accounts,
  public.acc_entries,
  public.acc_lines,
  public.acc_periods,
  public.acc_closings,
  public.acc_settings,
  public.acc_counters
from public, anon;

revoke insert, update, delete, truncate on table
  public.acc_accounts,
  public.acc_entries,
  public.acc_lines,
  public.acc_periods,
  public.acc_closings,
  public.acc_settings,
  public.acc_counters
from authenticated;

revoke select on table public.acc_counters from authenticated;

grant select on table
  public.acc_accounts,
  public.acc_entries,
  public.acc_lines,
  public.acc_periods,
  public.acc_closings,
  public.acc_settings
to authenticated;

grant all on table
  public.acc_accounts,
  public.acc_entries,
  public.acc_lines,
  public.acc_periods,
  public.acc_closings,
  public.acc_settings,
  public.acc_counters
to service_role;

-- =============================================================================
-- 5. PRIVILEGIOS EXPLÍCITOS EN FUNCIONES MODIFICADAS
-- =============================================================================

revoke all on function public._require_company_roles(text[]) from public, anon, authenticated;
grant execute on function public._require_company_roles(text[]) to postgres, service_role;

revoke all on function public.acc_post_supplier_payment(uuid) from public, anon, authenticated;
grant execute on function public.acc_post_supplier_payment(uuid) to postgres, service_role;

revoke all on function public.acc_close_period(integer, integer, text, boolean) from public, anon;
grant execute on function public.acc_close_period(integer, integer, text, boolean) to authenticated, service_role;

revoke all on function public.acc_reopen_period(integer, integer, text) from public, anon;
grant execute on function public.acc_reopen_period(integer, integer, text) to authenticated, service_role;

revoke all on function public.acc_post_pending() from public, anon;
grant execute on function public.acc_post_pending() to authenticated, service_role;

revoke all on function public.registrar_pago_proveedor(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.registrar_pago_proveedor(uuid, numeric, text, text, uuid) to authenticated, service_role;

revoke all on function public.cxp_save_account(uuid) from public, anon;
grant execute on function public.cxp_save_account(uuid) to authenticated, service_role;

revoke all on function public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) from public, anon;
grant execute on function public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) to authenticated, service_role;

revoke all on function public.cambiar_estado_orden_compra(uuid, text) from public, anon;
grant execute on function public.cambiar_estado_orden_compra(uuid, text) to authenticated, service_role;

-- =============================================================================
-- 6. PIE DE REGISTRO OBLIGATORIO EN BITÁCORA
-- =============================================================================

select public.sql_registrar_migracion(
  '20261118000068_cierre_bloqueantes_etapa1',
  'Etapa 1 Bloqueantes: auditoría atómica reapertura/cierre, atomicidad CxP, separación creación/aprobación OC, máquina de estados OC y cierre DML acc_*',
  '20261118000068_cierre_bloqueantes_etapa1.sql'
);
