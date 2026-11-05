-- ============================================================
-- 000039: AISLAMIENTO DE PERFILES Y AUTORIZACION DE SOPORTE
--
-- Administrador central:
--   - Solo administra usuarios de su empresa de prueba.
--   - No puede trasladar usuarios entre empresas.
--   - No puede modificar otros administradores centrales.
--
-- Eliminación:
--   - Desactiva y archiva.
--   - Nunca elimina auth.users ni historial operativo.
--
-- Soporte:
--   - Exige autorización expresa y vigente.
--   - Empresa, ticket, técnico, módulo y alcance coincidentes.
--   - Registra cada intervención en auditoría.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. GUARDAR USUARIO COMPLETO
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_guardar_usuario_completo(
    p_user_id uuid,
    p_full_name text DEFAULT NULL,
    p_role text DEFAULT NULL,
    p_company_id uuid DEFAULT NULL,
    p_active boolean DEFAULT NULL,
    p_avatar_url text DEFAULT NULL,
    p_national_id text DEFAULT NULL,
    p_phone text DEFAULT NULL,
    p_job_title text DEFAULT NULL,
    p_zone text DEFAULT NULL,
    p_address text DEFAULT NULL,
    p_emergency_contact text DEFAULT NULL,
    p_hire_date date DEFAULT NULL,
    p_base_salary numeric DEFAULT 0,
    p_commission_pct numeric DEFAULT 0,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_target public.profiles%ROWTYPE;
    v_company uuid;
    v_new_company uuid;
    v_new_role text;
    v_new_active boolean;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    SELECT *
    INTO v_target
    FROM public.profiles
    WHERE id = p_user_id
      AND company_id = v_company
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Usuario no encontrado en la empresa de prueba';
    END IF;

    -- No permitir cambios de empresa.
    v_new_company := coalesce(p_company_id, v_target.company_id);

    IF v_new_company IS DISTINCT FROM v_company
       OR v_target.company_id IS DISTINCT FROM v_company THEN
        RAISE EXCEPTION
            'No se permite trasladar usuarios a otra empresa'
            USING ERRCODE = '42501';
    END IF;

    v_new_role := coalesce(
        nullif(btrim(p_role), ''),
        v_target.role
    );

    IF v_new_role NOT IN (
        'admin',
        'tecnico',
        'dueno',
        'admin_empresa',
        'gerente',
        'contador',
        'almacen',
        'vendedor',
        'cajero',
        'comprador',
        'transportador'
    ) THEN
        RAISE EXCEPTION 'Rol inválido: %', v_new_role;
    END IF;

    v_new_active := coalesce(p_active, v_target.active);

    IF v_target.id = auth.uid()
       AND (
           v_new_active = false
           OR v_new_role <> 'admin'
       ) THEN
        RAISE EXCEPTION
            'No puedes desactivar ni quitar permisos de administrador a tu propia cuenta';
    END IF;

    UPDATE public.profiles
    SET
        full_name = coalesce(
            nullif(btrim(p_full_name), ''),
            full_name
        ),
        role = v_new_role,
        company_id = v_company,
        active = v_new_active,
        subscription_status = CASE
            WHEN v_new_role IN ('admin', 'tecnico')
                THEN 'active'
            ELSE subscription_status
        END
    WHERE id = v_target.id
      AND company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo actualizar el perfil';
    END IF;

    INSERT INTO public.member_profiles (
        user_id,
        company_id,
        avatar_url,
        national_id,
        phone,
        job_title,
        zone,
        address,
        emergency_contact,
        hire_date,
        base_salary,
        commission_pct,
        notes,
        archived,
        updated_at
    )
    VALUES (
        v_target.id,
        v_company,
        nullif(btrim(coalesce(p_avatar_url, '')), ''),
        nullif(btrim(coalesce(p_national_id, '')), ''),
        nullif(btrim(coalesce(p_phone, '')), ''),
        nullif(btrim(coalesce(p_job_title, '')), ''),
        nullif(btrim(coalesce(p_zone, '')), ''),
        nullif(btrim(coalesce(p_address, '')), ''),
        nullif(btrim(coalesce(p_emergency_contact, '')), ''),
        p_hire_date,
        round(greatest(coalesce(p_base_salary, 0), 0), 2),
        round(
            least(greatest(coalesce(p_commission_pct, 0), 0), 100),
            2
        ),
        nullif(btrim(coalesce(p_notes, '')), ''),
        false,
        now()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
        company_id = EXCLUDED.company_id,
        avatar_url = EXCLUDED.avatar_url,
        national_id = EXCLUDED.national_id,
        phone = EXCLUDED.phone,
        job_title = EXCLUDED.job_title,
        zone = EXCLUDED.zone,
        address = EXCLUDED.address,
        emergency_contact = EXCLUDED.emergency_contact,
        hire_date = EXCLUDED.hire_date,
        base_salary = EXCLUDED.base_salary,
        commission_pct = EXCLUDED.commission_pct,
        notes = EXCLUDED.notes,
        archived = false,
        updated_at = now();

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', v_target.id,
        'company_id', v_company
    );
END;
$function$;


-- ------------------------------------------------------------
-- 2. DESACTIVAR Y ARCHIVAR PERFIL
--    NO ELIMINA auth.users NI REGISTROS HISTORICOS.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_eliminar_perfil(
    p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_target public.profiles%ROWTYPE;
    v_company uuid;
BEGIN
    v_company := public.admin_target_company(p_user_id);

    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'No puedes eliminar tu propio perfil';
    END IF;

    SELECT *
    INTO v_target
    FROM public.profiles
    WHERE id = p_user_id
      AND company_id = v_company
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'El perfil no existe en la empresa de prueba';
    END IF;

    -- Desactivar el acceso.
    UPDATE public.profiles
    SET active = false
    WHERE id = v_target.id
      AND company_id = v_company;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo desactivar el perfil';
    END IF;

    -- Archivar ficha laboral conservando sus datos.
    INSERT INTO public.member_profiles (
        user_id,
        company_id,
        archived,
        updated_at
    )
    VALUES (
        v_target.id,
        v_company,
        true,
        now()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
        company_id = EXCLUDED.company_id,
        archived = true,
        updated_at = now();

    RETURN jsonb_build_object(
        'ok', true,
        'mode', 'archivado',
        'user_id', v_target.id,
        'company_id', v_company,
        'message',
        'Acceso desactivado. Se conserva la cuenta y todo el historial.'
    );
END;
$function$;


-- ------------------------------------------------------------
-- 3. ACTUALIZACION DE RESOLUCION TECNICA CON AUTORIZACION
-- ------------------------------------------------------------

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
    v_authorization public.support_authorizations%ROWTYPE;
    v_module text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION
            'Se requiere una sesión autenticada';
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

    IF coalesce(v_role, '') <> 'tecnico'
       AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION
            'Solo un técnico o administrador central puede gestionar el caso';
    END IF;

    SELECT *
    INTO v_ticket
    FROM public.support_tickets
    WHERE id = p_ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;

    IF v_ticket.company_id IS NULL THEN
        RAISE EXCEPTION
            'La solicitud no tiene empresa asociada';
    END IF;

    -- Todo interventor debe tener el ticket asignado.
    IF v_ticket.assigned_to IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION
            'El caso no está asignado al usuario que intenta intervenir'
            USING ERRCODE = '42501';
    END IF;

    v_module := coalesce(
        nullif(btrim(v_ticket.module_page), ''),
        v_ticket.category
    );

    IF v_module IS NULL OR btrim(v_module) = '' THEN
        RAISE EXCEPTION
            'La solicitud no tiene un módulo identificable';
    END IF;

    -- Buscar autorización expresa y vigente.
    SELECT a.*
    INTO v_authorization
    FROM public.support_authorizations a
    WHERE a.ticket_id = v_ticket.id
      AND a.company_id = v_ticket.company_id
      AND a.technician_id = auth.uid()
      AND a.module_name = v_module
      AND a.authorization_scope = 'intervencion_asistida'
      AND a.revoked_at IS NULL
      AND a.expires_at > now()
    ORDER BY a.granted_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'No existe autorización vigente de intervención asistida para este caso y módulo'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.support_tickets
    SET
        status = p_status,
        tech_diagnosis = nullif(
            btrim(coalesce(p_tech_diagnosis, '')),
            ''
        ),
        resolution_notes = nullif(
            btrim(coalesce(p_resolution_notes, '')),
            ''
        ),
        resolved_at = CASE
            WHEN p_status IN ('resuelto', 'cerrado')
                THEN now()
            ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_ticket_id
      AND company_id = v_ticket.company_id
      AND assigned_to = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'No se pudo actualizar la solicitud';
    END IF;

    -- Registrar validación e intervención.
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
        v_ticket.id,
        v_authorization.id,
        v_ticket.company_id,
        auth.uid(),
        'access_validated',
        v_authorization.module_name,
        v_authorization.authorization_scope,
        jsonb_build_object(
            'action', 'technical_resolution_update',
            'new_status', p_status,
            'authorization_expires_at',
            v_authorization.expires_at
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'ticket_id', p_ticket_id,
        'status', p_status,
        'authorization_id', v_authorization.id
    );
END;
$function$;


-- ------------------------------------------------------------
-- 4. VALIDACIONES DE SEGURIDAD
-- ------------------------------------------------------------

DO $validation$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*)
    INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          'admin_guardar_usuario_completo',
          'admin_eliminar_perfil',
          'support_update_ticket_technical_resolution'
      )
      AND p.prosecdef = true;

    IF v_count <> 3 THEN
        RAISE EXCEPTION
            'Se esperaban 3 funciones SECURITY DEFINER; encontradas: %',
            v_count;
    END IF;

    IF has_function_privilege(
        'anon',
        'public.admin_guardar_usuario_completo(uuid,text,text,uuid,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'anon conserva ejecución de admin_guardar_usuario_completo';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.admin_eliminar_perfil(uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'anon conserva ejecución de admin_eliminar_perfil';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.support_update_ticket_technical_resolution(uuid,text,text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'anon conserva ejecución de la función técnica';
    END IF;
END;
$validation$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000039
-- ============================================================
