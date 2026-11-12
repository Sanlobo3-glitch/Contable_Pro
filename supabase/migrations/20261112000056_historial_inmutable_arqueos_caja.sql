
-- ============================================================================
-- INVENTARIOPRO
-- MIGRACION 000056: HISTORIAL INMUTABLE DE ARQUEOS X Y CIERRES Z
-- ============================================================================

begin;

create table if not exists public.cash_shift_arqueos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shift_id uuid not null references public.cash_shifts(id) on delete restrict,
  event_type text not null
    check (event_type in ('cierre_x', 'cierre_z')),
  performed_by uuid not null,
  performed_by_name text not null,
  shift_cashier_id uuid not null,
  shift_cashier_name text,
  opening_amount numeric not null default 0,
  sales_cash numeric not null default 0,
  sales_card numeric not null default 0,
  sales_transfer numeric not null default 0,
  sales_credit numeric not null default 0,
  sales_count integer not null default 0,
  cash_in numeric not null default 0,
  cash_out numeric not null default 0,
  expected_cash numeric not null,
  counted_cash numeric not null,
  difference numeric not null,
  notes text,
  denominations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(denominations) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists idx_cash_shift_arqueos_company_created
on public.cash_shift_arqueos(company_id, created_at desc);

create index if not exists idx_cash_shift_arqueos_shift_created
on public.cash_shift_arqueos(shift_id, created_at desc);

create index if not exists idx_cash_shift_arqueos_cashier_created
on public.cash_shift_arqueos(shift_cashier_id, created_at desc);

alter table public.cash_shift_arqueos enable row level security;

drop policy if exists cash_shift_arqueos_read_authorized
on public.cash_shift_arqueos;

create policy cash_shift_arqueos_read_authorized
on public.cash_shift_arqueos
for select
to authenticated
using (
  company_id = public._ctx(null)
  and (
    shift_cashier_id = (select auth.uid())
    or performed_by = (select auth.uid())
    or public.is_manager()
  )
);

revoke all privileges on table public.cash_shift_arqueos
from anon, public, authenticated;

grant select on table public.cash_shift_arqueos
to authenticated;

grant all privileges on table public.cash_shift_arqueos
to service_role;

-- ============================================================================
-- RPC DE ARQUEO CON REGISTRO HISTORICO
-- ============================================================================

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
set search_path to pg_catalog, public, pg_temp
as $function$

declare
  v_co uuid := public._ctx(null);
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
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

  v_stage text :=
    case when p_is_final then 'cierre_z' else 'cierre_x' end;

  v_item jsonb;
  v_subtotal numeric;
  v_denomination numeric;
  v_quantity int;
  v_kind text;

  v_denom_snapshot jsonb := '[]'::jsonb;
  v_arqueo_id uuid;

begin

  if v_co is null then
    raise exception 'No se pudo determinar la empresa en sesión';
  end if;

  if v_user is null then
    raise exception 'Usuario no autenticado';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_user
    and company_id = v_co
    and active = true;

  if v_profile.id is null then
    raise exception 'Perfil de usuario no activo o no pertenece a esta empresa';
  end if;

  select *
  into v_shift
  from public.cash_shifts
  where id = p_shift_id
    and company_id = v_co
  for update;

  if v_shift.id is null then
    raise exception 'Turno de caja no encontrado';
  end if;

  if v_shift.cashier_id <> v_user
     and not public.is_manager() then
    raise exception 'No tienes autorización para cerrar el turno de otro cajero';
  end if;

  -- Evitar duplicar un cierre Z ya realizado.
  if p_is_final and v_shift.status = 'closed' then
    return jsonb_build_object(
      'ok', true,
      'stage', 'cierre_z',
      'expected_cash', v_shift.expected_cash,
      'counted_cash', coalesce(v_shift.counted_cash, 0),
      'difference', coalesce(v_shift.cash_difference, 0),
      'status', 'closed',
      'sales_cash', coalesce(v_shift.total_sales_cash, 0),
      'sales_card', coalesce(v_shift.total_sales_card, 0),
      'sales_transfer', coalesce(v_shift.total_sales_transfer, 0),
      'sales_credit', coalesce(v_shift.total_sales_credit, 0),
      'sales_count', coalesce(v_shift.total_sales_count, 0),
      'already_closed', true,
      'message', 'El turno de caja ya se encontraba cerrado previamente'
    );
  end if;

  if v_shift.status <> 'open' then
    raise exception 'El turno ya está cerrado';
  end if;

  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'El monto contado no puede ser negativo ni estar vacío';
  end if;

  -- Calcular ventas del turno.
  with shift_sales as (
    select id, total, payment_method
    from public.sales
    where company_id = v_co
      and (
        shift_id = v_shift.id
        or (
          shift_id is null
          and seller_id = v_shift.cashier_id
          and created_at >= v_shift.opened_at
        )
      )
      and status = 'completada'
  ),

  sale_payments_agg as (
    select sp.sale_id, sp.method, sp.amount
    from public.sale_payments sp
    join shift_sales ss on ss.id = sp.sale_id
    where sp.company_id = v_co
  ),

  unified_payments as (
    select method, amount
    from sale_payments_agg

    union all

    select ss.payment_method, ss.total
    from shift_sales ss
    where not exists (
      select 1
      from sale_payments_agg spa
      where spa.sale_id = ss.id
    )
  )

  select
    coalesce(sum(case
      when method in ('efectivo', 'cash') then amount
      else 0 end), 0),

    coalesce(sum(case
      when method in ('tarjeta', 'card', 'datafono', 'datáfono')
      then amount else 0 end), 0),

    coalesce(sum(case
      when method in ('transferencia', 'transfer', 'nequi',
                      'daviplata', 'bancolombia')
      then amount else 0 end), 0),

    coalesce(sum(case
      when method in ('fiado', 'credito', 'crédito')
      then amount else 0 end), 0)

  into
    v_sales_cash,
    v_sales_card,
    v_sales_transfer,
    v_sales_credit

  from unified_payments;

  select count(*)
  into v_sales_count
  from public.sales
  where company_id = v_co
    and (
      shift_id = v_shift.id
      or (
        shift_id is null
        and seller_id = v_shift.cashier_id
        and created_at >= v_shift.opened_at
      )
    )
    and status = 'completada';

  -- Calcular ingresos y egresos del turno.
  select
    coalesce(sum(case
      when type = 'ingreso'
       and reference_type <> 'caja_apertura'
       and reference_type <> 'sale'
      then amount else 0 end), 0),

    coalesce(sum(case
      when type = 'egreso'
      then amount else 0 end), 0)

  into v_cash_in, v_cash_out

  from public.cash_entries

  where company_id = v_co
    and (
      shift_id = v_shift.id
      or (
        created_at >= v_shift.opened_at
        and (reference_type is null
             or reference_type <> 'arqueo')
      )
    );

  v_expected :=
    coalesce(v_shift.opening_amount, 0)
    + v_sales_cash
    + v_cash_in
    - v_cash_out;

  v_diff := p_counted_cash - v_expected;

  -- Guardar denominaciones operativas y copia histórica.
  if p_denominations is not null
     and jsonb_typeof(p_denominations) = 'array' then

    delete from public.cash_shift_denominations
    where shift_id = p_shift_id
      and stage = v_stage;

    for v_item in
      select * from jsonb_array_elements(p_denominations)
    loop

      v_denomination :=
        (v_item->>'denomination')::numeric;

      v_quantity :=
        coalesce((v_item->>'quantity')::int, 0);

      v_kind :=
        coalesce(v_item->>'kind', 'billete');

      v_subtotal :=
        greatest(v_quantity, 0) * v_denomination;

      if v_subtotal > 0 then

        insert into public.cash_shift_denominations (
          company_id,
          shift_id,
          stage,
          denomination,
          kind,
          quantity,
          subtotal
        )
        values (
          v_co,
          p_shift_id,
          v_stage,
          v_denomination,
          v_kind,
          v_quantity,
          v_subtotal
        );

        v_denom_snapshot :=
          v_denom_snapshot ||
          jsonb_build_array(
            jsonb_build_object(
              'denomination', v_denomination,
              'kind', v_kind,
              'quantity', v_quantity,
              'subtotal', v_subtotal
            )
          );

      end if;
    end loop;
  end if;

  -- Crear un evento histórico independiente.
  insert into public.cash_shift_arqueos (
    company_id,
    shift_id,
    event_type,
    performed_by,
    performed_by_name,
    shift_cashier_id,
    shift_cashier_name,
    opening_amount,
    sales_cash,
    sales_card,
    sales_transfer,
    sales_credit,
    sales_count,
    cash_in,
    cash_out,
    expected_cash,
    counted_cash,
    difference,
    notes,
    denominations
  )
  values (
    v_co,
    p_shift_id,
    v_stage,
    v_user,
    coalesce(v_profile.full_name, v_profile.email, 'Usuario'),
    v_shift.cashier_id,
    v_shift.cashier_name,
    coalesce(v_shift.opening_amount, 0),
    v_sales_cash,
    v_sales_card,
    v_sales_transfer,
    v_sales_credit,
    v_sales_count,
    v_cash_in,
    v_cash_out,
    v_expected,
    p_counted_cash,
    v_diff,
    p_notes,
    v_denom_snapshot
  )
  returning id into v_arqueo_id;

  -- Solo el cierre Z cierra el turno.
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

    if v_diff <> 0 then

      insert into public.cash_entries (
        company_id,
        type,
        amount,
        description,
        reference_type,
        reference_id,
        shift_id
      )
      values (
        v_co,
        case when v_diff > 0 then 'ingreso' else 'egreso' end,
        abs(v_diff),
        'Ajuste por arqueo de caja (' ||
          case when v_diff > 0
            then 'Sobrante' else 'Faltante' end ||
          ') - Turno ' || left(p_shift_id::text, 8),
        'arqueo',
        p_shift_id,
        p_shift_id
      );

    end if;

    -- Mantener compatibilidad con el historial actual de cierres.
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
    )
    values (
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
    'arqueo_id', v_arqueo_id,
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
    'message', case when p_is_final
      then 'Cierre Z de turno guardado exitosamente'
      else 'Arqueo parcial X guardado'
    end
  );

end;
$function$;

revoke all privileges on function
  public.caja_arqueo_ciego(uuid, numeric, text, jsonb, boolean)
from public, anon;

grant execute on function
  public.caja_arqueo_ciego(uuid, numeric, text, jsonb, boolean)
to authenticated, service_role;

commit;
