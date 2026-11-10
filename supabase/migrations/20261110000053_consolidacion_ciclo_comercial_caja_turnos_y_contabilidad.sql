-- ============================================================================
-- MIGRACIÓN 81: CONSOLIDACIÓN DEL CICLO COMERCIAL, CAJA Y CONTABILIDAD NIIF
-- Idempotente, sin BEGIN/COMMIT.
-- Modela turnos de caja (cash_shifts), arqueo ciego por denominaciones (cash_shift_denominations),
-- pagos múltiples (sale_payments) y enlace contable directo a acc_entries/acc_lines.
-- ============================================================================

-- 1. Tabla de Turnos / Sesiones de Caja
create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  cashier_id uuid not null references public.profiles(id),
  cashier_name text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_amount numeric not null default 0 check (opening_amount >= 0),
  expected_cash numeric not null default 0,
  counted_cash numeric,
  cash_difference numeric default 0,
  total_sales_cash numeric not null default 0,
  total_sales_card numeric not null default 0,
  total_sales_transfer numeric not null default 0,
  total_sales_credit numeric not null default 0,
  total_sales_count int not null default 0,
  total_cash_in numeric not null default 0,
  total_cash_out numeric not null default 0,
  status text not null default 'open' check (status in ('open', 'closed')),
  closing_type text check (closing_type in ('cierre_x', 'cierre_z')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índices de consulta rápida
create index if not exists idx_cash_shifts_company_status on public.cash_shifts(company_id, status);
create index if not exists idx_cash_shifts_cashier on public.cash_shifts(cashier_id, opened_at desc);

-- 2. Tabla de Conteo Físico por Denominaciones
create table if not exists public.cash_shift_denominations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shift_id uuid not null references public.cash_shifts(id) on delete cascade,
  stage text not null check (stage in ('apertura', 'cierre_x', 'cierre_z')),
  denomination numeric not null,
  kind text not null check (kind in ('billete', 'moneda')),
  quantity int not null default 0 check (quantity >= 0),
  subtotal numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_cash_shift_denoms_shift on public.cash_shift_denominations(shift_id, stage);

-- 3. Tabla de Pagos Divididos / Múltiples por Venta
create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  shift_id uuid references public.cash_shifts(id) on delete set null,
  method text not null check (method in ('efectivo', 'tarjeta', 'transferencia', 'fiado')),
  amount numeric not null check (amount > 0),
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sale_payments_sale on public.sale_payments(sale_id);
create index if not exists idx_sale_payments_shift on public.sale_payments(shift_id);

-- 4. Extender sales y cash_entries con shift_id
alter table public.sales add column if not exists shift_id uuid references public.cash_shifts(id) on delete set null;
create index if not exists idx_sales_shift_id on public.sales(shift_id);

alter table public.cash_entries add column if not exists shift_id uuid references public.cash_shifts(id) on delete set null;
create index if not exists idx_cash_entries_shift_id on public.cash_entries(shift_id);

-- 5. RLS y Políticas de Aislamiento Multiempresa
alter table public.cash_shifts enable row level security;
alter table public.cash_shift_denominations enable row level security;
alter table public.sale_payments enable row level security;

drop policy if exists cash_shifts_company_isolate on public.cash_shifts;
create policy cash_shifts_company_isolate on public.cash_shifts
  for all to authenticated
  using (company_id = public._ctx(null))
  with check (company_id = public._ctx(null));

drop policy if exists cash_shift_denoms_company_isolate on public.cash_shift_denominations;
create policy cash_shift_denoms_company_isolate on public.cash_shift_denominations
  for all to authenticated
  using (company_id = public._ctx(null))
  with check (company_id = public._ctx(null));

drop policy if exists sale_payments_company_isolate on public.sale_payments;
create policy sale_payments_company_isolate on public.sale_payments
  for all to authenticated
  using (company_id = public._ctx(null))
  with check (company_id = public._ctx(null));

grant all on public.cash_shifts to authenticated, service_role;
grant all on public.cash_shift_denominations to authenticated, service_role;
grant all on public.sale_payments to authenticated, service_role;

-- 6. RPC: Abrir Turno de Caja
create or replace function public.caja_abrir_turno(
  p_opening_amount numeric default 0,
  p_warehouse_id uuid default null,
  p_notes text default null,
  p_denominations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_co uuid := public._ctx(null);
  v_user uuid := auth.uid();
  v_cashier_name text;
  v_existing_id uuid;
  v_shift_id uuid;
  v_item jsonb;
  v_subtotal numeric;
begin
  if v_co is null then
    raise exception 'No se pudo determinar la empresa en sesión';
  end if;

  select id into v_existing_id
  from public.cash_shifts
  where company_id = v_co and cashier_id = v_user and status = 'open'
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'ok', true,
      'shift_id', v_existing_id,
      'already_open', true,
      'message', 'Ya tienes un turno de caja activo'
    );
  end if;

  select coalesce(full_name, email, 'Cajero') into v_cashier_name
  from public.profiles
  where id = v_user;

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
    greatest(coalesce(p_opening_amount, 0), 0),
    greatest(coalesce(p_opening_amount, 0), 0),
    p_notes,
    'open'
  )
  returning id into v_shift_id;

  -- Registrar movimiento inicial en cash_entries
  if coalesce(p_opening_amount, 0) > 0 then
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

  -- Guardar desglose físico si fue provisto
  if p_denominations is not null and jsonb_typeof(p_denominations) = 'array' then
    for v_item in select * from jsonb_array_elements(p_denominations) loop
      v_subtotal := coalesce((v_item->>'quantity')::int, 0) * coalesce((v_item->>'denomination')::numeric, 0);
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

-- 7. RPC: Obtener Turno Activo y Totales Acumulados
create or replace function public.caja_obtener_turno_activo()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_co uuid := public._ctx(null);
  v_user uuid := auth.uid();
  v_shift public.cash_shifts%rowtype;
  v_sales_cash numeric := 0;
  v_sales_card numeric := 0;
  v_sales_transfer numeric := 0;
  v_sales_credit numeric := 0;
  v_sales_count int := 0;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected numeric := 0;
begin
  select * into v_shift
  from public.cash_shifts
  where company_id = v_co and cashier_id = v_user and status = 'open'
  order by opened_at desc
  limit 1;

  if v_shift.id is null then
    return jsonb_build_object('active', false);
  end if;

  -- Acumular ventas del turno
  select
    coalesce(sum(case when payment_method = 'efectivo' then total else 0 end), 0),
    coalesce(sum(case when payment_method = 'tarjeta' then total else 0 end), 0),
    coalesce(sum(case when payment_method = 'transferencia' then total else 0 end), 0),
    coalesce(sum(case when payment_method = 'fiado' then total else 0 end), 0),
    count(*)
  into
    v_sales_cash,
    v_sales_card,
    v_sales_transfer,
    v_sales_credit,
    v_sales_count
  from public.sales
  where company_id = v_co
    and (shift_id = v_shift.id or (shift_id is null and seller_id = v_user and created_at >= v_shift.opened_at))
    and status = 'completada';

  -- Entradas y salidas manuales de caja en el turno (abonos, retiros, gastos menores)
  select
    coalesce(sum(case when type = 'ingreso' and reference_type <> 'caja_apertura' and reference_type <> 'sale' then amount else 0 end), 0),
    coalesce(sum(case when type = 'egreso' then amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.cash_entries
  where company_id = v_co
    and (shift_id = v_shift.id or (created_at >= v_shift.opened_at and (reference_type is null or reference_type <> 'arqueo')));

  v_expected := v_shift.opening_amount + v_sales_cash + v_cash_in - v_cash_out;

  return jsonb_build_object(
    'active', true,
    'shift_id', v_shift.id,
    'opened_at', v_shift.opened_at,
    'cashier_name', v_shift.cashier_name,
    'opening_amount', v_shift.opening_amount,
    'sales_cash', v_sales_cash,
    'sales_card', v_sales_card,
    'sales_transfer', v_sales_transfer,
    'sales_credit', v_sales_credit,
    'sales_count', v_sales_count,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', v_expected
  );
end;
$$;

-- 8. RPC: Arqueo Ciego y Cierre de Turno (Cierre X o Z)
create or replace function public.caja_arqueo_ciego(
  p_shift_id uuid,
  p_counted_cash numeric,
  p_notes text default null,
  p_denominations jsonb default '[]'::jsonb,
  p_is_final boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_co uuid := public._ctx(null);
  v_user uuid := auth.uid();
  v_shift public.cash_shifts%rowtype;
  v_sales_cash numeric := 0;
  v_sales_card numeric := 0;
  v_sales_transfer numeric := 0;
  v_sales_credit numeric := 0;
  v_sales_count int := 0;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected numeric := 0;
  v_diff numeric := 0;
  v_stage text := case when p_is_final then 'cierre_z' else 'cierre_x' end;
  v_item jsonb;
  v_subtotal numeric;
begin
  select * into v_shift
  from public.cash_shifts
  where id = p_shift_id and company_id = v_co;

  if v_shift.id is null then
    raise exception 'Turno de caja no encontrado';
  end if;

  -- Calcular totales exactos
  select
    coalesce(sum(case when payment_method = 'efectivo' then total else 0 end), 0),
    coalesce(sum(case when payment_method = 'tarjeta' then total else 0 end), 0),
    coalesce(sum(case when payment_method = 'transferencia' then total else 0 end), 0),
    coalesce(sum(case when payment_method = 'fiado' then total else 0 end), 0),
    count(*)
  into
    v_sales_cash,
    v_sales_card,
    v_sales_transfer,
    v_sales_credit,
    v_sales_count
  from public.sales
  where company_id = v_co
    and (shift_id = v_shift.id or (shift_id is null and seller_id = v_shift.cashier_id and created_at >= v_shift.opened_at))
    and status = 'completada';

  select
    coalesce(sum(case when type = 'ingreso' and reference_type <> 'caja_apertura' and reference_type <> 'sale' then amount else 0 end), 0),
    coalesce(sum(case when type = 'egreso' then amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.cash_entries
  where company_id = v_co
    and (shift_id = v_shift.id or (created_at >= v_shift.opened_at and (reference_type is null or reference_type <> 'arqueo')));

  v_expected := v_shift.opening_amount + v_sales_cash + v_cash_in - v_cash_out;
  v_diff := coalesce(p_counted_cash, 0) - v_expected;

  -- Guardar denominaciones contadas
  if p_denominations is not null and jsonb_typeof(p_denominations) = 'array' then
    delete from public.cash_shift_denominations where shift_id = p_shift_id and stage = v_stage;
    for v_item in select * from jsonb_array_elements(p_denominations) loop
      v_subtotal := coalesce((v_item->>'quantity')::int, 0) * coalesce((v_item->>'denomination')::numeric, 0);
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
        p_shift_id,
        v_stage,
        (v_item->>'denomination')::numeric,
        coalesce(v_item->>'kind', 'billete'),
        coalesce((v_item->>'quantity')::int, 0),
        v_subtotal
      );
    end loop;
  end if;

  -- Si es cierre final (Z), actualizar turno a cerrado
  if p_is_final then
    update public.cash_shifts
    set
      status = 'closed',
      closing_type = 'cierre_z',
      closed_at = now(),
      expected_cash = v_expected,
      counted_cash = p_counted_cash,
      cash_difference = v_diff,
      total_sales_cash = v_sales_cash,
      total_sales_card = v_sales_card,
      total_sales_transfer = v_sales_transfer,
      total_sales_credit = v_sales_credit,
      total_sales_count = v_sales_count,
      total_cash_in = v_cash_in,
      total_cash_out = v_cash_out,
      notes = coalesce(p_notes, notes),
      updated_at = now()
    where id = p_shift_id;

    -- Registrar diferencia en cash_entries si hay faltante o sobrante
    if v_diff <> 0 then
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
        case when v_diff > 0 then 'ingreso' else 'egreso' end,
        abs(v_diff),
        'Ajuste por arqueo de caja (' || case when v_diff > 0 then 'Sobrante' else 'Faltante' end || ') - Turno ' || left(p_shift_id::text, 8),
        'arqueo',
        p_shift_id,
        p_shift_id
      );
    end if;

    -- Asentar en cash_closings para mantener retrocompatibilidad
    insert into public.cash_closings (
      company_id,
      closed_by,
      closed_by_name,
      opening_balance,
      income,
      expense,
      expected,
      counted,
      difference,
      notes,
      closed_at
    ) values (
      v_co,
      v_user,
      v_shift.cashier_name,
      v_shift.opening_amount,
      v_sales_cash + v_cash_in,
      v_cash_out,
      v_expected,
      p_counted_cash,
      v_diff,
      p_notes,
      now()
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'stage', v_stage,
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', v_diff,
    'status', case when p_is_final then 'closed' else 'open' end,
    'sales_cash', v_sales_cash,
    'sales_card', v_sales_card,
    'sales_transfer', v_sales_transfer,
    'sales_credit', v_sales_credit,
    'sales_count', v_sales_count,
    'message', case when p_is_final then 'Cierre Z de turno guardado exitosamente' else 'Arqueo parcial X guardado' end
  );
end;
$$;

-- 9. RPC: Contabilización Automática NIIF de Venta en acc_entries y acc_lines
create or replace function public.contabilizar_venta_automatica(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_co uuid := public._ctx(null);
  v_sale public.sales%rowtype;
  v_settings public.acc_settings%rowtype;
  v_entry_id uuid;
  v_num text;
  v_caja_id uuid;
  v_bancos_id uuid;
  v_cxc_id uuid;
  v_ingreso_id uuid;
  v_iva_id uuid;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_subtotal numeric;
begin
  select * into v_sale from public.sales where id = p_sale_id and company_id = v_co;
  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'reason', 'Venta no encontrada');
  end if;

  -- Comprobar si ya existe asiento para esta venta
  if exists (select 1 from public.acc_entries where company_id = v_co and source_type = 'venta' and source_id = p_sale_id) then
    return jsonb_build_object('ok', true, 'already_posted', true);
  end if;

  -- Buscar cuentas PUC correspondientes
  select id into v_caja_id from public.acc_accounts where company_id = v_co and code like '1105%' and is_postable = true limit 1;
  select id into v_bancos_id from public.acc_accounts where company_id = v_co and code like '1110%' and is_postable = true limit 1;
  select id into v_cxc_id from public.acc_accounts where company_id = v_co and code like '1305%' and is_postable = true limit 1;
  select id into v_ingreso_id from public.acc_accounts where company_id = v_co and code like '4135%' and is_postable = true limit 1;
  select id into v_iva_id from public.acc_accounts where company_id = v_co and code like '2408%' and is_postable = true limit 1;

  -- Si no existen cuentas NIIF creadas para esta empresa, salimos de forma segura
  if v_ingreso_id is null or (v_caja_id is null and v_bancos_id is null and v_cxc_id is null) then
    return jsonb_build_object('ok', false, 'reason', 'Plan de cuentas NIIF incompleto para contabilización');
  end if;

  v_num := 'V-' || to_char(coalesce(v_sale.created_at, now()), 'YYYYMMDD') || '-' || left(v_sale.id::text, 6);
  v_tax_amount := coalesce(v_sale.tax_amount, 0);
  v_subtotal := v_sale.total - v_tax_amount;

  -- Crear cabecera de comprobante contable
  insert into public.acc_entries (
    company_id,
    number,
    entry_date,
    description,
    source_type,
    source_id,
    status
  ) values (
    v_co,
    v_num,
    coalesce(v_sale.created_at, now())::date,
    'Facturación venta ' || coalesce(v_sale.customer_name, 'Consumidor Final'),
    'venta',
    p_sale_id,
    'contabilizado'
  )
  returning id into v_entry_id;

  -- Línea Débito: Activo según medio de pago
  if v_sale.payment_method = 'efectivo' and v_caja_id is not null then
    insert into public.acc_lines (company_id, entry_id, account_id, debit, credit, description)
    values (v_co, v_entry_id, v_caja_id, v_sale.total, 0, 'Ingreso efectivo caja');
  elsif (v_sale.payment_method in ('tarjeta', 'transferencia')) and (v_bancos_id is not null or v_caja_id is not null) then
    insert into public.acc_lines (company_id, entry_id, account_id, debit, credit, description)
    values (v_co, v_entry_id, coalesce(v_bancos_id, v_caja_id), v_sale.total, 0, 'Cobro bancario / pasarela');
  elsif v_sale.payment_method = 'fiado' and v_cxc_id is not null then
    insert into public.acc_lines (company_id, entry_id, account_id, debit, credit, description)
    values (v_co, v_entry_id, v_cxc_id, v_sale.total, 0, 'Cuenta por cobrar cliente ' || coalesce(v_sale.customer_name, ''));
  else
    insert into public.acc_lines (company_id, entry_id, account_id, debit, credit, description)
    values (v_co, v_entry_id, coalesce(v_caja_id, v_bancos_id), v_sale.total, 0, 'Recaudo de venta');
  end if;

  -- Línea Crédito: Ingresos operacionales
  insert into public.acc_lines (company_id, entry_id, account_id, debit, credit, description)
  values (v_co, v_entry_id, v_ingreso_id, 0, v_subtotal, 'Ingreso por ventas');

  -- Línea Crédito: IVA por pagar si aplica
  if v_tax_amount > 0 and v_iva_id is not null then
    insert into public.acc_lines (company_id, entry_id, account_id, debit, credit, description)
    values (v_co, v_entry_id, v_iva_id, 0, v_tax_amount, 'IVA generado en venta');
  end if;

  return jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'number', v_num);
end;
$$;

grant execute on function public.caja_abrir_turno(numeric, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.caja_obtener_turno_activo() to authenticated, service_role;
grant execute on function public.caja_arqueo_ciego(uuid, numeric, text, jsonb, boolean) to authenticated, service_role;
grant execute on function public.contabilizar_venta_automatica(uuid) to authenticated, service_role;

-- 10. Pie de Registro Oficial en sql_migration_log
select public.sql_registrar_migracion(
  '20261110000053_consolidacion_ciclo_comercial_caja_turnos_y_contabilidad',
  'Consolidación ciclo comercial, turnos de caja y contabilidad NIIF',
  '20261110000053_consolidacion_ciclo_comercial_caja_turnos_y_contabilidad.sql'
);
