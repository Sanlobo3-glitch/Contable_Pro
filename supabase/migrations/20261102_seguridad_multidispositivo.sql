-- Inventario Pro: registro de dispositivos con autorización fail-closed.
-- Ejecutar en Supabase SQL Editor después de revisar el proyecto y hacer backup.

create or replace function public.register_device(
  p_key text,
  p_name text,
  p_kind text,
  p_os text,
  p_browser text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_role text;
  v_active boolean;
  v_usage jsonb;
  v_status text;
  v_enforced boolean;
begin
  if v_user is null then
    raise exception 'Debes iniciar sesión para registrar este dispositivo.' using errcode = '42501';
  end if;

  if p_key is null or p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Identificador de dispositivo inválido.' using errcode = '22023';
  end if;

  if p_kind is null or p_kind not in ('movil', 'tablet', 'pc', 'mac') then
    raise exception 'Tipo de dispositivo no permitido.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'El dispositivo debe tener un nombre válido.' using errcode = '22023';
  end if;

  select pr.company_id, pr.role, pr.active
    into v_company, v_role, v_active
  from public.profiles pr
  where pr.id = v_user;

  if not found or v_active is distinct from true then
    raise exception 'La cuenta no existe o está desactivada.' using errcode = '42501';
  end if;

  if v_company is null then
    raise exception 'Tu usuario todavía no está asociado a una empresa.' using errcode = '42501';
  end if;

  v_usage := public.device_usage();
  v_enforced := coalesce((v_usage ->> 'enforced')::boolean, false);

  -- Dueño/administrador puede autorizar automáticamente su equipo si hay cupo.
  -- Los demás equipos quedan pendientes y el cliente decide si se bloquean
  -- según la política enforced de la empresa.
  if v_role in ('dueno', 'admin')
     and coalesce((v_usage ->> 'used')::integer, 0) < coalesce((v_usage ->> 'limit')::integer, 1) then
    v_status := 'autorizado';
  else
    v_status := 'pendiente';
  end if;

  insert into public.devices (
    company_id, user_id, device_key, name, kind, os, browser, status, last_seen
  ) values (
    v_company, v_user, p_key, left(btrim(p_name), 120), p_kind,
    left(coalesce(nullif(btrim(p_os), ''), 'Otro'), 80),
    left(coalesce(nullif(btrim(p_browser), ''), 'Navegador'), 80),
    v_status, now()
  )
  on conflict (company_id, device_key) do update
    set name = excluded.name,
        os = excluded.os,
        browser = excluded.browser,
        last_seen = now()
    where public.devices.user_id is null
       or public.devices.user_id = excluded.user_id
  returning status into v_status;

  if v_status is null then
    raise exception 'Este identificador de dispositivo ya está asociado a otro usuario.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'enforced', v_enforced
  );
end;
$function$;

revoke all on function public.register_device(text, text, text, text, text) from public;
revoke all on function public.register_device(text, text, text, text, text) from anon;
grant execute on function public.register_device(text, text, text, text, text) to authenticated;
grant execute on function public.register_device(text, text, text, text, text) to service_role;

comment on function public.register_device(text, text, text, text, text) is
  'Registra un dispositivo de usuario activo y asociado a empresa. Rechaza errores de identidad y nunca autoriza por defecto.';
