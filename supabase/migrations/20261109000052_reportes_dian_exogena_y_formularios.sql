-- supabase/migrations/20261109000052_reportes_dian_exogena_y_formularios.sql
-- Reportes DIAN: Catálogo de Medios Magnéticos Exógena, Mapeo PUC acc_*,
-- Formularios Muisca 300 (IVA) y 350 (ReteFuente), y Certificados Tributarios.
-- Idempotente, sin BEGIN/COMMIT, compatible con el modelo contable acc_*.

-- 1. Catálogo oficial de conceptos DIAN para Información Exógena
create table if not exists public.dian_exogena_concepts (
  id text primary key, -- ej: '1001-5001'
  form_code text not null, -- '1001', '1003', '1005', '1006', '1007', '1008', '1009', '2276'
  concept_code text not null, -- '5001', '5002', '5007', etc.
  description text not null,
  valid_year integer default 2026,
  active boolean default true,
  created_at timestamptz default now()
);

-- 2. Mapeo entre Cuentas PUC NIIF (acc_accounts) y Conceptos de Exógena DIAN
create table if not exists public.dian_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_prefix text not null, -- prefijo o código: ej '5105', '2408', '2365', '4135'
  dian_form text not null, -- '1001', '1003', '1005', '1006', '1007', '1008', '1009', '2276'
  dian_concept text not null, -- '5001', '5007', etc.
  column_target text not null, -- 'pago_deducible', 'pago_no_deducible', 'ret_practicada', 'ret_asumida', 'iva_descontable', 'iva_generado', 'ingreso_bruto', 'saldo_cxc', 'saldo_cxp'
  notes text,
  created_at timestamptz default now()
);

-- 3. Parámetros de Retención en la Fuente y Tarifas ICA Municipales
create table if not exists public.dian_tax_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tax_type text not null, -- 'retefuente', 'reteiva', 'reteica', 'auto_renta'
  concept_name text not null, -- 'Compras generales declarantes', 'Servicios generales', 'Honorarios persona jurídica'
  base_uvt numeric default 0,
  base_cop numeric default 0,
  percentage numeric not null, -- 2.5, 3.5, 4.0, 11.0, 15.0, etc.
  account_code text not null, -- cuenta PUC vinculada: ej '236540'
  municipality_code text, -- código DANE para ICA (ej: '11001' Bogotá)
  ciuu_code text, -- actividad económica (ej: '4711')
  active boolean default true,
  created_at timestamptz default now()
);

-- 4. Registro y Auditoría de Certificados Tributarios Emitidos a Terceros
create table if not exists public.dian_certificates_issued (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year integer not null,
  cert_type text not null, -- 'retefuente', 'reteiva', 'reteica', '2276'
  third_party_id text not null, -- NIT o Cédula
  third_party_name text not null,
  total_base numeric default 0,
  total_retained numeric default 0,
  issued_by_email text,
  issued_at timestamptz default now()
);

-- Índices de alto rendimiento para búsquedas y consultas multiempresa
create index if not exists idx_dian_map_co_form on public.dian_account_mappings (company_id, dian_form);
create index if not exists idx_dian_tax_co_type on public.dian_tax_rules (company_id, tax_type);
create index if not exists idx_dian_cert_co_year on public.dian_certificates_issued (company_id, fiscal_year, cert_type);
create index if not exists idx_dian_cert_tp on public.dian_certificates_issued (third_party_id);

-- Habilitar Row Level Security (RLS) en todas las tablas
alter table public.dian_exogena_concepts enable row level security;
alter table public.dian_account_mappings enable row level security;
alter table public.dian_tax_rules enable row level security;
alter table public.dian_certificates_issued enable row level security;

-- Políticas de Seguridad RLS
drop policy if exists "dian_concepts_read" on public.dian_exogena_concepts;
create policy "dian_concepts_read" on public.dian_exogena_concepts
  for select to authenticated using (true);

drop policy if exists "dian_mappings_tenant" on public.dian_account_mappings;
create policy "dian_mappings_tenant" on public.dian_account_mappings
  for all to authenticated
  using (
    company_id in (select p.company_id from public.profiles p where p.id = (select auth.uid()))
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'super_admin'))
  )
  with check (
    company_id in (select p.company_id from public.profiles p where p.id = (select auth.uid()))
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "dian_tax_rules_tenant" on public.dian_tax_rules;
create policy "dian_tax_rules_tenant" on public.dian_tax_rules
  for all to authenticated
  using (
    company_id in (select p.company_id from public.profiles p where p.id = (select auth.uid()))
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'super_admin'))
  )
  with check (
    company_id in (select p.company_id from public.profiles p where p.id = (select auth.uid()))
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "dian_certs_tenant" on public.dian_certificates_issued;
create policy "dian_certs_tenant" on public.dian_certificates_issued
  for all to authenticated
  using (
    company_id in (select p.company_id from public.profiles p where p.id = (select auth.uid()))
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'super_admin'))
  )
  with check (
    company_id in (select p.company_id from public.profiles p where p.id = (select auth.uid()))
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'super_admin'))
  );

-- 5. Semilla inicial de Conceptos DIAN Oficiales (Formatos 1001, 1003, 1005, 1006, 1007, 1008, 1009, 2276)
insert into public.dian_exogena_concepts (id, form_code, concept_code, description) values
  ('1001-5001', '1001', '5001', 'Salarios, prestaciones sociales y demás pagos laborales'),
  ('1001-5002', '1001', '5002', 'Honorarios a personas naturales o jurídicas'),
  ('1001-5003', '1001', '5003', 'Comisiones pagadas'),
  ('1001-5004', '1001', '5004', 'Servicios técnicos y de consultoría'),
  ('1001-5005', '1001', '5005', 'Arrendamientos de bienes muebles e inmuebles'),
  ('1001-5006', '1001', '5006', 'Seguros y reaseguros tomados'),
  ('1001-5007', '1001', '5007', 'Adquisición de mercancías para la venta (inventario)'),
  ('1001-5008', '1001', '5008', 'Adquisición de activos fijos reales productivos'),
  ('1001-5011', '1001', '5011', 'Intereses y demás gastos financieros pagados'),
  ('1001-5015', '1001', '5015', 'Pagos o abonos en cuenta al exterior'),
  ('1003-1301', '1003', '1301', 'Retención en la fuente que le practicaron por ventas de bienes o servicios'),
  ('1003-1302', '1003', '1302', 'Retención de IVA (ReteIVA) que le practicaron clientes'),
  ('1003-1303', '1003', '1303', 'Retención de Industria y Comercio (ReteICA) practicada'),
  ('1005-7001', '1005', '7001', 'Impuesto a las ventas descontable por compras y servicios nacionales'),
  ('1005-7002', '1005', '7002', 'IVA descontable resultante de devoluciones en compras'),
  ('1006-8001', '1006', '8001', 'Impuesto a las ventas generado en operaciones gravadas'),
  ('1006-8002', '1006', '8002', 'IVA resultante de rescisiones, anulaciones o devoluciones en ventas'),
  ('1007-4001', '1007', '4001', 'Ingresos brutos operacionales por venta de bienes'),
  ('1007-4002', '1007', '4002', 'Ingresos brutos operacionales por prestación de servicios'),
  ('1007-4003', '1007', '4003', 'Ingresos no operacionales (financieros, diversos)'),
  ('1008-1315', '1008', '1315', 'Saldo de cuentas por cobrar a clientes nacionales al 31 de diciembre'),
  ('1008-1316', '1008', '1316', 'Saldo de cuentas por cobrar a socios, accionistas y vinculados'),
  ('1009-2201', '1009', '2201', 'Saldo de pasivos con proveedores nacionales al 31 de diciembre'),
  ('1009-2202', '1009', '2202', 'Saldo de pasivos con contratistas, acreedores varios y obligaciones financieras'),
  ('2276-2201', '2276', '2201', 'Certificado de ingresos y retenciones por rentas de trabajo y pensiones')
on conflict (id) do update set
  description = excluded.description,
  active = true;

-- 6. Función RPC: Calcular Formulario 300 DIAN (IVA Bimestral/Cuatrimestral)
create or replace function public.dian_calcular_formulario_300(
  p_company_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ing_grav_19 numeric := 0;
  v_ing_grav_5 numeric := 0;
  v_ing_excl numeric := 0;
  v_iva_gen_19 numeric := 0;
  v_iva_gen_5 numeric := 0;
  v_dev_ventas numeric := 0;
  v_compras_grav_19 numeric := 0;
  v_iva_desc_compras numeric := 0;
  v_saldo_pagar numeric := 0;
  v_saldo_favor numeric := 0;
begin
  -- 1. Acumulado de ventas operacionales de la empresa
  select
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 0 then coalesce(s.subtotal, s.total) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.tax_amount, 0) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.tax_amount, 0) else 0 end), 0)
  into v_ing_grav_19, v_ing_grav_5, v_ing_excl, v_iva_gen_19, v_iva_gen_5
  from public.sales s
  where (s.company_id = p_company_id or (p_company_id is null and s.company_id is null))
    and s.created_at >= p_start_date
    and s.created_at < p_end_date
    and s.status <> 'anulada';

  -- 2. Devoluciones en ventas
  select coalesce(sum(d.amount), 0)
  into v_dev_ventas
  from public.devolutions d
  where (d.company_id = p_company_id or (p_company_id is null and d.company_id is null))
    and d.created_at >= p_start_date
    and d.created_at < p_end_date;

  -- 3. Compras e IVA descontable
  select
    coalesce(sum(p.subtotal), coalesce(sum(p.total - coalesce(p.tax, 0)), 0)),
    coalesce(sum(p.tax), 0)
  into v_compras_grav_19, v_iva_desc_compras
  from public.purchases p
  where (p.company_id = p_company_id or (p_company_id is null and p.company_id is null))
    and p.created_at >= p_start_date
    and p.created_at < p_end_date
    and p.status <> 'anulada';

  -- Liquidación
  if (v_iva_gen_19 + v_iva_gen_5) >= v_iva_desc_compras then
    v_saldo_pagar := (v_iva_gen_19 + v_iva_gen_5) - v_iva_desc_compras;
    v_saldo_favor := 0;
  else
    v_saldo_favor := v_iva_desc_compras - (v_iva_gen_19 + v_iva_gen_5);
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
    'casilla_66_compras_gravadas', round(v_compras_grav_19, 0),
    'casilla_74_iva_descontable_compras', round(v_iva_desc_compras, 0),
    'casilla_83_total_iva_descontable', round(v_iva_desc_compras, 0),
    'casilla_84_saldo_a_pagar', round(v_saldo_pagar, 0),
    'casilla_85_saldo_a_favor', round(v_saldo_favor, 0)
  );
end;
$$;

-- 7. Función RPC: Calcular Formulario 350 DIAN (Retenciones en la Fuente Mensual)
create or replace function public.dian_calcular_formulario_350(
  p_company_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_compras_base numeric := 0;
  v_compras_ret numeric := 0;
  v_servicios_base numeric := 0;
  v_servicios_ret numeric := 0;
  v_honorarios_base numeric := 0;
  v_honorarios_ret numeric := 0;
  v_arrendamientos_base numeric := 0;
  v_arrendamientos_ret numeric := 0;
  v_laborales_base numeric := 0;
  v_laborales_ret numeric := 0;
  v_reteiva_base numeric := 0;
  v_reteiva_ret numeric := 0;
  v_auto_renta_base numeric := 0;
  v_auto_renta_ret numeric := 0;
  v_total_ret numeric := 0;
begin
  -- Consultar cuentas de retención en el libro contable acc_lines
  -- Cuentas 2365 (ReteFuente) y 2367 (ReteIVA)
  select
    coalesce(sum(case when a.code like '236540%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236525%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236515%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236530%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236505%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '2367%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236575%' then coalesce(l.credit - l.debit, 0) else 0 end), 0)
  into
    v_compras_ret,
    v_servicios_ret,
    v_honorarios_ret,
    v_arrendamientos_ret,
    v_laborales_ret,
    v_reteiva_ret,
    v_auto_renta_ret
  from public.acc_lines l
  join public.acc_entries e on e.id = l.entry_id
  join public.acc_accounts a on a.id = l.account_id
  where (e.company_id = p_company_id or (p_company_id is null and e.company_id is null))
    and e.date >= p_start_date::date
    and e.date < p_end_date::date
    and e.status = 'posted';

  -- Si no hay asientos directos, estimar bases a partir de compras y gastos
  if v_compras_ret > 0 then
    v_compras_base := round(v_compras_ret / 0.025, 0);
  end if;
  if v_servicios_ret > 0 then
    v_servicios_base := round(v_servicios_ret / 0.04, 0);
  end if;
  if v_honorarios_ret > 0 then
    v_honorarios_base := round(v_honorarios_ret / 0.11, 0);
  end if;
  if v_arrendamientos_ret > 0 then
    v_arrendamientos_base := round(v_arrendamientos_ret / 0.035, 0);
  end if;
  if v_reteiva_ret > 0 then
    v_reteiva_base := round(v_reteiva_ret / 0.15, 0);
  end if;

  v_total_ret := v_compras_ret + v_servicios_ret + v_honorarios_ret + v_arrendamientos_ret + v_laborales_ret + v_reteiva_ret + v_auto_renta_ret;

  return jsonb_build_object(
    'casilla_27_laborales_base', round(v_laborales_base, 0),
    'casilla_39_laborales_ret', round(v_laborales_ret, 0),
    'casilla_46_honorarios_base', round(v_honorarios_base, 0),
    'casilla_47_honorarios_ret', round(v_honorarios_ret, 0),
    'casilla_50_servicios_base', round(v_servicios_base, 0),
    'casilla_51_servicios_ret', round(v_servicios_ret, 0),
    'casilla_54_arrendamientos_base', round(v_arrendamientos_base, 0),
    'casilla_55_arrendamientos_ret', round(v_arrendamientos_ret, 0),
    'casilla_56_compras_base', round(v_compras_base, 0),
    'casilla_57_compras_ret', round(v_compras_ret, 0),
    'casilla_74_reteiva_base', round(v_reteiva_base, 0),
    'casilla_75_reteiva_ret', round(v_reteiva_ret, 0),
    'casilla_83_autorenta_base', round(v_auto_renta_base, 0),
    'casilla_84_autorenta_ret', round(v_auto_renta_ret, 0),
    'casilla_90_total_retenciones', round(v_total_ret, 0)
  );
end;
$$;

-- 8. Pie de registro obligatorio en sql_migration_log
select public.sql_registrar_migracion(
  '20261109000052_reportes_dian_exogena_y_formularios',
  'Reportes DIAN: Exógena, Formularios Muisca 300 y 350, Retenciones y Certificados',
  '20261109000052_reportes_dian_exogena_y_formularios.sql',
  'sql_editor_manual',
  'Tablas multiempresa para catálogo de conceptos DIAN, mapeo de cuentas PUC acc_* a formatos de exógena, cálculo automático de casillas Muisca 300/350 y registro de certificados tributarios a terceros.'
);
