
-- ============================================================================
-- INVENTARIOPRO
-- 000056: HISTORIAL INMUTABLE DE ARQUEOS X Y CIERRES Z
-- Requiere la migración 000055 previamente aplicada.
-- No reconstruye la lógica de cálculo ni duplica cash_closings.
-- ============================================================================

begin;

create table public.cash_shift_arqueos (
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

create index idx_cash_shift_arqueos_company_created
on public.cash_shift_arqueos(company_id, created_at desc);

create index idx_cash_shift_arqueos_shift_created
on public.cash_shift_arqueos(shift_id, created_at desc);

create index idx_cash_shift_arqueos_cashier_created
on public.cash_shift_arqueos(shift_cashier_id, created_at desc);

-- Seguridad: lectura limitada a la empresa, al cajero titular
-- o a los supervisores autorizados.

alter table public.cash_shift_arqueos enable row level security;

create policy cash_shift_arqueos_read_authorized
on public.cash_shift_arqueos
for select
to authenticated
using (
  company_id = public._ctx(null)
  and exists (
    select 1
    from public.cash_shifts s
    where s.id = cash_shift_arqueos.shift_id
      and s.company_id = cash_shift_arqueos.company_id
      and (
        s.cashier_id = (select auth.uid())
        or public.is_manager()
      )
  )
);

-- Nadie desde el cliente puede insertar, modificar o borrar
-- registros históricos directamente. La RPC SECURITY DEFINER
-- es la encargada de insertar los eventos.

revoke all privileges on table public.cash_shift_arqueos
from anon, public, authenticated, service_role;

grant select on table public.cash_shift_arqueos
to authenticated, service_role;

-- ============================================================================
-- PARCHE MÍNIMO A LA RPC EXISTENTE
-- Conserva su definición y todos sus cálculos.
-- Exige que 000055 ya haya corregido el filtro de movimientos.
-- ============================================================================

do $migration$
declare
  v_definition text;

  v_old_filter text :=
    $old$and (shift_id = v_shift.id or (created_at >= v_shift.opened_at and (reference_type is null or reference_type <> 'arqueo')));$old$;

  v_new_filter text :=
    $new$and shift_id = v_shift.id;$new$;

  v_decl_marker text :=
    $decl$v_subtotal numeric;$decl$;

  v_hook text :=
    $hook$  -- Si es cierre final (Z), actualizar turno a cerrado y registrar movimientos$hook$;

  v_return_marker text :=
    $ret$    'stage', v_stage,$ret$;

  v_insert_block text :=
    $insert$
  -- HISTORIAL_ARQUEO_INSERT
  -- Registro histórico independiente del arqueo X o Z.
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
    coalesce(
      nullif(v_profile.full_name, ''),
      nullif(v_profile.email, ''),
      'Usuario'
    ),
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

    case
      when p_denominations is not null
       and jsonb_typeof(p_denominations) = 'array'
      then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'denomination', d.denomination,
            'kind', d.kind,
            'quantity', d.quantity,
            'subtotal', d.subtotal
          )
          order by d.kind, d.denomination
        )
        from public.cash_shift_denominations d
        where d.company_id = v_co
          and d.shift_id = p_shift_id
          and d.stage = v_stage
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  )
  returning id into v_arqueo_id;
    $insert$;

begin

  select pg_get_functiondef(
    'public.caja_arqueo_ciego(uuid,numeric,text,jsonb,boolean)'::regprocedure
  )
  into v_definition;

  -- No permitir aplicar 000056 antes de 000055.

  if position(v_old_filter in v_definition) > 0
     or position(v_new_filter in v_definition) = 0 then
    raise exception
      'Primero debe aplicarse correctamente la migración 000055';
  end if;

  -- Validar los puntos de inserción antes de modificar la RPC.

  if position(v_decl_marker in v_definition) = 0 then
    raise exception 'No se encontró la declaración esperada';
  end if;

  if position(v_hook in v_definition) = 0 then
    raise exception 'No se encontró el punto de inserción del historial';
  end if;

  if position(v_return_marker in v_definition) = 0 then
    raise exception 'No se encontró el punto de retorno de la RPC';
  end if;

  if position('v_arqueo_id uuid;' in v_definition) > 0 then
    raise exception 'La RPC ya contiene la variable del historial';
  end if;

  -- Agregar únicamente la variable de identificación histórica.

  v_definition := replace(
    v_definition,
    v_decl_marker,
    v_decl_marker || E'\n  v_arqueo_id uuid;'
  );

  -- Insertar el evento después de guardar las denominaciones
  -- y antes de ejecutar el cierre Z.

  v_definition := replace(
    v_definition,
    v_hook,
    v_insert_block || E'\n' || v_hook
  );

  -- Devolver el identificador del evento al comprobante del POS.

  v_definition := replace(
    v_definition,
    v_return_marker,
    $ret2$    'arqueo_id', v_arqueo_id,$ret2$ || E'\n' || v_return_marker
  );

  if position('HISTORIAL_ARQUEO_INSERT' in v_definition) = 0
     or position('arqueo_id' in v_definition) = 0 then
    raise exception 'El parche histórico quedó incompleto';
  end if;

  execute v_definition;

end
$migration$;

commit;
