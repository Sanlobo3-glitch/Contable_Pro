
-- ============================================================
-- 000038: AISLAMIENTO DE FUNCIONES ADMINISTRATIVAS
-- El administrador central solo opera en su empresa de prueba.
-- No permite administrar usuarios de otras empresas.
-- No permite promover usuarios a administradores globales.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. BARRERA COMUN PARA USUARIOS OBJETIVO
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_target_company(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
    v_current_company uuid;
BEGIN
    PERFORM public.assert_platform_admin();

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Se requiere sesión autenticada';
    END IF;

    v_current_company := public.current_company_id();

    IF v_current_company IS NULL THEN
        RAISE EXCEPTION 'El administrador no tiene empresa de prueba asignada';
    END IF;

    SELECT p.company_id
    INTO v_company
    FROM public.profiles p
    WHERE p.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND OR v_company IS NULL THEN
        RAISE EXCEPTION 'Usuario o empresa no encontrados';
    END IF;

    IF v_company IS DISTINCT FROM v_current_company THEN
        RAISE EXCEPTION 'Operación denegada: el usuario pertenece a otra empresa'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.platform_admins pa
        WHERE pa.user_id = p_user_id
          AND pa.active = true
    ) THEN
        RAISE EXCEPTION 'No se pueden administrar cuentas de plataforma desde esta función'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_company;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_target_company(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_target_company(uuid)
TO authenticated, service_role;


-- ------------------------------------------------------------
-- 2. BUSQUEDA DE USUARIOS LIMITADA A LA EMPRESA DE PRUEBA
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_find_user(p_email text)
RETURNS TABLE(
    id uuid,
    email text,
    full_name text,
    role text,
    plan_type text,
    subscription_status text,
    subscription_end timestamptz,
    trial_end timestamptz,
    plan_courtesy boolean,
    plan_note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    PERFORM public.assert_platform_admin();

    IF public.current_company_id() IS NULL THEN
        RAISE EXCEPTION 'Empresa de prueba no configurada';
    END IF;

    RETURN QUERY
    SELECT
        p.id,
        p.email,
        p.full_name,
        p.role,
        CASE WHEN pa.active THEN NULL ELSE cs.plan_type END,
        CASE WHEN pa.active THEN 'independent' ELSE cs.status END,
        CASE WHEN pa.active THEN NULL ELSE cs.subscription_end END,
        CASE WHEN pa.active THEN NULL ELSE cs.trial_end END,
        CASE WHEN pa.active THEN false ELSE cs.plan_courtesy END,
        CASE WHEN pa.active THEN NULL ELSE cs.plan_note END
    FROM public.profiles p
    LEFT JOIN public.company_subscriptions cs
        ON cs.company_id = p.company_id
    LEFT JOIN public.platform_admins pa
        ON pa.user_id = p.id AND pa.active = true
    WHERE p.company_id = public.current_company_id()
      AND p.email ILIKE '%' || coalesce(p_email, '') || '%'
    ORDER BY p.created_at DESC
    LIMIT 20;
END;
$function$;


-- ------------------------------------------------------------
-- 3. LISTADO DE CORTESIAS LIMITADO A LA EMPRESA DE PRUEBA
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_courtesies()
RETURNS TABLE(
    id uuid,
    email text,
    full_name text,
    plan_type text,
    subscription_end timestamptz,
    plan_note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    PERFORM public.assert_platform_admin();

    IF public.current_company_id() IS NULL THEN
        RAISE EXCEPTION 'Empresa de prueba no configurada';
    END IF;

    RETURN QUERY
    SELECT
        owner.id,
        owner.email,
        owner.full_name,
        cs.plan_type,
        cs.subscription_end,
        cs.plan_note
    FROM public.company_subscriptions cs
    JOIN LATERAL (
        SELECT p.id, p.email, p.full_name
        FROM public.profiles p
        WHERE p.company_id = cs.company_id
        ORDER BY (p.role = 'dueno') DESC, p.created_at ASC
        LIMIT 1
    ) owner ON true
    WHERE cs.plan_courtesy = true
      AND cs.company_id = public.current_company_id()
    ORDER BY cs.updated_at DESC;
END;
$function$;


-- ------------------------------------------------------------
-- 4. ACTIVAR / DESACTIVAR USUARIO
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_active(
    p_user_id uuid,
    p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    IF p_user_id = auth.uid() AND p_active = false THEN
        RAISE EXCEPTION 'No puedes desactivar tu propia cuenta';
    END IF;

    UPDATE public.profiles
    SET active = p_active
    WHERE id = p_user_id
      AND company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo actualizar el usuario';
    END IF;
END;
$function$;


-- ------------------------------------------------------------
-- 5. CAMBIO DE ROL SIN PROMOCION A ADMINISTRADOR GLOBAL
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_role(
    p_user_id uuid,
    p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    IF p_role NOT IN (
        'admin',
        'dueno',
        'admin_empresa',
        'gerente',
        'contador',
        'almacen',
        'vendedor',
        'transportador',
        'cajero',
        'comprador'
    ) THEN
        RAISE EXCEPTION 'Rol inválido';
    END IF;

    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'No puedes cambiar tu propio rol';
    END IF;

    UPDATE public.profiles
    SET
        role = p_role,
        subscription_status = CASE
            WHEN p_role = 'admin' THEN 'expired'
            ELSE subscription_status
        END,
        trial_start = CASE
            WHEN p_role = 'admin' THEN NULL
            ELSE trial_start
        END,
        trial_end = CASE
            WHEN p_role = 'admin' THEN NULL
            ELSE trial_end
        END,
        subscription_end = CASE
            WHEN p_role = 'admin' THEN NULL
            ELSE subscription_end
        END,
        plan_type = CASE
            WHEN p_role = 'admin' THEN NULL
            ELSE plan_type
        END,
        plan_courtesy = CASE
            WHEN p_role = 'admin' THEN false
            ELSE plan_courtesy
        END,
        plan_note = CASE
            WHEN p_role = 'admin' THEN NULL
            ELSE plan_note
        END,
        plan_granted_at = CASE
            WHEN p_role = 'admin' THEN NULL
            ELSE plan_granted_at
        END
    WHERE id = p_user_id
      AND company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado en la empresa de prueba';
    END IF;

    -- IMPORTANTE:
    -- Esta función ya no inserta ni reactiva registros en
    -- public.platform_admins.
    -- El rol admin aquí es exclusivamente empresarial.
END;
$function$;


-- ------------------------------------------------------------
-- 6. ASIGNAR PLAN EMPRESARIAL
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_plan(
    p_user_id uuid,
    p_plan text,
    p_days integer,
    p_lifetime boolean,
    p_courtesy boolean,
    p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
    v_base timestamptz;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    IF p_plan NOT IN (
        'emprendedor',
        'profesional',
        'empresarial',
        'corporativo'
    ) THEN
        RAISE EXCEPTION 'Plan inválido';
    END IF;

    IF NOT coalesce(p_lifetime, false)
       AND (p_days IS NULL OR p_days < 1) THEN
        RAISE EXCEPTION 'Duración inválida';
    END IF;

    SELECT
        CASE
            WHEN status = 'active'
             AND (subscription_end IS NULL OR subscription_end > now())
            THEN coalesce(subscription_end, now())
            ELSE now()
        END
    INTO v_base
    FROM public.company_subscriptions
    WHERE company_id = v_company;

    UPDATE public.company_subscriptions
    SET
        plan_type = p_plan,
        status = 'active',
        subscription_start = coalesce(subscription_start, now()),
        subscription_end = CASE
            WHEN coalesce(p_lifetime, false) THEN NULL
            ELSE v_base + make_interval(days => p_days)
        END,
        plan_courtesy = coalesce(p_courtesy, false),
        plan_note = p_note,
        updated_at = now(),
        updated_by = auth.uid()
    WHERE company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suscripción empresarial no encontrada';
    END IF;
END;
$function$;


-- ------------------------------------------------------------
-- 7. REINICIAR PRUEBA EMPRESARIAL
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_reset_trial(
    p_user_id uuid,
    p_days integer DEFAULT 7
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    IF p_days IS NULL OR p_days < 1 THEN
        RAISE EXCEPTION 'Duración inválida';
    END IF;

    UPDATE public.company_subscriptions
    SET
        status = 'trial',
        trial_start = now(),
        trial_end = now() + make_interval(days => p_days),
        subscription_start = NULL,
        subscription_end = NULL,
        updated_at = now(),
        updated_by = auth.uid()
    WHERE company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suscripción empresarial no encontrada';
    END IF;
END;
$function$;


-- ------------------------------------------------------------
-- 8. REVOCAR PLAN
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_revoke_plan(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    UPDATE public.company_subscriptions
    SET
        status = 'expired',
        trial_end = now(),
        subscription_end = now(),
        updated_at = now(),
        updated_by = auth.uid()
    WHERE company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suscripción empresarial no encontrada';
    END IF;
END;
$function$;


-- ------------------------------------------------------------
-- 9. ACTIVAR SUSCRIPCION
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_activate_subscription(
    p_user_id uuid,
    p_plan text,
    p_months integer,
    p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
    v_end timestamptz;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    IF p_plan NOT IN (
        'emprendedor',
        'profesional',
        'empresarial',
        'corporativo'
    ) THEN
        RAISE EXCEPTION 'Plan inválido';
    END IF;

    IF p_months IS NULL OR p_months < 1 THEN
        RAISE EXCEPTION 'Meses inválidos';
    END IF;

    SELECT
        greatest(coalesce(cs.subscription_end, now()), now())
        + make_interval(months => p_months)
    INTO v_end
    FROM public.company_subscriptions cs
    WHERE cs.company_id = v_company;

    UPDATE public.company_subscriptions
    SET
        plan_type = p_plan,
        status = 'active',
        subscription_start = coalesce(subscription_start, now()),
        subscription_end = v_end,
        updated_at = now(),
        updated_by = auth.uid()
    WHERE company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suscripción empresarial no encontrada';
    END IF;

    INSERT INTO public.subscriptions(
        user_id,
        company_id,
        amount,
        currency,
        status
    )
    VALUES (
        p_user_id,
        v_company,
        coalesce(p_amount, 0),
        'USD',
        'admin_activated'
    );
END;
$function$;


-- ------------------------------------------------------------
-- 10. DESACTIVAR SUSCRIPCION
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_deactivate_subscription(
    p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_company uuid;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    UPDATE public.company_subscriptions
    SET
        status = 'expired',
        subscription_end = now(),
        updated_at = now(),
        updated_by = auth.uid()
    WHERE company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suscripción empresarial no encontrada';
    END IF;
END;
$function$;


-- ------------------------------------------------------------
-- 11. LIMITAR GESTION DE DISPOSITIVOS A EMPRESA DE PRUEBA
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_company_device_enforcement(
    p_company_id uuid,
    p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Solo el administrador central puede configurar dispositivos'
            USING ERRCODE = '42501';
    END IF;

    IF public.current_company_id() IS NULL
       OR p_company_id IS DISTINCT FROM public.current_company_id() THEN
        RAISE EXCEPTION 'Solo puedes configurar dispositivos de tu empresa de prueba'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.companies c
        WHERE c.id = p_company_id
    ) THEN
        RAISE EXCEPTION 'Empresa no encontrada';
    END IF;

    INSERT INTO public.device_settings(company_id, enforced)
    VALUES (p_company_id, p_enabled)
    ON CONFLICT (company_id)
    DO UPDATE SET enforced = EXCLUDED.enforced;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_company_device_enforcement(uuid, boolean)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_company_device_enforcement(uuid, boolean)
TO authenticated, service_role;


-- ------------------------------------------------------------
-- 12. LIMITAR ESTADO DE DISPOSITIVOS DEL ADMIN CENTRAL
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_device_status(
    p_id uuid,
    p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_device_company uuid;
    v_device_user uuid;
    v_current text;
    v_usage jsonb;
BEGIN
    IF p_status NOT IN ('pendiente', 'autorizado', 'bloqueado') THEN
        RAISE EXCEPTION 'Estado de dispositivo inválido';
    END IF;

    SELECT d.company_id, d.user_id, d.status
    INTO v_device_company, v_device_user, v_current
    FROM public.devices d
    WHERE d.id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispositivo no encontrado';
    END IF;

    IF public.is_platform_admin() THEN
        IF public.current_company_id() IS NULL
           OR v_device_company IS DISTINCT FROM public.current_company_id() THEN
            RAISE EXCEPTION 'Solo puedes gestionar dispositivos de tu empresa de prueba'
                USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NOT public.is_manager()
           OR public.my_company() IS DISTINCT FROM v_device_company THEN
            RAISE EXCEPTION 'No autorizado'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_device_company::text, 0)
    );

    IF p_status = 'autorizado'
       AND v_current <> 'autorizado'
       AND NOT EXISTS (
           SELECT 1
           FROM public.platform_admins pa
           WHERE pa.user_id = v_device_user
             AND pa.active = true
       ) THEN

        v_usage := public.company_device_usage(v_device_company);

        IF (v_usage->>'used')::integer >= (v_usage->>'limit')::integer THEN
            RAISE EXCEPTION
                'Límite de dispositivos del plan alcanzado (%). Libera uno o mejora el plan.',
                v_usage->>'limit';
        END IF;
    END IF;

    UPDATE public.devices
    SET status = p_status
    WHERE id = p_id
      AND company_id = v_device_company;
END;
$function$;


-- ------------------------------------------------------------
-- 13. VALIDACIONES DE ESTRUCTURA Y PERMISOS
-- ------------------------------------------------------------

DO $validation$
DECLARE
    v_count integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'admin_target_company'
          AND p.prosecdef = true
    ) THEN
        RAISE EXCEPTION 'No se creó la barrera administrativa';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.set_company_device_enforcement(uuid,boolean)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'La función de dispositivos sigue ejecutable por anon';
    END IF;

    SELECT count(*)
    INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          'admin_find_user',
          'admin_list_courtesies',
          'admin_set_active',
          'admin_set_role',
          'admin_set_plan',
          'admin_reset_trial',
          'admin_revoke_plan',
          'admin_activate_subscription',
          'admin_deactivate_subscription',
          'set_company_device_enforcement',
          'set_device_status'
      )
      AND p.prosecdef = true;

    IF v_count <> 11 THEN
        RAISE EXCEPTION
            'Validación incompleta: se esperaban 11 funciones SECURITY DEFINER y se encontraron %',
            v_count;
    END IF;
END;
$validation$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000038
-- ============================================================
