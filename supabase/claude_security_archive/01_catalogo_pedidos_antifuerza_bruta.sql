-- Protección contra fuerza bruta en consulta pública de pedidos.

create table if not exists public.catalog_lookup_attempts (
  company_id uuid not null,
  order_key text not null,
  fail_count integer not null,
  window_start timestamptz not null,
  locked_until timestamptz,
  primary key (company_id, order_key)
);

alter table public.catalog_lookup_attempts enable row level security;

revoke all on table public.catalog_lookup_attempts
from public, anon, authenticated;

create or replace function public.consultar_pedido_catalogo_publico(
  p_company_id uuid,
  p_order_number text,
  p_pin_or_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_ord public.catalog_orders%rowtype;
  v_code text := upper(btrim(coalesce(p_order_number, '')));
  v_secret text := regexp_replace(coalesce(p_pin_or_phone, ''), '[^0-9]', '', 'g');
  v_phone_digits text;
  v_locked timestamptz;
  v_match boolean;
  v_msg constant text := 'No encontramos un pedido con esos datos. Revisa el código y el PIN o teléfono.';
begin
  if p_company_id is null or v_code = '' or length(v_secret) < 4 then
    return jsonb_build_object('found', false,
      'reason', 'Ingresa el código del pedido (ej. WEB-1001) y los últimos 4 dígitos de tu teléfono o PIN.');
  end if;

  select * into v_ord from public.catalog_orders co
  where co.company_id = p_company_id
    and upper(btrim(co.order_number)) = v_code
  order by co.created_at desc limit 1;

  if not found then
    return jsonb_build_object('found', false, 'reason', v_msg);
  end if;

  select a.locked_until into v_locked
  from public.catalog_lookup_attempts a
  where a.company_id = p_company_id and a.order_key = v_code;

  if v_locked is not null and v_locked > now() then
    return jsonb_build_object('found', false,
      'reason', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
  end if;

  v_phone_digits := regexp_replace(coalesce(v_ord.customer_phone, ''), '[^0-9]', '', 'g');

  v_match :=
       (coalesce(v_ord.tracking_pin, '') <> '' and v_ord.tracking_pin = right(v_secret, 4))
    or (v_phone_digits <> '' and right(v_phone_digits, 4) = right(v_secret, 4))
    or (v_phone_digits <> '' and v_phone_digits = v_secret);

  if not v_match then
    insert into public.catalog_lookup_attempts as a
      (company_id, order_key, fail_count, window_start)
    values (p_company_id, v_code, 1, now())
    on conflict (company_id, order_key) do update set
      fail_count = case
        when a.window_start < now() - interval '15 minutes' then 1
        else a.fail_count + 1
      end,
      window_start = case
        when a.window_start < now() - interval '15 minutes' then now()
        else a.window_start
      end,
      locked_until = case
        when (case
          when a.window_start < now() - interval '15 minutes' then 1
          else a.fail_count + 1
        end) >= 5
        then now() + interval '15 minutes'
        else null
      end;

    return jsonb_build_object('found', false, 'reason', v_msg);
  end if;

  delete from public.catalog_lookup_attempts
  where company_id = p_company_id and order_key = v_code;

  return jsonb_build_object('found', true, 'order', jsonb_build_object(
    'order_number', v_ord.order_number,
    'customer_name', v_ord.customer_name,
    'customer_type', v_ord.customer_type,
    'total', v_ord.total,
    'currency', v_ord.currency,
    'payment_method', v_ord.payment_method,
    'payment_reference', v_ord.payment_reference,
    'payment_status', v_ord.payment_status,
    'order_status', v_ord.order_status,
    'delivery_mode', v_ord.delivery_mode,
    'verified_at', v_ord.verified_at,
    'admin_notes', v_ord.admin_notes,
    'created_at', v_ord.created_at,
    'items', coalesce(v_ord.items, '[]'::jsonb)
  ));
end;
$function$;
