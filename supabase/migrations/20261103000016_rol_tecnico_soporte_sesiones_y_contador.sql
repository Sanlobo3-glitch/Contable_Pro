-- ============================================================================
-- INVENTARIOPRO · MIGRACIÓN 000016
-- Rol Técnico, Bandeja de Solicitudes con Autorización Expresa de Sesión,
-- Actualización de Funciones de Roles Empresariales y Papeles de Trabajo CPC
-- 100% Idempotente · Seguro de ejecutar en Supabase SQL Editor
-- ============================================================================

BEGIN;

-- 1. Ampliar restricción de roles en profiles para incluir 'tecnico' y los 11 perfiles empresariales
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (
    role = ANY (
      ARRAY[
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
      ]::text[]
    )
  );

-- 2. Asegurar reconocimiento del Administrador Central de Plataforma (y cuenta maestra sanlobo3@hotmail.com)
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ok boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_uid
      AND p.active = true
      AND (p.role = 'admin' OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com')
  ) INTO v_ok;

  IF v_ok THEN
    RETURN true;
  END IF;

  IF to_regclass('public.platform_admins') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = $1 AND active = true)'
      INTO v_ok
      USING v_uid;
  END IF;

  RETURN coalesce(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

-- 3. Función de verificación de equipo de soporte técnico y administración central
CREATE OR REPLACE FUNCTION public.is_tech_support()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND (
        p.role IN ('admin', 'tecnico')
        OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_tech_support() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tech_support() TO authenticated, service_role;

-- 4. Actualizar guardado administrativo de usuarios para admitir todos los roles (incluido 'tecnico' y 'contador')
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
  v_owner public.profiles%ROWTYPE;
  v_old_co uuid;
  v_new_co uuid;
  v_new_role text;
  v_new_active boolean;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el administrador central tiene acceso';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  v_old_co := v_target.company_id;
  v_new_co := coalesce(p_company_id, v_target.company_id);
  v_new_role := coalesce(nullif(btrim(p_role), ''), v_target.role);

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
  IF v_target.id = auth.uid() AND (v_new_active = false OR v_new_role <> 'admin') THEN
    RAISE EXCEPTION 'No puedes desactivar ni quitar permisos de administrador a tu propia cuenta';
  END IF;

  IF v_new_co IS DISTINCT FROM v_old_co AND v_new_role NOT IN ('admin', 'dueno', 'tecnico') THEN
    SELECT * INTO v_owner
    FROM public.profiles p
    WHERE p.company_id = v_new_co AND p.role IN ('dueno', 'admin') AND p.active = true
    ORDER BY (p.role = 'dueno') DESC, p.created_at ASC
    LIMIT 1;
  END IF;

  UPDATE public.profiles
  SET full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
      role = v_new_role,
      company_id = v_new_co,
      active = v_new_active,
      subscription_status = CASE
        WHEN v_new_role IN ('admin', 'tecnico') THEN 'active'
        ELSE coalesce(v_owner.subscription_status, subscription_status)
      END,
      subscription_end = coalesce(v_owner.subscription_end, subscription_end),
      trial_end = coalesce(v_owner.trial_end, trial_end),
      plan_type = coalesce(v_owner.plan_type, plan_type)
  WHERE id = v_target.id;

  IF v_new_co IS NOT NULL AND to_regclass('public.member_profiles') IS NOT NULL THEN
    INSERT INTO public.member_profiles (
      user_id, company_id, avatar_url, national_id, phone, job_title, zone,
      address, emergency_contact, hire_date, base_salary, commission_pct, notes, archived, updated_at
    )
    VALUES (
      v_target.id, v_new_co,
      nullif(btrim(coalesce(p_avatar_url, '')), ''),
      nullif(btrim(coalesce(p_national_id, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_job_title, '')), ''),
      nullif(btrim(coalesce(p_zone, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_emergency_contact, '')), ''),
      p_hire_date,
      round(greatest(coalesce(p_base_salary, 0), 0), 2),
      round(least(greatest(coalesce(p_commission_pct, 0), 0), 100), 2),
      nullif(btrim(coalesce(p_notes, '')), ''),
      false,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET company_id = v_new_co,
        avatar_url = nullif(btrim(coalesce(p_avatar_url, '')), ''),
        national_id = nullif(btrim(coalesce(p_national_id, '')), ''),
        phone = nullif(btrim(coalesce(p_phone, '')), ''),
        job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
        zone = nullif(btrim(coalesce(p_zone, '')), ''),
        address = nullif(btrim(coalesce(p_address, '')), ''),
        emergency_contact = nullif(btrim(coalesce(p_emergency_contact, '')), ''),
        hire_date = p_hire_date,
        base_salary = round(greatest(coalesce(p_base_salary, 0), 0), 2),
        commission_pct = round(least(greatest(coalesce(p_commission_pct, 0), 0), 100), 2),
        notes = nullif(btrim(coalesce(p_notes, '')), ''),
        archived = false,
        updated_at = now();
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_target.id);
END $function$;

REVOKE ALL ON FUNCTION public.admin_guardar_usuario_completo(uuid,text,text,uuid,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_guardar_usuario_completo(uuid,text,text,uuid,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text) TO authenticated, service_role;

-- 5. Actualizar guardar_ficha_miembro para permitir a dueños asignar roles empresariales completos (contador, almacen, transporte, etc.)
DO $$
BEGIN
  IF to_regprocedure('public._ctx(text[])') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.guardar_ficha_miembro(
        p_user_id uuid,
        p_full_name text DEFAULT NULL,
        p_role text DEFAULT NULL,
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
      AS $body$
      DECLARE
        v_co uuid := public._ctx(ARRAY['admin', 'dueno', 'admin_empresa']);
        v_caller_role text;
        v_target public.profiles%ROWTYPE;
        v_new_role text;
        v_new_active boolean;
        v_sal numeric := greatest(coalesce(p_base_salary, 0), 0);
        v_comm numeric := least(greatest(coalesce(p_commission_pct, 0), 0), 100);
      BEGIN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = auth.uid() AND active = true;

        SELECT * INTO v_target
        FROM public.profiles p
        WHERE p.id = p_user_id AND p.company_id = v_co
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'El miembro no pertenece a tu empresa';
        END IF;

        v_new_role := coalesce(nullif(btrim(p_role), ''), v_target.role);

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

        IF v_new_role IN ('admin', 'tecnico') AND v_caller_role <> 'admin' THEN
          RAISE EXCEPTION 'Solo el administrador central puede asignar el rol %', v_new_role;
        END IF;

        IF v_caller_role = 'admin_empresa' AND (
          v_target.role IN ('admin', 'dueno', 'admin_empresa', 'tecnico')
          OR v_new_role IN ('admin', 'dueno', 'admin_empresa', 'tecnico')
        ) THEN
          RAISE EXCEPTION 'El administrador de empresa solo puede gestionar roles operativos';
        END IF;

        IF v_target.role IN ('admin', 'dueno') AND v_caller_role <> 'admin' AND v_target.id <> auth.uid() THEN
          RAISE EXCEPTION 'No puedes modificar al propietario ni al administrador central';
        END IF;

        v_new_active := coalesce(p_active, v_target.active);
        IF v_target.id = auth.uid() AND v_new_active = false THEN
          RAISE EXCEPTION 'No puedes desactivar tu propio usuario';
        END IF;

        UPDATE public.profiles
        SET full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
            role = v_new_role,
            active = v_new_active
        WHERE id = v_target.id;

        IF to_regclass('public.member_profiles') IS NOT NULL THEN
          INSERT INTO public.member_profiles (
            user_id, company_id, avatar_url, national_id, phone, job_title, zone,
            address, emergency_contact, hire_date, base_salary, commission_pct, notes, archived, updated_at
          )
          VALUES (
            v_target.id, v_co,
            nullif(btrim(coalesce(p_avatar_url, '')), ''),
            nullif(btrim(coalesce(p_national_id, '')), ''),
            nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_job_title, '')), ''),
            nullif(btrim(coalesce(p_zone, '')), ''),
            nullif(btrim(coalesce(p_address, '')), ''),
            nullif(btrim(coalesce(p_emergency_contact, '')), ''),
            p_hire_date,
            round(v_sal, 2),
            round(v_comm, 2),
            nullif(btrim(coalesce(p_notes, '')), ''),
            false,
            now()
          )
          ON CONFLICT (user_id) DO UPDATE SET
            company_id = v_co,
            avatar_url = nullif(btrim(coalesce(p_avatar_url, '')), ''),
            national_id = nullif(btrim(coalesce(p_national_id, '')), ''),
            phone = nullif(btrim(coalesce(p_phone, '')), ''),
            job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
            zone = nullif(btrim(coalesce(p_zone, '')), ''),
            address = nullif(btrim(coalesce(p_address, '')), ''),
            emergency_contact = nullif(btrim(coalesce(p_emergency_contact, '')), ''),
            hire_date = p_hire_date,
            base_salary = round(v_sal, 2),
            commission_pct = round(v_comm, 2),
            notes = nullif(btrim(coalesce(p_notes, '')), ''),
            archived = false,
            updated_at = now();
        END IF;

        RETURN jsonb_build_object('ok', true, 'user_id', v_target.id);
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- 6. Tabla de solicitudes de soporte técnico y autorizaciones expresas de sesión
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL,
  company_id uuid,
  company_name text,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  user_email text NOT NULL,
  user_role text NOT NULL DEFAULT 'vendedor',
  category text NOT NULL DEFAULT 'operacion'
    CHECK (category IN ('operacion', 'ventas_pos', 'inventario', 'contabilidad', 'dispositivos', 'facturacion_pdf', 'otro')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('baja', 'normal', 'alta', 'critica')),
  subject text NOT NULL,
  description text NOT NULL,
  module_page text,
  session_authorized boolean NOT NULL DEFAULT false,
  authorization_code text,
  authorized_at timestamptz,
  authorized_until timestamptz,
  revoked_at timestamptz,
  authorization_scope text NOT NULL DEFAULT 'lectura_diagnostico'
    CHECK (authorization_scope IN ('lectura_diagnostico', 'intervencion_asistida')),
  session_snapshot jsonb,
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'en_revision', 'resuelto', 'cerrado')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_name text,
  tech_diagnosis text,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_company_created
  ON public.support_tickets (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created
  ON public.support_tickets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_auth
  ON public.support_tickets (status, session_authorized, created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;

DROP POLICY IF EXISTS support_tickets_select ON public.support_tickets;
CREATE POLICY support_tickets_select
ON public.support_tickets
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_tech_support()
  OR (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active = true
        AND p.company_id = support_tickets.company_id
        AND p.role IN ('dueno', 'admin_empresa', 'gerente')
    )
  )
);

DROP POLICY IF EXISTS support_tickets_insert ON public.support_tickets;
CREATE POLICY support_tickets_insert
ON public.support_tickets
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR public.is_tech_support());

DROP POLICY IF EXISTS support_tickets_update ON public.support_tickets;
CREATE POLICY support_tickets_update
ON public.support_tickets
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_tech_support()
  OR (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active = true
        AND p.company_id = support_tickets.company_id
        AND p.role IN ('dueno', 'admin_empresa')
    )
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR public.is_tech_support()
  OR (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active = true
        AND p.company_id = support_tickets.company_id
        AND p.role IN ('dueno', 'admin_empresa')
    )
  )
);

-- 7. Tabla de papeles de trabajo y firma colegiada del Contador Público (CPC)
CREATE TABLE IF NOT EXISTS public.cpa_working_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  period_ym text NOT NULL,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_notes text,
  cpa_profile jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_ym)
);

ALTER TABLE public.cpa_working_papers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.cpa_working_papers TO authenticated;

DROP POLICY IF EXISTS cpa_working_papers_access ON public.cpa_working_papers;
CREATE POLICY cpa_working_papers_access
ON public.cpa_working_papers
FOR ALL
TO authenticated
USING (
  public.is_tech_support()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.company_id = cpa_working_papers.company_id
      AND p.role IN ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
  )
)
WITH CHECK (
  public.is_tech_support()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.company_id = cpa_working_papers.company_id
      AND p.role IN ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador')
  )
);

NOTIFY pgrst, 'reload schema';

COMMIT;
