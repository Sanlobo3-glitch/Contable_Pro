-- supabase/migrations/20261115000065_corregir_permisos_y_seguridad_fase_b.sql
-- Etapa 1: Permisos, autorización, separación de funciones y seguridad multiempresa (Fase B)
-- Idempotente, sin BEGIN/COMMIT.
-- Reglas funcionales aplicadas:
--   1A: Contador con separación de funciones (concilia, asientos manuales, clasifica IVA y DIAN;
--       sin parámetros estructurales, sin PUC/plantilla, sin contabilización en lote acc_post_pending).
--   2A: Comprador (compras directas, proveedores, órdenes de compra; sin anular compras, sin devoluciones ni CxP)
--       y Almacén (exclusivamente recepción física de OC aprobadas/enviadas/parciales vía _registrar_compra_core,
--       sin cambiar pago, días de crédito ni costos unitarios, sin compras directas).
--   3B: admin_empresa con paridad frente a dueno; Gerente con supervisión en compras/CxP/devoluciones/DIAN
--       y conciliación contable, sin compras directas, sin anular compras/devoluciones y sin pagos/créditos CxP.
--   Condiciones 1-2: Perfil activo y company_id = current_company_id() en todas las operaciones;
--       cierre de excepciones globales en dian_account_mappings, dian_tax_rules, dian_certificates_issued,
--       dian_calcular_formulario_300/350, cxp_config y cxp_save_account.

-- =============================================================================
-- 1. HELPERS CENTRALES DE AUTORIZACIÓN Y AISLAMIENTO
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

create or replace function public.can_view_accounting()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.company_id is not null
      and p.company_id = public.current_company_id()
      and p.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
  );
$function$;

create or replace function public.can_write_accounting()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.company_id is not null
      and p.company_id = public.current_company_id()
      and p.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
  );
$function$;

-- =============================================================================
-- 2. CONTABILIDAD: SEPARACIÓN DE FUNCIONES (DECISIÓN 1A / 3B)
-- =============================================================================

create or replace function public.acc_seed_template(p_template text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.current_company_id();
  r record;
  v_n int := 0;
begin
  if auth.uid() is null
     or v_c is null
     or not exists (
       select 1
       from public.profiles pr
       where pr.id = auth.uid()
         and pr.active = true
         and pr.company_id = v_c
         and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente')
     ) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_template <> 'generico' then
    raise exception 'Plantilla no disponible';
  end if;
  if exists (select 1 from public.acc_accounts where company_id = v_c) then
    raise exception 'Tu empresa ya tiene cuentas; la plantilla solo se aplica a un plan vacío';
  end if;

  for r in
    select * from (values
      ('1', 'ACTIVO', 'activo', 'debito', null, false),
      ('1.1', 'Activo corriente', 'activo', 'debito', '1', false),
      ('1.1.01', 'Caja', 'activo', 'debito', '1.1', true),
      ('1.1.02', 'Bancos', 'activo', 'debito', '1.1', true),
      ('1.1.03', 'Cuentas por cobrar clientes', 'activo', 'debito', '1.1', true),
      ('1.1.04', 'Inventario de mercancías', 'activo', 'debito', '1.1', true),
      ('1.1.05', 'Impuestos por recuperar', 'activo', 'debito', '1.1', true),
      ('1.1.06', 'IVA por clasificar en compras', 'activo', 'debito', '1.1', true),
      ('2', 'PASIVO', 'pasivo', 'credito', null, false),
      ('2.1', 'Pasivo corriente', 'pasivo', 'credito', '2', false),
      ('2.1.01', 'Cuentas por pagar proveedores', 'pasivo', 'credito', '2.1', true),
      ('2.1.02', 'Impuestos por pagar', 'pasivo', 'credito', '2.1', true),
      ('3', 'PATRIMONIO', 'patrimonio', 'credito', null, false),
      ('3.1.01', 'Capital', 'patrimonio', 'credito', '3', true),
      ('3.1.02', 'Resultados acumulados', 'patrimonio', 'credito', '3', true),
      ('3.1.03', 'Resultado del ejercicio', 'patrimonio', 'credito', '3', true),
      ('4', 'INGRESOS', 'ingreso', 'credito', null, false),
      ('4.1.01', 'Ventas', 'ingreso', 'credito', '4', true),
      ('4.1.02', 'Devoluciones en ventas', 'ingreso', 'debito', '4', true),
      ('5', 'COSTOS', 'costo', 'debito', null, false),
      ('5.1.01', 'Costo de ventas', 'costo', 'debito', '5', true),
      ('6', 'GASTOS', 'gasto', 'debito', null, false),
      ('6.1.01', 'Gastos operativos', 'gasto', 'debito', '6', true),
      ('6.1.02', 'Ajustes de inventario', 'gasto', 'debito', '6', true)
    ) as t(code, name, type, nature, parent, postable)
  loop
    insert into public.acc_accounts (company_id, code, name, type, nature, parent_id, is_postable)
    values (
      v_c,
      r.code,
      r.name,
      r.type,
      r.nature,
      (select a.id from public.acc_accounts a where a.company_id = v_c and a.code = r.parent),
      r.postable
    );
    v_n := v_n + 1;
  end loop;

  return v_n;
end
$function$;

create or replace function public.acc_save_settings(p_map jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.current_company_id();
  k text;
  v text;
  v_acc public.acc_accounts%rowtype;
  v_cur jsonb;
begin
  if auth.uid() is null
     or v_c is null
     or not exists (
       select 1
       from public.profiles pr
       where pr.id = auth.uid()
         and pr.active = true
         and pr.company_id = v_c
         and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente')
     ) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_map is null or jsonb_typeof(p_map) <> 'object' then
    raise exception 'Mapa de cuentas inválido';
  end if;

  for k, v in select key, value from jsonb_each_text(p_map) loop
    if k not in (
      'caja', 'bancos', 'ventas', 'impuestos', 'costo_ventas', 'inventario',
      'devoluciones', 'gastos', 'otros_ingresos', 'ajustes_inventario',
      'iva_descontable', 'iva_pendiente'
    ) then
      raise exception 'Clave de configuración desconocida: %', k;
    end if;

    if coalesce(btrim(v), '') <> '' then
      begin
        select * into v_acc
        from public.acc_accounts
        where id = v::uuid and company_id = v_c;
      exception when invalid_text_representation then
        raise exception 'El identificador de cuenta para "%" no es un UUID válido', k;
      end;

      if not found or not v_acc.is_postable or not v_acc.active then
        raise exception 'La cuenta elegida para "%" no existe, está inactiva o no admite movimientos', k;
      end if;

      if k in ('iva_descontable', 'iva_pendiente') then
        if v_acc.type <> 'activo' or v_acc.nature <> 'debito' then
          raise exception 'La cuenta para "%" debe ser de tipo activo y naturaleza debito (actual: % / %)',
            k, v_acc.type, v_acc.nature;
        end if;
      end if;
    end if;
  end loop;

  select coalesce(map, '{}'::jsonb) into v_cur
  from public.acc_settings
  where company_id = v_c;
  v_cur := coalesce(v_cur, '{}'::jsonb);

  for k, v in select key, value from jsonb_each_text(p_map) loop
    if coalesce(btrim(v), '') = '' then
      v_cur := v_cur - k;
    else
      v_cur := jsonb_set(v_cur, array[k], to_jsonb(btrim(v)), true);
    end if;
  end loop;

  insert into public.acc_settings (company_id, map)
  values (v_c, v_cur)
  on conflict (company_id) do update
    set map = v_cur,
        updated_at = now();
end
$function$;

create or replace function public.acc_post_pending()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.current_company_id();
  s public.acc_settings;
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
  if auth.uid() is null
     or v_c is null
     or not exists (
       select 1
       from public.profiles pr
       where pr.id = auth.uid()
         and pr.active = true
         and pr.company_id = v_c
         and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente')
     ) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into s from public.acc_settings where company_id = v_c;
  if not found or not s.active then
    raise exception 'Activa primero la contabilidad automática';
  end if;

  for r in
    select * from public.sales x
    where x.company_id = v_c and x.status = 'completada' and jsonb_array_length(x.items) > 0
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'venta'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_sale(r, true) is not null then v_s := v_s + 1; end if;
  end loop;

  for q in
    select * from public.purchases x
    where x.company_id = v_c and x.status = 'recibida' and jsonb_array_length(x.items) > 0
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'compra'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_purchase(q, true) is not null then v_p := v_p + 1; end if;
  end loop;

  for d in
    select * from public.devolutions x
    where x.company_id = v_c and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'devolucion'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_devolution(d, true) is not null then v_d := v_d + 1; end if;
  end loop;

  for c in
    select * from public.cash_entries x
    where x.company_id = v_c and (x.reference_type is null or x.reference_type = 'arqueo')
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c
        and e.source_type in ('caja', 'arqueo') and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_cash(c, true) is not null then v_k := v_k + 1; end if;
  end loop;

  for k in
    select * from public.kardex x
    where x.company_id = v_c and x.reference_type = 'ajuste'
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'ajuste_stock'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_adjustment(k, true) is not null then v_a := v_a + 1; end if;
  end loop;

  for pp in
    select * from public.credit_payments x
    where x.company_id = v_c and x.status = 'activo'
      and (x.created_at at time zone s.timezone)::date >= s.start_date
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
        and (x.created_at at time zone s.timezone)::date >= s.start_date
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
      and (x.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (select 1 from public.acc_entries e where e.company_id = v_c and e.source_type = 'gasto'
        and e.source_id = x.id and e.source_event = 'registro')
    order by x.created_at
  loop
    if public.acc_post_expense(ex.id) is not null then v_g := v_g + 1; end if;
  end loop;

  for pd in
    select * from public.purchase_devolutions x
    where x.company_id = v_c and x.status = 'activa'
      and (x.created_at at time zone s.timezone)::date >= s.start_date
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
as $function$
declare
  v_c uuid := public.current_company_id();
  v_id uuid;
  v_l jsonb;
begin
  if auth.uid() is null or v_c is null or not public.can_write_accounting() then
    raise exception 'No autorizado' using errcode = '42501';
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
$function$;

create or replace function public.acc_post_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.current_company_id();
begin
  if auth.uid() is null or v_c is null or not public.can_write_accounting() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  update public.acc_entries
  set status = 'contabilizado',
      posted_by = auth.uid()
  where id = p_entry_id
    and company_id = v_c
    and status = 'borrador';

  if not found then
    raise exception 'El asiento no existe o ya no es un borrador';
  end if;
end;
$function$;

create or replace function public.acc_reconcile()
returns table(code text, label text, operational numeric, accounting numeric, difference numeric, note text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.current_company_id();
  s public.acc_settings;
  a numeric;
  b numeric;
  k int;
  x uuid;
  v_iva_desc uuid;
  v_iva_pend uuid;
  v_dev_inv numeric := 0;
  v_dev_desc numeric := 0;
  v_dev_pend numeric := 0;
  v_other_vat numeric := 0;
  v_has_dev_iva boolean;
begin
  if auth.uid() is null or v_c is null or not public.can_view_accounting() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into s from public.acc_settings where company_id = v_c;
  if not found or s.start_date is null then
    raise exception 'Configura y activa la contabilidad automática antes de conciliar';
  end if;

  v_has_dev_iva := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_devolutions' and column_name = 'tax_amount'
  );

  -- 1. Ventas sin impuesto
  select coalesce(sum(x2.total - x2.tax_amount), 0) into a
  from public.sales x2
  where x2.company_id = v_c and x2.status = 'completada'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.credit - l.debit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'venta'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'ventas')::uuid;

  code := 'ventas'; label := 'Ventas sin impuesto'; operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0'; return next;

  -- 2. Ventas pendientes de contabilizar
  select count(*) into k from public.sales x2
  where x2.company_id = v_c and x2.status = 'completada' and jsonb_array_length(x2.items) > 0
    and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'venta'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  code := 'ventas_pendientes'; label := 'Ventas sin contabilizar (cantidad)'; operational := k; accounting := 0;
  difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;

  -- 3. Compras recibidas originales
  select coalesce(sum(
    coalesce(x2.subtotal, x2.total - coalesce(x2.tax, 0))
    + case when x2.tax_status = 'costo' and x2.iva_classified_at is null then coalesce(x2.tax, 0) else 0 end
  ), 0) into a
  from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'compra'
    and e.source_event = 'registro'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'compras'; label := 'Compras recibidas (registro original en inventario)';
  operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0 (excluye IVA descontable/pendiente y reclasificaciones posteriores)'; return next;

  -- 4. Reclasificaciones de IVA capitalizadas en inventario remanente
  select coalesce(sum(adj.amount_to_inventory), 0) into a
  from public.purchase_iva_adjustments adj
  where adj.company_id = v_c
    and adj.status = 'aplicado'
    and adj.to_status = 'costo'
    and (adj.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'compra'
    and e.source_event = 'reclasificacion_iva'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'compras_reclasificacion_inv';
  label := 'IVA reclasificado a inventario remanente';
  operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0 (IVA no descontable de unidades aún en inventario)'; return next;

  -- 5. Devoluciones a proveedores
  if v_has_dev_iva then
    execute $q$
      select coalesce(sum(coalesce(pd.inventory_credit,
        case when pd.tax_status_snapshot = 'costo' then pd.amount else coalesce(pd.subtotal, pd.amount - coalesce(pd.tax_amount, 0)) end
      )), 0)
      from public.purchase_devolutions pd
      where pd.company_id = $1 and pd.status = 'activa'
        and (pd.created_at at time zone $2)::date >= $3
    $q$ into v_dev_inv using v_c, s.timezone, s.start_date;
  else
    select coalesce(sum(pd.amount), 0) into v_dev_inv
    from public.purchase_devolutions pd
    where pd.company_id = v_c and pd.status = 'activa'
      and (pd.created_at at time zone s.timezone)::date >= s.start_date;
  end if;

  select coalesce(sum(l.credit - l.debit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'devolucion_compra'
    and e.source_event = 'registro'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'devoluciones_compra_inv';
  label := 'Devoluciones a proveedor (crédito a inventario)';
  operational := v_dev_inv; accounting := b; difference := v_dev_inv - b;
  note := 'Debe ser 0'; return next;

  -- 6. IVA reclasificado a costo de ventas
  select coalesce(sum(adj.amount_to_expense), 0) into a
  from public.purchase_iva_adjustments adj
  where adj.company_id = v_c
    and adj.status = 'aplicado'
    and adj.to_status = 'costo'
    and (adj.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.source_type = 'compra'
    and e.source_event = 'reclasificacion_iva'
    and e.status = 'contabilizado'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'costo_ventas')::uuid;

  code := 'iva_compras_costo_gasto';
  label := 'IVA reclasificado a costo de ventas (unidades vendidas)';
  operational := a; accounting := b; difference := a - b;
  note := 'Debe ser 0 (diferenciado del inventario remanente)'; return next;

  -- 7. IVA descontable neto vigente en compras
  begin
    v_iva_desc := nullif(btrim(coalesce(s.map->>'iva_descontable', '')), '')::uuid;
  exception when others then
    v_iva_desc := null;
  end;

  select coalesce(sum(x2.tax), 0) into a
  from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida' and x2.tax_status = 'descontable'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  if v_has_dev_iva then
    execute $q$
      select coalesce(sum(pd.tax_amount), 0)
      from public.purchase_devolutions pd
      join public.purchases p on p.id = pd.purchase_id
      where pd.company_id = $1 and pd.status = 'activa'
        and p.status = 'recibida'
        and p.tax_status = 'descontable'
        and (pd.created_at at time zone $2)::date >= $3
    $q$ into v_dev_desc using v_c, s.timezone, s.start_date;
  end if;
  a := a - v_dev_desc;

  if v_iva_desc is not null then
    select coalesce(sum(l.debit - l.credit), 0) into b
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type in ('compra', 'devolucion_compra')
      and e.entry_date >= s.start_date
      and l.account_id = v_iva_desc;
  else
    b := 0;
  end if;

  code := 'iva_compras_descontable';
  label := 'IVA descontable en compras (neto vigente desde inicio)';
  operational := a; accounting := b; difference := a - b;
  note := case when v_iva_desc is null then 'Configura la cuenta iva_descontable en Config. contable' else 'Debe ser 0' end;
  return next;

  -- 8. IVA pendiente neto vigente en compras
  begin
    v_iva_pend := nullif(btrim(coalesce(s.map->>'iva_pendiente', '')), '')::uuid;
  exception when others then
    v_iva_pend := null;
  end;

  select coalesce(sum(x2.tax), 0) into a
  from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida' and x2.tax_status = 'pendiente'
    and (x2.created_at at time zone s.timezone)::date >= s.start_date;

  if v_has_dev_iva then
    execute $q$
      select coalesce(sum(pd.tax_amount), 0)
      from public.purchase_devolutions pd
      join public.purchases p on p.id = pd.purchase_id
      where pd.company_id = $1 and pd.status = 'activa'
        and p.status = 'recibida'
        and p.tax_status = 'pendiente'
        and (pd.created_at at time zone $2)::date >= $3
    $q$ into v_dev_pend using v_c, s.timezone, s.start_date;
  end if;
  a := a - v_dev_pend;

  if v_iva_pend is not null then
    select coalesce(sum(l.debit - l.credit), 0) into b
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type in ('compra', 'devolucion_compra')
      and e.entry_date >= s.start_date
      and l.account_id = v_iva_pend;
  else
    b := 0;
  end if;

  code := 'iva_compras_pendiente';
  label := 'IVA de compras por clasificar (pendiente desde inicio)';
  operational := a; accounting := b; difference := a - b;
  note := case when v_iva_pend is null then 'Configura la cuenta iva_pendiente en Config. contable' else 'Debe ser 0' end;
  return next;

  if v_iva_desc is not null or v_iva_pend is not null then
    select coalesce(sum(l.debit - l.credit), 0) into v_other_vat
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type not in ('compra', 'devolucion_compra', 'reverso')
      and e.entry_date >= s.start_date
      and l.account_id in (v_iva_desc, v_iva_pend);
    if abs(v_other_vat) >= 0.01 then
      code := 'iva_compras_otros_asientos';
      label := 'Asientos manuales u otros en cuentas IVA de compras';
      operational := 0; accounting := v_other_vat; difference := -v_other_vat;
      note := 'Saldo proveniente de asientos no originados en compras/devoluciones desde start_date';
      return next;
    end if;
  end if;

  -- 9. Compras pendientes de contabilizar
  select count(*) into k from public.purchases x2
  where x2.company_id = v_c and x2.status = 'recibida' and jsonb_array_length(x2.items) > 0
    and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'compra'
        and e.source_id = x2.id and e.source_event = 'registro'
        and e.status = 'contabilizado'
    );
  if k > 0 then
    code := 'compras_pendientes'; label := 'Compras sin contabilizar (cantidad)'; operational := k; accounting := 0;
    difference := k; note := 'Si compraste a crédito, elige la cuenta en Cuentas por pagar o usa "Contabilizar pendientes"'; return next;
  end if;

  -- 10. Devoluciones de ventas pendientes
  select count(*) into k from public.devolutions x2
  where x2.company_id = v_c and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'devolucion'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  code := 'devoluciones_pendientes'; label := 'Devoluciones de ventas sin contabilizar (cantidad)'; operational := k;
  accounting := 0; difference := k; note := 'Debe ser 0'; return next;

  -- 11. Devoluciones a proveedores pendientes
  select count(*) into k from public.purchase_devolutions x2
  where x2.company_id = v_c and x2.status = 'activa' and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'devolucion_compra'
        and e.source_id = x2.id and e.source_event = 'registro'
        and e.status = 'contabilizado'
    );
  if k > 0 then
    code := 'devoluciones_compra_pendientes'; label := 'Devoluciones a proveedores sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
  end if;

  -- 12. Gastos operativos pendientes
  select count(*) into k from public.expenses x2
  where x2.company_id = v_c and x2.status = 'activo' and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'gasto'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  if k > 0 then
    code := 'gastos_pendientes'; label := 'Gastos operativos sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Configura la cuenta de Gastos en Config. contable y usa "Contabilizar pendientes"'; return next;
  end if;

  -- 13. Ajustes de stock pendientes
  select count(*) into k from public.kardex x2
  where x2.company_id = v_c and x2.reference_type = 'ajuste' and (x2.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type = 'ajuste_stock'
        and e.source_id = x2.id and e.source_event = 'registro'
    );
  code := 'ajustes_pendientes'; label := 'Ajustes de stock sin contabilizar (cantidad)'; operational := k;
  accounting := 0; difference := k;
  note := 'Si hay pendientes, configura la cuenta de ajustes de inventario'; return next;

  -- 14. Caja
  select coalesce(sum(case when c.type = 'ingreso' then c.amount else -c.amount end), 0) into a
  from public.cash_entries c
  where c.company_id = v_c and (c.created_at at time zone s.timezone)::date >= s.start_date;

  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.status = 'contabilizado'
    and e.source_type <> 'reverso'
    and e.entry_date >= s.start_date
    and l.account_id = (s.map->>'caja')::uuid;

  code := 'caja'; label := 'Movimiento de caja desde el inicio'; operational := a; accounting := b;
  difference := a - b; note := 'Debe ser 0 cuando no haya movimientos pendientes'; return next;

  -- 15. Caja manual y arqueos pendientes
  select coalesce(sum(case when c.type = 'ingreso' then c.amount else -c.amount end), 0) into a
  from public.cash_entries c
  where c.company_id = v_c and (c.reference_type is null or c.reference_type = 'arqueo')
    and (c.created_at at time zone s.timezone)::date >= s.start_date
    and not exists (
      select 1 from public.acc_entries e
      where e.company_id = v_c and e.source_type in ('caja', 'arqueo')
        and e.source_id = c.id and e.source_event = 'registro'
    );
  code := 'caja_pendiente'; label := 'Caja manual y arqueos sin contabilizar'; operational := a; accounting := 0;
  difference := a; note := 'Si hay pendientes, configura Gastos y Otros ingresos'; return next;

  -- 16. Inventario físico remanente vs saldo contable
  select coalesce(sum(p.stock * p.cost), 0) into a from public.products p where p.company_id = v_c;
  select coalesce(sum(l.debit - l.credit), 0) into b
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where e.company_id = v_c
    and e.status = 'contabilizado'
    and e.source_type <> 'reverso'
    and l.account_id = (s.map->>'inventario')::uuid;

  code := 'inventario'; label := 'Inventario remanente'; operational := a; accounting := b; difference := a - b;
  note := 'Valorado al costo promedio. La contabilidad empieza en cero salvo que cargues un asiento de apertura';
  return next;

  -- 17. Cartera CxC
  select account_id into x from public.cxc_settings where company_id = v_c;
  if x is not null then
    select coalesce(sum(public._sale_balance(f.id)), 0) into a from public.sales f
    where f.company_id = v_c and f.status = 'completada'
      and (
        f.payment_method = 'fiado'
        or exists (select 1 from public.sale_payments sp where sp.sale_id = f.id and sp.method = 'fiado')
      )
      and (f.created_at at time zone s.timezone)::date >= s.start_date;

    select coalesce(sum(l.debit - l.credit), 0) into b
    from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
    where e.company_id = v_c
      and e.status = 'contabilizado'
      and e.source_type <> 'reverso'
      and l.account_id = x;

    code := 'cartera'; label := 'Cartera de clientes (fiado)'; operational := a; accounting := b;
    difference := a - b;
    note := 'Debe ser 0 cuando no haya pendientes';
    return next;

    select count(*) into k from public.credit_payments y
    where y.company_id = v_c and y.status = 'activo' and (y.created_at at time zone s.timezone)::date >= s.start_date
      and not exists (
        select 1 from public.acc_entries e
        where e.company_id = v_c and e.source_type = 'abono'
          and e.source_id = y.id and e.source_event = 'registro'
      );
    code := 'abonos_pendientes'; label := 'Abonos de clientes sin contabilizar (cantidad)'; operational := k;
    accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
  end if;

  -- 18. Cuentas por pagar CxP
  if to_regclass('public.cxp_settings') is not null then
    select account_id into x from public.cxp_settings where company_id = v_c;
    if x is not null then
      select coalesce(sum(public._purchase_balance(f.id)), 0) into a from public.purchases f
      where f.company_id = v_c and f.payment_method = 'credito' and f.status = 'recibida'
        and (f.created_at at time zone s.timezone)::date >= s.start_date;

      select coalesce(sum(l.credit - l.debit), 0) into b
      from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
      where e.company_id = v_c
        and e.status = 'contabilizado'
        and e.source_type <> 'reverso'
        and l.account_id = x;

      code := 'cuentas_por_pagar'; label := 'Cuentas por pagar a proveedores'; operational := a; accounting := b;
      difference := a - b;
      note := 'Debe ser 0 cuando no haya pendientes';
      return next;

      select count(*) into k from public.supplier_payments y
      where y.company_id = v_c and y.status = 'activo' and (y.created_at at time zone s.timezone)::date >= s.start_date
        and not exists (
          select 1 from public.acc_entries e
          where e.company_id = v_c and e.source_type = 'pago_proveedor'
            and e.source_id = y.id and e.source_event = 'registro'
        );
      code := 'pagos_proveedor_pendientes'; label := 'Pagos a proveedores sin contabilizar (cantidad)'; operational := k;
      accounting := 0; difference := k; note := 'Si hay pendientes, usa "Contabilizar pendientes"'; return next;
    end if;
  end if;
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
set search_path to ''
as $function$
declare
  v_c uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
  v_name text;
  v_id uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la reapertura';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

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

  begin
    insert into public.audit_log (company_id, user_id, user_name, action, table_name, record_id, detail)
    values (
      v_c,
      auth.uid(),
      v_name,
      'reapertura_contable',
      'acc_closings',
      v_id,
      jsonb_build_object('year', p_year, 'month', p_month, 'motivo', btrim(p_reason))
    );
  exception when others then null;
  end;
end
$function$;

-- =============================================================================
-- 3. COMPRAS, ÓRDENES DE COMPRA Y RECEPCIÓN DE ALMACÉN (DECISIONES 2A Y 3B)
-- =============================================================================

-- Núcleo privado no exponible a roles públicos: permite que recibir_orden_compra
-- ingrese la compra derivada sin ampliar registrar_compra* al rol almacen.
create or replace function public._registrar_compra_core(
  p_co uuid,
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_credit_days integer,
  p_tax numeric,
  p_tax_status text,
  p_tax_rate numeric,
  p_tax_included boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := p_co;
  e jsonb;
  v_prod public.products%rowtype;
  v_pid uuid;
  v_qty numeric;
  v_raw_cost numeric;
  v_items_sum numeric := 0;
  v_line_count int := 0;
  v_idx int := 0;
  v_tax_rate numeric := p_tax_rate;
  v_tax_incl boolean := coalesce(p_tax_included, false);
  v_tax numeric;
  v_tax_status text := coalesce(nullif(btrim(coalesce(p_tax_status, '')), ''), 'sin_iva');
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_line_base numeric;
  v_line_tax numeric;
  v_rem_base numeric;
  v_rem_tax numeric;
  v_eff_unit_cost numeric;
  v_inv_add numeric;
  v_new_cost numeric;
  v_sup text;
  v_exp date;
  v_lot text;
  v_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_new numeric;
  v_pay text := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'efectivo');
  v_limit numeric := 0;
  v_days integer := 30;
  v_due date := null;
  v_owed numeric := 0;
  v_s public.acc_settings%rowtype;
  v_pur_date date;
begin
  if v_co is null then
    raise exception 'Empresa inválida';
  end if;

  if v_pay not in ('efectivo', 'tarjeta', 'transferencia', 'credito') then
    raise exception 'Forma de pago de compra inválida';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra no tiene items';
  end if;

  if p_tax is not null and (not public._es_finito(p_tax) or p_tax < 0) then
    raise exception 'El valor del IVA de compra no puede ser negativo ni inválido';
  end if;

  if v_tax_rate is not null and (not public._es_finito(v_tax_rate) or v_tax_rate < 0 or v_tax_rate > 100) then
    raise exception 'La tarifa de IVA debe estar entre 0 y 100';
  end if;

  if v_tax_status not in ('sin_iva', 'descontable', 'pendiente', 'costo') then
    raise exception 'Estado tributario de IVA inválido: %', v_tax_status;
  end if;

  for e in select x from jsonb_array_elements(p_items) x loop
    v_qty := public._item_num(e, 'quantity');
    v_raw_cost := public._item_num(e, 'cost');
    if v_qty <= 0 or v_raw_cost < 0 then
      raise exception 'Cantidad o costo inválido';
    end if;
    v_items_sum := v_items_sum + round(v_qty * v_raw_cost, 2);
    v_line_count := v_line_count + 1;
  end loop;
  v_items_sum := round(v_items_sum, 2);

  if p_tax is null then
    if coalesce(v_tax_rate, 0) > 0 and v_items_sum > 0 then
      if v_tax_incl then
        v_tax := round(v_items_sum - (v_items_sum / (1 + v_tax_rate / 100.0)), 2);
      else
        v_tax := round(v_items_sum * (v_tax_rate / 100.0), 2);
      end if;
    else
      v_tax := 0;
    end if;
  else
    v_tax := round(p_tax, 2);
    if v_tax = 0 and v_tax_incl and coalesce(v_tax_rate, 0) > 0 and v_items_sum > 0 then
      v_tax := round(v_items_sum - (v_items_sum / (1 + v_tax_rate / 100.0)), 2);
    end if;
  end if;

  if v_tax_incl then
    if v_tax > v_items_sum then
      raise exception 'El IVA incluido (%) no puede superar el total bruto (%)', v_tax, v_items_sum;
    end if;
    v_total := v_items_sum;
    v_subtotal := round(v_total - v_tax, 2);
  else
    v_subtotal := v_items_sum;
    v_total := round(v_subtotal + v_tax, 2);
  end if;

  if v_tax = 0 then
    v_tax_status := 'sin_iva';
  else
    if v_subtotal <= 0 then
      raise exception 'No se puede registrar IVA > 0 sobre base gravable igual o menor a 0';
    end if;
    if v_tax_status = 'sin_iva' then
      raise exception 'Una compra con IVA > 0 requiere estado descontable, pendiente o costo';
    end if;
  end if;

  if p_supplier_id is not null then
    select name into v_sup from public.suppliers where id = p_supplier_id and company_id = v_co;
    if not found then
      raise exception 'Proveedor no existe';
    end if;
  end if;

  if v_pay = 'credito' then
    if p_supplier_id is null then
      raise exception 'Para registrar una compra a crédito debes elegir un proveedor registrado';
    end if;
    perform 1 from public.suppliers where id = p_supplier_id and company_id = v_co for update;
    if to_regclass('public.supplier_credit') is not null then
      select coalesce(credit_limit, 0), coalesce(credit_days, 30)
        into v_limit, v_days
        from public.supplier_credit
        where supplier_id = p_supplier_id and company_id = v_co;
      if not found then
        v_limit := 0;
        v_days := 30;
      end if;
    end if;
    if p_credit_days is not null then
      if p_credit_days < 0 or p_credit_days > 365 then
        raise exception 'Los días de plazo deben estar entre 0 y 365';
      end if;
      v_days := p_credit_days;
    end if;
    v_due := public._co_today(v_co) + v_days;
  end if;

  select * into v_s from public.acc_settings where company_id = v_co;
  if v_s.company_id is not null and v_s.active and v_s.start_date is not null then
    v_pur_date := (now() at time zone v_s.timezone)::date;
    if v_pur_date >= v_s.start_date and v_total > 0 and v_tax > 0 and v_tax_status in ('descontable', 'pendiente') then
      perform public._acc_resolve_purchase_vat_account(v_co, v_tax_status);
    end if;
  end if;

  insert into public.purchases (
    company_id, supplier_id, supplier_name, items, total, subtotal, tax,
    tax_rate, tax_included, tax_status, recognized_cost,
    status, payment_method, due_date, credit_days
  ) values (
    v_co, p_supplier_id, v_sup, '[]'::jsonb, 0, v_subtotal, v_tax,
    v_tax_rate, v_tax_incl, v_tax_status,
    case when v_tax_status = 'costo' then v_total else v_subtotal end,
    'recibida', v_pay, v_due, case when v_pay = 'credito' then v_days else null end
  )
  returning id into v_id;

  v_rem_base := v_subtotal;
  v_rem_tax := v_tax;

  for e in select x from jsonb_array_elements(p_items) x order by x->>'product_id' loop
    v_idx := v_idx + 1;
    v_pid := public._item_uuid(e, 'product_id');
    v_qty := public._item_num(e, 'quantity');
    v_raw_cost := public._item_num(e, 'cost');

    select * into v_prod
    from public.products
    where id = v_pid and company_id = v_co
    for update;
    if not found then
      raise exception 'Producto no existe';
    end if;

    if v_idx = v_line_count then
      v_line_base := v_rem_base;
      v_line_tax := v_rem_tax;
    elsif v_items_sum > 0 then
      v_line_base := round(v_subtotal * (round(v_qty * v_raw_cost, 2) / v_items_sum), 2);
      v_line_tax := round(v_tax * (round(v_qty * v_raw_cost, 2) / v_items_sum), 2);
    else
      v_line_base := 0;
      v_line_tax := 0;
    end if;
    v_rem_base := v_rem_base - v_line_base;
    v_rem_tax := v_rem_tax - v_line_tax;

    v_inv_add := v_line_base + case when v_tax_status = 'costo' then v_line_tax else 0 end;
    v_eff_unit_cost := round(v_inv_add / v_qty, 4);

    v_new := v_prod.stock + v_qty;
    if v_prod.stock > 0 and v_new > 0 then
      v_new_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) + v_inv_add) / v_new, 2);
    else
      v_new_cost := round(v_eff_unit_cost, 2);
    end if;

    update public.products
    set stock = v_new,
        cost = v_new_cost
    where id = v_prod.id;

    insert into public.kardex (
      company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id
    ) values (
      v_co, v_prod.id, v_prod.name, 'entrada', v_qty, v_new, 'purchase', v_id
    );

    v_exp := null;
    v_lot := null;
    if v_prod.tracks_expiry then
      if coalesce(e->>'expiry_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'El producto "%" maneja vencimiento: indica la fecha de vencimiento del lote', v_prod.name;
      end if;
      v_exp := (e->>'expiry_date')::date;
      if v_exp < public._co_today(v_co) then
        raise exception 'La fecha de vencimiento de "%" ya pasó', v_prod.name;
      end if;
      if v_exp > date '2100-01-01' then
        raise exception 'Fecha de vencimiento inválida para "%"', v_prod.name;
      end if;
      v_lot := coalesce(nullif(left(btrim(coalesce(e->>'lot_code', '')), 40), ''), 'S/L');

      insert into public.product_lots (
        company_id, product_id, lot_code, expiry_date, qty_initial, qty_remaining, cost, source_type, source_id
      ) values (
        v_co, v_prod.id, v_lot, v_exp, v_qty, v_qty, v_eff_unit_cost, 'compra', v_id
      );
    end if;

    v_items := v_items || (
      jsonb_build_object(
        'product_id', v_prod.id,
        'product_name', v_prod.name,
        'quantity', v_qty,
        'cost', round(v_line_base / v_qty, 4),
        'unit_base_cost', round(v_line_base / v_qty, 4),
        'tax_amount', v_line_tax,
        'recognized_unit_cost', v_eff_unit_cost,
        'prev_cost', v_prod.cost,
        'subtotal', v_line_base,
        'line_total', v_line_base + v_line_tax
      ) || case when v_exp is not null then jsonb_build_object('lot_code', v_lot, 'expiry_date', v_exp) else '{}'::jsonb end
    );
  end loop;

  if v_pay = 'credito' and v_limit > 0 then
    v_owed := public._supplier_owed(v_co, p_supplier_id);
    if v_owed + v_total > v_limit then
      raise exception 'Supera el cupo de crédito con este proveedor (cupo: %, debes: %, esta compra: %)',
        round(v_limit, 2), round(v_owed, 2), round(v_total, 2);
    end if;
  end if;

  update public.purchases
  set items = v_items,
      total = v_total,
      subtotal = v_subtotal,
      tax = v_tax,
      recognized_cost = case when v_tax_status = 'costo' then v_total else v_subtotal end
  where id = v_id;

  if v_pay = 'efectivo' then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', v_total, 'Compra - ' || coalesce(v_sup, 'Proveedor general'), 'purchase', v_id);
  end if;

  return v_id;
end
$function$;

create or replace function public._registrar_compra_impl(
  p_supplier_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_credit_days integer,
  p_tax numeric,
  p_tax_status text,
  p_tax_rate numeric,
  p_tax_included boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'comprador']);
begin
  return public._registrar_compra_core(
    v_co,
    p_supplier_id,
    p_items,
    p_payment_method,
    p_credit_days,
    p_tax,
    p_tax_status,
    p_tax_rate,
    p_tax_included
  );
end
$function$;

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
  v_po_id uuid;
  v_seq integer;
  v_po_number text;
  v_sup_name text := 'Proveedor general';
  v_actor_name text;
  v_total numeric(14,2) := 0;
  v_item jsonb;
  v_prod record;
  v_qty numeric;
  v_cost numeric;
begin
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

  if p_target_warehouse_id is not null and not exists (
    select 1 from public.warehouses where id = p_target_warehouse_id and company_id = v_co and active = true
  ) then
    raise exception 'Bodega destino inválida, inactiva o de otra empresa';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario') into v_actor_name
  from public.profiles where id = auth.uid();

  select count(*) + 1 into v_seq from public.purchase_orders where company_id = v_co;
  v_po_number := 'OC-' || lpad(v_seq::text, 4, '0');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'ordered_qty')::numeric, (v_item->>'quantity')::numeric, 0);
    v_cost := coalesce((v_item->>'unit_cost')::numeric, (v_item->>'cost')::numeric, 0);
    if v_qty <= 0 or v_cost < 0 then
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
    case when p_auto_approve then 'approved' else 'draft' end,
    coalesce(p_payment_terms, 'credito'),
    coalesce(p_credit_days, 30),
    p_expected_date, v_total, v_total,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), v_actor_name,
    case when p_auto_approve then v_actor_name else null end,
    case when p_auto_approve then now() else null end
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
  v_cur text;
  v_actor text;
begin
  select status into v_cur from public.purchase_orders where id = p_po_id and company_id = v_co for update;
  if not found then
    raise exception 'Orden de compra no encontrada';
  end if;
  if v_cur in ('received', 'cancelled') then
    raise exception 'No se puede modificar una orden ya cerrada o cancelada';
  end if;
  if p_status not in ('approved', 'sent', 'cancelled') then
    raise exception 'Estado de transición inválido';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario') into v_actor
  from public.profiles where id = auth.uid();

  update public.purchase_orders
     set status = p_status,
         approved_by_name = case when p_status = 'approved' then v_actor else approved_by_name end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         updated_at = now()
   where id = p_po_id and company_id = v_co;
end;
$function$;

create or replace function public.recibir_orden_compra(
  p_po_id uuid,
  p_warehouse_id uuid default null::uuid,
  p_lines jsonb default '[]'::jsonb,
  p_payment_method text default null::text,
  p_credit_days integer default null::integer
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'comprador', 'almacen']);
  v_actor_role text;
  v_po record;
  v_line jsonb;
  v_item record;
  v_item_id uuid;
  v_seen_ids uuid[] := '{}'::uuid[];
  v_rec_now numeric;
  v_rej_now numeric;
  v_req_cost numeric;
  v_unit_cost numeric;
  v_purchase_items jsonb := '[]'::jsonb;
  v_purchase_id uuid;
  v_all_fulfilled boolean := true;
  v_wh uuid;
  v_before numeric;
  v_after numeric;
  v_method text;
  v_days integer;
begin
  select pr.role into v_actor_role
  from public.profiles pr
  where pr.id = auth.uid() and pr.active = true and pr.company_id = v_co;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Debes enviar las líneas a recibir de la orden de compra';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id and company_id = v_co for update;
  if not found then
    raise exception 'Orden de compra no encontrada';
  end if;
  if v_po.status not in ('approved', 'sent', 'partial') then
    raise exception 'Solo se pueden recibir órdenes de compra aprobadas, enviadas o parciales (estado actual: %)', v_po.status;
  end if;

  v_wh := coalesce(p_warehouse_id, v_po.target_warehouse_id);
  if v_wh is not null and not exists (
    select 1 from public.warehouses w where w.id = v_wh and w.company_id = v_co and w.active = true
  ) then
    raise exception 'La bodega destino no existe, está inactiva o pertenece a otra empresa';
  end if;

  if v_actor_role = 'almacen' then
    if nullif(btrim(coalesce(p_payment_method, '')), '') is not null
       and btrim(p_payment_method) is distinct from coalesce(v_po.payment_terms, 'credito') then
      raise exception 'El rol almacén no puede modificar la condición de pago de la orden de compra' using errcode = '42501';
    end if;
    if p_credit_days is not null
       and p_credit_days is distinct from coalesce(v_po.credit_days, 30) then
      raise exception 'El rol almacén no puede modificar los días de crédito de la orden de compra' using errcode = '42501';
    end if;
    v_method := coalesce(v_po.payment_terms, 'credito');
    v_days := coalesce(v_po.credit_days, 30);
  else
    v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), v_po.payment_terms, 'credito');
    v_days := coalesce(p_credit_days, v_po.credit_days, 30);
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      v_item_id := (v_line->>'item_id')::uuid;
    exception when others then
      raise exception 'Identificador de renglón inválido en recepción de OC';
    end;

    if v_item_id is null then
      raise exception 'Falta item_id en línea de recepción de OC';
    end if;
    if v_item_id = any(v_seen_ids) then
      raise exception 'Línea duplicada (%) en recepción de orden de compra', v_item_id;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);

    select * into v_item
      from public.purchase_order_items
     where id = v_item_id and po_id = p_po_id and company_id = v_co
     for update;

    if not found then
      raise exception 'El renglón % no pertenece a esta orden de compra', v_item_id;
    end if;

    v_rec_now := coalesce((v_line->>'received_now')::numeric, 0);
    v_rej_now := coalesce((v_line->>'rejected_now')::numeric, 0);
    if v_rec_now < 0 or v_rej_now < 0 then
      raise exception 'Las cantidades recibidas y rechazadas no pueden ser negativas';
    end if;

    if (coalesce(v_item.received_qty, 0) + coalesce(v_item.rejected_qty, 0) + v_rec_now + v_rej_now)
       > coalesce(v_item.ordered_qty, 0) + 0.0001 then
      raise exception 'La cantidad recibida/rechazada de "%" supera lo ordenado (%)', v_item.product_name, v_item.ordered_qty;
    end if;

    if (v_line ? 'unit_cost') and nullif(btrim(coalesce(v_line->>'unit_cost', '')), '') is not null then
      v_req_cost := (v_line->>'unit_cost')::numeric;
      if v_req_cost < 0 then
        raise exception 'El costo unitario no puede ser negativo';
      end if;
      if v_actor_role = 'almacen' and abs(v_req_cost - coalesce(v_item.unit_cost, 0)) > 0.0001 then
        raise exception 'El rol almacén no puede modificar el costo unitario pactado en la orden de compra' using errcode = '42501';
      end if;
      v_unit_cost := v_req_cost;
    else
      v_unit_cost := coalesce(v_item.unit_cost, 0);
    end if;

    if v_rec_now > 0 then
      v_purchase_items := v_purchase_items || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'product_id', v_item.product_id,
          'product_name', v_item.product_name,
          'quantity', v_rec_now,
          'cost', v_unit_cost,
          'subtotal', round(v_rec_now * v_unit_cost, 2),
          'lot_code', nullif(btrim(coalesce(v_line->>'lot_code', '')), ''),
          'expiry_date', nullif(btrim(coalesce(v_line->>'expiry_date', '')), '')
        ))
      );
    end if;

    update public.purchase_order_items
       set received_qty = received_qty + v_rec_now,
           rejected_qty = rejected_qty + v_rej_now,
           unit_cost = v_unit_cost,
           lot_code = coalesce(nullif(btrim(coalesce(v_line->>'lot_code', '')), ''), lot_code),
           expiry_date = coalesce(nullif(btrim(coalesce(v_line->>'expiry_date', '')), '')::date, expiry_date)
     where id = v_item.id and company_id = v_co;
  end loop;

  if jsonb_array_length(v_purchase_items) = 0 then
    raise exception 'Indica al menos una unidad recibida conforme para ingresar al inventario';
  end if;

  v_purchase_id := public._registrar_compra_core(
    v_co,
    v_po.supplier_id,
    v_purchase_items,
    v_method,
    case when v_method = 'credito' then v_days else null end,
    0,
    'sin_iva',
    null,
    false
  );

  update public.purchases
     set branch_id = v_po.branch_id,
         warehouse_id = v_wh
   where id = v_purchase_id and company_id = v_co;

  if v_wh is not null then
    for v_line in select * from jsonb_array_elements(v_purchase_items) loop
      v_rec_now := (v_line->>'quantity')::numeric;
      insert into public.warehouse_stock (company_id, warehouse_id, product_id, quantity, reserved_quantity)
      values (v_co, v_wh, (v_line->>'product_id')::uuid, 0, 0)
      on conflict (warehouse_id, product_id) do nothing;

      select quantity into v_before
        from public.warehouse_stock
       where company_id = v_co and warehouse_id = v_wh and product_id = (v_line->>'product_id')::uuid
       for update;

      v_after := coalesce(v_before, 0) + v_rec_now;

      update public.warehouse_stock
         set quantity = v_after, updated_at = now()
       where company_id = v_co and warehouse_id = v_wh and product_id = (v_line->>'product_id')::uuid;

      insert into public.warehouse_movements (
        company_id, warehouse_id, product_id, movement_type,
        quantity_delta, quantity_before, quantity_after,
        reference_type, reference_id, notes, created_by
      ) values (
        v_co, v_wh, (v_line->>'product_id')::uuid, 'entry',
        v_rec_now, coalesce(v_before, 0), v_after,
        'purchase_order', v_po.id, 'Recepción ' || v_po.po_number, auth.uid()
      );
    end loop;
  end if;

  select bool_and((received_qty + rejected_qty) >= ordered_qty)
    into v_all_fulfilled
    from public.purchase_order_items
   where po_id = p_po_id and company_id = v_co;

  update public.purchase_orders
     set status = case when coalesce(v_all_fulfilled, true) then 'received' else 'partial' end,
         target_warehouse_id = coalesce(v_wh, target_warehouse_id),
         linked_purchase_id = v_purchase_id,
         received_at = now(),
         updated_at = now()
   where id = p_po_id and company_id = v_co;

  return v_purchase_id;
end;
$function$;

-- =============================================================================
-- 4. RECLASIFICACIÓN IVA, ANULACIÓN Y DEVOLUCIONES DE COMPRAS (1A, 2A, 3B)
-- =============================================================================

create or replace function public.clasificar_iva_compra(
  p_purchase_id uuid,
  p_new_status text,
  p_reason text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'gerente', 'contador']);
  v_pur public.purchases%rowtype;
  v_s public.acc_settings%rowtype;
  v_prof public.profiles%rowtype;
  v_has_dev_iva boolean;
  v_dev_count int := 0;
  v_pur_date date;
  v_reclass_date date;
  v_vat_pend uuid;
  v_vat_desc uuid;
  v_inv_acc_id uuid;
  v_cogs_acc_id uuid;
  v_inv_acc public.acc_accounts%rowtype;
  v_cogs_acc public.acc_accounts%rowtype;
  v_entry_id uuid;
  v_adj_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_item record;
  v_prod public.products%rowtype;
  v_k_seq bigint;
  v_k_cnt int := 0;
  v_k_verified boolean := false;
  v_other_moves int;
  v_returned_qty numeric := 0;
  v_returned_tax numeric := 0;
  v_net_qty numeric;
  v_net_line_tax numeric;
  v_lot_rem numeric;
  v_lot_sold numeric;
  v_qty_inv numeric;
  v_qty_cogs numeric;
  v_iva_inv numeric;
  v_iva_cogs numeric;
  v_tot_tax numeric := 0;
  v_tot_inv numeric := 0;
  v_tot_cogs numeric := 0;
  v_new_avg numeric;
  v_prev_avg numeric;
  v_prod_adj jsonb := '[]'::jsonb;
  v_lot record;
  v_lot_rem_tax numeric;
  v_lot_share numeric;
  v_lot_cnt int;
  v_lot_idx int;
  v_prev_rec_cost numeric;
  v_new_rec_cost numeric;
begin
  if p_new_status not in ('descontable', 'costo') then
    raise exception 'El nuevo estado fiscal debe ser descontable o costo';
  end if;

  select * into v_prof from public.profiles where id = auth.uid();

  select * into v_pur
  from public.purchases
  where id = p_purchase_id and company_id = v_co
  for update;
  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_pur.status <> 'recibida' then
    raise exception 'Solo se puede clasificar el IVA de compras recibidas';
  end if;
  if v_pur.tax_status <> 'pendiente' then
    raise exception 'La compra tiene estado fiscal "%" (solo se reclasifican compras en estado pendiente)', v_pur.tax_status;
  end if;
  if coalesce(v_pur.tax, 0) <= 0 then
    raise exception 'La compra no tiene IVA pendiente por clasificar';
  end if;
  if v_pur.items is null or jsonb_typeof(v_pur.items) <> 'array' or jsonb_array_length(v_pur.items) = 0 then
    raise exception 'La compra no tiene items válidos';
  end if;

  if exists (
    select 1 from public.purchase_iva_adjustments
    where company_id = v_co and purchase_id = v_pur.id and status = 'aplicado'
  ) or exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
      and source_event = 'reclasificacion_iva' and status = 'contabilizado'
  ) then
    raise exception 'Esta compra ya registra una reclasificación fiscal de IVA vigente';
  end if;

  select * into v_s from public.acc_settings where company_id = v_co;
  if not found or not v_s.active or v_s.start_date is null then
    raise exception 'La contabilidad automática no está activa: no se puede reclasificar el IVA sin garantizar el asiento contable';
  end if;

  v_pur_date := (v_pur.created_at at time zone v_s.timezone)::date;
  if v_pur_date < v_s.start_date then
    raise exception 'La compra (%) es anterior a la fecha de inicio contable (%): no se puede reclasificar automáticamente',
      v_pur_date, v_s.start_date;
  end if;

  if not exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
      and source_event = 'registro' and status = 'contabilizado'
  ) then
    raise exception 'La compra no tiene asiento contable inicial activo; contabiliza pendientes antes de reclasificar el IVA';
  end if;

  v_reclass_date := (now() at time zone v_s.timezone)::date;
  if not public.acc_period_is_open(v_co, v_reclass_date) then
    raise exception 'El periodo contable actual está cerrado: no se puede registrar la reclasificación del IVA';
  end if;

  v_vat_pend := public._acc_resolve_purchase_vat_account(v_co, 'pendiente');
  if p_new_status = 'descontable' then
    v_vat_desc := public._acc_resolve_purchase_vat_account(v_co, 'descontable');
  else
    begin
      v_inv_acc_id := nullif(btrim(coalesce(v_s.map->>'inventario', '')), '')::uuid;
    exception when others then
      v_inv_acc_id := null;
    end;
    if v_inv_acc_id is null then
      raise exception 'Falta configurar cuenta de inventario para reclasificar IVA al costo';
    end if;
    select * into v_inv_acc from public.acc_accounts where id = v_inv_acc_id and company_id = v_co;
    if not found or not v_inv_acc.active or not v_inv_acc.is_postable or v_inv_acc.type <> 'activo' or v_inv_acc.nature <> 'debito' then
      raise exception 'La cuenta de inventario configurada es inválida, inactiva, no imputable o de naturaleza incorrecta';
    end if;

    begin
      v_cogs_acc_id := nullif(btrim(coalesce(v_s.map->>'costo_ventas', '')), '')::uuid;
    exception when others then
      v_cogs_acc_id := null;
    end;
    if v_cogs_acc_id is null then
      raise exception 'Falta configurar cuenta de costo de ventas para reclasificar IVA al costo';
    end if;
    select * into v_cogs_acc from public.acc_accounts where id = v_cogs_acc_id and company_id = v_co;
    if not found or not v_cogs_acc.active or not v_cogs_acc.is_postable or v_cogs_acc.type <> 'costo' or v_cogs_acc.nature <> 'debito' then
      raise exception 'La cuenta de costo de ventas configurada es inválida, inactiva, no imputable o de naturaleza incorrecta';
    end if;
  end if;

  v_has_dev_iva := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_devolutions' and column_name = 'tax_amount'
  );
  select count(*) into v_dev_count
  from public.purchase_devolutions
  where company_id = v_co and purchase_id = v_pur.id and status = 'activa';
  if v_dev_count > 0 and not v_has_dev_iva then
    raise exception 'Esta compra tiene devoluciones activas: aplica primero la migración 000064 para reclasificar IVA con devoluciones.';
  end if;

  for v_item in
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::numeric) as bought_qty,
      sum(coalesce((item->>'tax_amount')::numeric, 0)) as explicit_tax,
      sum(coalesce((item->>'subtotal')::numeric, (item->>'quantity')::numeric * (item->>'cost')::numeric)) as line_sub
    from jsonb_array_elements(v_pur.items) as item
    group by (item->>'product_id')::uuid
    order by (item->>'product_id')::uuid
  loop
    select * into v_prod
    from public.products
    where id = v_item.product_id and company_id = v_co
    for update;
    if not found then
      raise exception 'Producto % no encontrado al clasificar IVA', v_item.product_id;
    end if;

    v_returned_qty := 0;
    v_returned_tax := 0;
    if v_dev_count > 0 and v_has_dev_iva then
      execute $q$
        select coalesce(sum(quantity), 0), coalesce(sum(tax_amount), 0)
        from public.purchase_devolutions
        where company_id = $1 and purchase_id = $2 and product_id = $3 and status = 'activa'
      $q$ into v_returned_qty, v_returned_tax using v_co, v_pur.id, v_prod.id;
    end if;

    v_net_qty := v_item.bought_qty - v_returned_qty;
    if v_net_qty <= 0 then
      continue;
    end if;

    v_net_line_tax := round(
      case
        when v_item.explicit_tax > 0 then v_item.explicit_tax - v_returned_tax
        when coalesce(v_pur.subtotal, 0) > 0 then (v_pur.tax * (v_item.line_sub / v_pur.subtotal)) - v_returned_tax
        else 0
      end,
      2
    );
    if v_net_line_tax <= 0 then
      continue;
    end if;

    v_tot_tax := v_tot_tax + v_net_line_tax;
    v_qty_inv := 0;
    v_qty_cogs := 0;
    v_iva_inv := 0;
    v_iva_cogs := 0;

    if p_new_status = 'costo' then
      if v_prod.tracks_expiry then
        select coalesce(sum(qty_remaining), 0) into v_lot_rem
        from public.product_lots
        where company_id = v_co and source_type = 'compra' and source_id = v_pur.id and product_id = v_prod.id;

        select coalesce(sum(m.qty - m.restored), 0) into v_lot_sold
        from public.sale_lot_moves m
        join public.product_lots l on l.id = m.lot_id
        where l.company_id = v_co and l.source_type = 'compra' and l.source_id = v_pur.id and l.product_id = v_prod.id;

        if abs(v_net_qty - (v_lot_rem + v_lot_sold)) > 0.001 then
          raise exception 'El lote de "%" tuvo ajustes manuales o bajas fuera de ventas/devoluciones; no se automatiza IVA al costo', v_prod.name;
        end if;
        if v_prod.stock < v_lot_rem then
          raise exception 'Stock global de "%" (%) menor al saldo del lote (%)', v_prod.name, v_prod.stock, v_lot_rem;
        end if;

        v_qty_inv := v_lot_rem;
        v_qty_cogs := v_lot_sold;
      else
        select count(*), coalesce(bool_and(seq_verified), false), max(seq)
        into v_k_cnt, v_k_verified, v_k_seq
        from public.kardex
        where company_id = v_co and product_id = v_prod.id
          and reference_type = 'purchase' and reference_id = v_pur.id and type = 'entrada';

        if v_k_cnt = 0 or not v_k_verified or v_k_seq is null then
          raise exception 'Compra histórica o sin secuencia verificable en kardex para "%": orden cronológico anterior a la migración no reconstruible; reclasifica manualmente.', v_prod.name;
        end if;

        select count(*) into v_other_moves
        from public.kardex k
        where k.company_id = v_co
          and k.product_id = v_prod.id
          and k.seq_verified = true
          and k.seq > v_k_seq
          and not (
            k.reference_type = 'purchase_devolution'
            and exists (
              select 1 from public.purchase_devolutions pd
              where pd.id = k.reference_id and pd.purchase_id = v_pur.id
            )
          );

        if v_other_moves > 0 or v_prod.stock < v_net_qty then
          raise exception 'Sin trazabilidad por lote para "%" tras movimientos posteriores a la compra (ventas, ajustes u otras compras). No se usa stock global; reclasifica manualmente.', v_prod.name;
        end if;

        v_qty_inv := v_net_qty;
        v_qty_cogs := 0;
      end if;

      v_iva_inv := round(v_net_line_tax * (v_qty_inv / v_net_qty), 2);
      v_iva_cogs := round(v_net_line_tax - v_iva_inv, 2);
      v_tot_inv := v_tot_inv + v_iva_inv;
      v_tot_cogs := v_tot_cogs + v_iva_cogs;
    end if;

    v_prev_avg := coalesce(v_prod.cost, 0);
    v_new_avg := v_prev_avg;
    if p_new_status = 'costo' and v_iva_inv > 0 and v_prod.stock > 0 then
      v_new_avg := round(((v_prod.stock * v_prev_avg) + v_iva_inv) / v_prod.stock, 2);
      update public.products set cost = v_new_avg where id = v_prod.id;

      if v_prod.tracks_expiry and v_qty_inv > 0 then
        select count(*) into v_lot_cnt
        from public.product_lots
        where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
          and product_id = v_prod.id and qty_remaining > 0;
        v_lot_rem_tax := v_iva_inv;
        v_lot_idx := 0;
        for v_lot in
          select id, qty_remaining
          from public.product_lots
          where company_id = v_co and source_type = 'compra' and source_id = v_pur.id
            and product_id = v_prod.id and qty_remaining > 0
          order by expiry_date asc, created_at asc, id asc
          for update
        loop
          v_lot_idx := v_lot_idx + 1;
          if v_lot_idx = v_lot_cnt then
            v_lot_share := v_lot_rem_tax;
          else
            v_lot_share := round(v_iva_inv * (v_lot.qty_remaining / v_qty_inv), 2);
          end if;
          v_lot_rem_tax := v_lot_rem_tax - v_lot_share;
          update public.product_lots
          set cost = round(cost + (v_lot_share / qty_remaining), 4)
          where id = v_lot.id;
        end loop;
      end if;
    end if;

    v_prod_adj := v_prod_adj || jsonb_build_object(
      'product_id', v_prod.id,
      'product_name', v_prod.name,
      'net_qty', v_net_qty,
      'qty_inventory', v_qty_inv,
      'qty_cogs', v_qty_cogs,
      'iva_total', v_net_line_tax,
      'iva_inventory', v_iva_inv,
      'iva_expense', v_iva_cogs,
      'prev_avg_cost', v_prev_avg,
      'new_avg_cost', v_new_avg
    );
  end loop;

  if v_tot_tax <= 0 then
    raise exception 'El saldo neto de IVA pendiente de esta compra es 0 (posiblemente ya devuelto en su totalidad)';
  end if;

  if p_new_status = 'descontable' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_vat_desc, 'debit', v_tot_tax, 'memo', 'IVA compra confirmado descontable'),
      jsonb_build_object('account_id', v_vat_pend, 'credit', v_tot_tax, 'memo', 'Reclasificación desde IVA por clasificar')
    );
  else
    if v_tot_inv > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_inv_acc.id, 'debit', v_tot_inv, 'memo', 'IVA no descontable capitalizado en inventario')
      );
    end if;
    if v_tot_cogs > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cogs_acc.id, 'debit', v_tot_cogs, 'memo', 'IVA no descontable asignado a unidades ya vendidas')
      );
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_vat_pend, 'credit', v_tot_tax, 'memo', 'Reclasificación IVA por clasificar al costo')
    );
  end if;

  v_entry_id := public.acc_system_entry(
    v_co,
    v_reclass_date,
    'Reclasificación IVA compra C-' || substr(v_pur.id::text, 1, 8) || ' (' || p_new_status || ')',
    'compra',
    v_pur.id,
    'reclasificacion_iva',
    'RIVA-' || substr(v_pur.id::text, 1, 8),
    v_lines
  );

  v_prev_rec_cost := coalesce(v_pur.recognized_cost, coalesce(v_pur.subtotal, v_pur.total - coalesce(v_pur.tax, 0)));
  v_new_rec_cost := coalesce(v_pur.subtotal, v_pur.total - coalesce(v_pur.tax, 0)) +
    case when p_new_status = 'costo' then v_tot_inv else 0 end;

  update public.purchases
  set tax_status = p_new_status,
      iva_classified_at = now(),
      iva_classified_by = auth.uid(),
      iva_classification_note = nullif(left(btrim(coalesce(p_reason, '')), 240), ''),
      iva_cost_inventory = case when p_new_status = 'costo' then v_tot_inv else 0 end,
      iva_cost_expense = case when p_new_status = 'costo' then v_tot_cogs else 0 end,
      recognized_cost = v_new_rec_cost
  where id = v_pur.id and company_id = v_co;

  insert into public.purchase_iva_adjustments (
    company_id, purchase_id, from_status, to_status,
    original_subtotal, original_tax, tax_amount,
    previous_recognized_cost, new_recognized_cost,
    amount_to_inventory, amount_to_expense,
    product_adjustments, entry_id, reason,
    created_by, created_by_name, created_by_role
  ) values (
    v_co, v_pur.id, 'pendiente', p_new_status,
    coalesce(v_pur.subtotal, greatest(0, v_pur.total - coalesce(v_pur.tax, 0))),
    coalesce(v_pur.tax, 0),
    v_tot_tax,
    v_prev_rec_cost,
    v_new_rec_cost,
    v_tot_inv,
    v_tot_cogs,
    v_prod_adj,
    v_entry_id,
    nullif(left(btrim(coalesce(p_reason, '')), 240), ''),
    auth.uid(),
    coalesce(nullif(btrim(v_prof.full_name), ''), v_prof.email),
    v_prof.role
  )
  returning id into v_adj_id;

  return v_adj_id;
end
$function$;

create or replace function public.anular_compra(p_purchase_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
  v_purchase public.purchases%rowtype;
  v_item record;
  v_prod public.products%rowtype;
  v_new numeric;
  v_rev_cost numeric;
  v_adj_inv numeric := 0;
  v_item_inv_total numeric := 0;
  v_tz text;
  v_rev_date date;
  v_lot_count int := 0;
  v_k_seq bigint;
  v_k_cnt int := 0;
  v_k_verified boolean := false;
  v_other_moves int := 0;
begin
  select * into v_purchase
  from public.purchases
  where id = p_purchase_id and company_id = v_co
  for update;

  if not found then
    raise exception 'La compra no existe o no tienes permiso para acceder a ella';
  end if;
  if v_purchase.status = 'anulada' then
    raise exception 'Esta compra ya fue anulada';
  end if;
  if v_purchase.status <> 'recibida' then
    raise exception 'Solo se pueden anular compras recibidas';
  end if;
  if v_purchase.items is null or jsonb_typeof(v_purchase.items) <> 'array' or jsonb_array_length(v_purchase.items) = 0 then
    raise exception 'La compra no contiene artículos válidos';
  end if;
  if coalesce(v_purchase.iva_cost_expense, 0) > 0 then
    raise exception 'No se puede anular: parte del IVA de esta compra ya se imputó a costo de ventas por unidades vendidas';
  end if;

  if to_regclass('public.purchase_devolutions') is not null then
    if exists (
      select 1 from public.purchase_devolutions
      where company_id = v_co and purchase_id = v_purchase.id and status = 'activa'
    ) then
      raise exception 'No se puede anular: esta compra ya tiene devoluciones parciales a proveedor. Anula primero esas devoluciones en el módulo Devoluciones.';
    end if;
  end if;

  if to_regclass('public.supplier_allocations') is not null then
    if exists (
      select 1
      from public.supplier_allocations a
      join public.supplier_payments sp on sp.id = a.payment_id
      where a.purchase_id = v_purchase.id and sp.status = 'activo'
    ) then
      raise exception 'No se puede anular: esta compra ya tiene pagos o abonos registrados. Anula primero esos pagos en Cuentas por pagar.';
    end if;
  end if;

  select timezone into v_tz from public.acc_settings where company_id = v_co;
  v_rev_date := (now() at time zone coalesce(v_tz, 'America/Caracas'))::date;
  if exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id and status = 'contabilizado'
  ) and not public.acc_period_is_open(v_co, v_rev_date) then
    raise exception 'El periodo contable actual está cerrado: no se puede anular ni revertir el asiento de la compra';
  end if;

  for v_item in
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::numeric) as quantity
    from jsonb_array_elements(v_purchase.items) as item
    group by (item->>'product_id')::uuid
    order by (item->>'product_id')::uuid
  loop
    if v_item.quantity <= 0 then
      raise exception 'La compra contiene una cantidad inválida';
    end if;

    select * into v_prod
    from public.products
    where id = v_item.product_id and company_id = v_co
    for update;
    if not found then
      raise exception 'No se encontró un producto de esta compra';
    end if;

    if v_prod.stock < v_item.quantity then
      raise exception 'No se puede anular: el inventario actual de "%" es %, pero se necesitan % unidades para revertir la compra',
        v_prod.name, v_prod.stock, v_item.quantity;
    end if;

    if v_prod.tracks_expiry then
      select count(*) into v_lot_count
      from public.product_lots
      where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id and product_id = v_prod.id;

      if v_lot_count = 0 then
        raise exception 'No se puede anular "%": faltan los lotes originales de la compra para verificar trazabilidad', v_prod.name;
      end if;

      if exists (
        select 1 from public.product_lots
        where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id
          and product_id = v_prod.id and qty_remaining < qty_initial
      ) or exists (
        select 1
        from public.sale_lot_moves m
        join public.product_lots l on l.id = m.lot_id
        where l.company_id = v_co and l.source_type = 'compra' and l.source_id = v_purchase.id
          and l.product_id = v_prod.id and (m.qty - m.restored) > 0
      ) then
        raise exception 'No se puede anular: ya se vendió o dio de baja parte de los lotes de "%" de esta compra', v_prod.name;
      end if;
    else
      select count(*), coalesce(bool_and(seq_verified), false), max(seq)
      into v_k_cnt, v_k_verified, v_k_seq
      from public.kardex
      where company_id = v_co and product_id = v_prod.id
        and reference_type = 'purchase' and reference_id = v_purchase.id and type = 'entrada';

      if v_k_cnt = 0 or not v_k_verified or v_k_seq is null then
        raise exception 'No se puede anular "%": compra histórica o sin secuencia verificable en kardex (orden cronológico no reconstruible)', v_prod.name;
      end if;

      select count(*) into v_other_moves
      from public.kardex k
      where k.company_id = v_co
        and k.product_id = v_prod.id
        and k.seq_verified = true
        and k.seq > v_k_seq
        and not (
          k.reference_type = 'purchase_devolution'
          and exists (
            select 1 from public.purchase_devolutions pd
            where pd.id = k.reference_id and pd.purchase_id = v_purchase.id and pd.status = 'anulada'
          )
        );

      if v_other_moves > 0 then
        raise exception 'No se puede anular "%" sin control de lote: existen ventas, ajustes o recompras posteriores en kardex que mezclaron sus unidades', v_prod.name;
      end if;
    end if;
  end loop;

  update public.product_lots
  set qty_remaining = 0
  where company_id = v_co and source_type = 'compra' and source_id = v_purchase.id;

  for v_item in
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::numeric) as quantity,
      sum(coalesce((item->>'subtotal')::numeric, ((item->>'quantity')::numeric * (item->>'cost')::numeric))) as base_cost,
      sum(coalesce((item->>'tax_amount')::numeric, 0)) as explicit_tax,
      (array_agg((item->>'prev_cost')::numeric) filter (where item ? 'prev_cost'))[1] as prev_cost
    from jsonb_array_elements(v_purchase.items) as item
    group by (item->>'product_id')::uuid
    order by (item->>'product_id')::uuid
  loop
    select * into v_prod
    from public.products
    where id = v_item.product_id and company_id = v_co;

    select coalesce(sum((pa->>'iva_inventory')::numeric), 0)
    into v_adj_inv
    from public.purchase_iva_adjustments adj,
         jsonb_array_elements(adj.product_adjustments) pa
    where adj.company_id = v_co
      and adj.purchase_id = v_purchase.id
      and adj.status = 'aplicado'
      and adj.to_status = 'costo'
      and (pa->>'product_id')::uuid = v_prod.id;

    if v_adj_inv > 0 then
      v_item_inv_total := v_item.base_cost + v_adj_inv;
    elsif v_purchase.tax_status = 'costo' and v_purchase.iva_classified_at is null then
      v_item_inv_total := v_item.base_cost + case
        when v_item.explicit_tax > 0 then v_item.explicit_tax
        when coalesce(v_purchase.subtotal, 0) > 0 then round(coalesce(v_purchase.tax, 0) * (v_item.base_cost / v_purchase.subtotal), 2)
        else coalesce(v_purchase.tax, 0)
      end;
    else
      v_item_inv_total := v_item.base_cost;
    end if;

    v_new := v_prod.stock - v_item.quantity;
    v_rev_cost := v_prod.cost;
    if v_new > 0 then
      v_rev_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) - coalesce(v_item_inv_total, 0)) / v_new, 2);
      if v_rev_cost <= 0 then
        v_rev_cost := coalesce(v_item.prev_cost, v_prod.cost);
      end if;
    elsif v_item.prev_cost is not null and v_item.prev_cost >= 0 then
      v_rev_cost := round(v_item.prev_cost, 2);
    end if;

    update public.products
    set stock = v_new,
        cost = v_rev_cost
    where id = v_prod.id and company_id = v_co;

    insert into public.kardex (
      company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note
    ) values (
      v_co, v_prod.id, v_prod.name, 'salida', v_item.quantity, v_new, 'purchase', v_purchase.id, 'Anulación de compra'
    );
  end loop;

  if coalesce(v_purchase.payment_method, 'efectivo') = 'efectivo' then
    insert into public.cash_entries (
      company_id, type, amount, description, reference_type, reference_id
    ) values (
      v_co,
      'ingreso',
      v_purchase.total,
      'Reversión por anulación de compra - ' || coalesce(v_purchase.supplier_name, 'Proveedor general'),
      'purchase',
      v_purchase.id
    );
  end if;

  update public.purchases
  set status = 'anulada'
  where id = v_purchase.id and company_id = v_co;

  return v_purchase.id;
end
$function$;

create or replace function public.registrar_devolucion_compra(
  p_purchase_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_refund_method text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
  v_pur public.purchases%rowtype;
  v_prod public.products%rowtype;
  v_s public.acc_settings%rowtype;
  v_bought numeric := 0;
  v_bought_amt numeric := 0;
  v_bought_tax_expl numeric := 0;
  v_bought_tax numeric := 0;
  v_returned numeric := 0;
  v_returned_amt numeric := 0;
  v_returned_tax numeric := 0;
  v_dev_base numeric := 0;
  v_dev_tax numeric := 0;
  v_amount numeric := 0;
  v_inv_credit numeric := 0;
  v_unit_inv_cost numeric := 0;
  v_refund text;
  v_new numeric;
  v_rev_cost numeric;
  v_bal numeric := 0;
  v_id uuid;
  v_name text;
  v_lot_avail numeric := 0;
  v_left numeric := 0;
  v_take numeric := 0;
  v_k_seq bigint;
  v_k_cnt int := 0;
  v_k_verified boolean := false;
  v_other_moves int := 0;
  v_taken_lots jsonb := '[]'::jsonb;
  r_lot record;
  r_taken record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad a devolver debe ser mayor que cero';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la devolución al proveedor';
  end if;

  select * into v_pur
  from public.purchases
  where id = p_purchase_id and company_id = v_co
  for update;
  if not found then
    raise exception 'La compra no existe';
  end if;
  if v_pur.status = 'anulada' then
    raise exception 'Esta compra está anulada';
  end if;

  select
    coalesce(sum((it->>'quantity')::numeric), 0),
    coalesce(sum(coalesce((it->>'subtotal')::numeric, (it->>'quantity')::numeric * (it->>'cost')::numeric)), 0),
    coalesce(sum(coalesce((it->>'tax_amount')::numeric, 0)), 0)
  into v_bought, v_bought_amt, v_bought_tax_expl
  from jsonb_array_elements(v_pur.items) it
  where (it->>'product_id')::uuid = p_product_id;

  if v_bought <= 0 then
    raise exception 'Ese producto no pertenece a esta compra';
  end if;

  if v_bought_tax_expl > 0 then
    v_bought_tax := round(v_bought_tax_expl, 2);
  elsif coalesce(v_pur.tax, 0) > 0 and coalesce(v_pur.subtotal, 0) > 0 then
    v_bought_tax := round(v_pur.tax * (v_bought_amt / v_pur.subtotal), 2);
  else
    v_bought_tax := 0;
  end if;

  select
    coalesce(sum(quantity), 0),
    coalesce(sum(coalesce(subtotal, amount)), 0),
    coalesce(sum(coalesce(tax_amount, 0)), 0)
  into v_returned, v_returned_amt, v_returned_tax
  from public.purchase_devolutions
  where company_id = v_co and purchase_id = p_purchase_id and product_id = p_product_id and status = 'activa';

  if v_returned + p_quantity > v_bought + 0.0001 then
    raise exception 'Solo quedan % unidad(es) disponibles para devolver en esta compra', v_bought - v_returned;
  end if;

  if abs((v_returned + p_quantity) - v_bought) <= 0.0001 then
    v_dev_base := greatest(0, round(v_bought_amt - v_returned_amt, 2));
    v_dev_tax := greatest(0, round(v_bought_tax - v_returned_tax, 2));
  else
    v_dev_base := round(p_quantity * (v_bought_amt / v_bought), 2);
    v_dev_tax := round(p_quantity * (v_bought_tax / v_bought), 2);
  end if;

  v_amount := round(v_dev_base + v_dev_tax, 2);
  v_inv_credit := case
    when v_pur.tax_status = 'costo' then v_amount
    else v_dev_base
  end;
  v_unit_inv_cost := round(v_inv_credit / p_quantity, 4);

  v_refund := coalesce(nullif(btrim(coalesce(p_refund_method, '')), ''), coalesce(v_pur.payment_method, 'efectivo'));
  if v_refund not in ('efectivo', 'tarjeta', 'transferencia', 'credito') then
    raise exception 'Forma de reintegro de proveedor inválida';
  end if;

  if v_refund = 'credito' then
    if coalesce(v_pur.payment_method, 'efectivo') <> 'credito' then
      raise exception 'Solo puedes descontar de Cuentas por pagar cuando la compra original fue a crédito';
    end if;
    v_bal := public._purchase_balance(p_purchase_id);
    if v_amount > v_bal + 0.005 then
      raise exception 'La devolución (%) supera el saldo pendiente de esta compra (%).', v_amount, round(v_bal, 2);
    end if;
  end if;

  select * into v_prod
  from public.products
  where id = p_product_id and company_id = v_co
  for update;
  if not found then
    raise exception 'El producto ya no existe';
  end if;
  if v_prod.stock < p_quantity then
    raise exception 'Stock actual insuficiente de "%" (en inventario: %, a devolver: %)', v_prod.name, v_prod.stock, p_quantity;
  end if;

  if v_prod.tracks_expiry then
    select coalesce(sum(qty_remaining), 0) into v_lot_avail
    from public.product_lots
    where company_id = v_co and source_type = 'compra' and source_id = p_purchase_id and product_id = p_product_id;

    if v_lot_avail < p_quantity then
      raise exception 'Solo quedan % unidad(es) disponibles en el lote de esta compra para devolver', v_lot_avail;
    end if;

    v_left := p_quantity;
    for r_lot in
      select id, qty_remaining
      from public.product_lots
      where company_id = v_co and source_type = 'compra' and source_id = p_purchase_id
        and product_id = p_product_id and qty_remaining > 0
      order by expiry_date asc, created_at asc, id asc
      for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, r_lot.qty_remaining);
      update public.product_lots set qty_remaining = qty_remaining - v_take where id = r_lot.id;
      v_taken_lots := v_taken_lots || jsonb_build_array(jsonb_build_object('lot_id', r_lot.id, 'quantity', v_take));
      v_left := v_left - v_take;
    end loop;
  else
    select count(*), coalesce(bool_and(seq_verified), false), max(seq)
    into v_k_cnt, v_k_verified, v_k_seq
    from public.kardex
    where company_id = v_co and product_id = v_prod.id
      and reference_type = 'purchase' and reference_id = p_purchase_id and type = 'entrada';

    if v_k_cnt = 0 or not v_k_verified or v_k_seq is null then
      raise exception 'No se puede devolver "%" sin control de lote: compra histórica o sin secuencia verificable en kardex (orden cronológico no reconstruible)', v_prod.name;
    end if;

    select count(*) into v_other_moves
    from public.kardex k
    where k.company_id = v_co
      and k.product_id = v_prod.id
      and k.seq_verified = true
      and k.seq > v_k_seq
      and not (
        k.reference_type = 'purchase_devolution'
        and exists (
          select 1 from public.purchase_devolutions pd
          where pd.id = k.reference_id and pd.purchase_id = p_purchase_id
        )
      );

    if v_other_moves > 0 then
      raise exception 'No se puede devolver "%" sin control de lote: existen ventas, ajustes o compras posteriores en kardex que alteran trazabilidad o costo promedio', v_prod.name;
    end if;
  end if;

  v_new := v_prod.stock - p_quantity;
  v_rev_cost := v_prod.cost;
  if v_new > 0 then
    v_rev_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) - v_inv_credit) / v_new, 2);
    if v_rev_cost <= 0 then
      v_rev_cost := v_prod.cost;
    end if;
  end if;

  update public.products set stock = v_new, cost = v_rev_cost where id = v_prod.id;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();

  insert into public.purchase_devolutions (
    company_id, purchase_id, supplier_id, supplier_name,
    product_id, product_name, quantity, unit_cost, amount,
    subtotal, tax_amount, tax_status_snapshot, inventory_credit,
    refund_method, reason, status, created_by, created_by_name
  ) values (
    v_co, v_pur.id, v_pur.supplier_id, v_pur.supplier_name,
    v_prod.id, v_prod.name, p_quantity, round(v_unit_inv_cost, 2), v_amount,
    v_dev_base, v_dev_tax, v_pur.tax_status, v_inv_credit,
    v_refund, left(btrim(p_reason), 240), 'activa', auth.uid(), v_name
  )
  returning id into v_id;

  if jsonb_array_length(v_taken_lots) > 0 then
    for r_taken in select elem from jsonb_array_elements(v_taken_lots) as t(elem) loop
      insert into public.purchase_devolution_lots (
        company_id, devolution_id, purchase_id, product_id, lot_id, quantity
      ) values (
        v_co, v_id, v_pur.id, v_prod.id, (r_taken.elem->>'lot_id')::uuid, (r_taken.elem->>'quantity')::numeric
      );
    end loop;
  end if;

  insert into public.kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note)
  values (v_co, v_prod.id, v_prod.name, 'salida', p_quantity, v_new, 'purchase_devolution', v_id, 'Devolución a proveedor: ' || left(btrim(p_reason), 120));

  if v_refund = 'efectivo' and v_amount > 0 then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'ingreso', v_amount, 'Devolución a proveedor - ' || v_prod.name, 'purchase_devolution', v_id);
  end if;

  select * into v_s from public.acc_settings where company_id = v_co;
  if v_s.company_id is not null and v_s.active and v_s.start_date is not null then
    perform public.acc_post_purchase_devolution(v_id);
  end if;

  return v_id;
end
$function$;

create or replace function public.anular_devolucion_compra(p_dev_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
  d public.purchase_devolutions%rowtype;
  v_pur public.purchases%rowtype;
  v_prod public.products%rowtype;
  v_inv_amt numeric;
  v_new numeric;
  v_new_cost numeric;
  v_tz text;
  v_rev_date date;
  v_restored_sum numeric := 0;
  v_dev_seq bigint;
  v_dev_cnt int := 0;
  v_dev_verified boolean := false;
  v_other_moves int := 0;
  r_dl record;
  v_lot public.product_lots%rowtype;
begin
  select * into d
  from public.purchase_devolutions
  where id = p_dev_id and company_id = v_co
  for update;
  if not found then
    raise exception 'La devolución a proveedor no existe';
  end if;
  if d.status = 'anulada' then
    raise exception 'Esta devolución ya fue anulada';
  end if;

  select * into v_pur
  from public.purchases
  where id = d.purchase_id and company_id = v_co
  for update;
  if not found then
    raise exception 'La compra asociada a esta devolución no existe';
  end if;
  if v_pur.status = 'anulada' then
    raise exception 'No se puede anular esta devolución porque la compra origen ya está anulada';
  end if;
  if v_pur.tax_status is distinct from coalesce(d.tax_status_snapshot, v_pur.tax_status) then
    raise exception 'No se puede anular esta devolución porque el estado fiscal de la compra cambió de "%" a "%" tras devolver.',
      d.tax_status_snapshot, v_pur.tax_status;
  end if;

  select timezone into v_tz from public.acc_settings where company_id = v_co;
  v_rev_date := (now() at time zone coalesce(v_tz, 'America/Caracas'))::date;
  if exists (
    select 1 from public.acc_entries
    where company_id = v_co and source_type = 'devolucion_compra' and source_id = d.id
      and source_event = 'registro' and status = 'contabilizado'
  ) and not public.acc_period_is_open(v_co, v_rev_date) then
    raise exception 'El periodo contable actual está cerrado: no se puede anular la devolución de compra';
  end if;

  select * into v_prod
  from public.products
  where id = d.product_id and company_id = v_co
  for update;
  if not found then
    raise exception 'El producto ya no existe';
  end if;

  if v_prod.tracks_expiry then
    select coalesce(sum(quantity), 0) into v_restored_sum
    from public.purchase_devolution_lots
    where company_id = v_co and devolution_id = d.id;

    if abs(v_restored_sum - d.quantity) > 0.0001 then
      raise exception 'Falta trazabilidad exacta de lotes en purchase_devolution_lots para anular esta devolución (esperado %, registrado %)',
        d.quantity, v_restored_sum;
    end if;

    for r_dl in
      select dl.lot_id, dl.quantity
      from public.purchase_devolution_lots dl
      where dl.company_id = v_co and dl.devolution_id = d.id
      order by dl.lot_id
      for update
    loop
      select * into v_lot
      from public.product_lots
      where id = r_dl.lot_id and company_id = v_co
      for update;
      if not found then
        raise exception 'El lote original % de la devolución ya no existe', r_dl.lot_id;
      end if;
      if v_lot.qty_remaining + r_dl.quantity > v_lot.qty_initial + 0.0001 then
        raise exception 'Restaurar % unidad(es) excede la cantidad inicial del lote (%)', r_dl.quantity, v_lot.lot_code;
      end if;
      update public.product_lots
      set qty_remaining = qty_remaining + r_dl.quantity
      where id = v_lot.id;
    end loop;
  else
    select count(*), coalesce(bool_and(seq_verified), false), max(seq)
    into v_dev_cnt, v_dev_verified, v_dev_seq
    from public.kardex
    where company_id = v_co and product_id = v_prod.id
      and reference_type = 'purchase_devolution' and reference_id = d.id and type = 'salida';

    if v_dev_cnt = 0 or not v_dev_verified or v_dev_seq is null then
      raise exception 'No se puede anular la devolución de "%" sin control de lote: registro histórico o sin secuencia verificable en kardex', v_prod.name;
    end if;

    select count(*) into v_other_moves
    from public.kardex k
    where k.company_id = v_co
      and k.product_id = v_prod.id
      and k.seq_verified = true
      and k.seq > v_dev_seq;

    if v_other_moves > 0 then
      raise exception 'No se puede anular la devolución de "%" sin control de lote: existen movimientos posteriores en kardex que alteraron el inventario o costo promedio', v_prod.name;
    end if;
  end if;

  v_inv_amt := coalesce(
    d.inventory_credit,
    case when d.tax_status_snapshot = 'costo' then d.amount else coalesce(d.subtotal, d.amount - coalesce(d.tax_amount, 0)) end
  );

  v_new := v_prod.stock + d.quantity;
  if v_prod.stock > 0 and v_new > 0 then
    v_new_cost := round(((v_prod.stock * coalesce(v_prod.cost, 0)) + v_inv_amt) / v_new, 2);
  else
    v_new_cost := round(v_inv_amt / d.quantity, 2);
  end if;

  update public.products set stock = v_new, cost = v_new_cost where id = d.product_id;
  update public.purchase_devolutions set status = 'anulada' where id = d.id;

  insert into public.kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id, note)
  values (v_co, v_prod.id, v_prod.name, 'entrada', d.quantity, v_new, 'purchase_devolution', d.id, 'Anulación devolución a proveedor');

  if d.refund_method = 'efectivo' and d.amount > 0 then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'egreso', d.amount, 'Anulación devolución a proveedor - ' || d.product_name, 'anulacion_devolucion_compra', d.id);
  end if;

  perform public.acc_reverse_source(v_co, 'devolucion_compra', d.id, 'anulación de devolución a proveedor');
end
$function$;

-- =============================================================================
-- 5. CUENTAS POR PAGAR (DECISIÓN 3B: GERENTE SOLO CONSULTA, SIN BYPASS GLOBAL)
-- =============================================================================

create or replace function public.cuentas_por_pagar()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'gerente']);
  v_today date := public._co_today(v_co);
  v_res jsonb;
begin
  with b as (
    select p.supplier_id, p.id, p.due_date, public._purchase_balance(p.id) as bal
    from public.purchases p
    where p.company_id = v_co
      and p.payment_method = 'credito'
      and p.status = 'recibida'
      and p.supplier_id is not null
  ), agg as (
    select s.id, s.name, s.document, s.phone,
           coalesce(sum(b.bal), 0) as owed,
           coalesce(sum(b.bal) filter (where b.due_date is not null and b.due_date < v_today), 0) as overdue,
           min(b.due_date) filter (where b.bal > 0.004) as oldest_due,
           (count(b.id) filter (where b.bal > 0.004))::int as open_purchases,
           coalesce(sc.credit_limit, 0) as credit_limit,
           coalesce(sc.credit_days, 30) as credit_days,
           (select max(sp.created_at) from public.supplier_payments sp where sp.supplier_id = s.id and sp.status = 'activo') as last_payment
    from public.suppliers s
    left join b on b.supplier_id = s.id
    left join public.supplier_credit sc on sc.supplier_id = s.id and sc.company_id = v_co
    where s.company_id = v_co
    group by s.id, s.name, s.document, s.phone, sc.credit_limit, sc.credit_days
    having coalesce(sum(b.bal), 0) > 0.004 or coalesce(sc.credit_limit, 0) > 0
  )
  select jsonb_build_object(
    'today', v_today,
    'total_owed', coalesce((select sum(owed) from agg), 0),
    'total_overdue', coalesce((select sum(overdue) from agg), 0),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'supplier_id', id, 'name', name, 'document', document, 'phone', phone,
        'owed', owed, 'overdue', overdue, 'oldest_due', oldest_due, 'open_purchases', open_purchases,
        'credit_limit', credit_limit, 'credit_days', credit_days, 'last_payment', last_payment
      ) order by overdue desc, owed desc, name)
      from agg
    ), '[]'::jsonb)
  ) into v_res;
  return v_res;
end
$function$;

create or replace function public.cuenta_por_pagar_proveedor(p_supplier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'gerente']);
  v_today date := public._co_today(v_co);
  sup public.suppliers%rowtype;
  v_limit numeric := 0;
  v_days integer := 30;
  v_owed numeric := 0;
  v_overdue numeric := 0;
  v_purchases jsonb;
  v_payments jsonb;
begin
  select * into sup from public.suppliers where id = p_supplier_id and company_id = v_co;
  if not found then raise exception 'Proveedor no existe'; end if;

  select coalesce(credit_limit, 0), coalesce(credit_days, 30)
    into v_limit, v_days
    from public.supplier_credit
    where supplier_id = p_supplier_id and company_id = v_co;
  if not found then v_limit := 0; v_days := 30; end if;

  with b as (
    select p.id, p.total, p.due_date, p.created_at,
           public._purchase_balance(p.id) as bal,
           case when p.due_date is not null and p.due_date < v_today then (v_today - p.due_date)::int else 0 end as days_overdue
    from public.purchases p
    where p.company_id = v_co
      and p.supplier_id = p_supplier_id
      and p.payment_method = 'credito'
      and p.status = 'recibida'
  )
  select coalesce(sum(bal), 0),
         coalesce(sum(bal) filter (where due_date is not null and due_date < v_today), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'total', total, 'balance', bal, 'due_date', due_date,
           'created_at', created_at, 'days_overdue', days_overdue
         ) order by created_at asc, id asc) filter (where bal > 0.004), '[]'::jsonb)
    into v_owed, v_overdue, v_purchases
  from b;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sp.id, 'amount', sp.amount, 'method', sp.method, 'status', sp.status,
    'note', sp.note, 'by', sp.created_by_name, 'created_at', sp.created_at
  ) order by sp.created_at desc), '[]'::jsonb)
    into v_payments
  from (
    select * from public.supplier_payments
    where company_id = v_co and supplier_id = p_supplier_id
    order by created_at desc
    limit 50
  ) sp;

  return jsonb_build_object(
    'supplier', jsonb_build_object('id', sup.id, 'name', sup.name, 'phone', sup.phone, 'document', sup.document),
    'owed', v_owed,
    'overdue', v_overdue,
    'credit_limit', v_limit,
    'credit_days', v_days,
    'purchases', v_purchases,
    'payments', v_payments
  );
end
$function$;

create or replace function public.guardar_credito_proveedor(p_supplier uuid, p_limit numeric, p_days integer)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
begin
  if not exists (select 1 from public.suppliers where id = p_supplier and company_id = v_co) then
    raise exception 'Proveedor no existe';
  end if;
  if not public._es_finito(p_limit) or p_limit < 0 then
    raise exception 'El cupo debe ser 0 o mayor';
  end if;
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'Los días de plazo deben estar entre 0 y 365';
  end if;

  insert into public.supplier_credit (company_id, supplier_id, credit_limit, credit_days, updated_at)
  values (v_co, p_supplier, round(p_limit, 2), p_days, now())
  on conflict (company_id, supplier_id) do update
    set credit_limit = excluded.credit_limit,
        credit_days = excluded.credit_days,
        updated_at = now();
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
    select id into v_id from public.supplier_payments where company_id = v_co and client_uuid = p_client_id;
    if found then return v_id; end if;
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

  select name into v_sup from public.suppliers where id = p_supplier_id and company_id = v_co for update;
  if not found then raise exception 'Proveedor no existe'; end if;

  v_owed := public._supplier_owed(v_co, p_supplier_id);
  if v_owed <= 0 then raise exception 'No tienes deuda pendiente con este proveedor'; end if;
  if v_amount > v_owed + 0.005 then
    raise exception 'El pago (%) es mayor que lo que debes al proveedor (%)', v_amount, round(v_owed, 2);
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.supplier_payments (company_id, supplier_id, amount, method, note, client_uuid, created_by, created_by_name)
  values (
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

  begin
    perform public.acc_post_supplier_payment(v_id);
  exception when others then
    null;
  end;

  return v_id;
end
$function$;

create or replace function public.anular_pago_proveedor(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa']);
  p public.supplier_payments%rowtype;
  v_sup text;
begin
  select * into p from public.supplier_payments where id = p_payment_id and company_id = v_co for update;
  if not found then raise exception 'El pago no existe'; end if;
  if p.status = 'anulado' then raise exception 'Este pago ya está anulado'; end if;

  select name into v_sup from public.suppliers where id = p.supplier_id and company_id = v_co;

  update public.supplier_payments set status = 'anulado' where id = p.id;

  if p.method = 'efectivo' then
    insert into public.cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'ingreso', p.amount, 'Anulación pago a proveedor - ' || coalesce(v_sup, 'Proveedor'), 'anulacion_pago_proveedor', p.id);
  end if;

  perform public.acc_reverse_source(v_co, 'pago_proveedor', p.id, 'anulación de pago a proveedor');
end
$function$;

create or replace function public.cxp_config()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'gerente']);
  v_acc uuid;
  v_active boolean := false;
  a public.acc_accounts%rowtype;
begin
  select account_id into v_acc from public.cxp_settings where company_id = v_co;
  select coalesce(active, false) into v_active from public.acc_settings where company_id = v_co;

  if v_acc is not null then
    select * into a from public.acc_accounts where id = v_acc and company_id = v_co;
  end if;

  return jsonb_build_object(
    'account_id', v_acc,
    'account_code', a.code,
    'account_name', a.name,
    'accounting_active', coalesce(v_active, false)
  );
end;
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

  if p_account is not null
     and exists (
       select 1 from public.acc_settings where company_id = v_co and active = true
     ) then
    begin
      v_res := public.acc_post_pending();
    exception when others then
      v_res := null;
    end;
  end if;

  return coalesce(v_res, '{}'::jsonb);
end;
$function$;

-- =============================================================================
-- 6. DIAN: FORMULARIOS 300 Y 350 SIN BYPASS GLOBAL + ROL CONTABLE VERIFICADO
-- =============================================================================

create or replace function public.dian_calcular_formulario_300(
  p_company_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cur_co uuid := public.current_company_id();
  v_ing_grav_19 numeric := 0;
  v_ing_grav_5 numeric := 0;
  v_ing_excl numeric := 0;
  v_iva_gen_19 numeric := 0;
  v_iva_gen_5 numeric := 0;
  v_dev_ventas numeric := 0;
  v_compras_grav_desc numeric := 0;
  v_iva_desc_compras numeric := 0;
  v_reclass_base_desc numeric := 0;
  v_reclass_iva_desc numeric := 0;
  v_compras_pend_base numeric := 0;
  v_iva_pend_compras numeric := 0;
  v_compras_costo_base numeric := 0;
  v_iva_costo_compras numeric := 0;
  v_compras_sin_iva numeric := 0;
  v_dev_base_desc numeric := 0;
  v_dev_iva_desc numeric := 0;
  v_dev_base_pend numeric := 0;
  v_dev_iva_pend numeric := 0;
  v_dev_base_costo numeric := 0;
  v_dev_iva_costo numeric := 0;
  v_dev_base_sin_iva numeric := 0;
  v_iva_neto_desc numeric := 0;
  v_saldo_pagar numeric := 0;
  v_saldo_favor numeric := 0;
  v_has_dev_iva boolean;
  v_acc_active boolean := false;
  v_acc_start date;
  v_acc_tz text := 'America/Caracas';
  v_unposted_pur int := 0;
  v_unposted_dev int := 0;
begin
  if auth.uid() is null
     or v_cur_co is null
     or p_company_id is null
     or p_company_id is distinct from v_cur_co
     or not public.can_view_accounting() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 0 then coalesce(s.subtotal, s.total) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.tax_amount, 0) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.tax_amount, 0) else 0 end), 0)
  into v_ing_grav_19, v_ing_grav_5, v_ing_excl, v_iva_gen_19, v_iva_gen_5
  from public.sales s
  where s.company_id = p_company_id
    and s.created_at >= p_start_date
    and s.created_at < p_end_date
    and s.status <> 'anulada';

  select coalesce(sum(d.amount), 0) into v_dev_ventas
  from public.devolutions d
  where d.company_id = p_company_id
    and d.created_at >= p_start_date
    and d.created_at < p_end_date;

  select
    coalesce(sum(case when p.tax_status = 'descontable' and p.iva_classified_at is null
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'descontable' and p.iva_classified_at is null
      then coalesce(p.tax, 0) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'pendiente'
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'pendiente'
      then coalesce(p.tax, 0) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'costo'
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'costo'
      then coalesce(p.tax, 0) else 0 end), 0),
    coalesce(sum(case when p.tax_status = 'sin_iva'
      then coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) else 0 end), 0)
  into
    v_compras_grav_desc, v_iva_desc_compras,
    v_compras_pend_base, v_iva_pend_compras,
    v_compras_costo_base, v_iva_costo_compras,
    v_compras_sin_iva
  from public.purchases p
  where p.company_id = p_company_id
    and p.created_at >= p_start_date
    and p.created_at < p_end_date
    and p.status = 'recibida';

  v_has_dev_iva := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_devolutions' and column_name = 'tax_amount'
  );

  if v_has_dev_iva then
    execute $q$
      select
        coalesce(sum(greatest(0,
          coalesce(p.subtotal, p.total - coalesce(p.tax, 0)) -
          coalesce((
            select sum(coalesce(pd.subtotal, pd.amount))
            from public.purchase_devolutions pd
            where pd.company_id = adj.company_id
              and pd.purchase_id = adj.purchase_id
              and pd.status = 'activa'
              and pd.tax_status_snapshot = 'pendiente'
              and pd.created_at <= adj.created_at
          ), 0)
        )), 0),
        coalesce(sum(adj.tax_amount), 0)
      from public.purchase_iva_adjustments adj
      join public.purchases p on p.id = adj.purchase_id
      where adj.company_id = $1
        and adj.status = 'aplicado'
        and adj.to_status = 'descontable'
        and p.status = 'recibida'
        and adj.created_at >= $2
        and adj.created_at < $3
    $q$ into v_reclass_base_desc, v_reclass_iva_desc using p_company_id, p_start_date, p_end_date;

    execute $q$
      select
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'descontable'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0),
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'descontable'
          then coalesce(pd.tax_amount, 0) else 0 end), 0),
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'pendiente' and p.tax_status = 'pendiente'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0),
        coalesce(sum(case when coalesce(pd.tax_status_snapshot, 'sin_iva') = 'pendiente' and p.tax_status = 'pendiente'
          then coalesce(pd.tax_amount, 0) else 0 end), 0),
        coalesce(sum(case when p.tax_status = 'costo'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0),
        coalesce(sum(case when p.tax_status = 'costo'
          then coalesce(pd.tax_amount, 0) else 0 end), 0),
        coalesce(sum(case when p.tax_status = 'sin_iva'
          then coalesce(pd.subtotal, pd.amount) else 0 end), 0)
      from public.purchase_devolutions pd
      join public.purchases p on p.id = pd.purchase_id
      where pd.company_id = $1
        and pd.created_at >= $2
        and pd.created_at < $3
        and pd.status = 'activa'
        and p.status = 'recibida'
    $q$ into
      v_dev_base_desc, v_dev_iva_desc,
      v_dev_base_pend, v_dev_iva_pend,
      v_dev_base_costo, v_dev_iva_costo,
      v_dev_base_sin_iva
    using p_company_id, p_start_date, p_end_date;
  else
    select
      coalesce(sum(coalesce(p.subtotal, p.total - coalesce(p.tax, 0))), 0),
      coalesce(sum(adj.tax_amount), 0)
    into v_reclass_base_desc, v_reclass_iva_desc
    from public.purchase_iva_adjustments adj
    join public.purchases p on p.id = adj.purchase_id
    where adj.company_id = p_company_id
      and adj.status = 'aplicado'
      and adj.to_status = 'descontable'
      and p.status = 'recibida'
      and adj.created_at >= p_start_date
      and adj.created_at < p_end_date;
  end if;

  v_compras_grav_desc := greatest(0, v_compras_grav_desc + v_reclass_base_desc - v_dev_base_desc);
  v_iva_neto_desc := greatest(0, v_iva_desc_compras + v_reclass_iva_desc - v_dev_iva_desc);
  v_compras_pend_base := greatest(0, v_compras_pend_base - v_dev_base_pend);
  v_iva_pend_compras := greatest(0, v_iva_pend_compras - v_dev_iva_pend);
  v_compras_costo_base := greatest(0, v_compras_costo_base - v_dev_base_costo);
  v_iva_costo_compras := greatest(0, v_iva_costo_compras - v_dev_iva_costo);
  v_compras_sin_iva := greatest(0, v_compras_sin_iva - v_dev_base_sin_iva);

  select active, start_date, timezone
  into v_acc_active, v_acc_start, v_acc_tz
  from public.acc_settings
  where company_id = p_company_id;

  if coalesce(v_acc_active, false) and v_acc_start is not null then
    select count(*) into v_unposted_pur
    from public.purchases p
    where p.company_id = p_company_id
      and p.status = 'recibida'
      and jsonb_array_length(p.items) > 0
      and p.created_at >= p_start_date
      and p.created_at < p_end_date
      and (p.created_at at time zone v_acc_tz)::date >= v_acc_start
      and not exists (
        select 1 from public.acc_entries e
        where e.company_id = p_company_id and e.source_type = 'compra'
          and e.source_id = p.id and e.source_event = 'registro'
          and e.status = 'contabilizado'
      );

    select count(*) into v_unposted_dev
    from public.purchase_devolutions pd
    where pd.company_id = p_company_id
      and pd.status = 'activa'
      and pd.created_at >= p_start_date
      and pd.created_at < p_end_date
      and (pd.created_at at time zone v_acc_tz)::date >= v_acc_start
      and not exists (
        select 1 from public.acc_entries e
        where e.company_id = p_company_id and e.source_type = 'devolucion_compra'
          and e.source_id = pd.id and e.source_event = 'registro'
          and e.status = 'contabilizado'
      );
  end if;

  if (v_iva_gen_19 + v_iva_gen_5) >= v_iva_neto_desc then
    v_saldo_pagar := (v_iva_gen_19 + v_iva_gen_5) - v_iva_neto_desc;
    v_saldo_favor := 0;
  else
    v_saldo_favor := v_iva_neto_desc - (v_iva_gen_19 + v_iva_gen_5);
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
    'casilla_66_compras_gravadas', round(v_compras_grav_desc, 0),
    'casilla_74_iva_descontable_compras', round(v_iva_neto_desc, 0),
    'casilla_83_total_iva_descontable', round(v_iva_neto_desc, 0),
    'casilla_84_saldo_a_pagar', round(v_saldo_pagar, 0),
    'casilla_85_saldo_a_favor', round(v_saldo_favor, 0),
    'compras_sin_iva_base', round(v_compras_sin_iva, 0),
    'compras_iva_pendiente_base', round(v_compras_pend_base, 0),
    'iva_compras_pendiente', round(v_iva_pend_compras, 0),
    'compras_iva_costo_base', round(v_compras_costo_base, 0),
    'iva_compras_costo', round(v_iva_costo_compras, 0),
    'devoluciones_compras_iva_descontable', round(v_dev_iva_desc, 0),
    'compras_sin_contabilizar_count', v_unposted_pur,
    'devoluciones_compra_sin_contabilizar_count', v_unposted_dev,
    'es_borrador_no_conciliado', (not coalesce(v_acc_active, false) or v_unposted_pur > 0 or v_unposted_dev > 0 or v_iva_pend_compras > 0)
  );
end;
$function$;

create or replace function public.dian_calcular_formulario_350(
  p_company_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cur_co uuid := public.current_company_id();
  v_compras_base numeric := 0; v_compras_ret numeric := 0;
  v_servicios_base numeric := 0; v_servicios_ret numeric := 0;
  v_honorarios_base numeric := 0; v_honorarios_ret numeric := 0;
  v_arrendamientos_base numeric := 0; v_arrendamientos_ret numeric := 0;
  v_laborales_base numeric := 0; v_laborales_ret numeric := 0;
  v_reteiva_base numeric := 0; v_reteiva_ret numeric := 0;
  v_auto_renta_base numeric := 0; v_auto_renta_ret numeric := 0;
  v_total_ret numeric := 0;
begin
  if auth.uid() is null
     or v_cur_co is null
     or p_company_id is null
     or p_company_id is distinct from v_cur_co
     or not public.can_view_accounting() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select
    coalesce(sum(case when a.code like '236540%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236525%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236515%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236530%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236505%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '2367%' then coalesce(l.credit - l.debit, 0) else 0 end), 0),
    coalesce(sum(case when a.code like '236575%' then coalesce(l.credit - l.debit, 0) else 0 end), 0)
  into v_compras_ret, v_servicios_ret, v_honorarios_ret, v_arrendamientos_ret, v_laborales_ret, v_reteiva_ret, v_auto_renta_ret
  from public.acc_lines l
  join public.acc_entries e on e.id = l.entry_id
  join public.acc_accounts a on a.id = l.account_id
  where e.company_id = p_company_id
    and e.entry_date >= p_start_date::date
    and e.entry_date < p_end_date::date
    and e.status in ('contabilizado', 'posted');

  if v_compras_ret > 0 then v_compras_base := round(v_compras_ret / 0.025, 0); end if;
  if v_servicios_ret > 0 then v_servicios_base := round(v_servicios_ret / 0.04, 0); end if;
  if v_honorarios_ret > 0 then v_honorarios_base := round(v_honorarios_ret / 0.11, 0); end if;
  if v_arrendamientos_ret > 0 then v_arrendamientos_base := round(v_arrendamientos_ret / 0.035, 0); end if;
  if v_reteiva_ret > 0 then v_reteiva_base := round(v_reteiva_ret / 0.15, 0); end if;

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
$function$;

-- =============================================================================
-- 7. ENDURECIMIENTO DE RLS MULTIEMPRESA Y PRIVILEGIOS DE TABLA
--    (Mantiene intactas las políticas support_* y platform_admin_company_all)
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'dian_account_mappings',
        'dian_tax_rules',
        'dian_certificates_issued',
        'suppliers',
        'purchases',
        'purchase_iva_adjustments',
        'purchase_devolutions',
        'purchase_devolution_lots',
        'purchase_orders',
        'purchase_order_items'
      )
      and policyname not like 'support\_%' escape '\'
      and policyname <> 'platform_admin_company_all'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 7.1 Tablas DIAN: eliminar bypass admin/super_admin, exigir empresa activa y perfil activo con rol contable
create policy dian_account_mappings_select on public.dian_account_mappings
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and public.can_view_accounting()
  );

create policy dian_account_mappings_write on public.dian_account_mappings
  for all to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = dian_account_mappings.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  )
  with check (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = dian_account_mappings.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  );

create policy dian_tax_rules_select on public.dian_tax_rules
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and public.can_view_accounting()
  );

create policy dian_tax_rules_write on public.dian_tax_rules
  for all to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = dian_tax_rules.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  )
  with check (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = dian_tax_rules.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  );

create policy dian_certificates_issued_select on public.dian_certificates_issued
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and public.can_view_accounting()
  );

create policy dian_certificates_issued_write on public.dian_certificates_issued
  for all to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = dian_certificates_issued.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  )
  with check (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = dian_certificates_issued.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  );

revoke all on table public.dian_account_mappings, public.dian_tax_rules, public.dian_certificates_issued from public, anon;
grant select, insert, update, delete on table public.dian_account_mappings, public.dian_tax_rules, public.dian_certificates_issued to authenticated;
grant all on table public.dian_account_mappings, public.dian_tax_rules, public.dian_certificates_issued to service_role;

-- 7.2 Proveedores: lectura autorizada (gerencia, contador, comprador) y escritura solo admin/dueno/admin_empresa/comprador
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = suppliers.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador', 'comprador')
    )
  );

create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = suppliers.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'comprador')
    )
  );

create policy suppliers_update on public.suppliers
  for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = suppliers.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'comprador')
    )
  )
  with check (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = suppliers.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'comprador')
    )
  );

create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = suppliers.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'comprador')
    )
  );

revoke all on table public.suppliers from public, anon;
grant select, insert, update, delete on table public.suppliers to authenticated;
grant all on table public.suppliers to service_role;

-- 7.3 Compras, ajustes IVA, devoluciones y órdenes de compra: solo SELECT por rol + escritura exclusivamente vía RPC
create policy purchases_select on public.purchases
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = purchases.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador', 'comprador')
    )
  );

create policy purchase_iva_adjustments_select on public.purchase_iva_adjustments
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = purchase_iva_adjustments.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  );

create policy purchase_devolutions_select on public.purchase_devolutions
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = purchase_devolutions.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  );

create policy purchase_devolution_lots_select on public.purchase_devolution_lots
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = purchase_devolution_lots.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
    )
  );

create policy purchase_orders_select on public.purchase_orders
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = purchase_orders.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador', 'comprador', 'almacen')
    )
  );

create policy purchase_order_items_select on public.purchase_order_items
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and exists (
      select 1 from public.profiles pr
      where pr.id = (select auth.uid())
        and pr.active = true
        and pr.company_id = purchase_order_items.company_id
        and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador', 'comprador', 'almacen')
    )
  );

revoke all on table
  public.purchases,
  public.purchase_iva_adjustments,
  public.purchase_devolutions,
  public.purchase_devolution_lots,
  public.purchase_orders,
  public.purchase_order_items
from public, anon;

revoke insert, update, delete, truncate on table
  public.purchases,
  public.purchase_iva_adjustments,
  public.purchase_devolutions,
  public.purchase_devolution_lots,
  public.purchase_orders,
  public.purchase_order_items
from authenticated;

grant select on table
  public.purchases,
  public.purchase_iva_adjustments,
  public.purchase_devolutions,
  public.purchase_devolution_lots,
  public.purchase_orders,
  public.purchase_order_items
to authenticated;

grant all on table
  public.purchases,
  public.purchase_iva_adjustments,
  public.purchase_devolutions,
  public.purchase_devolution_lots,
  public.purchase_orders,
  public.purchase_order_items
to service_role;

-- =============================================================================
-- 8. ENDURECIMIENTO DE PRIVILEGIOS DE FUNCIONES (REVOKE / GRANT)
-- =============================================================================

revoke all on function public._require_company_roles(text[]) from public, anon, authenticated;
grant execute on function public._require_company_roles(text[]) to postgres, service_role;

revoke all on function public._registrar_compra_core(uuid, uuid, jsonb, text, integer, numeric, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public._registrar_compra_core(uuid, uuid, jsonb, text, integer, numeric, text, numeric, boolean) to postgres, service_role;

revoke all on function public._registrar_compra_impl(uuid, jsonb, text, integer, numeric, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public._registrar_compra_impl(uuid, jsonb, text, integer, numeric, text, numeric, boolean) to postgres, service_role;

revoke all on function public.can_view_accounting() from public, anon;
grant execute on function public.can_view_accounting() to authenticated, service_role;

revoke all on function public.can_write_accounting() from public, anon;
grant execute on function public.can_write_accounting() to authenticated, service_role;

revoke all on function public.acc_seed_template(text) from public, anon;
grant execute on function public.acc_seed_template(text) to authenticated, service_role;

revoke all on function public.acc_save_settings(jsonb) from public, anon;
grant execute on function public.acc_save_settings(jsonb) to authenticated, service_role;

revoke all on function public.acc_post_pending() from public, anon;
grant execute on function public.acc_post_pending() to authenticated, service_role;

revoke all on function public.acc_create_entry(date, text, jsonb, boolean, text, uuid, text) from public, anon;
grant execute on function public.acc_create_entry(date, text, jsonb, boolean, text, uuid, text) to authenticated, service_role;

revoke all on function public.acc_post_entry(uuid) from public, anon;
grant execute on function public.acc_post_entry(uuid) to authenticated, service_role;

revoke all on function public.acc_reconcile() from public, anon;
grant execute on function public.acc_reconcile() to authenticated, service_role;

revoke all on function public.acc_reopen_period(integer, integer, text) from public, anon;
grant execute on function public.acc_reopen_period(integer, integer, text) to authenticated, service_role;

revoke all on function public.registrar_compra(uuid, jsonb, text, integer) from public, anon;
grant execute on function public.registrar_compra(uuid, jsonb, text, integer) to authenticated, service_role;

revoke all on function public.registrar_compra(uuid, jsonb, text, integer, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.registrar_compra(uuid, jsonb, text, integer, numeric, text, numeric, boolean) to authenticated, service_role;

revoke all on function public.registrar_compra_con_iva(uuid, jsonb, text, integer, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.registrar_compra_con_iva(uuid, jsonb, text, integer, numeric, text, numeric, boolean) to authenticated, service_role;

revoke all on function public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) from public, anon;
grant execute on function public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) to authenticated, service_role;

revoke all on function public.cambiar_estado_orden_compra(uuid, text) from public, anon;
grant execute on function public.cambiar_estado_orden_compra(uuid, text) to authenticated, service_role;

revoke all on function public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) from public, anon;
grant execute on function public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) to authenticated, service_role;

revoke all on function public.clasificar_iva_compra(uuid, text, text) from public, anon;
grant execute on function public.clasificar_iva_compra(uuid, text, text) to authenticated, service_role;

revoke all on function public.anular_compra(uuid) from public, anon;
grant execute on function public.anular_compra(uuid) to authenticated, service_role;

revoke all on function public.registrar_devolucion_compra(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.registrar_devolucion_compra(uuid, uuid, numeric, text, text) to authenticated, service_role;

revoke all on function public.anular_devolucion_compra(uuid) from public, anon;
grant execute on function public.anular_devolucion_compra(uuid) to authenticated, service_role;

revoke all on function public.cuentas_por_pagar() from public, anon;
grant execute on function public.cuentas_por_pagar() to authenticated, service_role;

revoke all on function public.cuenta_por_pagar_proveedor(uuid) from public, anon;
grant execute on function public.cuenta_por_pagar_proveedor(uuid) to authenticated, service_role;

revoke all on function public.guardar_credito_proveedor(uuid, numeric, integer) from public, anon;
grant execute on function public.guardar_credito_proveedor(uuid, numeric, integer) to authenticated, service_role;

revoke all on function public.registrar_pago_proveedor(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.registrar_pago_proveedor(uuid, numeric, text, text, uuid) to authenticated, service_role;

revoke all on function public.anular_pago_proveedor(uuid) from public, anon;
grant execute on function public.anular_pago_proveedor(uuid) to authenticated, service_role;

revoke all on function public.cxp_config() from public, anon;
grant execute on function public.cxp_config() to authenticated, service_role;

revoke all on function public.cxp_save_account(uuid) from public, anon;
grant execute on function public.cxp_save_account(uuid) to authenticated, service_role;

revoke all on function public.dian_calcular_formulario_300(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.dian_calcular_formulario_300(uuid, timestamptz, timestamptz) to authenticated, service_role;

revoke all on function public.dian_calcular_formulario_350(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.dian_calcular_formulario_350(uuid, timestamptz, timestamptz) to authenticated, service_role;

select public.sql_registrar_migracion(
  '20261115000065_corregir_permisos_y_seguridad_fase_b',
  'Etapa 1 Fase B: matriz única de permisos, separación Compras/Almacén/Contador/Gerencia, recepción OC validada y cierre RLS multiempresa',
  '20261115000065_corregir_permisos_y_seguridad_fase_b.sql'
);
