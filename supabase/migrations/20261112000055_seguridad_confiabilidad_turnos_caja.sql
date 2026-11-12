
-- 20261112000055_seguridad_confiabilidad_turnos_caja.sql
-- Fase 3A: seguridad y confiabilidad del ciclo de caja.
-- No modifica ventas, cartera ni el libro contable acc_*.

begin;

-- 1. Solo contar movimientos de caja asociados explícitamente al turno.
do $migration$
declare
  v_definition text;
  v_old text := $old$and (shift_id = v_shift.id or (created_at >= v_shift.opened_at and (reference_type is null or reference_type <> 'arqueo')));$old$;
  v_new text := $new$and shift_id = v_shift.id;$new$;
  v_function regprocedure;
begin
  foreach v_function in array array[
    'public.caja_obtener_turno_activo()'::regprocedure,
    'public.caja_arqueo_ciego(uuid,numeric,text,jsonb,boolean)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_function::oid) into v_definition;

    if position(v_old in v_definition) = 0 then
      raise exception
        'Se aborta la migración: no se encontró el fragmento esperado en %',
        v_function;
    end if;

    v_definition := replace(v_definition, v_old, v_new);

    if position(v_old in v_definition) > 0 then
      raise exception
        'Se aborta la migración: quedó una condición antigua en %',
        v_function;
    end if;

    execute v_definition;
  end loop;
end
$migration$;

-- 2. Lectura limitada al cajero titular o a supervisores.
-- Las escrituras se realizan exclusivamente mediante las RPC SECURITY DEFINER.

drop policy if exists cash_shifts_company_isolate on public.cash_shifts;
drop policy if exists cash_shifts_owner_or_manager on public.cash_shifts;
drop policy if exists cash_shifts_read_owner_or_manager on public.cash_shifts;

create policy cash_shifts_read_owner_or_manager
on public.cash_shifts
for select
to authenticated
using (
  company_id = public._ctx(null)
  and (cashier_id = (select auth.uid()) or public.is_manager() or public.is_platform_admin())
);

drop policy if exists cash_shift_denoms_company_isolate on public.cash_shift_denominations;
drop policy if exists cash_shift_denoms_owner_or_manager on public.cash_shift_denominations;
drop policy if exists cash_shift_denoms_read_owner_or_manager on public.cash_shift_denominations;

create policy cash_shift_denoms_read_owner_or_manager
on public.cash_shift_denominations
for select
to authenticated
using (
  company_id = public._ctx(null)
  and exists (
    select 1
    from public.cash_shifts s
    where s.id = cash_shift_denominations.shift_id
      and s.company_id = cash_shift_denominations.company_id
      and (s.cashier_id = (select auth.uid()) or public.is_manager() or public.is_platform_admin())
  )
);

-- El cliente autenticado conserva lectura, pero no puede escribir directamente.
-- Las RPC SECURITY DEFINER realizan las escrituras autorizadas.
revoke all privileges on table
  public.cash_shifts,
  public.cash_shift_denominations
from authenticated;

grant select on table
  public.cash_shifts,
  public.cash_shift_denominations
to authenticated;

-- 3. Retirar privilegios directos del rol anon y PUBLIC.
-- Se conservan los privilegios de authenticated.

revoke all privileges on table
  public.cash_shifts,
  public.cash_shift_denominations,
  public.sale_payments
from anon, public;

-- 4. Las RPC de caja solo pueden invocarse desde sesiones
-- autenticadas o service_role.

revoke all privileges on function
  public.caja_abrir_turno(numeric, uuid, text, jsonb)
from public, anon;

revoke all privileges on function
  public.caja_obtener_turno_activo()
from public, anon;

revoke all privileges on function
  public.caja_arqueo_ciego(uuid, numeric, text, jsonb, boolean)
from public, anon;

grant execute on function
  public.caja_abrir_turno(numeric, uuid, text, jsonb)
to authenticated, service_role;

grant execute on function
  public.caja_obtener_turno_activo()
to authenticated, service_role;

grant execute on function
  public.caja_arqueo_ciego(uuid, numeric, text, jsonb, boolean)
to authenticated, service_role;

-- 5. Search path explícito para las funciones SECURITY DEFINER.

alter function public.caja_abrir_turno(numeric, uuid, text, jsonb)
  set search_path = pg_catalog, public, pg_temp;

alter function public.caja_obtener_turno_activo()
  set search_path = pg_catalog, public, pg_temp;

alter function public.caja_arqueo_ciego(uuid, numeric, text, jsonb, boolean)
  set search_path = pg_catalog, public, pg_temp;


-- PATCH_ADMIN_PLATAFORMA_ARQUEO
-- El administrador de plataforma solo opera dentro de su empresa activa.
do $migration$
declare
  v_definition text;
  v_old text := $old$if v_shift.cashier_id <> v_user and not public.is_manager() then$old$;
  v_new text := $new$if v_shift.cashier_id <> v_user and not (public.is_manager() or public.is_platform_admin()) then$new$;
begin
  select pg_get_functiondef(
    'public.caja_arqueo_ciego(uuid,numeric,text,jsonb,boolean)'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'No se encontró la autorización original de caja_arqueo_ciego';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end
$migration$;

commit;

-- Verificación posterior:
-- select has_table_privilege('anon','public.cash_shifts','select');
-- select has_table_privilege('anon','public.cash_shift_denominations','select');
-- select has_table_privilege('anon','public.sale_payments','select');
-- select has_function_privilege('anon','public.caja_obtener_turno_activo()','execute');
-- select policyname, tablename, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname='public'
--   and tablename in ('cash_shifts','cash_shift_denominations');
