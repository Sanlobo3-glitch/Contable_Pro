
-- ============================================================================
-- INVENTARIO PRO · MIGRACIÓN 000003
-- Autorizaciones independientes y auditoría de soporte técnico
-- Preparación de seguridad. No sustituye todavía las políticas RLS existentes.
-- ============================================================================

BEGIN;

-- 1. Registro independiente de autorizaciones.
CREATE TABLE IF NOT EXISTS public.support_authorizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL
        REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    company_id uuid NOT NULL,
    granted_by uuid NOT NULL REFERENCES auth.users(id),
    technician_id uuid NOT NULL REFERENCES auth.users(id),
    module_name text NOT NULL,
    authorization_scope text NOT NULL
        CHECK (authorization_scope IN (
            'lectura_diagnostico',
            'intervencion_asistida'
        )),
    granted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT support_authorization_expiry_check
        CHECK (expires_at > granted_at),
    CONSTRAINT support_authorization_module_check
        CHECK (length(btrim(module_name)) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_support_auth_company_expiry
ON public.support_authorizations(company_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_support_auth_technician
ON public.support_authorizations(technician_id, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_auth_one_active_ticket
ON public.support_authorizations(ticket_id)
WHERE revoked_at IS NULL;

ALTER TABLE public.support_authorizations ENABLE ROW LEVEL SECURITY;

-- El navegador no puede modificar directamente las autorizaciones.
REVOKE ALL ON public.support_authorizations
FROM PUBLIC, anon, authenticated;

-- 2. Bitácora independiente de actividad técnica.
CREATE TABLE IF NOT EXISTS public.support_access_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,
    authorization_id uuid REFERENCES public.support_authorizations(id)
        ON DELETE SET NULL,
    company_id uuid,
    actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type text NOT NULL CHECK (event_type IN (
        'authorization_granted',
        'authorization_revoked',
        'access_validated'
    )),
    module_name text,
    authorization_scope text,
    event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_audit_company_date
ON public.support_access_audit(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_audit_ticket_date
ON public.support_access_audit(ticket_id, created_at DESC);

ALTER TABLE public.support_access_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.support_access_audit
FROM PUBLIC, anon, authenticated;

-- 3. Conceder autorización temporal y asignarla a un técnico concreto.
CREATE OR REPLACE FUNCTION public.support_grant_ticket_authorization(
    p_ticket_id uuid,
    p_technician_id uuid,
    p_module text,
    p_scope text DEFAULT 'lectura_diagnostico',
    p_duration_hours integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_ticket public.support_tickets%ROWTYPE;
    v_actor_role text;
    v_actor_company uuid;
    v_actor_active boolean;
    v_tech_role text;
    v_tech_name text;
    v_expires timestamptz;
    v_auth_id uuid;
    v_code text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Se requiere una sesión autenticada';
    END IF;

    IF p_scope NOT IN (
        'lectura_diagnostico',
        'intervencion_asistida'
    ) THEN
        RAISE EXCEPTION 'Alcance de autorización inválido';
    END IF;

    IF p_module IS NULL OR length(btrim(p_module)) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Debe indicarse un módulo concreto';
    END IF;

    IF p_duration_hours IS NULL
       OR p_duration_hours < 1
       OR p_duration_hours > 168 THEN
        RAISE EXCEPTION 'La autorización debe durar entre 1 y 168 horas';
    END IF;

    SELECT role, company_id, active
    INTO v_actor_role, v_actor_company, v_actor_active
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Usuario inactivo o sin perfil';
    END IF;

    SELECT *
    INTO v_ticket
    FROM public.support_tickets
    WHERE id = p_ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitud de soporte no encontrada';
    END IF;

    IF v_ticket.company_id IS NULL
       OR v_ticket.company_id IS DISTINCT FROM v_actor_company THEN
        RAISE EXCEPTION 'La solicitud no pertenece a tu empresa';
    END IF;

    -- Puede autorizar el solicitante o un responsable de su empresa.
    IF v_ticket.user_id IS DISTINCT FROM auth.uid()
       AND v_actor_role NOT IN ('dueno', 'admin_empresa', 'gerente') THEN
        RAISE EXCEPTION 'No tienes permiso para autorizar esta solicitud';
    END IF;

    SELECT role, full_name
    INTO v_tech_role, v_tech_name
    FROM public.profiles
    WHERE id = p_technician_id
      AND active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Técnico no encontrado o inactivo';
    END IF;

    -- No se permite asignar la sesión a un usuario empresarial normal.
    IF v_tech_role <> 'tecnico'
       AND NOT public.is_platform_admin_for_user(p_technician_id) THEN
        RAISE EXCEPTION 'El destinatario no es técnico autorizado';
    END IF;

    -- Revocar cualquier autorización anterior del mismo ticket.
    UPDATE public.support_authorizations
    SET revoked_at = now()
    WHERE ticket_id = p_ticket_id
      AND revoked_at IS NULL;

    v_expires := now() + make_interval(hours => p_duration_hours);

    INSERT INTO public.support_authorizations (
        ticket_id,
        company_id,
        granted_by,
        technician_id,
        module_name,
        authorization_scope,
        expires_at
    )
    VALUES (
        p_ticket_id,
        v_ticket.company_id,
        auth.uid(),
        p_technician_id,
        btrim(p_module),
        p_scope,
        v_expires
    )
    RETURNING id INTO v_auth_id;

    v_code := 'AUT-' ||
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    -- Campos antiguos mantenidos únicamente por compatibilidad visual.
    -- La autorización efectiva será la tabla independiente.
    UPDATE public.support_tickets
    SET session_authorized = true,
        authorization_code = v_code,
        authorized_at = now(),
        authorized_until = v_expires,
        revoked_at = NULL,
        authorization_scope = p_scope,
        assigned_to = p_technician_id,
        assigned_name = v_tech_name,
        updated_at = now()
    WHERE id = p_ticket_id;

    INSERT INTO public.support_access_audit (
        ticket_id,
        authorization_id,
        company_id,
        actor_id,
        event_type,
        module_name,
        authorization_scope,
        event_metadata
    )
    VALUES (
        p_ticket_id,
        v_auth_id,
        v_ticket.company_id,
        auth.uid(),
        'authorization_granted',
        btrim(p_module),
        p_scope,
        jsonb_build_object(
            'technician_id', p_technician_id,
            'expires_at', v_expires
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'authorization_id', v_auth_id,
        'authorization_code', v_code,
        'expires_at', v_expires
    );
END;
$function$;

-- 4. Revocación por el solicitante o responsable de la empresa.
CREATE OR REPLACE FUNCTION public.support_revoke_ticket_authorization(
    p_ticket_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_ticket public.support_tickets%ROWTYPE;
    v_role text;
    v_company uuid;
    v_auth public.support_authorizations%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Se requiere una sesión autenticada';
    END IF;

    SELECT role, company_id
    INTO v_role, v_company
    FROM public.profiles
    WHERE id = auth.uid() AND active = true;

    SELECT *
    INTO v_ticket
    FROM public.support_tickets
    WHERE id = p_ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;

    IF v_ticket.company_id IS DISTINCT FROM v_company
       OR (
           v_ticket.user_id IS DISTINCT FROM auth.uid()
           AND v_role NOT IN ('dueno', 'admin_empresa', 'gerente')
       ) THEN
        RAISE EXCEPTION 'No tienes permiso para revocar esta autorización';
    END IF;

    UPDATE public.support_authorizations
    SET revoked_at = now()
    WHERE ticket_id = p_ticket_id
      AND revoked_at IS NULL
    RETURNING * INTO v_auth;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', true,
            'message', 'No había una autorización activa'
        );
    END IF;

    UPDATE public.support_tickets
    SET session_authorized = false,
        revoked_at = now(),
        updated_at = now()
    WHERE id = p_ticket_id;

    INSERT INTO public.support_access_audit (
        ticket_id,
        authorization_id,
        company_id,
        actor_id,
        event_type,
        module_name,
        authorization_scope
    )
    VALUES (
        p_ticket_id,
        v_auth.id,
        v_ticket.company_id,
        auth.uid(),
        'authorization_revoked',
        v_auth.module_name,
        v_auth.authorization_scope
    );

    RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 5. Comprobación de autorización para una intervención concreta.
CREATE OR REPLACE FUNCTION public.support_has_active_authorization(
    p_company_id uuid,
    p_module text,
    p_scope text DEFAULT 'lectura_diagnostico'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT
        auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.support_authorizations a
            JOIN public.profiles tech
              ON tech.id = a.technician_id
             AND tech.active = true
            WHERE a.company_id = p_company_id
              AND a.module_name = p_module
              AND a.authorization_scope = p_scope
              AND a.technician_id = auth.uid()
              AND a.revoked_at IS NULL
              AND a.expires_at > now()
              AND (
                  tech.role = 'tecnico'
                  OR public.is_platform_admin()
              )
        );
$function$;

-- 6. Registrar una comprobación de acceso técnico.
CREATE OR REPLACE FUNCTION public.support_register_access(
    p_company_id uuid,
    p_module text,
    p_scope text DEFAULT 'lectura_diagnostico'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_auth public.support_authorizations%ROWTYPE;
BEGIN
    IF NOT public.support_has_active_authorization(
        p_company_id,
        p_module,
        p_scope
    ) THEN
        RETURN false;
    END IF;

    SELECT *
    INTO v_auth
    FROM public.support_authorizations
    WHERE company_id = p_company_id
      AND module_name = p_module
      AND authorization_scope = p_scope
      AND technician_id = auth.uid()
      AND revoked_at IS NULL
      AND expires_at > now()
    ORDER BY granted_at DESC
    LIMIT 1;

    INSERT INTO public.support_access_audit (
        ticket_id,
        authorization_id,
        company_id,
        actor_id,
        event_type,
        module_name,
        authorization_scope
    )
    VALUES (
        v_auth.ticket_id,
        v_auth.id,
        p_company_id,
        auth.uid(),
        'access_validated',
        p_module,
        p_scope
    );

    RETURN true;
END;
$function$;

-- 7. Permisos de ejecución: solo usuarios autenticados.
REVOKE ALL ON FUNCTION public.support_grant_ticket_authorization(
    uuid, uuid, text, text, integer
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.support_revoke_ticket_authorization(uuid)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.support_has_active_authorization(
    uuid, text, text
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.support_register_access(
    uuid, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.support_grant_ticket_authorization(
    uuid, uuid, text, text, integer
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_revoke_ticket_authorization(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_has_active_authorization(
    uuid, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_register_access(
    uuid, text, text
) TO authenticated;

COMMIT;
