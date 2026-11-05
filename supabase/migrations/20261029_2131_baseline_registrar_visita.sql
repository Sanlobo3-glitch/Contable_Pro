-- Baseline: copia de la funcion tal como estaba en Supabase el 2026-10-29.

CREATE OR REPLACE FUNCTION public.registrar_visita(p_customer_id uuid, p_geo jsonb, p_client_id uuid DEFAULT NULL::uuid, p_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_co uuid := public._ctx(null);
  v_id uuid;
  v_at timestamptz;
begin
  -- Reintento de una visita ya registrada: no se duplica
  if p_client_id is not null then
    select id into v_id from visits where company_id = v_co and client_uuid = p_client_id;
    if found then return json_build_object('id', v_id); end if;
  end if;

  v_id := public._record_visit(v_co, p_customer_id, null, 'visita', p_geo);

  -- Hora real de la visita (máximo 30 días atrás)
  v_at := case
    when p_captured_at is not null and p_captured_at <= now() and p_captured_at >= now() - interval '30 days'
    then p_captured_at else now() end;

  update visits set client_uuid = p_client_id, created_at = v_at where id = v_id;
  return json_build_object('id', v_id);
end $function$;

GRANT EXECUTE ON FUNCTION public.registrar_visita(uuid, jsonb, uuid, timestamptz) TO authenticated, service_role;
