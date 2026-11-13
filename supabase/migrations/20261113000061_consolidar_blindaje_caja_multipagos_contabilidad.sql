-- ============================================================================
-- MIGRACIÓN 89 (000061): CONSOLIDACIÓN DEL BLINDAJE DE CAJA, MULTIPAGOS Y
-- CONTABILIZACIÓN AUTOMÁTICA NIIF
-- Idempotente, sin BEGIN/COMMIT.
-- 1) Corrige columna warehouses.active en caja_abrir_turno y fija search_path.
-- 2) Registra y consolida contabilizar_venta_automatica y registrar_pagos_venta
--    con search_path seguro (pg_catalog, public, pg_temp) y uso oficial de
--    acc_system_entry + columna memo.
-- 3) Actualiza acc_post_sale, _sale_balance, _customer_owed, cartera_clientes,
--    cartera_cliente y registrar_abono para soportar multipagos con abono/fiado
--    parcial y asociar recaudos en efectivo al turno de caja activo (shift_id).
-- 4) Actualiza registrar_venta para asociar shift_id activo a sales y cash_entries.
-- 5) Crea registrar_venta_multipago para ventas POS con múltiples medios de pago
--    en una sola transacción ACID.
-- ============================================================================

-- 1. Corregir caja_abrir_turno (warehouses.active en lugar de is_active)
create or replace function public.caja_abrir_turno(
  p_opening_amount numeric default 0,
  p_warehouse_id uuid default null,
  p_notes text default null,
  p_denominations jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_cashier_name text;
  v_existing_id uuid;
  v_shift_id uuid;
  v_item jsonb;
  v_subtotal numeric;
begin
  if v_co is null then
    raise exception 'No se pudo determinar la empresa en sesión';
  end if;
  if v_user is null then
    raise exception 'Usuario no autenticado';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user and company_id = v_co and active = true;

  if v_profile.id is null then
    raise exception 'Perfil de usuario no activo o no pertenece a esta empresa';
  end if;

  if coalesce(v_profile.role, '') not in ('cajero', 'vendedor', 'dueno', 'admin_empresa', 'gerente', 'admin') then
    raise exception 'El rol % no está autorizado para abrir turnos de caja', v_profile.role;
  end if;

  if p_warehouse_id is not null then
    if not exists (
      select 1 from public.warehouses
      where id = p_warehouse_id and company_id = v_co and active = true
    ) then
      raise exception 'Bodega inválida o inactiva';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('caja_abrir_turno:' || v_co::text || ':' || v_user::text));

  select id into v_existing_id
  from public.cash_shifts
  where company_id = v_co and cashier_id = v_user and status = 'open'
  order by opened_at desc
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'ok', true,
      'shift_id', v_existing_id,
      'already_open', true,
      'opening_amount', p_opening_amount,
      'message', 'Ya tienes un turno de caja activo'
    );
  end if;

  if coalesce(p_opening_amount, 0) < 0 then
    raise exception 'El monto base inicial no puede ser negativo';
  end if;

  v_cashier_name := coalesce(v_profile.full_name, v_profile.email, 'Cajero');

  insert into public.cash_shifts (
    company_id,
    cashier_id,
    cashier_name,
    warehouse_id,
    opening_amount,
    expected_cash,
    notes,
    status
  ) values (
    v_co,
    v_user,
    v_cashier_name,
    p_warehouse_id,
    p_opening_amount,
    p_opening_amount,
    p_notes,
    'open'
  )
  returning id into v_shift_id;

  if p_opening_amount > 0 then
    insert into public.cash_entries (
      company_id,
      type,
      amount,
      description,
      reference_type,
      reference_id,
      shift_id
    ) values (
      v_co,
      'ingreso',
      p_opening_amount,
      'Base inicial de caja - Turno ' || left(v_shift_id::text, 8),
      'caja_apertura',
      v_shift_id,
      v_shift_id
    );
  end if;

  if p_denominations is not null and jsonb_typeof(p_denominations) = 'array' and jsonb_array_length(p_denominations) > 0 then
    for v_item in select * from jsonb_array_elements(p_denominations) loop
      v_subtotal := coalesce((v_item->>'quantity')::int, 0) * coalesce((v_item->>'denomination')::numeric, 0);
      if v_subtotal > 0 then
        insert into public.cash_shift_denominations (
          company_id,
          shift_id,
          stage,
          denomination,
          kind,
          quantity,
          subtotal
        ) values (
          v_co,
          v_shift_id,
          'apertura',
          (v_item->>'denomination')::numeric,
          coalesce(v_item->>'kind', 'billete'),
          coalesce((v_item->>'quantity')::int, 0),
          v_subtotal
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'shift_id', v_shift_id,
    'already_open', false,
    'opening_amount', p_opening_amount,
    'message', 'Turno de caja abierto correctamente'
  );
end;
$$;

-- 2. Consolidar contabilizar_venta_automatica con search_path seguro
create or replace function public.contabilizar_venta_automatica(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_sale public.sales%rowtype;
  v_settings public.acc_settings%rowtype;
  v_entry_id uuid;
  v_caja_id uuid;
  v_bancos_id uuid;
  v_cxc_id uuid;
  v_ingreso_id uuid;
  v_iva_id uuid;
  v_tax_amount numeric;
  v_subtotal numeric;
  v_lines jsonb := '[]'::jsonb;
  v_p record;
  v_has_payments boolean := false;
  v_pay_acc uuid;
  v_tot_debit numeric := 0;
  v_tot_credit numeric := 0;
  v_diff numeric;
  v_sale_date date;
begin
  if v_co is null then
    raise exception 'No se pudo determinar la empresa en sesión';
  end if;

  select * into v_sale
  from public.sales
  where company_id = v_co and (id = p_sale_id or client_uuid = p_sale_id);

  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'reason', 'Venta no encontrada');
  end if;

  select id into v_entry_id
  from public.acc_entries
  where company_id = v_co and source_type = 'venta' and source_id = v_sale.id
  limit 1;

  if v_entry_id is not null then
    return jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'already_posted', true);
  end if;

  select * into v_settings from public.acc_settings where company_id = v_co;

  if v_settings.map is not null and (v_settings.map->>'caja') is not null then
    select id into v_caja_id from public.acc_accounts
    where id = (v_settings.map->>'caja')::uuid and company_id = v_co and is_postable = true and active = true;
  end if;
  if v_caja_id is null then
    select id into v_caja_id from public.acc_accounts
    where company_id = v_co and (code like '1105%' or code = '1.1.01' or name ilike '%caja%') and is_postable = true and active = true
    order by code limit 1;
  end if;

  if v_settings.map is not null and (v_settings.map->>'bancos') is not null then
    select id into v_bancos_id from public.acc_accounts
    where id = (v_settings.map->>'bancos')::uuid and company_id = v_co and is_postable = true and active = true;
  end if;
  if v_bancos_id is null then
    select id into v_bancos_id from public.acc_accounts
    where company_id = v_co and (code like '1110%' or code = '1.1.02' or name ilike '%banco%') and is_postable = true and active = true
    order by code limit 1;
  end if;

  if v_settings.map is not null and (v_settings.map->>'cxc') is not null then
    select id into v_cxc_id from public.acc_accounts
    where id = (v_settings.map->>'cxc')::uuid and company_id = v_co and is_postable = true and active = true;
  end if;
  if v_cxc_id is null then
    select account_id into v_cxc_id from public.cxc_settings where company_id = v_co;
  end if;
  if v_cxc_id is null then
    select id into v_cxc_id from public.acc_accounts
    where company_id = v_co and (code like '1305%' or code = '1.1.03' or name ilike '%cobrar%' or name ilike '%cliente%') and is_postable = true and active = true
    order by code limit 1;
  end if;

  if v_settings.map is not null and (v_settings.map->>'ventas') is not null then
    select id into v_ingreso_id from public.acc_accounts
    where id = (v_settings.map->>'ventas')::uuid and company_id = v_co and is_postable = true and active = true;
  end if;
  if v_ingreso_id is null then
    select id into v_ingreso_id from public.acc_accounts
    where company_id = v_co and (code like '4135%' or code like '41%' or code = '4.1.01' or name ilike '%venta%') and is_postable = true and active = true
    order by code limit 1;
  end if;

  if v_settings.map is not null and (v_settings.map->>'impuestos') is not null then
    select id into v_iva_id from public.acc_accounts
    where id = (v_settings.map->>'impuestos')::uuid and company_id = v_co and is_postable = true and active = true;
  end if;
  if v_iva_id is null then
    select id into v_iva_id from public.acc_accounts
    where company_id = v_co and (code like '2408%' or code = '2.1.02' or name ilike '%iva%' or name ilike '%impuesto%') and is_postable = true and active = true
    order by code limit 1;
  end if;

  if v_ingreso_id is null or (v_caja_id is null and v_bancos_id is null and v_cxc_id is null) then
    return jsonb_build_object('ok', false, 'reason', 'Plan de cuentas NIIF incompleto para contabilización');
  end if;

  for v_p in
    select method, amount from public.sale_payments
    where sale_id = v_sale.id and company_id = v_co
  loop
    v_has_payments := true;
    if v_p.method = 'efectivo' then
      v_pay_acc := coalesce(v_caja_id, v_bancos_id);
    elsif v_p.method in ('tarjeta', 'transferencia') then
      v_pay_acc := coalesce(v_bancos_id, v_caja_id);
    elsif v_p.method = 'fiado' then
      v_pay_acc := coalesce(v_cxc_id, v_caja_id);
    else
      v_pay_acc := coalesce(v_caja_id, v_bancos_id);
    end if;

    if v_pay_acc is not null and v_p.amount > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_pay_acc,
        'debit', v_p.amount,
        'credit', 0,
        'memo', 'Pago venta (' || v_p.method || ')'
      ));
      v_tot_debit := v_tot_debit + v_p.amount;
    end if;
  end loop;

  if not v_has_payments and v_sale.total > 0 then
    if v_sale.payment_method = 'efectivo' then
      v_pay_acc := coalesce(v_caja_id, v_bancos_id);
    elsif v_sale.payment_method in ('tarjeta', 'transferencia') then
      v_pay_acc := coalesce(v_bancos_id, v_caja_id);
    elsif v_sale.payment_method = 'fiado' then
      v_pay_acc := coalesce(v_cxc_id, v_caja_id);
    else
      v_pay_acc := coalesce(v_caja_id, v_bancos_id);
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_pay_acc,
      'debit', v_sale.total,
      'credit', 0,
      'memo', case when v_sale.payment_method = 'fiado' then 'Venta a crédito' else 'Recaudo ' || v_sale.payment_method end
    ));
    v_tot_debit := v_sale.total;
  end if;

  v_tax_amount := coalesce(v_sale.tax_amount, 0);
  if v_tax_amount > 0 and v_iva_id is not null and v_tax_amount < v_sale.total then
    v_subtotal := v_sale.total - v_tax_amount;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_ingreso_id, 'debit', 0, 'credit', v_subtotal, 'memo', 'Ingreso por ventas'),
      jsonb_build_object('account_id', v_iva_id, 'debit', 0, 'credit', v_tax_amount, 'memo', 'IVA generado en venta')
    );
    v_tot_credit := v_subtotal + v_tax_amount;
  else
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_ingreso_id, 'debit', 0, 'credit', v_sale.total, 'memo', 'Ingreso por ventas')
    );
    v_tot_credit := v_sale.total;
  end if;

  if jsonb_array_length(v_lines) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'Líneas contables insuficientes');
  end if;

  v_diff := v_tot_debit - v_tot_credit;
  if abs(v_diff) > 0.05 then
    return jsonb_build_object('ok', false, 'reason', 'Asiento descuadrado: débito ' || v_tot_debit || ' crédito ' || v_tot_credit);
  end if;

  if v_diff <> 0 then
    v_lines := jsonb_set(
      v_lines,
      '{1,credit}',
      to_jsonb((v_lines->1->>'credit')::numeric + v_diff)
    );
  end if;

  v_sale_date := coalesce((v_sale.created_at at time zone coalesce(v_settings.timezone, 'America/Bogota'))::date, current_date);

  v_entry_id := public.acc_system_entry(
    v_co,
    v_sale_date,
    'Facturación venta ' || coalesce(v_sale.customer_name, 'Consumidor Final') || ' [' || left(v_sale.id::text, 8) || ']',
    'venta',
    v_sale.id,
    'completada',
    'V-' || left(v_sale.id::text, 8),
    v_lines
  );

  return jsonb_build_object('ok', true, 'entry_id', v_entry_id);
end;
$$;

-- 3. Consolidar registrar_pagos_venta con search_path seguro
create or replace function public.registrar_pagos_venta(
  p_sale_id uuid,
  p_payments jsonb,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_user uuid := auth.uid();
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_method text;
  v_amount numeric;
  v_ref text;
  v_sum numeric := 0;
  v_count int := 0;
begin
  if v_co is null then raise exception 'No se pudo determinar la empresa en sesión'; end if;
  if v_user is null then raise exception 'Usuario no autenticado'; end if;

  select * into v_sale from public.sales
  where company_id = v_co and (id = p_sale_id or client_uuid = p_sale_id);

  if v_sale.id is null then
    raise exception 'Venta no encontrada';
  end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Se requiere una lista de pagos válida';
  end if;

  delete from public.sale_payments where sale_id = v_sale.id and company_id = v_co;

  for v_item in select * from jsonb_array_elements(p_payments) loop
    v_method := lower(btrim(coalesce(v_item->>'method', '')));
    v_amount := coalesce((v_item->>'amount')::numeric, 0);
    v_ref := nullif(btrim(coalesce(v_item->>'reference', '')), '');

    if v_method not in ('efectivo', 'tarjeta', 'transferencia', 'fiado') then
      raise exception 'Método de pago no válido: %', v_method;
    end if;

    if v_amount <= 0 then
      raise exception 'El monto del pago debe ser mayor a 0';
    end if;

    insert into public.sale_payments (
      company_id,
      sale_id,
      shift_id,
      method,
      amount,
      reference
    ) values (
      v_co,
      v_sale.id,
      p_shift_id,
      v_method,
      v_amount,
      v_ref
    );

    v_sum := v_sum + v_amount;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'sale_id', v_sale.id,
    'payments_count', v_count,
    'total_paid', v_sum
  );
end;
$$;

-- 4. Actualizar acc_post_sale para soportar multipagos en sale_payments
create or replace function public.acc_post_sale(p_sale public.sales, p_estimated boolean default false)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.acc_settings;
  v_date date;
  v_net numeric;
  v_cogs numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_pay uuid;
  v_cxc uuid;
  v_has_sp boolean := false;
  v_sp record;
begin
  select * into s from public.acc_settings where company_id = p_sale.company_id;
  if not found or not s.active or s.start_date is null then return null; end if;

  v_date := (p_sale.created_at at time zone s.timezone)::date;
  if v_date < s.start_date then return null; end if;

  select account_id into v_cxc from public.cxc_settings where company_id = p_sale.company_id;

  -- Verificar si existen pagos divididos en sale_payments
  for v_sp in
    select method, amount from public.sale_payments
    where company_id = p_sale.company_id and sale_id = p_sale.id
  loop
    v_has_sp := true;
    if v_sp.method = 'fiado' then
      v_pay := v_cxc;
      if v_pay is null then return null; end if;
    elsif v_sp.method = 'efectivo' then
      v_pay := (s.map->>'caja')::uuid;
    else
      v_pay := (s.map->>'bancos')::uuid;
    end if;

    if v_sp.amount > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_pay,
        'debit', v_sp.amount,
        'memo', case when v_sp.method = 'fiado' then 'Venta a crédito (cuentas por cobrar)' else 'Cobro ' || v_sp.method end
      ));
    end if;
  end loop;

  -- Flujo tradicional de un solo método si no hay registros en sale_payments
  if not v_has_sp then
    if p_sale.payment_method = 'fiado' then
      v_pay := v_cxc;
      if v_pay is null then return null; end if;
    else
      v_pay := case when p_sale.payment_method = 'efectivo' then (s.map->>'caja')::uuid else (s.map->>'bancos')::uuid end;
    end if;

    if p_sale.total > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_pay,
        'debit', p_sale.total,
        'memo', case when p_sale.payment_method = 'fiado' then 'Venta a crédito (cuentas por cobrar)' else 'Cobro ' || p_sale.payment_method end
      ));
    end if;
  end if;

  v_net := p_sale.total - p_sale.tax_amount;
  select coalesce(sum((i.item->>'quantity')::numeric * p.cost), 0) into v_cogs
  from jsonb_array_elements(p_sale.items) as i(item)
  join public.products p on p.id = (i.item->>'product_id')::uuid and p.company_id = p_sale.company_id;

  if v_net > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', (s.map->>'ventas')::uuid, 'credit', v_net));
  end if;
  if p_sale.tax_amount > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', (s.map->>'impuestos')::uuid, 'credit', p_sale.tax_amount));
  end if;
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', (s.map->>'costo_ventas')::uuid, 'debit', v_cogs),
      jsonb_build_object('account_id', (s.map->>'inventario')::uuid, 'credit', v_cogs)
    );
  end if;

  if jsonb_array_length(v_lines) < 2 then return null; end if;

  return public.acc_system_entry(
    p_sale.company_id,
    v_date,
    'Venta a ' || coalesce(p_sale.customer_name, 'Cliente general') || case when p_estimated then ' (costo al valor actual)' else '' end,
    'venta',
    p_sale.id,
    'registro',
    'V-' || substr(p_sale.id::text, 1, 8),
    v_lines
  );
end;
$$;

-- 5. Cartera compatible con multipagos que incluyen 'fiado' parcial
create or replace function public._sale_balance(p_sale_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  with fiado_info as (
    select
      s.id,
      s.total,
      s.items,
      s.status,
      s.payment_method,
      exists (select 1 from public.sale_payments sp where sp.sale_id = s.id) as has_sp,
      coalesce((select sum(sp.amount) from public.sale_payments sp where sp.sale_id = s.id and sp.method = 'fiado'), 0) as sp_fiado
    from public.sales s
    where s.id = p_sale_id
  )
  select case
    when f.status <> 'completada' then 0
    when not f.has_sp and f.payment_method <> 'fiado' then 0
    when f.has_sp and f.sp_fiado <= 0 then 0
    when coalesce((select sum(d.quantity) from public.devolutions d where d.sale_id = f.id), 0)
         >= coalesce((select sum((x->>'quantity')::numeric) from jsonb_array_elements(f.items) x), 0)
         and jsonb_array_length(f.items) > 0 then 0
    else greatest(
      (case when f.has_sp then f.sp_fiado else f.total end)
      - coalesce((select sum(d.amount) from public.devolutions d where d.sale_id = f.id), 0)
      - coalesce((select sum(a.amount) from public.credit_allocations a
                  join public.credit_payments p on p.id = a.payment_id
                  where a.sale_id = f.id and p.status = 'activo'), 0),
      0
    )
  end
  from fiado_info f;
$$;

create or replace function public._customer_owed(p_co uuid, p_customer uuid)
returns numeric
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  select coalesce(sum(public._sale_balance(s.id)), 0)
  from public.sales s
  where s.company_id = p_co
    and s.customer_id = p_customer
    and s.status = 'completada'
    and (
      s.payment_method = 'fiado'
      or exists (select 1 from public.sale_payments sp where sp.sale_id = s.id and sp.method = 'fiado')
    );
$$;

create or replace function public.cartera_clientes()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_today date := public._co_today(v_co);
  v_res jsonb;
begin
  with b as (
    select s.customer_id, s.id, s.due_date, public._sale_balance(s.id) as bal
    from public.sales s
    where s.company_id = v_co
      and s.status = 'completada'
      and s.customer_id is not null
      and (
        s.payment_method = 'fiado'
        or exists (select 1 from public.sale_payments sp where sp.sale_id = s.id and sp.method = 'fiado')
      )
  ), agg as (
    select c.id, c.name, c.document, c.phone,
           coalesce(sum(b.bal), 0) as owed,
           coalesce(sum(b.bal) filter (where b.due_date is not null and b.due_date < v_today), 0) as overdue,
           min(b.due_date) filter (where b.bal > 0.004) as oldest_due,
           (count(b.id) filter (where b.bal > 0.004))::int as open_sales,
           coalesce(cc.credit_limit, 0) as credit_limit,
           coalesce(cc.credit_days, 30) as credit_days,
           (select max(p.created_at) from public.credit_payments p where p.customer_id = c.id and p.status = 'activo') as last_payment
    from public.customers c
    left join b on b.customer_id = c.id
    left join public.customer_credit cc on cc.customer_id = c.id
    where c.company_id = v_co
    group by c.id, c.name, c.document, c.phone, cc.credit_limit, cc.credit_days
    having coalesce(sum(b.bal), 0) > 0.004 or coalesce(cc.credit_limit, 0) > 0
  )
  select jsonb_build_object(
    'today', v_today,
    'total_owed', coalesce((select sum(owed) from agg), 0),
    'total_overdue', coalesce((select sum(overdue) from agg), 0),
    'customers', coalesce((select jsonb_agg(jsonb_build_object(
        'customer_id', id, 'name', name, 'document', document, 'phone', phone,
        'owed', owed, 'overdue', overdue, 'oldest_due', oldest_due, 'open_sales', open_sales,
        'credit_limit', credit_limit, 'credit_days', credit_days, 'last_payment', last_payment)
        order by overdue desc, owed desc, name) from agg), '[]'::jsonb))
  into v_res;
  return v_res;
end;
$$;

create or replace function public.cartera_cliente(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_today date := public._co_today(v_co);
  c public.customers%rowtype;
  v_limit numeric := 0;
  v_days int := 30;
  v_sales jsonb;
  v_pays jsonb;
  v_owed numeric := 0;
  v_over numeric := 0;
begin
  select * into c from public.customers where id = p_customer_id and company_id = v_co;
  if not found then raise exception 'Cliente no existe'; end if;

  select credit_limit, credit_days into v_limit, v_days from public.customer_credit where customer_id = p_customer_id;
  v_limit := coalesce(v_limit, 0);
  v_days := coalesce(v_days, 30);

  with b as (
    select s.id, s.created_at, s.total, s.due_date, public._sale_balance(s.id) as bal
    from public.sales s
    where s.company_id = v_co
      and s.customer_id = p_customer_id
      and s.status = 'completada'
      and (
        s.payment_method = 'fiado'
        or exists (select 1 from public.sale_payments sp where sp.sale_id = s.id and sp.method = 'fiado')
      )
  )
  select coalesce(sum(bal), 0),
         coalesce(sum(bal) filter (where due_date is not null and due_date < v_today), 0),
         coalesce(jsonb_agg(jsonb_build_object(
            'id', id, 'created_at', created_at, 'total', total, 'balance', bal,
            'due_date', due_date, 'days_overdue', case when due_date is not null and due_date < v_today then v_today - due_date else 0 end)
            order by created_at desc) filter (where bal > 0.004), '[]'::jsonb)
    into v_owed, v_over, v_sales
  from b;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'created_at', created_at, 'amount', amount, 'method', method,
      'note', note, 'status', status, 'by', created_by_name) order by created_at desc), '[]'::jsonb)
    into v_pays
  from (select * from public.credit_payments where company_id = v_co and customer_id = p_customer_id
        order by created_at desc limit 50) q;

  return jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'document', c.document, 'phone', c.phone),
    'credit_limit', v_limit, 'credit_days', v_days, 'owed', v_owed, 'overdue', v_over,
    'sales', v_sales, 'payments', v_pays);
end;
$$;

create or replace function public.registrar_abono(
  p_customer_id uuid,
  p_amount numeric,
  p_method text default 'efectivo',
  p_note text default null,
  p_client_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_amount numeric;
  v_cust text;
  v_owed numeric;
  v_id uuid;
  v_left numeric;
  v_alloc numeric;
  v_name text;
  v_shift_id uuid;
  r record;
begin
  if p_client_id is not null then
    select id into v_id from public.credit_payments where company_id = v_co and client_uuid = p_client_id;
    if found then return v_id; end if;
  end if;

  if not public._es_finito(p_amount) or p_amount <= 0 then
    raise exception 'El abono debe ser mayor que cero';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount < 0.01 then raise exception 'El abono debe ser mayor que cero'; end if;

  if coalesce(p_method, '') not in ('efectivo', 'tarjeta', 'transferencia') then
    raise exception 'Método de pago inválido';
  end if;

  select name into v_cust from public.customers where id = p_customer_id and company_id = v_co for update;
  if not found then raise exception 'Cliente no existe'; end if;

  v_owed := public._customer_owed(v_co, p_customer_id);
  if v_owed <= 0 then raise exception 'Este cliente no tiene deuda pendiente'; end if;
  if v_amount > v_owed + 0.005 then
    raise exception 'El abono (%) es mayor que lo que debe el cliente (%)', v_amount, round(v_owed, 2);
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.credit_payments (company_id, customer_id, amount, method, note, client_uuid, created_by, created_by_name)
  values (v_co, p_customer_id, v_amount, p_method, nullif(left(btrim(coalesce(p_note, '')), 300), ''),
          p_client_id, auth.uid(), v_name)
  returning id into v_id;

  v_left := v_amount;
  for r in
    select s.id, public._sale_balance(s.id) as bal
    from public.sales s
    where s.company_id = v_co
      and s.customer_id = p_customer_id
      and s.status = 'completada'
      and (
        s.payment_method = 'fiado'
        or exists (select 1 from public.sale_payments sp where sp.sale_id = s.id and sp.method = 'fiado')
      )
    order by s.created_at, s.id
    for update of s
  loop
    exit when v_left <= 0.004;
    if r.bal > 0.004 then
      v_alloc := least(v_left, r.bal);
      insert into public.credit_allocations (company_id, payment_id, sale_id, amount)
      values (v_co, v_id, r.id, v_alloc);
      v_left := v_left - v_alloc;
    end if;
  end loop;

  if v_left > 0.01 then raise exception 'No se pudo aplicar el abono completo'; end if;

  if p_method = 'efectivo' then
    select id into v_shift_id
    from public.cash_shifts
    where company_id = v_co and cashier_id = auth.uid() and status = 'open'
    order by opened_at desc
    limit 1;

    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id, shift_id)
    values (v_co, 'ingreso', v_amount, 'Abono - ' || coalesce(v_cust, 'Cliente'), 'abono', v_id, v_shift_id);
  end if;

  begin
    perform public.acc_post_payment(v_id);
  exception when others then
    null;
  end;

  return v_id;
end;
$$;

-- 6. Actualizar registrar_venta para asociar shift_id activo a sales y cash_entries
create or replace function public.registrar_venta(
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method text default 'efectivo',
  p_geo jsonb default null,
  p_client_id uuid default null,
  p_captured_at timestamptz default null,
  p_channel text default 'ruta',
  p_discount numeric default 0,
  p_received numeric default null,
  p_fx_currency text default null,
  p_fx_amount numeric default null,
  p_fx_rate numeric default null,
  p_base_amount numeric default null
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_prod public.products%rowtype; v_pid uuid;
  v_qty numeric; v_price numeric; v_total numeric := 0;
  v_cust text; v_id uuid; v_items jsonb := '[]'::jsonb; v_new numeric;
  v_pay text := coalesce(p_payment_method, 'efectivo');
  v_mode text; v_role text;
  v_at timestamptz := now();
  v_taxmode text; v_rate numeric; v_tax numeric := 0; v_base numeric;
  v_chan text := coalesce(p_channel, 'ruta');
  v_disc numeric := 0;
  v_sdate date; v_due date; v_limit numeric := 0; v_days int := 30; v_tz text; v_owed numeric;
  v_ccur text; v_fxc text := null; v_fxa numeric := null; v_fxr numeric := null; v_eq numeric := null;
  v_basea numeric := 0;
  v_shift_id uuid;
  e jsonb;
begin
  if p_client_id is not null then
    select id into v_id from public.sales where company_id = v_co and client_uuid = p_client_id;
    if found then return v_id; end if;
  end if;

  if v_chan not in ('ruta', 'mostrador') then
    raise exception 'Canal de venta inválido';
  end if;

  if p_captured_at is not null and p_captured_at < now() and p_captured_at > now() - interval '30 days' then
    v_at := p_captured_at;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene items';
  end if;
  if v_pay not in ('efectivo', 'tarjeta', 'transferencia', 'fiado') then
    raise exception 'Método de pago inválido';
  end if;
  if coalesce(p_discount, 0) < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;

  if p_fx_currency is not null then
    v_fxc := upper(btrim(p_fx_currency));
    if v_fxc !~ '^[A-Z]{3}$' then raise exception 'Moneda de pago inválida'; end if;
    if v_pay = 'fiado' then raise exception 'Una venta fiada no puede registrar un pago en otra moneda'; end if;
    if coalesce(p_fx_amount, 0) <= 0 or coalesce(p_fx_rate, 0) <= 0 then
      raise exception 'Indica el monto recibido y la tasa de cambio';
    end if;
    if p_fx_rate > 1000000000 or p_fx_amount > 1000000000000 then
      raise exception 'Monto o tasa fuera de rango';
    end if;
    v_fxa := round(p_fx_amount, 4);
    v_fxr := p_fx_rate;
    v_basea := round(greatest(coalesce(p_base_amount, 0), 0), 2);
    v_eq := round(v_fxa * v_fxr, 2) + v_basea;
  end if;

  select geo_mode, tax_mode, tax_rate, currency into v_mode, v_taxmode, v_rate, v_ccur
    from public.company_config where company_id = v_co limit 1;
  v_taxmode := coalesce(v_taxmode, 'none');
  v_rate := coalesce(v_rate, 0);

  if v_fxc is not null and v_fxc = upper(btrim(coalesce(v_ccur, ''))) then
    raise exception 'Ese pago es en la moneda de la empresa (%): no es un pago en otra moneda', v_fxc;
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_chan = 'ruta' and p_geo is null and (coalesce(v_mode, 'off') = 'todos'
    or (coalesce(v_mode, 'off') = 'vendedores' and v_role = 'vendedor')) then
    raise exception 'La empresa exige confirmar la ubicación de la venta';
  end if;

  if p_customer_id is not null then
    select name into v_cust from public.customers where id = p_customer_id and company_id = v_co;
    if not found then raise exception 'Cliente no existe'; end if;
  end if;

  if v_pay = 'fiado' then
    if p_customer_id is null then raise exception 'El fiado requiere un cliente registrado'; end if;
    perform 1 from public.customers where id = p_customer_id and company_id = v_co for update;
    select coalesce(credit_limit, 0), coalesce(credit_days, 30) into v_limit, v_days
      from public.customer_credit where customer_id = p_customer_id and company_id = v_co;
    if not found then v_limit := 0; v_days := 30; end if;
    select timezone into v_tz from public.acc_settings where company_id = v_co;
    v_due := (v_at at time zone coalesce(v_tz, 'America/Bogota'))::date + v_days;
  end if;

  -- Vincular turno abierto del cajero si existe
  select id into v_shift_id
  from public.cash_shifts
  where company_id = v_co and cashier_id = auth.uid() and status = 'open'
  order by opened_at desc
  limit 1;

  insert into public.sales (company_id, customer_id, customer_name, items, total, payment_method, status, client_uuid, created_at, channel, shift_id)
    values (v_co, p_customer_id, v_cust, '[]', 0, v_pay, 'completada', p_client_id, v_at, v_chan, v_shift_id)
    returning id into v_id;

  for e in select x from jsonb_array_elements(p_items) x order by x->>'product_id' loop
    v_pid   := public._item_uuid(e, 'product_id');
    v_qty   := public._item_num(e, 'quantity');
    v_price := public._item_num(e, 'price');
    if v_qty <= 0 or v_price < 0 then raise exception 'Cantidad o precio inválido'; end if;

    select * into v_prod from public.products where id = v_pid and company_id = v_co for update;
    if not found then raise exception 'Producto no existe'; end if;
    if v_prod.stock < v_qty then
      raise exception 'Stock insuficiente para % (disponible: %)', v_prod.name, v_prod.stock;
    end if;

    if v_prod.tracks_expiry then
      v_sdate := (v_at at time zone coalesce((select timezone from public.acc_settings where company_id = v_co), 'America/Bogota'))::date;
      if v_prod.stock - coalesce((select sum(qty_remaining) from public.product_lots
        where company_id = v_co and product_id = v_prod.id and expiry_date < v_sdate), 0) < v_qty then
        raise exception 'No hay stock vendible de %: lo que queda está vencido. Dalo de baja en Lotes.', v_prod.name;
      end if;
    end if;

    v_new := v_prod.stock - v_qty;
    update public.products set stock = v_new where id = v_prod.id;
    if v_prod.tracks_expiry then perform public._lot_consume(v_co, v_id, v_prod.id, v_qty); end if;

    insert into public.kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id)
      values (v_co, v_prod.id, v_prod.name, 'salida', v_qty, v_new, 'sale', v_id);

    v_total := v_total + v_qty * v_price;
    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'product_name', v_prod.name,
      'quantity', v_qty, 'price', v_price, 'subtotal', v_qty * v_price);
  end loop;

  v_disc := round(least(coalesce(p_discount, 0), v_total), 2);
  v_total := v_total - v_disc;

  v_base := v_total;
  if v_taxmode = 'adicional' and v_rate > 0 then
    v_tax := round(v_total * v_rate / 100, 2);
    v_total := v_total + v_tax;
  elsif v_taxmode = 'incluido' and v_rate > 0 then
    v_tax := round(v_total - v_total / (1 + v_rate / 100), 2);
    v_base := v_total - v_tax;
  else
    v_rate := 0;
  end if;

  if v_eq is not null and v_eq < v_total - greatest(0.01, v_fxr * 0.005) then
    raise exception 'El pago en % equivale a %, y no cubre el total de la venta (%)', v_fxc, v_eq, v_total;
  end if;

  if v_pay = 'fiado' and v_limit > 0 then
    v_owed := public._customer_owed(v_co, p_customer_id);
    if v_owed + v_total > v_limit then
      raise exception 'Supera el cupo de crédito del cliente (cupo: %, debe: %, esta venta: %)',
        round(v_limit, 2), round(v_owed, 2), round(v_total, 2);
    end if;
  end if;

  update public.sales
    set items = v_items, total = v_total, subtotal = v_base, tax_rate = v_rate, tax_amount = v_tax,
    discount_amount = v_disc,
    amount_received = case when v_pay = 'fiado' then null when v_eq is not null then v_eq else p_received end,
    fx_currency = v_fxc, fx_amount = v_fxa, fx_rate = v_fxr,
    due_date = v_due
    where id = v_id;

  if v_pay = 'efectivo' then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id, created_at, shift_id)
      values (v_co, 'ingreso', v_total,
      'Venta - ' || coalesce(v_cust, 'Cliente general')
      || case when v_fxc is not null then ' (pagó ' || round(v_fxa, 2) || ' ' || v_fxc || ' a tasa ' || v_fxr
      || case when v_basea > 0 then ' + ' || v_basea || ' en moneda local' else '' end || ')' else '' end,
      'sale', v_id, v_at, v_shift_id);
  end if;

  if p_geo is not null then
    perform public._record_visit(v_co, p_customer_id, v_id, 'venta', p_geo);
    if v_at <> now() then
      update public.visits set created_at = v_at where sale_id = v_id;
    end if;
  end if;

  return v_id;
end;
$$;

-- 7. Nueva RPC atómica para ventas con pagos divididos / multipagos
create or replace function public.registrar_venta_multipago(
  p_customer_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_warehouse_id uuid default null,
  p_shift_id uuid default null,
  p_geo jsonb default null,
  p_client_id uuid default null,
  p_captured_at timestamptz default null,
  p_channel text default 'mostrador',
  p_discount numeric default 0,
  p_received numeric default null
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_co uuid := public._ctx(null);
  v_user uuid := auth.uid();
  v_prod public.products%rowtype;
  v_pid uuid;
  v_qty numeric;
  v_price numeric;
  v_total numeric := 0;
  v_cust text;
  v_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_new numeric;
  v_at timestamptz := now();
  v_taxmode text;
  v_rate numeric;
  v_tax numeric := 0;
  v_base numeric;
  v_chan text := coalesce(p_channel, 'mostrador');
  v_disc numeric := 0;
  v_sdate date;
  v_due date := null;
  v_limit numeric := 0;
  v_days int := 30;
  v_tz text;
  v_owed numeric;
  v_shift_id uuid;
  v_wh_active boolean;
  v_stock numeric;
  v_reserved numeric;
  v_after numeric;
  v_pay_sum numeric := 0;
  v_cash_sum numeric := 0;
  v_fiado_sum numeric := 0;
  v_primary_pay text := 'efectivo';
  v_max_pay numeric := -1;
  v_item jsonb;
  v_pmethod text;
  v_pamount numeric;
  v_pref text;
  r record;
  e jsonb;
begin
  if v_co is null or v_user is null then
    raise exception 'Sesión inválida para registrar venta';
  end if;

  if p_client_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_co::text || ':' || p_client_id::text, 0));
    select id into v_id from public.sales where company_id = v_co and client_uuid = p_client_id;
    if found then return v_id; end if;
  end if;

  if v_chan not in ('ruta', 'mostrador') then
    raise exception 'Canal de venta inválido';
  end if;

  if p_captured_at is not null and p_captured_at < now() and p_captured_at > now() - interval '30 days' then
    v_at := p_captured_at;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene items';
  end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Debe especificar al menos un medio de pago';
  end if;

  if coalesce(p_discount, 0) < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;

  -- Validar bodega si se indicó
  if p_warehouse_id is not null then
    select active into v_wh_active from public.warehouses
    where id = p_warehouse_id and company_id = v_co;
    if not found or v_wh_active is not true then
      raise exception 'La bodega seleccionada no existe o está inactiva';
    end if;
  end if;

  -- Validar cliente
  if p_customer_id is not null then
    select name into v_cust from public.customers where id = p_customer_id and company_id = v_co;
    if not found then raise exception 'Cliente no existe'; end if;
  end if;

  -- Pre-validar pagos y totales por método
  for v_item in select * from jsonb_array_elements(p_payments) loop
    v_pmethod := lower(btrim(coalesce(v_item->>'method', '')));
    v_pamount := round(coalesce((v_item->>'amount')::numeric, 0), 2);
    if v_pmethod not in ('efectivo', 'tarjeta', 'transferencia', 'fiado') then
      raise exception 'Método de pago inválido: %', v_pmethod;
    end if;
    if not public._es_finito(v_pamount) or v_pamount <= 0 then
      raise exception 'Cada monto de pago debe ser mayor a cero';
    end if;

    v_pay_sum := v_pay_sum + v_pamount;
    if v_pmethod = 'efectivo' then
      v_cash_sum := v_cash_sum + v_pamount;
    elsif v_pmethod = 'fiado' then
      v_fiado_sum := v_fiado_sum + v_pamount;
    end if;

    if v_pamount > v_max_pay then
      v_max_pay := v_pamount;
      v_primary_pay := v_pmethod;
    end if;
  end loop;

  if v_fiado_sum > 0 then
    if p_customer_id is null then
      raise exception 'El pago fiado requiere un cliente registrado';
    end if;
    perform 1 from public.customers where id = p_customer_id and company_id = v_co for update;
    select coalesce(credit_limit, 0), coalesce(credit_days, 30) into v_limit, v_days
      from public.customer_credit where customer_id = p_customer_id and company_id = v_co;
    if not found then v_limit := 0; v_days := 30; end if;
    select timezone into v_tz from public.acc_settings where company_id = v_co;
    v_due := (v_at at time zone coalesce(v_tz, 'America/Bogota'))::date + v_days;
    v_primary_pay := 'fiado';
  end if;

  select tax_mode, tax_rate into v_taxmode, v_rate
    from public.company_config where company_id = v_co limit 1;
  v_taxmode := coalesce(v_taxmode, 'none');
  v_rate := coalesce(v_rate, 0);

  -- Determinar turno activo válido
  if p_shift_id is not null then
    select id into v_shift_id from public.cash_shifts
    where id = p_shift_id and company_id = v_co and status = 'open'
      and (cashier_id = v_user or public.is_manager() or public.is_platform_admin());
  end if;
  if v_shift_id is null then
    select id into v_shift_id from public.cash_shifts
    where company_id = v_co and cashier_id = v_user and status = 'open'
    order by opened_at desc
    limit 1;
  end if;

  -- Insertar cabecera en estado inicial items='[]' antes de crear líneas
  insert into public.sales (
    company_id, customer_id, customer_name, items, total, payment_method,
    status, client_uuid, created_at, channel, shift_id, warehouse_id
  ) values (
    v_co, p_customer_id, v_cust, '[]', 0, v_primary_pay,
    'completada', p_client_id, v_at, v_chan, v_shift_id, p_warehouse_id
  ) returning id into v_id;

  -- Procesar productos e inventario global + kardex
  for e in select x from jsonb_array_elements(p_items) x order by x->>'product_id' loop
    v_pid := public._item_uuid(e, 'product_id');
    v_qty := public._item_num(e, 'quantity');
    v_price := public._item_num(e, 'price');
    if v_qty <= 0 or v_price < 0 then raise exception 'Cantidad o precio inválido'; end if;

    select * into v_prod from public.products where id = v_pid and company_id = v_co for update;
    if not found then raise exception 'Producto no existe'; end if;
    if v_prod.stock < v_qty then
      raise exception 'Stock insuficiente para % (disponible: %)', v_prod.name, v_prod.stock;
    end if;

    if v_prod.tracks_expiry then
      v_sdate := (v_at at time zone coalesce((select timezone from public.acc_settings where company_id = v_co), 'America/Bogota'))::date;
      if v_prod.stock - coalesce((select sum(qty_remaining) from public.product_lots
        where company_id = v_co and product_id = v_prod.id and expiry_date < v_sdate), 0) < v_qty then
        raise exception 'No hay stock vendible de %: lo que queda está vencido. Dalo de baja en Lotes.', v_prod.name;
      end if;
    end if;

    v_new := v_prod.stock - v_qty;
    update public.products set stock = v_new where id = v_prod.id;
    if v_prod.tracks_expiry then perform public._lot_consume(v_co, v_id, v_prod.id, v_qty); end if;

    insert into public.kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id)
      values (v_co, v_prod.id, v_prod.name, 'salida', v_qty, v_new, 'sale', v_id);

    v_total := v_total + v_qty * v_price;
    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'product_name', v_prod.name,
      'quantity', v_qty, 'price', v_price, 'subtotal', v_qty * v_price);
  end loop;

  -- Descontar existencias de bodega si aplica
  if p_warehouse_id is not null then
    for r in
      select
        public._item_uuid(x, 'product_id') as product_id,
        sum(public._item_num(x, 'quantity')) as quantity
      from jsonb_array_elements(p_items) as t(x)
      group by public._item_uuid(x, 'product_id')
      order by public._item_uuid(x, 'product_id')
    loop
      insert into public.warehouse_stock (company_id, warehouse_id, product_id, quantity, reserved_quantity)
      values (v_co, p_warehouse_id, r.product_id, 0, 0)
      on conflict (warehouse_id, product_id) do nothing;

      select quantity, reserved_quantity into v_stock, v_reserved
      from public.warehouse_stock
      where company_id = v_co and warehouse_id = p_warehouse_id and product_id = r.product_id
      for update;

      if v_stock - v_reserved < r.quantity then
        raise exception 'Stock insuficiente en la bodega seleccionada. Disponible: %, solicitado: %',
          v_stock - v_reserved, r.quantity;
      end if;

      v_after := v_stock - r.quantity;
      update public.warehouse_stock set quantity = v_after, updated_at = now()
      where company_id = v_co and warehouse_id = p_warehouse_id and product_id = r.product_id;

      insert into public.warehouse_movements (
        company_id, warehouse_id, product_id, movement_type, quantity_delta,
        quantity_before, quantity_after, reference_type, reference_id, notes, created_by
      ) values (
        v_co, p_warehouse_id, r.product_id, 'exit', -r.quantity,
        v_stock, v_after, 'sale', v_id, 'Salida por venta multipago', v_user
      );
    end loop;
  end if;

  v_disc := round(least(coalesce(p_discount, 0), v_total), 2);
  v_total := v_total - v_disc;

  v_base := v_total;
  if v_taxmode = 'adicional' and v_rate > 0 then
    v_tax := round(v_total * v_rate / 100, 2);
    v_total := v_total + v_tax;
  elsif v_taxmode = 'incluido' and v_rate > 0 then
    v_tax := round(v_total - v_total / (1 + v_rate / 100), 2);
    v_base := v_total - v_tax;
  else
    v_rate := 0;
  end if;

  if abs(v_pay_sum - v_total) > 0.05 then
    raise exception 'La suma de los pagos (%) no coincide con el total de la venta (%)', round(v_pay_sum, 2), round(v_total, 2);
  end if;

  if v_fiado_sum > 0 and v_limit > 0 then
    v_owed := public._customer_owed(v_co, p_customer_id);
    if v_owed + v_fiado_sum > v_limit then
      raise exception 'Supera el cupo de crédito del cliente (cupo: %, debe: %, fiado en esta venta: %)',
        round(v_limit, 2), round(v_owed, 2), round(v_fiado_sum, 2);
    end if;
  end if;

  -- Insertar pagos en sale_payments ANTES de actualizar items en sales para que acc_post_sale los lea
  for v_item in select * from jsonb_array_elements(p_payments) loop
    v_pmethod := lower(btrim(coalesce(v_item->>'method', '')));
    v_pamount := round(coalesce((v_item->>'amount')::numeric, 0), 2);
    v_pref := nullif(btrim(coalesce(v_item->>'reference', '')), '');
    insert into public.sale_payments (
      company_id, sale_id, shift_id, method, amount, reference
    ) values (
      v_co, v_id, v_shift_id, v_pmethod, v_pamount, v_pref
    );
  end loop;

  -- Actualizar totales e items (dispara acc_trg_sales -> acc_post_sale)
  update public.sales
    set items = v_items,
        total = v_total,
        subtotal = v_base,
        tax_rate = v_rate,
        tax_amount = v_tax,
        discount_amount = v_disc,
        amount_received = p_received,
        due_date = v_due
    where id = v_id;

  -- Ingresar a cash_entries únicamente la fracción en efectivo
  if v_cash_sum > 0 then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id, created_at, shift_id)
      values (v_co, 'ingreso', v_cash_sum,
      'Venta multipago (efectivo) - ' || coalesce(v_cust, 'Cliente general'),
      'sale', v_id, v_at, v_shift_id);
  end if;

  if p_geo is not null then
    perform public._record_visit(v_co, p_customer_id, v_id, 'venta', p_geo);
    if v_at <> now() then
      update public.visits set created_at = v_at where sale_id = v_id;
    end if;
  end if;

  return v_id;
end;
$$;

-- 8. Permisos restrictivos (cerrar anon/public, habilitar authenticated/service_role)
revoke all privileges on function public.caja_abrir_turno(numeric, uuid, text, jsonb) from public, anon;
revoke all privileges on function public.contabilizar_venta_automatica(uuid) from public, anon;
revoke all privileges on function public.registrar_pagos_venta(uuid, jsonb, uuid) from public, anon;
revoke all privileges on function public.registrar_venta_multipago(uuid, jsonb, jsonb, uuid, uuid, jsonb, uuid, timestamptz, text, numeric, numeric) from public, anon;

grant execute on function public.caja_abrir_turno(numeric, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.contabilizar_venta_automatica(uuid) to authenticated, service_role;
grant execute on function public.registrar_pagos_venta(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.registrar_venta_multipago(uuid, jsonb, jsonb, uuid, uuid, jsonb, uuid, timestamptz, text, numeric, numeric) to authenticated, service_role;

-- Pie de registro obligatorio en bitácora unificada
select public.sql_registrar_migracion(
  '20261113000061_consolidar_blindaje_caja_multipagos_contabilidad',
  'Consolidación de blindaje de caja, multipagos atómicos y contabilización NIIF',
  '20261113000061_consolidar_blindaje_caja_multipagos_contabilidad.sql'
);
