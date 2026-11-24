-- Revierte 01: restaura la versión original (STABLE, sin límite de intentos).

create or replace function public.consultar_pedido_catalogo_publico(
  p_company_id uuid,
  p_order_number text,
  p_pin_or_phone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_ord public.catalog_orders%rowtype;
  v_code text := upper(btrim(coalesce(p_order_number, '')));
  v_secret text := regexp_replace(coalesce(p_pin_or_phone, ''), '[^0-9]', '', 'g');
  v_phone_digits text;
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
    return jsonb_build_object('found', false,
      'reason', 'No encontramos ningún pedido con ese código en este catálogo.');
  end if;

  v_phone_digits := regexp_replace(coalesce(v_ord.customer_phone, ''), '[^0-9]', '', 'g');

  if v_ord.tracking_pin <> right(v_secret, 4)
     and right(v_phone_digits, 4) <> right(v_secret, 4)
     and v_phone_digits <> v_secret then
    return jsonb_build_object('found', false,
      'reason', 'El PIN o teléfono ingresado no coincide con el titular del pedido.');
  end if;

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

-- drop table if exists public.catalog_lookup_attempts; -- opcional
