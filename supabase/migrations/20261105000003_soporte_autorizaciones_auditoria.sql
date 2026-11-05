
-- ============================================================================
-- INVENTARIO PRO · MIGRACIÓN 000003
-- Autorizaciones temporales, auditoría y gestión técnica protegida
--
-- No elimina todavía las políticas RLS antiguas.
-- No modifica admin_ejecutar_migracion_sql.
-- No concede acceso general a datos de empresas.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. AUTORIZACIONES TEMPORALES
-- ============================================================================

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

REVOKE ALL ON public.support_authorizations
FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 2. AUDITORÍA DE ACCESO TÉCNICO
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.support_access_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid
        REFERENCES public.support_tickets(id) ON DELETE SET NULL,
    authorization_id uuid
        REFERENCES public.support_authorizations(id) ON DELETE SET NULL,
    company_id uuid,
    actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type text NOT NULL
        CHECK (event_type IN (
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


-- ============================================================================
-- 3. CONCEDER AUTORIZACIÓN
--
-- Si p_technician_id es NULL:
--   1. Busca un perfil activo con rol tecnico.
--   2. Si no existe, busca la cuenta maestra autorizada.
--   3. Si no existe destinatario válido, rechaza la operación.
--
-- Nunca selecciona un usuario arbitrario.
-- ============================================================================

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

    v_tech_id uuid;
    v_tech_role text;
    v_tech_name text;
    v_tech_email text;
    v_tech_platform_admin boolean := false;

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

    IF p_module IS NULL
       OR length(btrim(p_module)) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Debe indicarse un módulo concreto';
    END IF;

    IF p_duration_hours IS NULL
       OR p_duration_hours < 1
       OR p_duration_hours > 168 THEN
        RAISE EXCEPTION
            'La autorización debe durar entre 1 y 168 horas';
    END IF;

    SELECT p.role, p.company_id, p.active
    INTO v_actor_role, v_actor_company, v_actor_active
    FROM public.profiles p
    WHERE p.id = auth.uid();

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

    IF v_ticket.status IN ('resuelto', 'cerrado') THEN
        RAISE EXCEPTION
            'No se puede autorizar una solicitud resuelta o cerrada';
    END IF;

    IF v_ticket.user_id IS DISTINCT FROM auth.uid()
       AND COALESCE(v_actor_role, '') NOT IN (
           'dueno',
           'admin_empresa',
           'gerente'
       ) THEN
        RAISE EXCEPTION
            'No tienes permiso para autorizar esta solicitud';
    END IF;

    -- Resolver destinatario técnico.
    IF p_technician_id IS NULL THEN
        SELECT
            p.id,
            p.role,
            p.full_name,
            p.email,
            (
                lower(btrim(COALESCE(p.email, ''))) =
                    'sanlobo3@hotmail.com'
                OR EXISTS (
                    SELECT 1
                    FROM public.platform_admins pa
                    WHERE pa.user_id = p.id
                      AND pa.active = true
                )
            )
        INTO
            v_tech_id,
            v_tech_role,
            v_tech_name,
            v_tech_email,
            v_tech_platform_admin
        FROM public.profiles p
        WHERE p.active = true
          AND (
              p.role = 'tecnico'
              OR lower(btrim(COALESCE(p.email, ''))) =
                    'sanlobo3@hotmail.com'
              OR EXISTS (
                  SELECT 1
                  FROM public.platform_admins pa
                  WHERE pa.user_id = p.id
                    AND pa.active = true
              )
          )
        ORDER BY
            CASE
                WHEN p.role = 'tecnico' THEN 1
                WHEN lower(btrim(COALESCE(p.email, ''))) =
                    'sanlobo3@hotmail.com' THEN 2
                ELSE 3
            END,
            p.id
        LIMIT 1;
    ELSE
        SELECT
            p.id,
            p.role,
            p.full_name,
            p.email,
            (
                lower(btrim(COALESCE(p.email, ''))) =
                    'sanlobo3@hotmail.com'
                OR EXISTS (
                    SELECT 1
                    FROM public.platform_admins pa
                    WHERE pa.user_id = p.id
                      AND pa.active = true
                )
            )
        INTO
            v_tech_id,
            v_tech_role,
            v_tech_name,
            v_tech_email,
            v_tech_platform_admin
        FROM public.profiles p
        WHERE p.id = p_technician_id
          AND p.active = true;
    END IF;

    IF v_tech_id IS NULL THEN
        RAISE EXCEPTION
            'No hay un técnico activo ni administrador global disponible';
    END IF;

    IF COALESCE(v_tech_role, '') <> 'tecnico'
       AND NOT COALESCE(v_tech_platform_admin, false) THEN
        RAISE EXCEPTION
            'El destinatario no es técnico ni administrador global autorizado';
    END IF;

    -- Revocar cualquier autorización previa de este ticket.
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
        v_tech_id,
        btrim(p_module),
        p_scope,
        v_expires
    )
    RETURNING id INTO v_auth_id;

    v_code := 'AUT-' ||
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    -- Campos antiguos solo para compatibilidad visual.
    -- La tabla support_authorizations es la fuente de verdad.
    UPDATE public.support_tickets
    SET
        session_authorized = true,
        authorization_code = v_code,
        authorized_at = now(),
        authorized_until = v_expires,
        revoked_at = NULL,
        authorization_scope = p_scope,
        assigned_to = v_tech_id,
        assigned_name = COALESCE(v_tech_name, v_tech_email),
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
            'technician_id', v_tech_id,
            'expires_at', v_expires
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'authorization_id', v_auth_id,
        'authorization_code', v_code,
        'technician_id', v_tech_id,
        'expires_at', v_expires
    );
END;
$function$;


-- ============================================================================
-- 4. REVOCAR AUTORIZACIÓN
-- ============================================================================

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
    v_actor_active boolean;
    v_auth public.support_authorizations%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Se requiere una sesión autenticada';
    END IF;

    SELECT p.role, p.company_id, p.active
    INTO v_role, v_company, v_actor_active
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_actor_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Usuario inactivo o sin perfil';
    END IF;

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
           AND COALESCE(v_role, '') NOT IN (
               'dueno',
               'admin_empresa',
               'gerente'
           )
       ) THEN
        RAISE EXCEPTION
            'No tienes permiso para revocar esta autorización';
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
    SET
        session_authorized = false,
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


-- ============================================================================
-- 5. CONSULTAR AUTORIZACIÓN ACTIVA DEL TÉCNICO
-- ============================================================================

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


-- ============================================================================
-- 6. VALIDAR Y REGISTRAR ACCESO
-- ============================================================================

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
    IF auth.uid() IS NULL
       OR p_company_id IS NULL
       OR p_module IS NULL
       OR p_scope NOT IN (
           'lectura_diagnostico',
           'intervencion_asistida'
       ) THEN
        RETURN false;
    END IF;

    SELECT a.*
    INTO v_auth
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
    ORDER BY a.granted_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

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


-- ============================================================================
-- 7. GUARDAR DIAGNÓSTICO Y RESOLUCIÓN
--
-- Solo el técnico asignado o el administrador global real puede hacerlo.
-- El rol visual del frontend no concede privilegios.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.support_update_ticket_technical_resolution(
    p_ticket_id uuid,
    p_status text,
    p_tech_diagnosis text,
    p_resolution_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_ticket public.support_tickets%ROWTYPE;
    v_active boolean;
    v_role text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Se requiere una sesión autenticada';
    END IF;

    IF p_status NOT IN (
        'pendiente',
        'en_revision',
        'resuelto',
        'cerrado'
    ) THEN
        RAISE EXCEPTION 'Estado de solicitud inválido';
    END IF;

    SELECT p.active, p.role
    INTO v_active, v_role
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF v_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Usuario inactivo o sin perfil';
    END IF;

    IF COALESCE(v_role, '') <> 'tecnico'
       AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION
            'Solo el técnico o administrador global puede gestionar el caso';
    END IF;

    SELECT *
    INTO v_ticket
    FROM public.support_tickets
    WHERE id = p_ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;

    IF v_ticket.assigned_to IS DISTINCT FROM auth.uid()
       AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION
            'Este caso no está asignado a tu usuario técnico';
    END IF;

    UPDATE public.support_tickets
    SET
        status = p_status,
        tech_diagnosis = NULLIF(btrim(COALESCE(p_tech_diagnosis, '')), ''),
        resolution_notes = NULLIF(btrim(COALESCE(p_resolution_notes, '')), ''),
        resolved_at = CASE
            WHEN p_status IN ('resuelto', 'cerrado') THEN now()
            ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_ticket_id;

    RETURN jsonb_build_object(
        'ok', true,
        'ticket_id', p_ticket_id,
        'status', p_status
    );
END;
$function$;


-- ============================================================================
-- 8. PRIVILEGIOS DE EJECUCIÓN
-- ============================================================================

REVOKE ALL ON FUNCTION
public.support_grant_ticket_authorization(uuid, uuid, text, text, integer)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION
public.support_revoke_ticket_authorization(uuid)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION
public.support_has_active_authorization(uuid, text, text)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION
public.support_register_access(uuid, text, text)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION
public.support_update_ticket_technical_resolution(uuid, text, text, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
public.support_grant_ticket_authorization(uuid, uuid, text, text, integer)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.support_revoke_ticket_authorization(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.support_has_active_authorization(uuid, text, text)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.support_register_access(uuid, text, text)
TO authenticated;

GRANT EXECUTE ON FUNCTION
public.support_update_ticket_technical_resolution(uuid, text, text, text)
TO authenticated;

COMMIT;

-- FIN MIGRACIÓN 000003
