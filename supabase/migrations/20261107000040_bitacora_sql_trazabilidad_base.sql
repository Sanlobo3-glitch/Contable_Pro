-- ============================================================================
-- 20261107000040 · BITÁCORA SQL — BASE (ya aplicada en Supabase; reconstruida del esquema vivo el 2026-11-07)
-- Esta parte se aplicó en su día desde el SQL Editor y nunca quedó escrita en el repositorio.
-- Se reconstruye desde la base real para que el repo sea reproducible. Es idempotente.
-- Depende de: public.profiles. La usan: registro único (20261107000049) y el Centro SQL de la app.
-- ============================================================================

create table if not exists public.sql_migration_log (
  id uuid primary key default gen_random_uuid(),
  script_id text not null,
  script_title text not null,
  executed_by uuid references auth.users(id) on delete set null,
  executed_email text not null,
  status text not null default 'aplicado',
  summary text,
  statements_length integer not null default 0,
  executed_at timestamptz not null default now()
);

alter table public.sql_migration_log add column if not exists sql_text text;
alter table public.sql_migration_log add column if not exists sql_hash text;
alter table public.sql_migration_log add column if not exists error_message text;
alter table public.sql_migration_log add column if not exists duration_ms integer;
alter table public.sql_migration_log add column if not exists source text not null default 'desconocido';
alter table public.sql_migration_log add column if not exists migration_file text;
alter table public.sql_migration_log add column if not exists result_rows integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sql_migration_log_status_check') then
    alter table public.sql_migration_log
      add constraint sql_migration_log_status_check check (status = any (array['aplicado', 'error']));
  end if;
end $$;

create index if not exists idx_sql_migration_log_executed_at on public.sql_migration_log (executed_at desc);

alter table public.sql_migration_log enable row level security;

drop policy if exists sql_migration_log_select_admin on public.sql_migration_log;
create policy sql_migration_log_select_admin on public.sql_migration_log
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true
      and (p.role = 'admin' or lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com')
  ));

drop policy if exists sql_migration_log_insert_service on public.sql_migration_log;
create policy sql_migration_log_insert_service on public.sql_migration_log
  for insert to service_role
  with check (true);

-- Registro interno (solo service_role / funciones SECURITY DEFINER)
create or replace function public.registrar_ejecucion_sql(
  p_script_id text default 'manual',
  p_script_title text default 'Script administrativo',
  p_sql text default null,
  p_status text default 'aplicado',
  p_error_message text default null,
  p_duration_ms integer default null,
  p_source text default 'api',
  p_migration_file text default null,
  p_result_rows integer default null,
  p_executed_by uuid default null,
  p_executed_email text default null,
  p_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
DECLARE
  v_id     uuid;
  v_raw    text := coalesce(p_sql, '');
  v_len    integer := length(v_raw);
  v_sql    text := v_raw;
  v_hash   text := NULL;
  v_status text := lower(btrim(coalesce(p_status, 'aplicado')));
  v_by     uuid := p_executed_by;
  v_email  text := lower(btrim(coalesce(p_executed_email, '')));
BEGIN
  IF v_status NOT IN ('aplicado', 'error') THEN
    v_status := 'aplicado';
  END IF;

  IF v_raw <> '' THEN
    v_hash := encode(sha256(convert_to(v_raw, 'UTF8')), 'hex');
    IF v_len > 200000 THEN
      v_sql := left(v_raw, 200000) || E'\\n-- [truncado: 200000 caracteres]';
    END IF;
  END IF;

  -- Si el llamador no indica identidad, se toma la de la sesión.
  IF v_by IS NULL AND auth.uid() IS NOT NULL THEN
    v_by := auth.uid();
  END IF;
  IF v_email = '' AND auth.jwt() ->> 'email' IS NOT NULL THEN
    v_email := lower(btrim(auth.jwt() ->> 'email'));
  END IF;

  INSERT INTO public.sql_migration_log (
    script_id, script_title, executed_by, executed_email, status, summary, statements_length,
    sql_text, sql_hash, error_message, duration_ms, source, migration_file, result_rows
  )
  VALUES (
    left(coalesce(nullif(btrim(p_script_id), ''), 'manual'), 120),
    left(coalesce(nullif(btrim(p_script_title), ''), 'Script administrativo'), 200),
    v_by,
    coalesce(nullif(v_email, ''), 'desconocido'),
    v_status,
    left(coalesce(p_summary, ''), 500),
    v_len,
    nullif(v_sql, ''),
    v_hash,
    nullif(left(coalesce(p_error_message, ''), 2000), ''),
    p_duration_ms,
    left(coalesce(nullif(btrim(p_source), ''), 'desconocido'), 40),
    nullif(left(coalesce(nullif(btrim(p_migration_file), ''), ''), 200), ''),
    p_result_rows
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

revoke all on function public.registrar_ejecucion_sql(text, text, text, text, text, integer, text, text, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.registrar_ejecucion_sql(text, text, text, text, text, integer, text, text, integer, uuid, text, text) to service_role;

-- Registro de un fallo desde el cliente (un RAISE aborta la transacción, por eso el error se registra aparte)
create or replace function public.admin_registrar_ejecucion_sql(
  p_script_id text default 'manual',
  p_script_title text default 'Script administrativo',
  p_sql text default null,
  p_status text default 'aplicado',
  p_error_message text default null,
  p_source text default 'app_rpc',
  p_migration_file text default null,
  p_duration_ms integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_jwt_email     text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_profile_email text;
  v_id            uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para registrar ejecuciones SQL';
  END IF;

  SELECT lower(btrim(coalesce(p.email, '')))
  INTO v_profile_email
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = true;

  IF v_profile_email IS DISTINCT FROM 'sanlobo3@hotmail.com'
     OR (v_jwt_email <> '' AND v_jwt_email <> 'sanlobo3@hotmail.com') THEN
    RAISE EXCEPTION 'Seguridad: únicamente la cuenta maestra sanlobo3@hotmail.com está autorizada.';
  END IF;

  v_id := public.registrar_ejecucion_sql(
    p_script_id      => p_script_id,
    p_script_title   => p_script_title,
    p_sql            => p_sql,
    p_status         => p_status,
    p_error_message  => p_error_message,
    p_duration_ms    => p_duration_ms,
    p_source         => p_source,
    p_migration_file => p_migration_file,
    p_executed_by    => v_uid,
    p_executed_email => v_profile_email
  );

  RETURN v_id;
END;
$function$;

revoke all on function public.admin_registrar_ejecucion_sql(text, text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.admin_registrar_ejecucion_sql(text, text, text, text, text, text, text, integer) to authenticated;

-- Pie de registro (en esta base ya consta como 'backfill_reconstruido')
do $reg$
begin
  if to_regprocedure('public.sql_registrar_migracion(text,text,text,text,text)') is not null then
    perform public.sql_registrar_migracion('20261107000040_bitacora_sql_trazabilidad_base', 'Bitácora SQL base (reconstruida)', '20261107000040_bitacora_sql_trazabilidad_base.sql');
  end if;
end
$reg$;
