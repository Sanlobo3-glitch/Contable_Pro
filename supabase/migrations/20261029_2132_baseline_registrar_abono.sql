-- Baseline: copia de la funcion tal como estaba en Supabase el 2026-10-29.

CREATE OR REPLACE FUNCTION public.registrar_abono(p_customer_id uuid, p_amount numeric, p_method text DEFAULT 'efectivo'::text, p_note text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_co uuid := public._ctx(null);
  v_amount numeric; v_cust text; v_owed numeric; v_id uuid; v_left numeric; v_alloc numeric;
  v_name text; r record;
begin
  if p_client_id is not null then
    select id into v_id from credit_payments where company_id = v_co and client_uuid = p_client_id;
    if found then return v_id; end if;
  end if;
  if not public._es_finito(p_amount) or p_amount <= 0 then raise exception 'El abono debe ser mayor que cero'; end if;
  v_amount := round(p_amount, 2);
  if v_amount < 0.01 then raise exception 'El abono debe ser mayor que cero'; end if;
  if coalesce(p_method, '') not in ('efectivo', 'tarjeta', 'transferencia') then
    raise exception 'Método de pago inválido';
  end if;

  select name into v_cust from customers where id = p_customer_id and company_id = v_co for update;
  if not found then raise exception 'Cliente no existe'; end if;

  v_owed := public._customer_owed(v_co, p_customer_id);
  if v_owed <= 0 then raise exception 'Este cliente no tiene deuda pendiente'; end if;
  if v_amount > v_owed + 0.005 then
    raise exception 'El abono (%) es mayor que lo que debe el cliente (%)', v_amount, round(v_owed, 2);
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  insert into credit_payments (company_id, customer_id, amount, method, note, client_uuid, created_by, created_by_name)
  values (v_co, p_customer_id, v_amount, p_method, nullif(left(btrim(coalesce(p_note, '')), 300), ''),
          p_client_id, auth.uid(), v_name)
  returning id into v_id;

  -- se aplica primero a la deuda más vieja
  v_left := v_amount;
  for r in
    select s.id, public._sale_balance(s.id) as bal
    from sales s
    where s.company_id = v_co and s.customer_id = p_customer_id
      and s.payment_method = 'fiado' and s.status = 'completada'
    order by s.created_at, s.id
    for update of s
  loop
    exit when v_left <= 0.004;
    if r.bal > 0.004 then
      v_alloc := least(v_left, r.bal);
      insert into credit_allocations (company_id, payment_id, sale_id, amount) values (v_co, v_id, r.id, v_alloc);
      v_left := v_left - v_alloc;
    end if;
  end loop;
  if v_left > 0.01 then raise exception 'No se pudo aplicar el abono completo'; end if;

  if p_method = 'efectivo' then
    insert into cash_entries (company_id, type, amount, description, reference_type, reference_id)
    values (v_co, 'ingreso', v_amount, 'Abono - ' || coalesce(v_cust, 'Cliente'), 'abono', v_id);
  end if;

  -- si la contabilidad falla o está incompleta, el abono igual queda registrado (queda pendiente)
  begin
    perform public.acc_post_payment(v_id);
  exception when others then
    null;
  end;
  return v_id;
end $function$;

GRANT EXECUTE ON FUNCTION public.registrar_abono(uuid, numeric, text, text, uuid) TO authenticated, service_role;
