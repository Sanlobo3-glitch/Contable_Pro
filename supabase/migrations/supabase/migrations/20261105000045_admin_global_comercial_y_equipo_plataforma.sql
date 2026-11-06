-- ============================================================
-- INVENTARIOPRO · MIGRACIÓN 000040
-- ADMINISTRACIÓN GLOBAL COMERCIAL Y EQUIPO DE PLATAFORMA
--
-- No concede acceso operativo global a empresas clientes.
-- No modifica la empresa interna ni los roles empresariales.
-- No crea usuarios Auth: las invitaciones se harán mediante
-- un servicio seguro en una fase posterior.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. PREVALIDAR DEPENDENCIAS
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.company_config') IS NULL
     OR to_regclass('public.company_subscriptions') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.platform_admins') IS NULL THEN
    RAISE EXCEPTION
      'Faltan tablas base para la administración global';
  END IF;

  IF to_regprocedure('public.assert_platform_admin()') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION
      'Faltan funciones de autorización de plataforma';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'company_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'plan_type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'trial_start'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'trial_end'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'subscription_start'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'subscription_end'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'updated_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_subscriptions'
      AND column_name = 'updated_by'
  ) THEN
    RAISE EXCEPTION
      'La estructura de company_subscriptions no coincide con la esperada';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 1. AUDITORÍA DEL PLANO GLOBAL
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  target_company_id uuid
    REFERENCES public.companies(id) ON DELETE SET NULL,
  target_user_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_created
  ON public.platform_admin_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_company
  ON public.platform_admin_audit(target_company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_actor
  ON public.platform_admin_audit(actor_id, created_at DESC);

ALTER TABLE public.platform_admin_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_admin_audit
FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. EQUIPO INTERNO DE INVENTARIOPRO
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_staff (
  user_id uuid PRIMARY KEY
    REFERENCES auth.users(id) ON DELETE CASCADE,

  staff_role text NOT NULL CHECK (staff_role IN (
    'developer',
    'operations_manager',
    'support_manager',
    'technician',
    'commercial',
    'billing',
    'customer_success'
  )),

  active boolean NOT NULL DEFAULT true,

  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(permissions) = 'object'),

  notes text,

  granted_by uuid NOT NULL REFERENCES auth.users(id),

  granted_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_staff_active_role
  ON public.platform_staff(active, staff_role);

ALTER TABLE public.platform_staff ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_staff
FROM PUBLIC, anon, authenticated;

-- La membresía global es independiente del rol y empresa
-- que tenga el perfil empresarial del integrante.

CREATE OR REPLACE FUNCTION public.is_platform_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_staff ps
    WHERE ps.user_id = auth.uid()
      AND ps.active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_staff()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_platform_staff()
TO authenticated;

-- ------------------------------------------------------------
-- 3. LISTADO COMERCIAL GLOBAL DE EMPRESAS CLIENTES
--
-- Solo devuelve metadatos comerciales.
-- Excluye la empresa interna del administrador central.
-- No consulta ventas, inventario, caja ni datos operativos.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_listar_empresas_comerciales()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_internal_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  v_internal_company := public.current_company_id();

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'company_id', c.id,

        'company_name', coalesce(
          nullif(btrim(cc.name), ''),
          nullif(btrim(c.name), ''),
          'Empresa sin nombre'
        ),

        'owner_name', owner.full_name,
        'owner_email', owner.email,

        'members_count', coalesce(m.members_count, 0),

        'plan_type', cs.plan_type,
        'subscription_status', cs.status,

        'trial_start', cs.trial_start,
        'trial_end', cs.trial_end,

        'subscription_start', cs.subscription_start,
        'subscription_end', cs.subscription_end,

        'created_at', c.created_at
      )
      ORDER BY c.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.companies c

  LEFT JOIN public.company_config cc
    ON cc.company_id = c.id

  LEFT JOIN public.company_subscriptions cs
    ON cs.company_id = c.id

  LEFT JOIN LATERAL (
    SELECT
      p.full_name,
      p.email
    FROM public.profiles p
    WHERE p.company_id = c.id
    ORDER BY
      (p.role = 'dueno') DESC,
      p.created_at ASC
    LIMIT 1
  ) owner ON true

  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS members_count
    FROM public.profiles p
    WHERE p.company_id = c.id
  ) m ON true

  WHERE c.id IS DISTINCT FROM v_internal_company;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_listar_empresas_comerciales()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_listar_empresas_comerciales()
TO authenticated;
-- ------------------------------------------------------------
-- 4. ACTIVAR O RENOVAR PLAN DE EMPRESA CLIENTE
--
-- p_months = 0 significa vigencia indefinida.
-- No permite modificar la empresa interna de pruebas.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_activar_plan_empresa(
  p_company_id uuid,
  p_plan text,
  p_months integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_end timestamptz;
  v_previous_status text;
  v_previous_plan text;
  v_internal_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  v_internal_company := public.current_company_id();

  IF p_company_id IS NULL
     OR p_company_id = v_internal_company THEN
    RAISE EXCEPTION
      'Esta operación solo aplica a empresas clientes'
      USING ERRCODE = '42501';
  END IF;

  IF p_plan NOT IN (
    'emprendedor',
    'profesional',
    'empresarial',
    'corporativo'
  ) THEN
    RAISE EXCEPTION 'Plan inválido';
  END IF;

  IF p_months IS NULL
     OR p_months < 0
     OR p_months > 120 THEN
    RAISE EXCEPTION
      'La duración debe estar entre 0 y 120 meses';
  END IF;

  SELECT
    cs.status,
    cs.plan_type
  INTO
    v_previous_status,
    v_previous_plan
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No existe suscripción para esta empresa';
  END IF;

  IF p_months = 0 THEN
    v_end := NULL;
  ELSE
    SELECT
      greatest(
        CASE
          WHEN status = 'active'
           AND (
             subscription_end IS NULL
             OR subscription_end > now()
           )
          THEN coalesce(subscription_end, now())
          ELSE now()
        END,
        now()
      ) + make_interval(months => p_months)
    INTO v_end
    FROM public.company_subscriptions
    WHERE company_id = p_company_id;
  END IF;

  UPDATE public.company_subscriptions
  SET
    plan_type = p_plan,
    status = 'active',

    subscription_start = CASE
      WHEN v_previous_status = 'active'
        AND subscription_start IS NOT NULL
      THEN subscription_start
      ELSE now()
    END,

    subscription_end = v_end,

    trial_start = NULL,
    trial_end = NULL,

    plan_courtesy = false,

    plan_note = nullif(
      btrim(coalesce(p_note, '')),
      ''
    ),

    updated_at = now(),
    updated_by = auth.uid()

  WHERE company_id = p_company_id;

  INSERT INTO public.platform_admin_audit(
    actor_id,
    target_company_id,
    event_type,
    event_data
  )
  VALUES (
    auth.uid(),
    p_company_id,
    'company_plan_activated',
    jsonb_build_object(
      'previous_plan', v_previous_plan,
      'previous_status', v_previous_status,
      'new_plan', p_plan,
      'months', p_months,
      'subscription_end', v_end,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'plan_type', p_plan,
    'subscription_status', 'active',
    'subscription_end', v_end
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_activar_plan_empresa(uuid,text,integer,text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_activar_plan_empresa(uuid,text,integer,text)
TO authenticated;


-- ------------------------------------------------------------
-- 5. CONCEDER O REINICIAR PERÍODO DE PRUEBA
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_reactivar_prueba_empresa(
  p_company_id uuid,
  p_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_internal_company uuid;
  v_trial_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  v_internal_company := public.current_company_id();

  IF p_company_id IS NULL
     OR p_company_id = v_internal_company THEN
    RAISE EXCEPTION
      'No puedes modificar la prueba de la empresa interna'
      USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL
     OR p_days < 1
     OR p_days > 90 THEN
    RAISE EXCEPTION
      'La prueba debe durar entre 1 y 90 días';
  END IF;

  v_trial_end := now() + make_interval(days => p_days);

  UPDATE public.company_subscriptions
  SET
    status = 'trial',
    trial_start = now(),
    trial_end = v_trial_end,
    subscription_start = NULL,
    subscription_end = NULL,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No existe suscripción para esta empresa';
  END IF;

  INSERT INTO public.platform_admin_audit(
    actor_id,
    target_company_id,
    event_type,
    event_data
  )
  VALUES (
    auth.uid(),
    p_company_id,
    'company_trial_granted',
    jsonb_build_object('days', p_days)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'subscription_status', 'trial',
    'trial_end', v_trial_end
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_reactivar_prueba_empresa(uuid,integer)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_reactivar_prueba_empresa(uuid,integer)
TO authenticated;


-- ------------------------------------------------------------
-- 6. SUSPENDER, REACTIVAR O MARCAR VENCIDA UNA EMPRESA
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_cambiar_estado_empresa(
  p_company_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_internal_company uuid;
  v_old_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  v_internal_company := public.current_company_id();

  IF p_company_id IS NULL
     OR p_company_id = v_internal_company THEN
    RAISE EXCEPTION
      'No puedes cambiar el estado de la empresa interna'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN (
    'active',
    'suspended',
    'expired'
  ) THEN
    RAISE EXCEPTION 'Estado no permitido';
  END IF;

  SELECT status
  INTO v_old_status
  FROM public.company_subscriptions
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No existe suscripción para esta empresa';
  END IF;

  UPDATE public.company_subscriptions
  SET
    status = p_status,

    updated_at = now(),
    updated_by = auth.uid(),

    plan_note = CASE
      WHEN nullif(btrim(coalesce(p_note, '')), '') IS NOT NULL
      THEN nullif(btrim(p_note), '')
      ELSE plan_note
    END

  WHERE company_id = p_company_id;

  INSERT INTO public.platform_admin_audit(
    actor_id,
    target_company_id,
    event_type,
    event_data
  )
  VALUES (
    auth.uid(),
    p_company_id,
    'company_subscription_status_changed',
    jsonb_build_object(
      'previous_status', v_old_status,
      'new_status', p_status,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'subscription_status', p_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_cambiar_estado_empresa(uuid,text,text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_cambiar_estado_empresa(uuid,text,text)
TO authenticated;
-- ------------------------------------------------------------
-- 7. LISTAR EQUIPO GLOBAL
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_listar_equipo_plataforma()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', ps.user_id,
        'email', p.email,
        'full_name', p.full_name,
        'profile_role', p.role,
        'staff_role', ps.staff_role,
        'active', ps.active,
        'permissions', ps.permissions,
        'notes', ps.notes,
        'granted_by', ps.granted_by,
        'granted_at', ps.granted_at,
        'updated_at', ps.updated_at
      )
      ORDER BY
        ps.active DESC,
        ps.staff_role,
        p.full_name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.platform_staff ps
  LEFT JOIN public.profiles p
    ON p.id = ps.user_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_listar_equipo_plataforma()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_listar_equipo_plataforma()
TO authenticated;


-- ------------------------------------------------------------
-- 8. ASIGNAR PERSONAL A INVENTARIOPRO
--
-- El usuario debe tener una cuenta activa existente.
-- Esta función NO crea cuentas Auth.
-- NO cambia company_id ni role del perfil empresarial.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_asignar_personal_plataforma(
  p_user_id uuid,
  p_staff_role text,
  p_permissions jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_role text;
  v_old_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  IF p_user_id IS NULL
     OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION
      'Selecciona otro usuario para asignarlo al equipo';
  END IF;

  IF p_staff_role NOT IN (
    'developer',
    'operations_manager',
    'support_manager',
    'technician',
    'commercial',
    'billing',
    'customer_success'
  ) THEN
    RAISE EXCEPTION 'Cargo de plataforma inválido';
  END IF;

  IF p_permissions IS NULL
     OR jsonb_typeof(p_permissions) <> 'object' THEN
    RAISE EXCEPTION
      'Los permisos deben enviarse como objeto JSON';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.active = true
  ) THEN
    RAISE EXCEPTION
      'El usuario debe tener una cuenta activa en InventarioPro';
  END IF;

  SELECT
    staff_role,
    active
  INTO
    v_old_role,
    v_old_active
  FROM public.platform_staff
  WHERE user_id = p_user_id
  FOR UPDATE;

  INSERT INTO public.platform_staff(
    user_id,
    staff_role,
    active,
    permissions,
    notes,
    granted_by,
    granted_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_staff_role,
    true,
    p_permissions,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    now(),
    now()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    staff_role = EXCLUDED.staff_role,
    active = true,
    permissions = EXCLUDED.permissions,
    notes = EXCLUDED.notes,
    granted_by = auth.uid(),
    updated_at = now();

  INSERT INTO public.platform_admin_audit(
    actor_id,
    target_user_id,
    event_type,
    event_data
  )
  VALUES (
    auth.uid(),
    p_user_id,
    'platform_staff_assigned',
    jsonb_build_object(
      'previous_role', v_old_role,
      'previous_active', v_old_active,
      'new_role', p_staff_role,
      'permissions', p_permissions
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'staff_role', p_staff_role
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_asignar_personal_plataforma(uuid,text,jsonb,text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_asignar_personal_plataforma(uuid,text,jsonb,text)
TO authenticated;


-- ------------------------------------------------------------
-- 9. ACTIVAR O DESACTIVAR INTEGRANTE DEL EQUIPO GLOBAL
--
-- Esto retira o habilita su membresía interna.
-- No elimina su cuenta Auth ni su perfil empresarial.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_estado_personal_plataforma(
  p_user_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  IF p_user_id IS NULL
     OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION
      'No puedes desactivar tu propia cuenta';
  END IF;

  SELECT active
  INTO v_old_active
  FROM public.platform_staff
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'El integrante no pertenece al equipo de plataforma';
  END IF;

  UPDATE public.platform_staff
  SET
    active = coalesce(p_active, false),
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.platform_admin_audit(
    actor_id,
    target_user_id,
    event_type,
    event_data
  )
  VALUES (
    auth.uid(),
    p_user_id,
    'platform_staff_status_changed',
    jsonb_build_object(
      'previous_active', v_old_active,
      'new_active', coalesce(p_active, false)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'active', coalesce(p_active, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_estado_personal_plataforma(uuid,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_estado_personal_plataforma(uuid,boolean)
TO authenticated;
-- ------------------------------------------------------------
-- 10. CONSULTAR AUDITORÍA GLOBAL
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_listar_auditoria_plataforma(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesión autenticada'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_platform_admin();

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'actor_id', a.actor_id,
        'actor_email', actor.email,
        'target_company_id', a.target_company_id,
        'target_user_id', a.target_user_id,
        'target_email', target.email,
        'event_type', a.event_type,
        'event_data', a.event_data,
        'created_at', a.created_at
      )
      ORDER BY a.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT *
    FROM public.platform_admin_audit
    ORDER BY created_at DESC
    LIMIT greatest(
      1,
      least(coalesce(p_limit, 100), 500)
    )
  ) a

  LEFT JOIN public.profiles actor
    ON actor.id = a.actor_id

  LEFT JOIN public.profiles target
    ON target.id = a.target_user_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_listar_auditoria_plataforma(integer)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_listar_auditoria_plataforma(integer)
TO authenticated;


-- ------------------------------------------------------------
-- 11. VERIFICACIONES DE SEGURIDAD
-- ------------------------------------------------------------

DO $validation$
DECLARE
  v_function_count integer;
BEGIN
  SELECT count(*)
  INTO v_function_count
  FROM pg_proc p
  JOIN pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'admin_listar_empresas_comerciales',
      'admin_activar_plan_empresa',
      'admin_reactivar_prueba_empresa',
      'admin_cambiar_estado_empresa',
      'admin_listar_equipo_plataforma',
      'admin_asignar_personal_plataforma',
      'admin_estado_personal_plataforma',
      'admin_listar_auditoria_plataforma'
    )
    AND p.prosecdef = true;

  IF v_function_count <> 8 THEN
    RAISE EXCEPTION
      'Se esperaban 8 RPC SECURITY DEFINER; encontrados: %',
      v_function_count;
  END IF;

  -- Las tablas internas no pueden consultarse directamente.
  IF has_table_privilege(
    'authenticated',
    'public.platform_staff',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'public.platform_staff',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.platform_admin_audit',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'Las tablas internas tienen acceso directo indebido';
  END IF;

  -- anon no puede ejecutar RPC administrativos.
  IF has_function_privilege(
    'anon',
    'public.admin_listar_empresas_comerciales()',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.admin_listar_equipo_plataforma()',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.admin_asignar_personal_plataforma(uuid,text,jsonb,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'anon conserva ejecución de RPC de plataforma';
  END IF;
END;
$validation$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- FIN MIGRACIÓN 000040
-- ============================================================
