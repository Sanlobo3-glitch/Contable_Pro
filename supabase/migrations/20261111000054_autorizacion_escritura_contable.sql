-- supabase/migrations/20261111000054_autorizacion_escritura_contable.sql
-- Autorización controlada de escritura contable para el rol 'contador'
-- Permite a 'contador', 'dueno', 'admin_empresa' y 'gerente' crear borradores y contabilizar asientos
-- en el modelo oficial acc_* mediante acc_create_entry y acc_post_entry.
-- Conserva acc_reverse_entry y acc_close_period restringidos exclusivamente a la gerencia (is_manager()).

-- 1. Función de autorización de escritura contable
create or replace function public.can_write_accounting()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.company_id is not null
      and p.role in ('dueno', 'admin_empresa', 'gerente', 'contador')
  );
$$;

comment on function public.can_write_accounting() is 'Determina si el usuario autenticado tiene permisos de escritura contable (creación de borradores y contabilización de asientos): dueno, admin_empresa, gerente, contador.';

revoke all on function public.can_write_accounting() from public;
grant execute on function public.can_write_accounting() to authenticated;
grant execute on function public.can_write_accounting() to service_role;

-- 2. Actualizar acc_create_entry para utilizar can_write_accounting()
create or replace function public.acc_create_entry(
  p_date date,
  p_description text,
  p_lines jsonb,
  p_post boolean default false,
  p_source_type text default 'manual'::text,
  p_source_id uuid default null::uuid,
  p_event text default 'registro'::text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_c uuid := public.my_company();
  v_id uuid;
  v_l jsonb;
begin
  if not public.can_write_accounting() or v_c is null then
    raise exception 'No autorizado';
  end if;

  if p_source_type not in ('manual', 'ajuste') then
    raise exception 'Tipo de origen no permitido';
  end if;

  if p_source_id is not null then
    select id into v_id from public.acc_entries
    where company_id = v_c and source_type = p_source_type and source_id = p_source_id and source_event = p_event;
    if found then return v_id; end if;
  end if;

  if p_date is null or coalesce(btrim(p_description), '') = '' then
    raise exception 'La fecha y la descripción son obligatorias';
  end if;

  if not public.acc_period_is_open(v_c, p_date) then
    raise exception 'El periodo de esa fecha está cerrado';
  end if;

  insert into public.acc_entries (company_id, number, entry_date, description, source_type, source_id, source_event, created_by)
  values (v_c, public.acc_next_number(v_c, 'diario'), p_date, btrim(p_description),
          p_source_type, p_source_id, p_event, auth.uid())
  returning id into v_id;

  for v_l in select * from jsonb_array_elements(p_lines) loop
    insert into public.acc_lines (entry_id, company_id, account_id, debit, credit, memo)
    values (v_id, v_c, (v_l->>'account_id')::uuid, coalesce((v_l->>'debit')::numeric, 0),
            coalesce((v_l->>'credit')::numeric, 0), nullif(v_l->>'memo', ''));
  end loop;

  if p_post then
    perform public.acc_post_entry(v_id);
  end if;

  return v_id;
end;
$$;

revoke all on function public.acc_create_entry(date, text, jsonb, boolean, text, uuid, text) from public;
grant execute on function public.acc_create_entry(date, text, jsonb, boolean, text, uuid, text) to authenticated;
grant execute on function public.acc_create_entry(date, text, jsonb, boolean, text, uuid, text) to service_role;

-- 3. Actualizar acc_post_entry para utilizar can_write_accounting()
create or replace function public.acc_post_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.can_write_accounting() then
    raise exception 'No autorizado';
  end if;

  update public.acc_entries
  set status = 'contabilizado',
      posted_by = auth.uid()
  where id = p_entry_id
    and company_id = public.my_company()
    and status = 'borrador';

  if not found then
    raise exception 'El asiento no existe o ya no es un borrador';
  end if;
end;
$$;

revoke all on function public.acc_post_entry(uuid) from public;
grant execute on function public.acc_post_entry(uuid) to authenticated;
grant execute on function public.acc_post_entry(uuid) to service_role;

-- 4. Pie de registro obligatorio en sql_migration_log
select public.sql_registrar_migracion(
  '20261111000054_autorizacion_escritura_contable',
  'Autorización de escritura contable para el rol Contador',
  '20261111000054_autorizacion_escritura_contable.sql'
);
