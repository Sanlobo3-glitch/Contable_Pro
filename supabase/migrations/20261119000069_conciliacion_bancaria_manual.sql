-- ============================================================================
-- MIGRACIÓN 20261119000069: CONCILIACIÓN BANCARIA MANUAL MULTICUENTA
-- 1. Cuentas bancarias vinculadas al PUC vigente (acc_accounts) sin duplicar catálogo
-- 2. Extractos bancarios manuales, contador atómico de códigos y renglones manuales
-- 3. Cruces manuales N-a-M / parciales contra acc_lines de acc_entries contabilizados
--    con separación estricta ingresos vs egresos e independencia de orden
-- 4. Bloqueo estricto de extractos confirmados (exige reapertura formal autorizada)
-- 5. Bitácora inmutable protegida por triggers + audit_log
-- 6. Aislamiento multiempresa compuesto, RLS explícita de solo lectura y permisos granulares
-- Idempotente · Sin BEGIN/COMMIT propios · Sin alterar helpers compartidos previos
-- ============================================================================

-- ============================================================================
-- 0. HELPERS INTERNOS EXCLUSIVOS DEL MÓDULO (SIN ALTERAR _require_company_roles)
-- ============================================================================

create or replace function public._bank_is_finite(p_val numeric)
returns boolean
language sql
immutable
as $function$
  select p_val is not null
     and p_val <> 'NaN'::numeric
     and p_val <> 'Infinity'::numeric
     and p_val <> '-Infinity'::numeric;
$function$;

create or replace function public._bank_require_roles(p_roles text[])
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_co uuid := public.current_company_id();
  v_ok boolean := false;
begin
  if v_uid is null or v_co is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.profiles pr
    join public.companies co on co.id = pr.company_id
    where pr.id = v_uid
      and pr.active = true
      and coalesce(co.active, true) = true
      and pr.company_id = v_co
      and (p_roles is null or lower(pr.role) = any(p_roles))
  ) into v_ok;

  if not v_ok then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return v_co;
end
$function$;

create or replace function public.can_access_bank_reconciliation()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.profiles p
    join public.companies co on co.id = p.company_id
    where p.id = (select auth.uid())
      and p.active = true
      and coalesce(co.active, true) = true
      and p.company_id is not null
      and p.company_id = (select public.current_company_id())
      and lower(p.role) in ('admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
  );
$function$;

revoke all on function public._bank_is_finite(numeric) from public, anon, authenticated;
revoke all on function public._bank_require_roles(text[]) from public, anon, authenticated;

-- ============================================================================
-- 1. TABLAS DE CONCILIACIÓN BANCARIA MANUAL E INTEGRIDAD COMPUESTA POR EMPRESA
-- ============================================================================

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  acc_account_id uuid not null references public.acc_accounts(id) on delete restrict,
  bank_name text not null,
  account_alias text not null,
  account_type text not null default 'ahorros' check (
    account_type in ('ahorros', 'corriente', 'billetera_digital', 'fiduciaria', 'otra')
  ),
  account_number_last4 text not null,
  account_number_masked text not null,
  currency text not null default 'COP',
  active boolean not null default true,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_bank_accounts_company_alias
  on public.bank_accounts (company_id, lower(bank_name), lower(account_alias));

create index if not exists idx_fk_bank_accounts_company
  on public.bank_accounts (company_id, active, bank_name);

create index if not exists idx_fk_bank_accounts_acc_account
  on public.bank_accounts (acc_account_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_bank_accounts_company_id_id'
  ) then
    alter table public.bank_accounts
      add constraint uq_bank_accounts_company_id_id unique (company_id, id);
  end if;
end
$$;

create table if not exists public.bank_statement_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_seq integer not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  statement_code text not null,
  period_start date not null,
  period_end date not null,
  cutoff_date date not null,
  opening_balance numeric(14,2) not null default 0,
  reported_closing_balance numeric(14,2),
  status text not null default 'pendiente' check (
    status in ('pendiente', 'parcialmente_conciliado', 'con_diferencia', 'conciliado', 'anulado')
  ),
  notes text,
  confirmed_by uuid,
  confirmed_by_name text,
  confirmed_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_statements_period_order check (period_end >= period_start),
  constraint bank_statements_cutoff_in_period check (cutoff_date >= period_start and cutoff_date <= period_end)
);

create unique index if not exists uq_bank_statements_company_code
  on public.bank_statements (company_id, statement_code);

create index if not exists idx_fk_bank_statements_company_cutoff
  on public.bank_statements (company_id, cutoff_date desc, created_at desc);

create index if not exists idx_fk_bank_statements_bank_account
  on public.bank_statements (bank_account_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_bank_statements_company_id_id'
  ) then
    alter table public.bank_statements
      add constraint uq_bank_statements_company_id_id unique (company_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_bank_statements_company_account'
  ) then
    alter table public.bank_statements
      add constraint fk_bank_statements_company_account
      foreign key (company_id, bank_account_id)
      references public.bank_accounts (company_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bank_statements_cutoff_in_period'
  ) then
    alter table public.bank_statements
      add constraint bank_statements_cutoff_in_period
      check (cutoff_date >= period_start and cutoff_date <= period_end);
  end if;
end
$$;

create table if not exists public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  statement_id uuid not null references public.bank_statements(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  line_number integer not null default 1 check (line_number > 0),
  tx_date date not null,
  post_date date,
  description text not null,
  bank_reference text,
  direction text not null check (direction in ('credit', 'debit')),
  amount numeric(14,2) not null check (amount > 0),
  reported_balance numeric(14,2),
  notes text,
  status text not null default 'pendiente' check (
    status in ('pendiente', 'parcialmente_conciliado', 'conciliado', 'con_diferencia', 'anulado')
  ),
  difference_reason text,
  source_origin text not null default 'manual' check (source_origin in ('manual', 'csv_manual')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fk_bank_stmt_lines_company_stmt
  on public.bank_statement_lines (company_id, statement_id, tx_date, line_number);

create index if not exists idx_fk_bank_stmt_lines_statement
  on public.bank_statement_lines (statement_id);

create index if not exists idx_fk_bank_stmt_lines_bank_account
  on public.bank_statement_lines (bank_account_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_bank_statement_lines_company_id_id'
  ) then
    alter table public.bank_statement_lines
      add constraint uq_bank_statement_lines_company_id_id unique (company_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_bank_stmt_lines_company_stmt'
  ) then
    alter table public.bank_statement_lines
      add constraint fk_bank_stmt_lines_company_stmt
      foreign key (company_id, statement_id)
      references public.bank_statements (company_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_bank_stmt_lines_company_account'
  ) then
    alter table public.bank_statement_lines
      add constraint fk_bank_stmt_lines_company_account
      foreign key (company_id, bank_account_id)
      references public.bank_accounts (company_id, id)
      on delete restrict;
  end if;
end
$$;

create table if not exists public.bank_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  statement_id uuid not null references public.bank_statements(id) on delete cascade,
  statement_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  acc_line_id uuid not null references public.acc_lines(id) on delete restrict,
  acc_entry_id uuid not null references public.acc_entries(id) on delete restrict,
  match_group_id uuid not null default gen_random_uuid(),
  matched_amount numeric(14,2) not null check (matched_amount > 0),
  status text not null default 'activo' check (status in ('activo', 'anulado')),
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  voided_by uuid,
  voided_by_name text,
  voided_at timestamptz,
  void_reason text
);

create unique index if not exists uq_bank_recon_active_pair
  on public.bank_reconciliation_matches (statement_line_id, acc_line_id)
  where status = 'activo';

create index if not exists idx_fk_bank_recon_matches_company_stmt
  on public.bank_reconciliation_matches (company_id, statement_id, status);

create index if not exists idx_fk_bank_recon_matches_stmt_line
  on public.bank_reconciliation_matches (statement_line_id);

create index if not exists idx_fk_bank_recon_matches_acc_line
  on public.bank_reconciliation_matches (acc_line_id);

create index if not exists idx_fk_bank_recon_matches_acc_entry
  on public.bank_reconciliation_matches (acc_entry_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_bank_recon_matches_company_stmt'
  ) then
    alter table public.bank_reconciliation_matches
      add constraint fk_bank_recon_matches_company_stmt
      foreign key (company_id, statement_id)
      references public.bank_statements (company_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fk_bank_recon_matches_company_line'
  ) then
    alter table public.bank_reconciliation_matches
      add constraint fk_bank_recon_matches_company_line
      foreign key (company_id, statement_line_id)
      references public.bank_statement_lines (company_id, id)
      on delete restrict;
  end if;
end
$$;

create table if not exists public.bank_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  statement_id uuid references public.bank_statements(id) on delete set null,
  action text not null,
  actor_id uuid,
  actor_name text,
  actor_role text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_fk_bank_recon_events_company_created
  on public.bank_reconciliation_events (company_id, created_at desc);

create index if not exists idx_fk_bank_recon_events_bank_account
  on public.bank_reconciliation_events (bank_account_id);

create index if not exists idx_fk_bank_recon_events_statement
  on public.bank_reconciliation_events (statement_id);

-- ============================================================================
-- 1B. TRIGGERS DE INTEGRIDAD MULTIEMPRESA E INMUTABILIDAD DE AUDITORÍA
-- ============================================================================

create or replace function public._bank_enforce_cross_table_company()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_acc_co uuid;
  v_stmt_co uuid;
  v_stmt_acc uuid;
  v_line_co uuid;
  v_line_stmt uuid;
  v_al_co uuid;
  v_al_entry uuid;
  v_ae_co uuid;
begin
  if tg_table_name = 'bank_accounts' then
    select a.company_id into v_acc_co
      from public.acc_accounts a
     where a.id = new.acc_account_id;
    if v_acc_co is null or v_acc_co is distinct from new.company_id then
      raise exception 'Aislamiento multiempresa: acc_account_id no pertenece a la empresa %', new.company_id using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'bank_statements' then
    select ba.company_id into v_acc_co
      from public.bank_accounts ba
     where ba.id = new.bank_account_id;
    if v_acc_co is null or v_acc_co is distinct from new.company_id then
      raise exception 'Aislamiento multiempresa: bank_account_id no pertenece a la empresa %', new.company_id using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'bank_statement_lines' then
    select bs.company_id, bs.bank_account_id
      into v_stmt_co, v_stmt_acc
      from public.bank_statements bs
     where bs.id = new.statement_id;
    if v_stmt_co is null or v_stmt_co is distinct from new.company_id or v_stmt_acc is distinct from new.bank_account_id then
      raise exception 'Aislamiento multiempresa: statement_id o bank_account_id inconsistente en bank_statement_lines' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'bank_reconciliation_matches' then
    select bs.company_id into v_stmt_co
      from public.bank_statements bs
     where bs.id = new.statement_id;
    select bsl.company_id, bsl.statement_id
      into v_line_co, v_line_stmt
      from public.bank_statement_lines bsl
     where bsl.id = new.statement_line_id;
    select al.company_id, al.entry_id
      into v_al_co, v_al_entry
      from public.acc_lines al
     where al.id = new.acc_line_id;
    select ae.company_id
      into v_ae_co
      from public.acc_entries ae
     where ae.id = new.acc_entry_id;

    if v_stmt_co is distinct from new.company_id
       or v_line_co is distinct from new.company_id
       or v_line_stmt is distinct from new.statement_id
       or v_al_co is distinct from new.company_id
       or v_al_entry is distinct from new.acc_entry_id
       or v_ae_co is distinct from new.company_id then
      raise exception 'Aislamiento multiempresa: inconsistencia entre extracto, línea bancaria y asiento contable' using errcode = '23514';
    end if;
    return new;
  end if;

  return new;
end
$function$;

create or replace function public._bank_block_events_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  raise exception 'Inmutabilidad de auditoría: los registros de bank_reconciliation_events no pueden modificarse ni eliminarse (%).', tg_op
    using errcode = '42501';
end
$function$;

revoke all on function public._bank_enforce_cross_table_company() from public, anon, authenticated;
revoke all on function public._bank_block_events_mutation() from public, anon, authenticated;

drop trigger if exists trg_bank_accounts_company_guard on public.bank_accounts;
create trigger trg_bank_accounts_company_guard
  before insert or update on public.bank_accounts
  for each row execute function public._bank_enforce_cross_table_company();

drop trigger if exists trg_bank_statements_company_guard on public.bank_statements;
create trigger trg_bank_statements_company_guard
  before insert or update on public.bank_statements
  for each row execute function public._bank_enforce_cross_table_company();

drop trigger if exists trg_bank_statement_lines_company_guard on public.bank_statement_lines;
create trigger trg_bank_statement_lines_company_guard
  before insert or update on public.bank_statement_lines
  for each row execute function public._bank_enforce_cross_table_company();

drop trigger if exists trg_bank_recon_matches_company_guard on public.bank_reconciliation_matches;
create trigger trg_bank_recon_matches_company_guard
  before insert or update on public.bank_reconciliation_matches
  for each row execute function public._bank_enforce_cross_table_company();

drop trigger if exists trg_bank_recon_events_immutable on public.bank_reconciliation_events;
create trigger trg_bank_recon_events_immutable
  before update or delete on public.bank_reconciliation_events
  for each row execute function public._bank_block_events_mutation();

-- ============================================================================
-- 2. RLS EXPLÍCITA Y PRIVILEGIOS ESTRICTOS (SOLO SELECT VIA RLS; SIN LOOP CIEGO)
-- ============================================================================

alter table public.bank_accounts enable row level security;
alter table public.bank_statements enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.bank_reconciliation_matches enable row level security;
alter table public.bank_reconciliation_events enable row level security;
alter table public.bank_statement_counters enable row level security;

-- bank_accounts
drop policy if exists bank_accounts_select on public.bank_accounts;
create policy bank_accounts_select
  on public.bank_accounts for select to authenticated
  using (company_id = (select public.current_company_id()) and public.can_access_bank_reconciliation());

drop policy if exists support_read_bank_accounts on public.bank_accounts;
create policy support_read_bank_accounts
  on public.bank_accounts for select to authenticated
  using (
    public.support_has_active_authorization(company_id, 'accounting', 'lectura_diagnostico')
    or public.support_has_active_authorization(company_id, 'accounting', 'intervencion_asistida')
  );

-- bank_statements
drop policy if exists bank_statements_select on public.bank_statements;
create policy bank_statements_select
  on public.bank_statements for select to authenticated
  using (company_id = (select public.current_company_id()) and public.can_access_bank_reconciliation());

drop policy if exists support_read_bank_statements on public.bank_statements;
create policy support_read_bank_statements
  on public.bank_statements for select to authenticated
  using (
    public.support_has_active_authorization(company_id, 'accounting', 'lectura_diagnostico')
    or public.support_has_active_authorization(company_id, 'accounting', 'intervencion_asistida')
  );

-- bank_statement_lines
drop policy if exists bank_statement_lines_select on public.bank_statement_lines;
create policy bank_statement_lines_select
  on public.bank_statement_lines for select to authenticated
  using (company_id = (select public.current_company_id()) and public.can_access_bank_reconciliation());

drop policy if exists support_read_bank_statement_lines on public.bank_statement_lines;
create policy support_read_bank_statement_lines
  on public.bank_statement_lines for select to authenticated
  using (
    public.support_has_active_authorization(company_id, 'accounting', 'lectura_diagnostico')
    or public.support_has_active_authorization(company_id, 'accounting', 'intervencion_asistida')
  );

-- bank_reconciliation_matches
drop policy if exists bank_reconciliation_matches_select on public.bank_reconciliation_matches;
create policy bank_reconciliation_matches_select
  on public.bank_reconciliation_matches for select to authenticated
  using (company_id = (select public.current_company_id()) and public.can_access_bank_reconciliation());

drop policy if exists support_read_bank_reconciliation_matches on public.bank_reconciliation_matches;
create policy support_read_bank_reconciliation_matches
  on public.bank_reconciliation_matches for select to authenticated
  using (
    public.support_has_active_authorization(company_id, 'accounting', 'lectura_diagnostico')
    or public.support_has_active_authorization(company_id, 'accounting', 'intervencion_asistida')
  );

-- bank_reconciliation_events
drop policy if exists bank_reconciliation_events_select on public.bank_reconciliation_events;
create policy bank_reconciliation_events_select
  on public.bank_reconciliation_events for select to authenticated
  using (company_id = (select public.current_company_id()) and public.can_access_bank_reconciliation());

drop policy if exists support_read_bank_reconciliation_events on public.bank_reconciliation_events;
create policy support_read_bank_reconciliation_events
  on public.bank_reconciliation_events for select to authenticated
  using (
    public.support_has_active_authorization(company_id, 'accounting', 'lectura_diagnostico')
    or public.support_has_active_authorization(company_id, 'accounting', 'intervencion_asistida')
  );

revoke all privileges on table
  public.bank_accounts,
  public.bank_statements,
  public.bank_statement_lines,
  public.bank_reconciliation_matches,
  public.bank_reconciliation_events,
  public.bank_statement_counters
from public, anon, authenticated;

grant select on table
  public.bank_accounts,
  public.bank_statements,
  public.bank_statement_lines,
  public.bank_reconciliation_matches,
  public.bank_reconciliation_events
to authenticated;

grant all on table
  public.bank_accounts,
  public.bank_statements,
  public.bank_statement_lines,
  public.bank_reconciliation_matches,
  public.bank_reconciliation_events,
  public.bank_statement_counters
to service_role;

-- ============================================================================
-- 3. FUNCIONES INTERNAS AUXILIARES DE ESTADO Y AUDITORÍA
-- ============================================================================

create or replace function public._bank_log_event(
  p_company_id uuid,
  p_bank_account_id uuid,
  p_statement_id uuid,
  p_action text,
  p_table_name text,
  p_record_id uuid,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_actor_name text;
  v_actor_role text;
begin
  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario'),
         coalesce(role, 'usuario')
    into v_actor_name, v_actor_role
    from public.profiles
   where id = auth.uid()
     and company_id = p_company_id;

  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'Usuario');
  v_actor_role := coalesce(nullif(btrim(v_actor_role), ''), 'usuario');

  insert into public.bank_reconciliation_events (
    company_id, bank_account_id, statement_id, action,
    actor_id, actor_name, actor_role, detail
  ) values (
    p_company_id, p_bank_account_id, p_statement_id, p_action,
    auth.uid(), v_actor_name, v_actor_role, coalesce(p_detail, '{}'::jsonb)
  );

  insert into public.audit_log (
    company_id, user_id, user_name, action, table_name, record_id, detail
  ) values (
    p_company_id, auth.uid(), v_actor_name, p_action, p_table_name, p_record_id, coalesce(p_detail, '{}'::jsonb)
  );
end
$function$;

create or replace function public._bank_recompute_statement_states(p_statement_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_stmt public.bank_statements;
  v_line record;
  v_matched numeric;
  v_new_line_status text;
  v_total_lines int := 0;
  v_conc_lines int := 0;
  v_part_lines int := 0;
  v_diff_lines int := 0;
  v_pend_lines int := 0;
  v_new_stmt_status text;
begin
  select * into v_stmt
    from public.bank_statements
   where id = p_statement_id
     for update;

  if not found then
    return null;
  end if;

  if v_stmt.status = 'anulado' then
    return 'anulado';
  end if;

  for v_line in
    select *
      from public.bank_statement_lines
     where statement_id = p_statement_id
       and company_id = v_stmt.company_id
       and status <> 'anulado'
     for update
  loop
    v_total_lines := v_total_lines + 1;

    select coalesce(sum(matched_amount), 0)
      into v_matched
      from public.bank_reconciliation_matches
     where statement_line_id = v_line.id
       and statement_id = p_statement_id
       and company_id = v_stmt.company_id
       and status = 'activo';

    if v_line.difference_reason is not null and btrim(v_line.difference_reason) <> '' then
      v_new_line_status := 'con_diferencia';
    elsif v_matched >= v_line.amount - 0.009 then
      v_new_line_status := 'conciliado';
    elsif v_matched > 0.009 then
      v_new_line_status := 'parcialmente_conciliado';
    else
      v_new_line_status := 'pendiente';
    end if;

    if v_line.status is distinct from v_new_line_status then
      update public.bank_statement_lines
         set status = v_new_line_status,
             updated_at = now()
       where id = v_line.id
         and company_id = v_stmt.company_id;
    end if;

    if v_new_line_status = 'conciliado' then
      v_conc_lines := v_conc_lines + 1;
    elsif v_new_line_status = 'parcialmente_conciliado' then
      v_part_lines := v_part_lines + 1;
    elsif v_new_line_status = 'con_diferencia' then
      v_diff_lines := v_diff_lines + 1;
    else
      v_pend_lines := v_pend_lines + 1;
    end if;
  end loop;

  if v_stmt.confirmed_at is not null then
    if v_diff_lines > 0 then
      v_new_stmt_status := 'con_diferencia';
    elsif v_pend_lines > 0 or v_part_lines > 0 then
      v_new_stmt_status := 'parcialmente_conciliado';
    elsif v_total_lines > 0 then
      v_new_stmt_status := 'conciliado';
    else
      v_new_stmt_status := 'pendiente';
    end if;
  else
    if v_diff_lines > 0 then
      v_new_stmt_status := 'con_diferencia';
    elsif v_conc_lines > 0 or v_part_lines > 0 then
      v_new_stmt_status := 'parcialmente_conciliado';
    else
      v_new_stmt_status := 'pendiente';
    end if;
  end if;

  update public.bank_statements
     set status = v_new_stmt_status,
         updated_at = now()
   where id = p_statement_id
     and company_id = v_stmt.company_id;

  return v_new_stmt_status;
end
$function$;

revoke all on function public._bank_log_event(uuid, uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._bank_recompute_statement_states(uuid) from public, anon, authenticated;

-- ============================================================================
-- 4. RPCS PÚBLICAS CON SEPARACIÓN GRANULAR DE PERMISOS POR FUNCIÓN
--   - Lectura:                admin, super_admin, dueno, admin_empresa, gerente, contador (+ soporte autorizado solo SELECT)
--   - Administración cuentas: admin, super_admin, dueno, admin_empresa, gerente
--   - Registro movimientos:   admin, super_admin, dueno, admin_empresa, gerente, contador
--   - Conciliación manual:    admin, super_admin, dueno, admin_empresa, gerente, contador
--   - Anulación:              admin, super_admin, dueno, admin_empresa, gerente
--   - Reapertura formal:      admin, super_admin, dueno, admin_empresa
-- ============================================================================

create or replace function public.bank_upsert_account(
  p_id uuid default null::uuid,
  p_bank_name text default null::text,
  p_account_alias text default null::text,
  p_account_type text default 'ahorros'::text,
  p_account_number_raw text default null::text,
  p_acc_account_id uuid default null::uuid,
  p_currency text default 'COP'::text,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente']);
  v_bank_name text := btrim(coalesce(p_bank_name, ''));
  v_alias text := btrim(coalesce(p_account_alias, ''));
  v_type text := coalesce(nullif(btrim(coalesce(p_account_type, '')), ''), 'ahorros');
  v_digits text;
  v_last4 text;
  v_masked text;
  v_currency text := upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'COP'));
  v_acc public.acc_accounts;
  v_actor_name text;
  v_id uuid;
  v_existing public.bank_accounts;
begin
  if v_bank_name = '' or v_alias = '' then
    raise exception 'El banco y el alias de la cuenta son obligatorios';
  end if;

  if v_type not in ('ahorros', 'corriente', 'billetera_digital', 'fiduciaria', 'otra') then
    raise exception 'Tipo de cuenta bancaria inválido';
  end if;

  if p_acc_account_id is null then
    raise exception 'Debes vincular la cuenta bancaria a una cuenta contable existente del PUC';
  end if;

  select * into v_acc
    from public.acc_accounts
   where id = p_acc_account_id
     and company_id = v_co;

  if not found then
    raise exception 'La cuenta contable seleccionada no pertenece a esta empresa';
  end if;

  if not v_acc.active or not v_acc.is_postable then
    raise exception 'La cuenta contable vinculada debe estar activa y ser imputable';
  end if;

  if v_acc.type <> 'activo' then
    raise exception 'La cuenta contable vinculada debe ser de tipo Activo (Bancos/Equivalentes)';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and company_id = v_co;

  if p_id is not null then
    select * into v_existing
      from public.bank_accounts
     where id = p_id
       and company_id = v_co
       for update;

    if not found then
      raise exception 'No autorizado o cuenta bancaria inexistente' using errcode = '42501';
    end if;

    v_digits := regexp_replace(coalesce(p_account_number_raw, ''), '\s+', '', 'g');
    if v_digits = '' then
      v_last4 := v_existing.account_number_last4;
      v_masked := v_existing.account_number_masked;
    else
      v_last4 := right(regexp_replace(v_digits, '[^A-Za-z0-9]', '', 'g'), 4);
      if length(v_last4) < 3 then
        raise exception 'Ingresa al menos los últimos 3 a 4 dígitos de la cuenta para identificarla de forma enmascarada';
      end if;
      v_masked := '****' || v_last4;
    end if;

    if v_existing.acc_account_id is distinct from p_acc_account_id
       and exists (
         select 1
           from public.bank_statements
          where bank_account_id = p_id
            and company_id = v_co
            and status <> 'anulado'
       ) then
      raise exception 'No puedes cambiar la cuenta contable PUC de una cuenta bancaria que ya tiene extractos registrados';
    end if;

    update public.bank_accounts
       set bank_name = v_bank_name,
           account_alias = v_alias,
           account_type = v_type,
           account_number_last4 = v_last4,
           account_number_masked = v_masked,
           acc_account_id = p_acc_account_id,
           currency = left(v_currency, 6),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           updated_at = now()
     where id = p_id
       and company_id = v_co;

    perform public._bank_log_event(
      v_co, p_id, null, 'bank_account_updated', 'bank_accounts', p_id,
      jsonb_build_object(
        'bank_name', v_bank_name,
        'account_alias', v_alias,
        'account_number_masked', v_masked,
        'acc_account_id', p_acc_account_id
      )
    );

    return p_id;
  else
    v_digits := regexp_replace(coalesce(p_account_number_raw, ''), '[^A-Za-z0-9]', '', 'g');
    v_last4 := right(v_digits, 4);
    if length(v_last4) < 3 then
      raise exception 'Ingresa el número o los últimos 4 dígitos de la cuenta (se guardarán enmascarados)';
    end if;
    v_masked := '****' || v_last4;

    insert into public.bank_accounts (
      company_id, acc_account_id, bank_name, account_alias, account_type,
      account_number_last4, account_number_masked, currency, notes,
      created_by, created_by_name
    ) values (
      v_co, p_acc_account_id, v_bank_name, v_alias, v_type,
      v_last4, v_masked, left(v_currency, 6),
      nullif(btrim(coalesce(p_notes, '')), ''),
      auth.uid(), coalesce(nullif(btrim(v_actor_name), ''), 'Usuario')
    )
    returning id into v_id;

    perform public._bank_log_event(
      v_co, v_id, null, 'bank_account_created', 'bank_accounts', v_id,
      jsonb_build_object(
        'bank_name', v_bank_name,
        'account_alias', v_alias,
        'account_number_masked', v_masked,
        'acc_account_id', p_acc_account_id,
        'acc_account_code', v_acc.code
      )
    );

    return v_id;
  end if;
end
$function$;

create or replace function public.bank_toggle_account_status(
  p_id uuid,
  p_active boolean,
  p_reason text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente']);
  v_acc public.bank_accounts;
begin
  select * into v_acc
    from public.bank_accounts
   where id = p_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o cuenta bancaria inexistente' using errcode = '42501';
  end if;

  update public.bank_accounts
     set active = coalesce(p_active, true),
         updated_at = now()
   where id = p_id
     and company_id = v_co;

  perform public._bank_log_event(
    v_co, p_id, null,
    case when coalesce(p_active, true) then 'bank_account_activated' else 'bank_account_deactivated' end,
    'bank_accounts', p_id,
    jsonb_build_object(
      'account_alias', v_acc.account_alias,
      'active', coalesce(p_active, true),
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end
$function$;

create or replace function public.bank_create_statement(
  p_bank_account_id uuid,
  p_period_start date,
  p_period_end date,
  p_cutoff_date date,
  p_opening_balance numeric default 0,
  p_reported_closing_balance numeric default null::numeric,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_bank public.bank_accounts;
  v_seq integer;
  v_existing_count integer;
  v_code text;
  v_actor_name text;
  v_id uuid;
begin
  if p_period_start is null or p_period_end is null or p_cutoff_date is null then
    raise exception 'Las fechas de inicio, fin y corte del extracto son obligatorias';
  end if;

  if p_period_end < p_period_start then
    raise exception 'La fecha fin del período no puede ser anterior a la fecha inicial';
  end if;

  if p_cutoff_date < p_period_start or p_cutoff_date > p_period_end then
    raise exception 'La fecha de corte (%) debe estar dentro del período del extracto (% a %)', p_cutoff_date, p_period_start, p_period_end;
  end if;

  if not public._bank_is_finite(coalesce(p_opening_balance, 0)) then
    raise exception 'El saldo inicial del extracto no es válido';
  end if;

  if p_reported_closing_balance is not null and not public._bank_is_finite(p_reported_closing_balance) then
    raise exception 'El saldo final reportado no es válido';
  end if;

  if not public.acc_period_is_open(v_co, p_cutoff_date) then
    raise exception 'El periodo contable de la fecha de corte (%) está cerrado. Reabre el periodo contable antes de crear una conciliación.', p_cutoff_date;
  end if;

  if not public.acc_period_is_open(v_co, p_period_start) or not public.acc_period_is_open(v_co, p_period_end) then
    raise exception 'El periodo contable del rango del extracto (% a %) está cerrado.', p_period_start, p_period_end;
  end if;

  select * into v_bank
    from public.bank_accounts
   where id = p_bank_account_id
     and company_id = v_co;

  if not found then
    raise exception 'No autorizado o cuenta bancaria inexistente' using errcode = '42501';
  end if;

  if not v_bank.active then
    raise exception 'La cuenta bancaria está inactiva; actívala antes de registrar un extracto';
  end if;

  -- Contador atómico por empresa serializado por fila para evitar códigos duplicados en concurrencia
  insert into public.bank_statement_counters (company_id, last_seq, updated_at)
  values (v_co, 0, now())
  on conflict (company_id) do nothing;

  select last_seq
    into v_seq
    from public.bank_statement_counters
   where company_id = v_co
     for update;

  select count(*)::integer
    into v_existing_count
    from public.bank_statements
   where company_id = v_co;

  v_seq := greatest(coalesce(v_seq, 0), coalesce(v_existing_count, 0)) + 1;
  loop
    v_code := 'EXT-' || to_char(p_cutoff_date, 'YYYYMM') || '-' || lpad(v_seq::text, 4, '0');
    exit when not exists (
      select 1
        from public.bank_statements
       where company_id = v_co
         and statement_code = v_code
    );
    v_seq := v_seq + 1;
  end loop;

  update public.bank_statement_counters
     set last_seq = v_seq,
         updated_at = now()
   where company_id = v_co;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and company_id = v_co;

  insert into public.bank_statements (
    company_id, bank_account_id, statement_code,
    period_start, period_end, cutoff_date,
    opening_balance, reported_closing_balance,
    status, notes, created_by, created_by_name
  ) values (
    v_co, p_bank_account_id, v_code,
    p_period_start, p_period_end, p_cutoff_date,
    round(coalesce(p_opening_balance, 0), 2),
    case when p_reported_closing_balance is null then null else round(p_reported_closing_balance, 2) end,
    'pendiente',
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    coalesce(nullif(btrim(v_actor_name), ''), 'Usuario')
  )
  returning id into v_id;

  perform public._bank_log_event(
    v_co, p_bank_account_id, v_id, 'bank_statement_created', 'bank_statements', v_id,
    jsonb_build_object(
      'statement_code', v_code,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'cutoff_date', p_cutoff_date,
      'opening_balance', round(coalesce(p_opening_balance, 0), 2),
      'reported_closing_balance', p_reported_closing_balance
    )
  );

  return v_id;
end
$function$;

create or replace function public.bank_add_statement_lines(
  p_statement_id uuid,
  p_lines jsonb,
  p_source_origin text default 'manual'::text
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_stmt public.bank_statements;
  v_origin text := coalesce(nullif(btrim(coalesce(p_source_origin, '')), ''), 'manual');
  v_actor_name text;
  v_next_num int;
  v_item jsonb;
  v_tx_date date;
  v_post_date date;
  v_desc text;
  v_ref text;
  v_dir text;
  v_amt numeric;
  v_rep_bal numeric;
  v_note text;
  v_inserted int := 0;
begin
  if v_origin not in ('manual', 'csv_manual') then
    raise exception 'Origen de extracto inválido (solo carga manual controlada)';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Agrega al menos un movimiento bancario válido';
  end if;

  select * into v_stmt
    from public.bank_statements
   where id = p_statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status in ('conciliado', 'anulado') or v_stmt.confirmed_at is not null then
    raise exception 'Este extracto está confirmado o bloqueado (%). Reábrelo formalmente antes de agregar movimientos.', v_stmt.status;
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) then
    raise exception 'El periodo contable de la fecha de corte (%) está cerrado', v_stmt.cutoff_date;
  end if;

  select coalesce(max(line_number), 0) + 1
    into v_next_num
    from public.bank_statement_lines
   where statement_id = p_statement_id
     and company_id = v_co;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and company_id = v_co;

  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'Usuario');

  for v_item in select * from jsonb_array_elements(p_lines) loop
    begin
      v_tx_date := (v_item->>'tx_date')::date;
    exception when others then
      raise exception 'Fecha de transacción inválida en uno de los movimientos';
    end;

    if v_tx_date is null then
      raise exception 'La fecha de transacción es obligatoria en cada movimiento';
    end if;

    if v_tx_date < v_stmt.period_start or v_tx_date > v_stmt.period_end then
      raise exception 'La fecha de transacción (%) está fuera del período del extracto (% a %)', v_tx_date, v_stmt.period_start, v_stmt.period_end;
    end if;

    if v_tx_date > v_stmt.cutoff_date then
      raise exception 'La fecha de transacción (%) no puede ser posterior a la fecha de corte (%)', v_tx_date, v_stmt.cutoff_date;
    end if;

    if not public.acc_period_is_open(v_co, v_tx_date) then
      raise exception 'El periodo contable de la fecha del movimiento (%) está cerrado', v_tx_date;
    end if;

    v_post_date := null;
    if coalesce(btrim(v_item->>'post_date'), '') <> '' then
      begin
        v_post_date := (v_item->>'post_date')::date;
      exception when others then
        raise exception 'Fecha contable/registro inválida en uno de los movimientos';
      end;
      if v_post_date > v_stmt.cutoff_date then
        raise exception 'La fecha registro (%) no puede ser posterior a la fecha de corte (%)', v_post_date, v_stmt.cutoff_date;
      end if;
      if not public.acc_period_is_open(v_co, v_post_date) then
        raise exception 'El periodo contable de la fecha registro (%) está cerrado', v_post_date;
      end if;
    end if;

    v_desc := btrim(coalesce(v_item->>'description', ''));
    if v_desc = '' then
      raise exception 'La descripción es obligatoria en cada movimiento del extracto';
    end if;

    v_ref := nullif(btrim(coalesce(v_item->>'bank_reference', '')), '');
    v_dir := lower(btrim(coalesce(v_item->>'direction', '')));
    if v_dir not in ('credit', 'debit') then
      raise exception 'Tipo de movimiento inválido (debe ser credit o debit)';
    end if;

    begin
      v_amt := round(coalesce((v_item->>'amount')::numeric, 0), 2);
    exception when others then
      raise exception 'El monto de uno de los movimientos no es numérico válido';
    end;
    if not public._bank_is_finite(v_amt) or v_amt <= 0 then
      raise exception 'El monto de cada movimiento debe ser mayor que cero';
    end if;

    v_rep_bal := null;
    if coalesce(btrim(v_item->>'reported_balance'), '') <> '' then
      begin
        v_rep_bal := round((v_item->>'reported_balance')::numeric, 2);
      exception when others then
        raise exception 'Saldo reportado inválido en uno de los movimientos';
      end;
      if not public._bank_is_finite(v_rep_bal) then
        raise exception 'Saldo reportado inválido en uno de los movimientos';
      end if;
    end if;

    v_note := nullif(btrim(coalesce(v_item->>'notes', '')), '');

    insert into public.bank_statement_lines (
      company_id, statement_id, bank_account_id, line_number,
      tx_date, post_date, description, bank_reference, direction,
      amount, reported_balance, notes, status, source_origin,
      created_by, created_by_name
    ) values (
      v_co, p_statement_id, v_stmt.bank_account_id, v_next_num,
      v_tx_date, v_post_date, left(v_desc, 300), left(v_ref, 120), v_dir,
      v_amt, v_rep_bal, left(v_note, 500), 'pendiente', v_origin,
      auth.uid(), v_actor_name
    );

    v_next_num := v_next_num + 1;
    v_inserted := v_inserted + 1;
  end loop;

  perform public._bank_recompute_statement_states(p_statement_id);

  perform public._bank_log_event(
    v_co, v_stmt.bank_account_id, p_statement_id, 'bank_statement_lines_added', 'bank_statement_lines', p_statement_id,
    jsonb_build_object(
      'statement_code', v_stmt.statement_code,
      'lines_added', v_inserted,
      'source_origin', v_origin
    )
  );

  return v_inserted;
end
$function$;

create or replace function public.bank_void_statement_line(
  p_line_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente']);
  v_line public.bank_statement_lines;
  v_stmt public.bank_statements;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'Indica el motivo para anular el movimiento del extracto';
  end if;

  select * into v_line
    from public.bank_statement_lines
   where id = p_line_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o movimiento inexistente' using errcode = '42501';
  end if;

  if v_line.status = 'anulado' then
    raise exception 'Este movimiento bancario ya se encuentra anulado';
  end if;

  select * into v_stmt
    from public.bank_statements
   where id = v_line.statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status in ('conciliado', 'anulado') or v_stmt.confirmed_at is not null then
    raise exception 'Reabre formalmente el extracto antes de anular uno de sus movimientos';
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) or not public.acc_period_is_open(v_co, v_line.tx_date) then
    raise exception 'El periodo contable de la fecha de corte (%) o del movimiento (%) está cerrado', v_stmt.cutoff_date, v_line.tx_date;
  end if;

  if exists (
    select 1 from public.bank_reconciliation_matches
     where statement_line_id = p_line_id
       and company_id = v_co
       and status = 'activo'
  ) then
    raise exception 'Anula primero los cruces conciliados asociados a este movimiento';
  end if;

  update public.bank_statement_lines
     set status = 'anulado',
         difference_reason = left(v_reason, 300),
         updated_at = now()
   where id = p_line_id
     and company_id = v_co;

  perform public._bank_recompute_statement_states(v_line.statement_id);

  perform public._bank_log_event(
    v_co, v_line.bank_account_id, v_line.statement_id, 'bank_statement_line_voided', 'bank_statement_lines', p_line_id,
    jsonb_build_object(
      'description', v_line.description,
      'amount', v_line.amount,
      'reason', v_reason
    )
  );
end
$function$;

create or replace function public.bank_create_manual_match(
  p_statement_id uuid,
  p_bank_allocations jsonb,
  p_acc_allocations jsonb,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_stmt public.bank_statements;
  v_bank public.bank_accounts;
  v_puc public.acc_accounts;
  v_group_id uuid := gen_random_uuid();
  v_actor_name text;
  v_b jsonb;
  v_a jsonb;
  v_b_id uuid;
  v_a_id uuid;
  v_b_amt numeric;
  v_a_amt numeric;
  v_b_line public.bank_statement_lines;
  v_a_line record;
  v_a_dir text;
  v_already_matched numeric;
  v_b_rem numeric;
  v_a_rem numeric;
  v_bank_inflows_sum numeric := 0;
  v_bank_outflows_sum numeric := 0;
  v_acc_inflows_sum numeric := 0;
  v_acc_outflows_sum numeric := 0;
  v_bank_inflows jsonb := '[]'::jsonb;
  v_bank_outflows jsonb := '[]'::jsonb;
  v_acc_inflows jsonb := '[]'::jsonb;
  v_acc_outflows jsonb := '[]'::jsonb;
  v_seen_bank uuid[] := '{}'::uuid[];
  v_seen_acc uuid[] := '{}'::uuid[];
  v_b_sorted jsonb;
  v_a_sorted jsonb;
  v_idx_b int;
  v_idx_a int;
  v_rem_b numeric;
  v_rem_a numeric;
  v_pair_amt numeric;
  v_cur_b jsonb;
  v_cur_a jsonb;
  v_b_rem_arr numeric[];
  v_a_rem_arr numeric[];
  v_bucket int;
begin
  if p_bank_allocations is null or jsonb_typeof(p_bank_allocations) <> 'array' or jsonb_array_length(p_bank_allocations) = 0 then
    raise exception 'Selecciona al menos un movimiento del extracto bancario';
  end if;

  if p_acc_allocations is null or jsonb_typeof(p_acc_allocations) <> 'array' or jsonb_array_length(p_acc_allocations) = 0 then
    raise exception 'Selecciona al menos un movimiento contable (acc_lines) para cruzar';
  end if;

  select * into v_stmt
    from public.bank_statements
   where id = p_statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status in ('conciliado', 'anulado') or v_stmt.confirmed_at is not null then
    raise exception 'El extracto está confirmado o bloqueado (%). Reábrelo formalmente antes de modificar cruces.', v_stmt.status;
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) then
    raise exception 'El periodo contable del extracto (%) está cerrado', v_stmt.cutoff_date;
  end if;

  select * into v_bank
    from public.bank_accounts
   where id = v_stmt.bank_account_id
     and company_id = v_co;

  if not found then
    raise exception 'Cuenta bancaria no encontrada';
  end if;

  select * into v_puc
    from public.acc_accounts
   where id = v_bank.acc_account_id
     and company_id = v_co;

  if not found then
    raise exception 'Cuenta contable PUC vinculada no pertenece a esta empresa' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and company_id = v_co;
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'Usuario');

  -- 1) Validar y separar movimientos bancarios en ingresos ('credit') y egresos ('debit')
  for v_b in select * from jsonb_array_elements(p_bank_allocations) loop
    v_b_id := (v_b->>'statement_line_id')::uuid;
    v_b_amt := round(coalesce((v_b->>'amount')::numeric, 0), 2);
    if v_b_id is null or not public._bank_is_finite(v_b_amt) or v_b_amt <= 0 then
      raise exception 'Valor inválido en movimiento del extracto seleccionado';
    end if;

    if v_b_id = any(v_seen_bank) then
      raise exception 'Movimiento bancario duplicado en la misma solicitud de cruce';
    end if;
    v_seen_bank := array_append(v_seen_bank, v_b_id);

    select * into v_b_line
      from public.bank_statement_lines
     where id = v_b_id
       and statement_id = p_statement_id
       and bank_account_id = v_stmt.bank_account_id
       and company_id = v_co
       for update;

    if not found then
      raise exception 'El movimiento bancario no pertenece a este extracto o a la empresa' using errcode = '42501';
    end if;

    if v_b_line.status = 'anulado' then
      raise exception 'No se puede conciliar un movimiento bancario anulado';
    end if;

    if v_b_line.tx_date < v_stmt.period_start or v_b_line.tx_date > v_stmt.cutoff_date then
      raise exception 'El movimiento bancario del % está fuera del rango válido del extracto', v_b_line.tx_date;
    end if;

    select coalesce(sum(matched_amount), 0)
      into v_already_matched
      from public.bank_reconciliation_matches
     where statement_line_id = v_b_id
       and company_id = v_co
       and status = 'activo';

    v_b_rem := round(v_b_line.amount - v_already_matched, 2);
    if v_b_amt > v_b_rem + 0.005 then
      raise exception 'El monto asignado (%) excede el saldo pendiente (%) del movimiento bancario', v_b_amt, v_b_rem;
    end if;

    if v_b_line.direction = 'credit' then
      v_bank_inflows_sum := round(v_bank_inflows_sum + v_b_amt, 2);
      v_bank_inflows := v_bank_inflows || jsonb_build_array(jsonb_build_object(
        'id', v_b_id,
        'amount', v_b_amt
      ));
    else
      v_bank_outflows_sum := round(v_bank_outflows_sum + v_b_amt, 2);
      v_bank_outflows := v_bank_outflows || jsonb_build_array(jsonb_build_object(
        'id', v_b_id,
        'amount', v_b_amt
      ));
    end if;
  end loop;

  -- 2) Validar y separar asignaciones contables según naturaleza de la cuenta vinculada
  for v_a in select * from jsonb_array_elements(p_acc_allocations) loop
    v_a_id := (v_a->>'acc_line_id')::uuid;
    v_a_amt := round(coalesce((v_a->>'amount')::numeric, 0), 2);
    if v_a_id is null or not public._bank_is_finite(v_a_amt) or v_a_amt <= 0 then
      raise exception 'Valor inválido en movimiento contable seleccionado';
    end if;

    if v_a_id = any(v_seen_acc) then
      raise exception 'Movimiento contable duplicado en la misma solicitud de cruce';
    end if;
    v_seen_acc := array_append(v_seen_acc, v_a_id);

    select l.id, l.company_id, l.entry_id, l.account_id, l.debit, l.credit,
           e.status as entry_status, e.entry_date, e.number as entry_number
      into v_a_line
      from public.acc_lines l
      join public.acc_entries e
        on e.id = l.entry_id
       and e.company_id = v_co
     where l.id = v_a_id
       and l.company_id = v_co
     for update of l;

    if not found then
      raise exception 'El movimiento contable no existe o no pertenece a esta empresa' using errcode = '42501';
    end if;

    if v_a_line.account_id is distinct from v_bank.acc_account_id then
      raise exception 'El movimiento contable (%) no corresponde a la cuenta PUC vinculada a este banco', v_a_line.entry_number;
    end if;

    if v_a_line.entry_status <> 'contabilizado' then
      raise exception 'Solo se pueden conciliar movimientos de asientos en estado contabilizado (% está en %)', v_a_line.entry_number, v_a_line.entry_status;
    end if;

    if v_a_line.entry_date > v_stmt.cutoff_date then
      raise exception 'El asiento contable % (% ) es posterior a la fecha de corte del extracto (%)', v_a_line.entry_number, v_a_line.entry_date, v_stmt.cutoff_date;
    end if;

    if abs(coalesce(v_a_line.debit, 0) - coalesce(v_a_line.credit, 0)) < 0.01 then
      raise exception 'El movimiento contable seleccionado no tiene saldo neto válido';
    end if;

    select coalesce(sum(matched_amount), 0)
      into v_already_matched
      from public.bank_reconciliation_matches
     where acc_line_id = v_a_id
       and company_id = v_co
       and status = 'activo';

    v_a_rem := round(abs(coalesce(v_a_line.debit, 0) - coalesce(v_a_line.credit, 0)) - v_already_matched, 2);
    if v_a_amt > v_a_rem + 0.005 then
      raise exception 'El monto asignado (%) excede el saldo pendiente (%) del asiento %', v_a_amt, v_a_rem, v_a_line.entry_number;
    end if;

    -- Correspondencia de naturaleza:
    -- En cuenta Activo/Débito: débito contable = crédito/ingreso en extracto bancario ('credit'); crédito contable = débito/egreso bancario ('debit').
    -- Si la cuenta contable fuera de naturaleza 'credito', la lectura se invierte simétricamente.
    if v_puc.nature = 'credito' then
      v_a_dir := case when coalesce(v_a_line.credit, 0) > coalesce(v_a_line.debit, 0) then 'credit' else 'debit' end;
    else
      v_a_dir := case when coalesce(v_a_line.debit, 0) > coalesce(v_a_line.credit, 0) then 'credit' else 'debit' end;
    end if;

    if v_a_dir = 'credit' then
      v_acc_inflows_sum := round(v_acc_inflows_sum + v_a_amt, 2);
      v_acc_inflows := v_acc_inflows || jsonb_build_array(jsonb_build_object(
        'id', v_a_id,
        'entry_id', v_a_line.entry_id,
        'entry_number', v_a_line.entry_number,
        'amount', v_a_amt
      ));
    else
      v_acc_outflows_sum := round(v_acc_outflows_sum + v_a_amt, 2);
      v_acc_outflows := v_acc_outflows || jsonb_build_array(jsonb_build_object(
        'id', v_a_id,
        'entry_id', v_a_line.entry_id,
        'entry_number', v_a_line.entry_number,
        'amount', v_a_amt
      ));
    end if;
  end loop;

  -- 3) Garantizar cuadre independiente por naturaleza (créditos bancarios vs ingresos contables; débitos bancarios vs egresos contables)
  if abs(round(v_bank_inflows_sum - v_acc_inflows_sum, 2)) > 0.01 then
    raise exception 'Descuadre en abonos/ingresos: extracto crédito (%) vs. contabilidad ingreso (%). Solo cruza créditos bancarios con su contrapartida contable correspondiente.',
      v_bank_inflows_sum, v_acc_inflows_sum;
  end if;

  if abs(round(v_bank_outflows_sum - v_acc_outflows_sum, 2)) > 0.01 then
    raise exception 'Descuadre en cargos/egresos: extracto débito (%) vs. contabilidad egreso (%). Solo cruza débitos bancarios con su contrapartida contable correspondiente.',
      v_bank_outflows_sum, v_acc_outflows_sum;
  end if;

  -- 4) Emparejar determinísticamente dentro de cada cubeta (ordenado por UUID, independiente del orden de entrada)
  for v_bucket in 1..2 loop
    if v_bucket = 1 then
      select coalesce(jsonb_agg(elem order by (elem->>'id')), '[]'::jsonb)
        into v_b_sorted
        from jsonb_array_elements(v_bank_inflows) as elem;
      select coalesce(jsonb_agg(elem order by (elem->>'id')), '[]'::jsonb)
        into v_a_sorted
        from jsonb_array_elements(v_acc_inflows) as elem;
    else
      select coalesce(jsonb_agg(elem order by (elem->>'id')), '[]'::jsonb)
        into v_b_sorted
        from jsonb_array_elements(v_bank_outflows) as elem;
      select coalesce(jsonb_agg(elem order by (elem->>'id')), '[]'::jsonb)
        into v_a_sorted
        from jsonb_array_elements(v_acc_outflows) as elem;
    end if;

    continue when jsonb_array_length(v_b_sorted) = 0 or jsonb_array_length(v_a_sorted) = 0;

    v_b_rem_arr := array(select (e->>'amount')::numeric from jsonb_array_elements(v_b_sorted) e);
    v_a_rem_arr := array(select (e->>'amount')::numeric from jsonb_array_elements(v_a_sorted) e);

    v_idx_b := 1;
    v_idx_a := 1;
    while v_idx_b <= array_length(v_b_rem_arr, 1) and v_idx_a <= array_length(v_a_rem_arr, 1) loop
      v_rem_b := v_b_rem_arr[v_idx_b];
      v_rem_a := v_a_rem_arr[v_idx_a];
      v_pair_amt := round(least(v_rem_b, v_rem_a), 2);

      if v_pair_amt > 0 then
        v_cur_b := v_b_sorted->(v_idx_b - 1);
        v_cur_a := v_a_sorted->(v_idx_a - 1);

        if exists (
          select 1
            from public.bank_reconciliation_matches
           where statement_line_id = (v_cur_b->>'id')::uuid
             and acc_line_id = (v_cur_a->>'id')::uuid
             and company_id = v_co
             and status = 'activo'
        ) then
          raise exception 'Ese par de movimiento bancario y asiento contable ya se encuentra vinculado';
        end if;

        insert into public.bank_reconciliation_matches (
          company_id, statement_id, statement_line_id, acc_line_id, acc_entry_id,
          match_group_id, matched_amount, status, notes, created_by, created_by_name
        ) values (
          v_co, p_statement_id,
          (v_cur_b->>'id')::uuid,
          (v_cur_a->>'id')::uuid,
          (v_cur_a->>'entry_id')::uuid,
          v_group_id,
          v_pair_amt,
          'activo',
          nullif(btrim(coalesce(p_notes, '')), ''),
          auth.uid(),
          v_actor_name
        );

        update public.bank_statement_lines
           set difference_reason = null,
               updated_at = now()
         where id = (v_cur_b->>'id')::uuid
           and company_id = v_co
           and difference_reason is not null;
      end if;

      v_b_rem_arr[v_idx_b] := round(v_rem_b - v_pair_amt, 2);
      v_a_rem_arr[v_idx_a] := round(v_rem_a - v_pair_amt, 2);

      if v_b_rem_arr[v_idx_b] <= 0.004 then v_idx_b := v_idx_b + 1; end if;
      if v_a_rem_arr[v_idx_a] <= 0.004 then v_idx_a := v_idx_a + 1; end if;
    end loop;
  end loop;

  perform public._bank_recompute_statement_states(p_statement_id);

  perform public._bank_log_event(
    v_co, v_stmt.bank_account_id, p_statement_id, 'bank_manual_match_created', 'bank_reconciliation_matches', v_group_id,
    jsonb_build_object(
      'statement_code', v_stmt.statement_code,
      'match_group_id', v_group_id,
      'bank_count', jsonb_array_length(p_bank_allocations),
      'acc_count', jsonb_array_length(p_acc_allocations),
      'inflows_matched', v_bank_inflows_sum,
      'outflows_matched', v_bank_outflows_sum,
      'total_matched', round(v_bank_inflows_sum + v_bank_outflows_sum, 2),
      'notes', nullif(btrim(coalesce(p_notes, '')), '')
    )
  );

  return v_group_id;
end
$function$;

create or replace function public.bank_mark_line_difference(
  p_line_id uuid,
  p_has_difference boolean,
  p_reason text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_line public.bank_statement_lines;
  v_stmt public.bank_statements;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_line
    from public.bank_statement_lines
   where id = p_line_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o movimiento inexistente' using errcode = '42501';
  end if;

  select * into v_stmt
    from public.bank_statements
   where id = v_line.statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status in ('conciliado', 'anulado') or v_stmt.confirmed_at is not null then
    raise exception 'Reabre formalmente el extracto antes de cambiar el estado de diferencias';
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) then
    raise exception 'El periodo contable de la fecha de corte (%) está cerrado', v_stmt.cutoff_date;
  end if;

  if v_line.status = 'anulado' then
    raise exception 'No se puede marcar un movimiento anulado';
  end if;

  if coalesce(p_has_difference, false) and v_reason = '' then
    raise exception 'Explica el motivo de la diferencia bancaria detectada (sin modificar los libros automáticamente)';
  end if;

  update public.bank_statement_lines
     set difference_reason = case when coalesce(p_has_difference, false) then left(v_reason, 300) else null end,
         updated_at = now()
   where id = p_line_id
     and company_id = v_co;

  perform public._bank_recompute_statement_states(v_line.statement_id);

  perform public._bank_log_event(
    v_co, v_line.bank_account_id, v_line.statement_id,
    case when coalesce(p_has_difference, false) then 'bank_line_difference_marked' else 'bank_line_difference_cleared' end,
    'bank_statement_lines', p_line_id,
    jsonb_build_object(
      'description', v_line.description,
      'amount', v_line.amount,
      'reason', nullif(v_reason, '')
    )
  );
end
$function$;

create or replace function public.bank_void_match(
  p_match_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente']);
  v_m public.bank_reconciliation_matches;
  v_stmt public.bank_statements;
  v_actor_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'Indica el motivo para deshacer este cruce manual';
  end if;

  select * into v_m
    from public.bank_reconciliation_matches
   where id = p_match_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o cruce inexistente' using errcode = '42501';
  end if;

  if v_m.status = 'anulado' then
    raise exception 'Este cruce ya se encuentra anulado';
  end if;

  select * into v_stmt
    from public.bank_statements
   where id = v_m.statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status in ('conciliado', 'anulado') or v_stmt.confirmed_at is not null then
    raise exception 'Reabre formalmente el extracto antes de anular un cruce conciliado';
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) then
    raise exception 'El periodo contable del extracto (%) está cerrado', v_stmt.cutoff_date;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and company_id = v_co;

  update public.bank_reconciliation_matches
     set status = 'anulado',
         voided_by = auth.uid(),
         voided_by_name = coalesce(nullif(btrim(v_actor_name), ''), 'Usuario'),
         voided_at = now(),
         void_reason = left(v_reason, 300)
   where id = p_match_id
     and company_id = v_co;

  perform public._bank_recompute_statement_states(v_m.statement_id);

  perform public._bank_log_event(
    v_co, v_stmt.bank_account_id, v_m.statement_id, 'bank_match_voided', 'bank_reconciliation_matches', p_match_id,
    jsonb_build_object(
      'statement_code', v_stmt.statement_code,
      'matched_amount', v_m.matched_amount,
      'reason', v_reason
    )
  );
end
$function$;

create or replace function public.bank_statement_summary(p_statement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_stmt public.bank_statements;
  v_bank public.bank_accounts;
  v_acc public.acc_accounts;
  v_bank_credits numeric := 0;
  v_bank_debits numeric := 0;
  v_bank_reconciled numeric := 0;
  v_bank_pending numeric := 0;
  v_bank_diff_amount numeric := 0;
  v_lines_total int := 0;
  v_lines_conc int := 0;
  v_lines_part int := 0;
  v_lines_diff int := 0;
  v_lines_pend int := 0;
  v_acc_balance numeric := 0;
  v_acc_period_debit numeric := 0;
  v_acc_period_credit numeric := 0;
  v_acc_reconciled numeric := 0;
  v_acc_pending numeric := 0;
  v_calc_bank_closing numeric := 0;
  v_period_open boolean := true;
begin
  select * into v_stmt
    from public.bank_statements
   where id = p_statement_id
     and company_id = v_co;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  select * into v_bank
    from public.bank_accounts
   where id = v_stmt.bank_account_id
     and company_id = v_co;

  if not found then
    raise exception 'No autorizado o cuenta bancaria inexistente' using errcode = '42501';
  end if;

  select * into v_acc
    from public.acc_accounts
   where id = v_bank.acc_account_id
     and company_id = v_co;

  if not found then
    raise exception 'No autorizado o cuenta PUC vinculada inexistente' using errcode = '42501';
  end if;

  select coalesce(sum(case when l.direction = 'credit' then l.amount else 0 end), 0),
         coalesce(sum(case when l.direction = 'debit' then l.amount else 0 end), 0),
         count(*),
         count(*) filter (where l.status = 'conciliado'),
         count(*) filter (where l.status = 'parcialmente_conciliado'),
         count(*) filter (where l.status = 'con_diferencia'),
         count(*) filter (where l.status = 'pendiente'),
         coalesce(sum(case when l.status = 'con_diferencia' then greatest(0, l.amount - coalesce(m.matched, 0)) else 0 end), 0),
         coalesce(sum(coalesce(m.matched, 0)), 0),
         coalesce(sum(greatest(0, l.amount - coalesce(m.matched, 0))), 0)
    into v_bank_credits, v_bank_debits,
         v_lines_total, v_lines_conc, v_lines_part, v_lines_diff, v_lines_pend,
         v_bank_diff_amount, v_bank_reconciled, v_bank_pending
    from public.bank_statement_lines l
    left join (
      select statement_line_id, sum(matched_amount) as matched
        from public.bank_reconciliation_matches
       where status = 'activo'
         and company_id = v_co
         and statement_id = p_statement_id
       group by statement_line_id
    ) m on m.statement_line_id = l.id
   where l.statement_id = p_statement_id
     and l.company_id = v_co
     and l.status <> 'anulado';

  v_calc_bank_closing := round(v_stmt.opening_balance + v_bank_credits - v_bank_debits, 2);

  -- Saldo contable REAL en acc_entries contabilizados + acc_lines hasta cutoff_date (estrictamente empresa activa)
  select coalesce(sum(case when v_acc.nature = 'credito' then (al.credit - al.debit) else (al.debit - al.credit) end), 0),
         coalesce(sum(case when ae.entry_date >= v_stmt.period_start and ae.entry_date <= v_stmt.cutoff_date then al.debit else 0 end), 0),
         coalesce(sum(case when ae.entry_date >= v_stmt.period_start and ae.entry_date <= v_stmt.cutoff_date then al.credit else 0 end), 0)
    into v_acc_balance, v_acc_period_debit, v_acc_period_credit
    from public.acc_lines al
    join public.acc_entries ae
      on ae.id = al.entry_id
     and ae.company_id = v_co
   where al.company_id = v_co
     and al.account_id = v_bank.acc_account_id
     and ae.status = 'contabilizado'
     and ae.entry_date <= v_stmt.cutoff_date;

  -- Movimientos contables del periodo hasta el corte vs lo conciliado en la empresa activa
  select coalesce(sum(coalesce(ma.matched, 0)), 0),
         coalesce(sum(greatest(0, abs(al.debit - al.credit) - coalesce(ma.matched, 0))), 0)
    into v_acc_reconciled, v_acc_pending
    from public.acc_lines al
    join public.acc_entries ae
      on ae.id = al.entry_id
     and ae.company_id = v_co
    left join (
      select acc_line_id, sum(matched_amount) as matched
        from public.bank_reconciliation_matches
       where status = 'activo'
         and company_id = v_co
       group by acc_line_id
    ) ma on ma.acc_line_id = al.id
   where al.company_id = v_co
     and al.account_id = v_bank.acc_account_id
     and ae.status = 'contabilizado'
     and ae.entry_date between v_stmt.period_start and v_stmt.cutoff_date;

  v_period_open := public.acc_period_is_open(v_co, v_stmt.cutoff_date);

  return jsonb_build_object(
    'statement_id', v_stmt.id,
    'statement_code', v_stmt.statement_code,
    'bank_account_id', v_bank.id,
    'bank_name', v_bank.bank_name,
    'account_alias', v_bank.account_alias,
    'account_number_masked', v_bank.account_number_masked,
    'acc_account_id', v_bank.acc_account_id,
    'acc_account_code', v_acc.code,
    'acc_account_name', v_acc.name,
    'period_start', v_stmt.period_start,
    'period_end', v_stmt.period_end,
    'cutoff_date', v_stmt.cutoff_date,
    'status', v_stmt.status,
    'is_period_open', v_period_open,
    'opening_balance', round(v_stmt.opening_balance, 2),
    'bank_credits', round(v_bank_credits, 2),
    'bank_debits', round(v_bank_debits, 2),
    'calculated_bank_closing', v_calc_bank_closing,
    'reported_closing_balance', v_stmt.reported_closing_balance,
    'accounting_balance', round(v_acc_balance, 2),
    'accounting_period_debits', round(v_acc_period_debit, 2),
    'accounting_period_credits', round(v_acc_period_credit, 2),
    'bank_reconciled_total', round(v_bank_reconciled, 2),
    'bank_pending_total', round(v_bank_pending, 2),
    'bank_difference_lines_total', round(v_bank_diff_amount, 2),
    'accounting_reconciled_total', round(v_acc_reconciled, 2),
    'accounting_pending_total', round(v_acc_pending, 2),
    'difference_bank_vs_books', round(v_calc_bank_closing - v_acc_balance, 2),
    'difference_vs_reported_closing', case
      when v_stmt.reported_closing_balance is null then null
      else round(v_stmt.reported_closing_balance - v_calc_bank_closing, 2)
    end,
    'lines_total', v_lines_total,
    'lines_reconciled', v_lines_conc,
    'lines_partial', v_lines_part,
    'lines_with_difference', v_lines_diff,
    'lines_pending', v_lines_pend
  );
end
$function$;

create or replace function public.bank_confirm_statement(
  p_statement_id uuid,
  p_notes text default null::text
)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_stmt public.bank_statements;
  v_actor_name text;
  v_summary jsonb;
  v_lines_total int;
  v_lines_diff int;
  v_lines_pend int;
  v_lines_part int;
  v_diff_books numeric;
  v_diff_rep numeric;
  v_final_status text;
  v_note text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select * into v_stmt
    from public.bank_statements
   where id = p_statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status = 'anulado' then
    raise exception 'No se puede confirmar un extracto anulado';
  end if;

  if v_stmt.confirmed_at is not null then
    raise exception 'Este extracto ya fue confirmado anteriormente. Reábrelo formalmente antes de volver a confirmarlo.';
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) then
    raise exception 'El periodo contable del corte (%) está cerrado. No se puede confirmar la conciliación.', v_stmt.cutoff_date;
  end if;

  v_summary := public.bank_statement_summary(p_statement_id);
  v_lines_total := coalesce((v_summary->>'lines_total')::int, 0);
  v_lines_diff := coalesce((v_summary->>'lines_with_difference')::int, 0);
  v_lines_pend := coalesce((v_summary->>'lines_pending')::int, 0);
  v_lines_part := coalesce((v_summary->>'lines_partial')::int, 0);
  v_diff_books := coalesce((v_summary->>'difference_bank_vs_books')::numeric, 0);
  v_diff_rep := (v_summary->>'difference_vs_reported_closing')::numeric;

  if v_lines_total = 0 then
    raise exception 'Registra al menos un movimiento en el extracto antes de confirmar la conciliación';
  end if;

  if v_lines_diff > 0 or (v_diff_rep is not null and abs(v_diff_rep) > 0.01) or abs(v_diff_books) > 0.01 then
    v_final_status := 'con_diferencia';
  elsif v_lines_pend > 0 or v_lines_part > 0 then
    v_final_status := 'parcialmente_conciliado';
  else
    v_final_status := 'conciliado';
  end if;

  if v_final_status = 'con_diferencia' and v_note is null and v_lines_diff = 0 then
    raise exception 'Existe una diferencia de saldo (%) vs. libros. Agrega una nota explicativa al confirmar (no se crean ajustes contables automáticos).', v_diff_books;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and company_id = v_co;

  update public.bank_statements
     set status = v_final_status,
         confirmed_by = auth.uid(),
         confirmed_by_name = coalesce(nullif(btrim(v_actor_name), ''), 'Usuario'),
         confirmed_at = now(),
         notes = coalesce(v_note, notes),
         updated_at = now()
   where id = p_statement_id
     and company_id = v_co;

  perform public._bank_log_event(
    v_co, v_stmt.bank_account_id, p_statement_id, 'bank_statement_confirmed', 'bank_statements', p_statement_id,
    jsonb_build_object(
      'statement_code', v_stmt.statement_code,
      'final_status', v_final_status,
      'difference_bank_vs_books', v_diff_books,
      'difference_vs_reported_closing', v_diff_rep,
      'notes', v_note
    )
  );

  return v_final_status;
end
$function$;

create or replace function public.bank_reopen_statement(
  p_statement_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa']);
  v_stmt public.bank_statements;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_next_status text;
begin
  if v_reason = '' then
    raise exception 'Indica el motivo para reabrir la conciliación';
  end if;

  select * into v_stmt
    from public.bank_statements
   where id = p_statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status = 'anulado' then
    raise exception 'Un extracto anulado no se puede reabrir';
  end if;

  if v_stmt.confirmed_at is null then
    raise exception 'Este extracto no está confirmado ni cerrado todavía';
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) then
    raise exception 'El periodo contable del corte (%) está cerrado. Reabre primero el periodo contable.', v_stmt.cutoff_date;
  end if;

  update public.bank_statements
     set confirmed_by = null,
         confirmed_by_name = null,
         confirmed_at = null,
         updated_at = now()
   where id = p_statement_id
     and company_id = v_co;

  v_next_status := public._bank_recompute_statement_states(p_statement_id);

  perform public._bank_log_event(
    v_co, v_stmt.bank_account_id, p_statement_id, 'bank_statement_reopened', 'bank_statements', p_statement_id,
    jsonb_build_object(
      'statement_code', v_stmt.statement_code,
      'previous_status', v_stmt.status,
      'new_status', v_next_status,
      'reason', v_reason
    )
  );

  return v_next_status;
end
$function$;

create or replace function public.bank_void_statement(
  p_statement_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._bank_require_roles(array['admin', 'super_admin', 'dueno', 'admin_empresa', 'gerente']);
  v_stmt public.bank_statements;
  v_actor_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'Indica el motivo para anular el extracto y su conciliación';
  end if;

  select * into v_stmt
    from public.bank_statements
   where id = p_statement_id
     and company_id = v_co
     for update;

  if not found then
    raise exception 'No autorizado o extracto bancario inexistente' using errcode = '42501';
  end if;

  if v_stmt.status = 'anulado' then
    raise exception 'Este extracto ya se encuentra anulado';
  end if;

  if v_stmt.confirmed_at is not null then
    raise exception 'Este extracto está confirmado. Reábrelo formalmente antes de anularlo.';
  end if;

  if not public.acc_period_is_open(v_co, v_stmt.cutoff_date) then
    raise exception 'El periodo contable del corte (%) está cerrado. No se puede anular la conciliación.', v_stmt.cutoff_date;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and company_id = v_co;
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'Usuario');

  update public.bank_reconciliation_matches
     set status = 'anulado',
         voided_by = auth.uid(),
         voided_by_name = v_actor_name,
         voided_at = now(),
         void_reason = left('Anulación de extracto: ' || v_reason, 300)
   where statement_id = p_statement_id
     and company_id = v_co
     and status = 'activo';

  update public.bank_statement_lines
     set status = 'anulado',
         updated_at = now()
   where statement_id = p_statement_id
     and company_id = v_co
     and status <> 'anulado';

  update public.bank_statements
     set status = 'anulado',
         voided_by = auth.uid(),
         voided_by_name = v_actor_name,
         voided_at = now(),
         void_reason = left(v_reason, 300),
         updated_at = now()
   where id = p_statement_id
     and company_id = v_co;

  perform public._bank_log_event(
    v_co, v_stmt.bank_account_id, p_statement_id, 'bank_statement_voided', 'bank_statements', p_statement_id,
    jsonb_build_object(
      'statement_code', v_stmt.statement_code,
      'reason', v_reason
    )
  );
end
$function$;

-- Privilegios explícitos de ejecución (revocar public/anon)
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.can_access_bank_reconciliation()',
    'public.bank_upsert_account(uuid,text,text,text,text,uuid,text,text)',
    'public.bank_toggle_account_status(uuid,boolean,text)',
    'public.bank_create_statement(uuid,date,date,date,numeric,numeric,text)',
    'public.bank_add_statement_lines(uuid,jsonb,text)',
    'public.bank_void_statement_line(uuid,text)',
    'public.bank_create_manual_match(uuid,jsonb,jsonb,text)',
    'public.bank_mark_line_difference(uuid,boolean,text)',
    'public.bank_void_match(uuid,text)',
    'public.bank_statement_summary(uuid)',
    'public.bank_confirm_statement(uuid,text)',
    'public.bank_reopen_statement(uuid,text)',
    'public.bank_void_statement(uuid,text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end
$$;

-- ============================================================================
-- 5. VERIFICACIÓN POSTERIOR DENTRO DE LA MISMA MIGRACIÓN
-- ============================================================================

do $$
declare
  v_cnt int;
  v_tbl text;
begin
  select count(*)
    into v_cnt
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in (
       'bank_accounts', 'bank_statements', 'bank_statement_lines',
       'bank_reconciliation_matches', 'bank_reconciliation_events',
       'bank_statement_counters'
     )
     and grantee = 'anon';

  if v_cnt <> 0 then
    raise exception 'Falló verificación: anon conserva privilegios en tablas de conciliación bancaria';
  end if;

  foreach v_tbl in array array[
    'bank_accounts', 'bank_statements', 'bank_statement_lines',
    'bank_reconciliation_matches', 'bank_reconciliation_events',
    'bank_statement_counters'
  ]
  loop
    if has_table_privilege('authenticated', 'public.' || v_tbl, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || v_tbl, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || v_tbl, 'DELETE') then
      raise exception 'Falló verificación: authenticated conserva escritura directa en public.%', v_tbl;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.bank_statement_counters', 'SELECT') then
    raise exception 'Falló verificación: authenticated conserva SELECT en public.bank_statement_counters';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgname = 'trg_bank_recon_events_immutable'
       and tgrelid = 'public.bank_reconciliation_events'::regclass
       and tgenabled <> 'D'
  ) then
    raise exception 'Falló verificación: falta trigger de inmutabilidad en public.bank_reconciliation_events';
  end if;
end
$$;

-- ============================================================================
-- 6. PIE DE REGISTRO OBLIGATORIO
-- ============================================================================

select public.sql_registrar_migracion(
  '20261119000069_conciliacion_bancaria_manual',
  'Módulo de Conciliación Bancaria Manual: cuentas bancarias vinculadas a acc_accounts, contador seguro, extractos confirmados bloqueados, cruces N:M por naturaleza e independientes de orden, protección de periodos cerrados y bitácora inmutable',
  '20261119000069_conciliacion_bancaria_manual.sql'
);
