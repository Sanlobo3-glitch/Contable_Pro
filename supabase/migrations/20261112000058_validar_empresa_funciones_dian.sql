-- Aislamiento multiempresa en dian_calcular_formulario_300/350 y correccion de estado en la 350.
create or replace function public.dian_calcular_formulario_300(p_company_id uuid, p_start_date timestamptz, p_end_date timestamptz)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ing_grav_19 numeric := 0; v_ing_grav_5 numeric := 0; v_ing_excl numeric := 0;
  v_iva_gen_19 numeric := 0; v_iva_gen_5 numeric := 0; v_dev_ventas numeric := 0;
  v_compras_grav_19 numeric := 0; v_iva_desc_compras numeric := 0;
  v_saldo_pagar numeric := 0; v_saldo_favor numeric := 0;
begin
  if not public.is_platform_admin() then
    if p_company_id is null
       or p_company_id is distinct from public.current_company_id()
       or not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.active = true) then
      raise exception 'No autorizado' using errcode = '42501';
    end if;
  end if;

  select
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.subtotal, s.total - coalesce(s.tax_amount, 0)) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 0 then coalesce(s.subtotal, s.total) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 19 then coalesce(s.tax_amount, 0) else 0 end), 0),
    coalesce(sum(case when coalesce(s.tax_rate, 0) = 5 then coalesce(s.tax_amount, 0) else 0 end), 0)
  into v_ing_grav_19, v_ing_grav_5, v_ing_excl, v_iva_gen_19, v_iva_gen_5
  from public.sales s
  where s.company_id = p_company_id and s.created_at >= p_start_date and s.created_at < p_end_date and s.status <> 'anulada';

  select coalesce(sum(d.amount), 0) into v_dev_ventas
  from public.devolutions d
  where d.company_id = p_company_id and d.created_at >= p_start_date and d.created_at < p_end_date;

  select coalesce(sum(p.subtotal), coalesce(sum(p.total - coalesce(p.tax, 0)), 0)), coalesce(sum(p.tax), 0)
  into v_compras_grav_19, v_iva_desc_compras
  from public.purchases p
  where p.company_id = p_company_id and p.created_at >= p_start_date and p.created_at < p_end_date and p.status <> 'anulada';

  if (v_iva_gen_19 + v_iva_gen_5) >= v_iva_desc_compras then
    v_saldo_pagar := (v_iva_gen_19 + v_iva_gen_5) - v_iva_desc_compras; v_saldo_favor := 0;
  else
    v_saldo_favor := v_iva_desc_compras - (v_iva_gen_19 + v_iva_gen_5); v_saldo_pagar := 0;
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
    'casilla_85_saldo_a_favor', round(v_saldo_favor, 0));
end;
$function$;

create or replace function public.dian_calcular_formulario_350(p_company_id uuid, p_start_date timestamptz, p_end_date timestamptz)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_compras_base numeric := 0; v_compras_ret numeric := 0; v_servicios_base numeric := 0; v_servicios_ret numeric := 0;
  v_honorarios_base numeric := 0; v_honorarios_ret numeric := 0; v_arrendamientos_base numeric := 0; v_arrendamientos_ret numeric := 0;
  v_laborales_base numeric := 0; v_laborales_ret numeric := 0; v_reteiva_base numeric := 0; v_reteiva_ret numeric := 0;
  v_auto_renta_base numeric := 0; v_auto_renta_ret numeric := 0; v_total_ret numeric := 0;
begin
  if not public.is_platform_admin() then
    if p_company_id is null
       or p_company_id is distinct from public.current_company_id()
       or not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.active = true) then
      raise exception 'No autorizado' using errcode = '42501';
    end if;
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
    and e.date >= p_start_date::date and e.date < p_end_date::date
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
    'casilla_90_total_retenciones', round(v_total_ret, 0));
end;
$function$;

select public.sql_registrar_migracion(
  '20261112000058_validar_empresa_funciones_dian',
  'Validar empresa en funciones DIAN 300/350 y corregir estado en 350',
  '20261112000058_validar_empresa_funciones_dian.sql'
);
