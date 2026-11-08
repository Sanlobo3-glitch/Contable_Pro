-- =============================================================================
-- InventarioPro · Nómina de Vendedores, Invitaciones de Equipo y Perfiles Completos
-- =============================================================================
-- Qué resuelve y agrega este script:
--   1. Corrige el registro por invitación (?invite=CODIGO):
--      - Valida el código antes y después del registro (info_invitacion y
--        aceptar_invitacion_vendedor) para que el invitado entre como VENDEDOR
--        de la empresa que lo invitó y NUNCA quede como dueño de una empresa aparte.
--   2. Permite recuperar/vincular vendedores ya inscritos por error como dueños:
--      - Función vincular_vendedor_existente(correo) para traer a tu empresa como
--        vendedor a un usuario que se registró sin que tomara el código (siempre
--        que esa cuenta accidental no tenga ventas ni compras registradas).
--   3. Crea el expediente de personal y Nómina de Vendedores (member_profiles):
--      - Foto de perfil (tomada con cámara o subida desde archivo), cédula/ID,
--        teléfono, cargo, zona, dirección, contacto de emergencia, fecha de ingreso,
--        sueldo base mensual, % de comisión y notas.
--   4. Gestión completa en Usuarios (Administrador de plataforma) y en Empresa:
--      - Ver y reasignar a qué empresa pertenece cada usuario y su rol.
--      - Subir o tomar foto, completar o corregir datos personales.
--      - Suspender acceso inmediato o retirar/eliminar perfiles no autorizados
--        conservando intacto el historial contable y de ventas si ya operaron.
--
-- Seguro de volver a ejecutar (idempotente). No altera funciones existentes de
-- ventas, compras, inventario ni contabilidad.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Tabla de expediente, foto y nómina por miembro (member_profiles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  avatar_url text,
  national_id text,
  phone text,
  job_title text,
  zone text,
  address text,
  emergency_contact text,
  hire_date date,
  base_salary numeric NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  commission_pct numeric NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  notes text,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_profiles_company
  ON public.member_profiles (company_id)
  WHERE archived = false;

ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_profiles_select ON public.member_profiles;
CREATE POLICY member_profiles_select ON public.member_profiles
  FOR SELECT USING (
    user_id = auth.uid()
    OR company_id = public.current_company_id()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin' AND p.active = true
    )
  );

-- Si ya existía una tabla previa de detalles de personal (staff_details), migramos
-- sus datos iniciales hacia member_profiles sin sobrescribir lo que ya esté cargado.
DO $$
BEGIN
  IF to_regclass('public.staff_details') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.member_profiles (user_id, company_id, phone, job_title, national_id, address, notes)
      SELECT p.id, p.company_id, sd.phone, sd.job_title, sd.national_id, sd.address, sd.notes
      FROM public.staff_details sd
      JOIN public.profiles p ON p.id = sd.user_id
      WHERE p.company_id IS NOT NULL
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Si staff_details tiene nombres de columna distintos, continuamos sin fallar
      NULL;
    END;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Consultar información pública mínima de una invitación (pantalla Registro)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.info_invitacion(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_clean text := btrim(coalesce(p_code, ''));
  v_co uuid;
  v_code text;
  v_exp timestamptz;
  v_cname text;
BEGIN
  IF v_clean = '' OR to_regclass('public.company_invites') IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT ci.company_id, ci.code, ci.expires_at
    INTO v_co, v_code, v_exp
  FROM public.company_invites ci
  WHERE lower(ci.code) = lower(v_clean)
    AND ci.active = true
    AND ci.expires_at > now()
    AND ci.used_count < ci.max_uses
  ORDER BY ci.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  IF to_regclass('public.company_config') IS NOT NULL THEN
    SELECT cc.name INTO v_cname
    FROM public.company_config cc
    WHERE cc.company_id = v_co
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', v_code,
    'company_id', v_co,
    'company_name', coalesce(nullif(btrim(v_cname), ''), 'Empresa en InventarioPro'),
    'expires_at', v_exp
  );
END $function$;

REVOKE ALL ON FUNCTION public.info_invitacion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.info_invitacion(text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Aceptar invitación al iniciar sesión / confirmar cuenta (convierte en Vendedor)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aceptar_invitacion_vendedor(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_clean text := btrim(coalesce(p_code, ''));
  v_inv record;
  v_me public.profiles%ROWTYPE;
  v_owner public.profiles%ROWTYPE;
  v_old_co uuid;
  v_has_ops boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para aceptar la invitación';
  END IF;

  IF v_clean = '' OR to_regclass('public.company_invites') IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  SELECT * INTO v_me FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de usuario no encontrado';
  END IF;

  SELECT *
    INTO v_inv
  FROM public.company_invites ci
  WHERE lower(ci.code) = lower(v_clean)
    AND ci.active = true
    AND ci.expires_at > now()
  ORDER BY ci.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La invitación no existe, venció o fue revocada';
  END IF;

  -- Si ya pertenece a esa empresa, no consumimos otro cupo
  IF v_me.company_id = v_inv.company_id THEN
    IF v_me.role NOT IN ('dueno', 'admin') THEN
      UPDATE public.profiles SET role = 'vendedor', active = true WHERE id = v_uid;
    END IF;
    INSERT INTO public.member_profiles (user_id, company_id, archived, updated_at)
    VALUES (v_uid, v_inv.company_id, false, now())
    ON CONFLICT (user_id) DO UPDATE
      SET company_id = EXCLUDED.company_id, archived = false, updated_at = now();

    RETURN jsonb_build_object('ok', true, 'already_member', true, 'company_id', v_inv.company_id);
  END IF;

  IF v_me.role = 'admin' THEN
    RAISE EXCEPTION 'La cuenta de administrador central no puede convertirse en vendedor por invitación';
  END IF;

  IF v_inv.used_count >= v_inv.max_uses THEN
    RAISE EXCEPTION 'Este enlace de invitación ya alcanzó el máximo de usos permitidos';
  END IF;

  v_old_co := v_me.company_id;
  IF v_old_co IS NOT NULL THEN
    SELECT (
      EXISTS (SELECT 1 FROM public.sales s WHERE s.company_id = v_old_co)
      OR EXISTS (SELECT 1 FROM public.purchases pu WHERE pu.company_id = v_old_co)
    ) INTO v_has_ops;

    IF v_has_ops THEN
      RAISE EXCEPTION 'Tu cuenta ya registra ventas o compras propias como dueño y no puede trasladarse con una invitación';
    END IF;
  END IF;

  -- Copiar vigencia del dueño de la empresa que invita para que el vendedor herede su mismo plan
  SELECT * INTO v_owner
  FROM public.profiles p
  WHERE p.company_id = v_inv.company_id
    AND p.role IN ('dueno', 'admin')
    AND p.active = true
  ORDER BY (p.role = 'dueno') DESC, p.created_at ASC
  LIMIT 1;

  UPDATE public.profiles
  SET company_id = v_inv.company_id,
      role = 'vendedor',
      active = true,
      subscription_status = coalesce(v_owner.subscription_status, subscription_status),
      subscription_end = coalesce(v_owner.subscription_end, subscription_end),
      trial_end = coalesce(v_owner.trial_end, trial_end),
      plan_type = coalesce(v_owner.plan_type, plan_type)
  WHERE id = v_uid;

  UPDATE public.company_invites
  SET used_count = used_count + 1
  WHERE id = v_inv.id;

  INSERT INTO public.member_profiles (user_id, company_id, hire_date, archived, updated_at)
  VALUES (v_uid, v_inv.company_id, current_date, false, now())
  ON CONFLICT (user_id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        archived = false,
        hire_date = coalesce(public.member_profiles.hire_date, current_date),
        updated_at = now();

  -- Limpiar configuración vacía de la empresa accidental si nadie más quedó allí
  IF v_old_co IS NOT NULL AND v_old_co <> v_inv.company_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = v_old_co) THEN
      DELETE FROM public.company_config WHERE company_id = v_old_co;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'already_member', false, 'company_id', v_inv.company_id);
END $function$;

REVOKE ALL ON FUNCTION public.aceptar_invitacion_vendedor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_invitacion_vendedor(text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Vincular por correo a un vendedor que ya creó su cuenta (corrección rápida)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vincular_vendedor_existente(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_clean text := lower(btrim(coalesce(p_email, '')));
  v_target public.profiles%ROWTYPE;
  v_owner public.profiles%ROWTYPE;
  v_old_co uuid;
  v_has_ops boolean := false;
BEGIN
  IF v_clean = '' OR position('@' IN v_clean) = 0 THEN
    RAISE EXCEPTION 'Escribe un correo electrónico válido';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE lower(btrim(p.email)) = v_clean
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe ningún usuario registrado con el correo "%". Envíale primero el enlace de invitación para que cree su cuenta.', v_clean;
  END IF;

  IF v_target.id = auth.uid() THEN
    RAISE EXCEPTION 'Ese es tu propio correo de usuario';
  END IF;

  IF v_target.role = 'admin' THEN
    RAISE EXCEPTION 'No se puede cambiar el rol de un administrador central desde aquí';
  END IF;

  IF v_target.company_id = v_co THEN
    UPDATE public.profiles
    SET role = 'vendedor', active = true
    WHERE id = v_target.id;

    INSERT INTO public.member_profiles (user_id, company_id, hire_date, archived, updated_at)
    VALUES (v_target.id, v_co, current_date, false, now())
    ON CONFLICT (user_id) DO UPDATE
      SET company_id = v_co, archived = false, updated_at = now();

    RETURN jsonb_build_object(
      'ok', true,
      'user_id', v_target.id,
      'full_name', v_target.full_name,
      'email', v_target.email,
      'message', 'El usuario ya estaba en tu empresa y quedó activo como Vendedor.'
    );
  END IF;

  v_old_co := v_target.company_id;
  IF v_old_co IS NOT NULL THEN
    SELECT (
      EXISTS (SELECT 1 FROM public.sales s WHERE s.company_id = v_old_co)
      OR EXISTS (SELECT 1 FROM public.purchases pu WHERE pu.company_id = v_old_co)
    ) INTO v_has_ops;

    IF v_has_ops THEN
      RAISE EXCEPTION 'Ese correo pertenece a otra empresa que ya tiene ventas o compras registradas. Si necesitas moverlo igualmente, hazlo desde Usuarios como administrador central.';
    END IF;
  END IF;

  SELECT * INTO v_owner
  FROM public.profiles p
  WHERE p.company_id = v_co
    AND p.role IN ('dueno', 'admin')
    AND p.active = true
  ORDER BY (p.role = 'dueno') DESC, p.created_at ASC
  LIMIT 1;

  UPDATE public.profiles
  SET company_id = v_co,
      role = 'vendedor',
      active = true,
      subscription_status = coalesce(v_owner.subscription_status, subscription_status),
      subscription_end = coalesce(v_owner.subscription_end, subscription_end),
      trial_end = coalesce(v_owner.trial_end, trial_end),
      plan_type = coalesce(v_owner.plan_type, plan_type)
  WHERE id = v_target.id;

  INSERT INTO public.member_profiles (user_id, company_id, hire_date, archived, updated_at)
  VALUES (v_target.id, v_co, current_date, false, now())
  ON CONFLICT (user_id) DO UPDATE
    SET company_id = v_co,
        archived = false,
        hire_date = coalesce(public.member_profiles.hire_date, current_date),
        updated_at = now();

  IF v_old_co IS NOT NULL AND v_old_co <> v_co THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = v_old_co) THEN
      DELETE FROM public.company_config WHERE company_id = v_old_co;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_target.id,
    'full_name', v_target.full_name,
    'email', v_target.email,
    'message', 'Vendedor vinculado a tu empresa correctamente.'
  );
END $function$;

REVOKE ALL ON FUNCTION public.vincular_vendedor_existente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_vendedor_existente(text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Listar nómina y equipo de la empresa actual con foto y datos laborales
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.listar_nomina_equipo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_res jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'full_name', p.full_name,
      'role', p.role,
      'active', p.active,
      'created_at', p.created_at,
      'avatar_url', mp.avatar_url,
      'national_id', mp.national_id,
      'phone', mp.phone,
      'job_title', mp.job_title,
      'zone', mp.zone,
      'address', mp.address,
      'emergency_contact', mp.emergency_contact,
      'hire_date', mp.hire_date,
      'base_salary', coalesce(mp.base_salary, 0),
      'commission_pct', coalesce(mp.commission_pct, 0),
      'notes', mp.notes,
      'archived', coalesce(mp.archived, false)
    )
    ORDER BY (p.role = 'vendedor') DESC, p.active DESC, coalesce(p.full_name, p.email) ASC
  ), '[]'::jsonb)
  INTO v_res
  FROM public.profiles p
  LEFT JOIN public.member_profiles mp ON mp.user_id = p.id
  WHERE p.company_id = v_co
    AND coalesce(mp.archived, false) = false;

  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.listar_nomina_equipo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_nomina_equipo() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Guardar ficha completa, foto, rol, estado y nómina de un miembro del equipo
-- -----------------------------------------------------------------------------
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
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_caller_role text;
  v_target public.profiles%ROWTYPE;
  v_new_role text;
  v_new_active boolean;
  v_sal numeric := greatest(coalesce(p_base_salary, 0), 0);
  v_comm numeric := least(greatest(coalesce(p_commission_pct, 0), 0), 100);
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.company_id = v_co
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El miembro no pertenece a tu empresa';
  END IF;

  v_new_role := coalesce(nullif(btrim(p_role), ''), v_target.role);
  IF v_new_role NOT IN ('vendedor', 'dueno', 'admin') THEN
    RAISE EXCEPTION 'Rol inválido';
  END IF;
  IF v_new_role = 'admin' AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador central puede asignar el rol admin';
  END IF;
  IF v_target.role = 'admin' AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'No puedes modificar el rol de un administrador central';
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
  ON CONFLICT (user_id) DO UPDATE
  SET company_id = v_co,
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

  -- Sincronizar también con save_staff_details si existe en el servidor
  IF to_regprocedure('public.save_staff_details(uuid,text,text,text,text,text)') IS NOT NULL THEN
    BEGIN
      PERFORM public.save_staff_details(
        v_target.id,
        nullif(btrim(coalesce(p_phone, '')), ''),
        nullif(btrim(coalesce(p_job_title, '')), ''),
        nullif(btrim(coalesce(p_national_id, '')), ''),
        nullif(btrim(coalesce(p_address, '')), ''),
        nullif(btrim(coalesce(p_notes, '')), '')
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Si se suspende el acceso, bloquear sus dispositivos activos
  IF v_new_active = false AND to_regclass('public.devices') IS NOT NULL THEN
    BEGIN
      UPDATE public.devices SET status = 'bloqueado'
      WHERE company_id = v_co AND user_id = v_target.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_target.id);
END $function$;

REVOKE ALL ON FUNCTION public.guardar_ficha_miembro(uuid,text,text,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_ficha_miembro(uuid,text,text,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Actualizar el propio perfil y foto (cualquier usuario activo autenticado)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_mi_perfil(
  p_full_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_national_id text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_emergency_contact text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
  v_uid uuid := auth.uid();
BEGIN
  UPDATE public.profiles
  SET full_name = coalesce(nullif(btrim(p_full_name), ''), full_name)
  WHERE id = v_uid;

  INSERT INTO public.member_profiles (
    user_id, company_id, avatar_url, national_id, phone, address, emergency_contact, updated_at
  )
  VALUES (
    v_uid, v_co,
    nullif(btrim(coalesce(p_avatar_url, '')), ''),
    nullif(btrim(coalesce(p_national_id, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_emergency_contact, '')), ''),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET avatar_url = nullif(btrim(coalesce(p_avatar_url, '')), ''),
      national_id = nullif(btrim(coalesce(p_national_id, '')), ''),
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      address = nullif(btrim(coalesce(p_address, '')), ''),
      emergency_contact = nullif(btrim(coalesce(p_emergency_contact, '')), ''),
      updated_at = now();

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.guardar_mi_perfil(text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_mi_perfil(text,text,text,text,text,text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Retirar / eliminar perfil no autorizado de una empresa (Dueño o Admin)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retirar_miembro_empresa(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_target public.profiles%ROWTYPE;
  v_has_history boolean := false;
BEGIN
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes eliminar tu propio perfil';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.company_id = v_co
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El perfil no pertenece a tu empresa';
  END IF;

  IF v_target.role = 'admin' THEN
    RAISE EXCEPTION 'No se puede retirar al administrador central';
  END IF;

  -- Revocar dispositivos y limpiar rutas futuras pendientes
  IF to_regclass('public.devices') IS NOT NULL THEN
    BEGIN
      DELETE FROM public.devices WHERE company_id = v_co AND user_id = v_target.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.route_plans') IS NOT NULL THEN
    BEGIN
      DELETE FROM public.route_plans
      WHERE company_id = v_co AND seller_id = v_target.id AND plan_date >= current_date;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Verificar si tiene historial operativo que deba preservarse en auditoría
  IF to_regclass('public.visits') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.visits WHERE seller_id = $1)' INTO v_has_history USING v_target.id;
  END IF;
  IF NOT v_has_history AND to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.audit_log WHERE user_id = $1)' INTO v_has_history USING v_target.id;
  END IF;

  IF NOT v_has_history THEN
    BEGIN
      DELETE FROM auth.users WHERE id = v_target.id;
      DELETE FROM public.profiles WHERE id = v_target.id;
      RETURN jsonb_build_object(
        'ok', true,
        'mode', 'eliminado',
        'message', 'Perfil eliminado definitivamente del sistema.'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Si alguna referencia foránea impide borrar la fila, pasamos a retiro definitivo bloqueado
      NULL;
    END;
  END IF;

  UPDATE public.profiles
  SET active = false
  WHERE id = v_target.id;

  INSERT INTO public.member_profiles (user_id, company_id, archived, updated_at)
  VALUES (v_target.id, v_co, true, now())
  ON CONFLICT (user_id) DO UPDATE
    SET archived = true, updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'archivado',
    'message', 'Acceso revocado y perfil retirado de la nómina activa (se conserva el rastro de sus operaciones históricas).'
  );
END $function$;

REVOKE ALL ON FUNCTION public.retirar_miembro_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retirar_miembro_empresa(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Funciones del Administrador Central de Plataforma (pantalla Usuarios)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_listar_empresas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND active = true) THEN
    RAISE EXCEPTION 'Solo el administrador central tiene acceso';
  END IF;

  WITH companies AS (
    SELECT
      p.company_id,
      count(*)::int AS members_count,
      (array_agg(p.full_name ORDER BY (p.role = 'dueno') DESC, p.created_at ASC))[1] AS owner_name,
      (array_agg(p.email ORDER BY (p.role = 'dueno') DESC, p.created_at ASC))[1] AS owner_email
    FROM public.profiles p
    WHERE p.company_id IS NOT NULL
    GROUP BY p.company_id
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'company_id', c.company_id,
      'company_name', coalesce(nullif(btrim(cc.name), ''), c.owner_name, c.owner_email, 'Empresa ' || substr(c.company_id::text, 1, 6)),
      'owner_name', c.owner_name,
      'owner_email', c.owner_email,
      'members_count', c.members_count
    )
    ORDER BY coalesce(nullif(btrim(cc.name), ''), c.owner_name, c.owner_email) ASC
  ), '[]'::jsonb)
  INTO v_res
  FROM companies c
  LEFT JOIN public.company_config cc ON cc.company_id = c.company_id;

  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.admin_listar_empresas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_empresas() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_listar_usuarios_completo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND active = true) THEN
    RAISE EXCEPTION 'Solo el administrador central tiene acceso';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'full_name', coalesce(p.full_name, ''),
      'role', p.role,
      'active', p.active,
      'created_at', p.created_at,
      'company_id', p.company_id,
      'company_name', coalesce(nullif(btrim(cc.name), ''), 'Empresa ' || substr(coalesce(p.company_id::text, '000000'), 1, 6)),
      'trial_start', p.trial_start,
      'trial_end', p.trial_end,
      'subscription_status', p.subscription_status,
      'subscription_end', p.subscription_end,
      'paypal_order_id', p.paypal_order_id,
      'plan_type', p.plan_type,
      'avatar_url', mp.avatar_url,
      'national_id', mp.national_id,
      'phone', mp.phone,
      'job_title', mp.job_title,
      'zone', mp.zone,
      'address', mp.address,
      'emergency_contact', mp.emergency_contact,
      'hire_date', mp.hire_date,
      'base_salary', coalesce(mp.base_salary, 0),
      'commission_pct', coalesce(mp.commission_pct, 0),
      'notes', mp.notes,
      'archived', coalesce(mp.archived, false)
    )
    ORDER BY coalesce(mp.archived, false) ASC, p.created_at DESC
  ), '[]'::jsonb)
  INTO v_res
  FROM public.profiles p
  LEFT JOIN public.company_config cc ON cc.company_id = p.company_id
  LEFT JOIN public.member_profiles mp ON mp.user_id = p.id;

  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.admin_listar_usuarios_completo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_usuarios_completo() TO authenticated, service_role;

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
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND active = true) THEN
    RAISE EXCEPTION 'Solo el administrador central tiene acceso';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  v_old_co := v_target.company_id;
  v_new_co := coalesce(p_company_id, v_target.company_id);
  v_new_role := coalesce(nullif(btrim(p_role), ''), v_target.role);
  IF v_new_role NOT IN ('admin', 'dueno', 'vendedor') THEN
    RAISE EXCEPTION 'Rol inválido';
  END IF;

  v_new_active := coalesce(p_active, v_target.active);
  IF v_target.id = auth.uid() AND (v_new_active = false OR v_new_role <> 'admin') THEN
    RAISE EXCEPTION 'No puedes desactivar ni quitar permisos de administrador a tu propia cuenta';
  END IF;

  -- Si lo movemos como vendedor a otra empresa, hereda el estado de suscripción del dueño de esa empresa
  IF v_new_co IS DISTINCT FROM v_old_co AND v_new_role = 'vendedor' THEN
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
      subscription_status = coalesce(v_owner.subscription_status, subscription_status),
      subscription_end = coalesce(v_owner.subscription_end, subscription_end),
      trial_end = coalesce(v_owner.trial_end, trial_end),
      plan_type = coalesce(v_owner.plan_type, plan_type)
  WHERE id = v_target.id;

  IF v_new_co IS NOT NULL THEN
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

  -- Si se cambió de empresa y la anterior quedó vacía y sin ventas/compras, limpiamos su config huérfana
  IF v_old_co IS NOT NULL AND v_old_co IS DISTINCT FROM v_new_co THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = v_old_co)
       AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.company_id = v_old_co)
       AND NOT EXISTS (SELECT 1 FROM public.purchases pu WHERE pu.company_id = v_old_co) THEN
      DELETE FROM public.company_config WHERE company_id = v_old_co;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_target.id);
END $function$;

REVOKE ALL ON FUNCTION public.admin_guardar_usuario_completo(uuid,text,text,uuid,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_guardar_usuario_completo(uuid,text,text,uuid,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_eliminar_perfil(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_has_history boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND active = true) THEN
    RAISE EXCEPTION 'Solo el administrador central tiene acceso';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes eliminar tu propio perfil de administrador';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El perfil ya no existe';
  END IF;

  IF to_regclass('public.devices') IS NOT NULL THEN
    BEGIN
      DELETE FROM public.devices WHERE user_id = v_target.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.route_plans') IS NOT NULL THEN
    BEGIN
      DELETE FROM public.route_plans WHERE seller_id = v_target.id AND plan_date >= current_date;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.visits') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.visits WHERE seller_id = $1)' INTO v_has_history USING v_target.id;
  END IF;
  IF NOT v_has_history AND to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.audit_log WHERE user_id = $1)' INTO v_has_history USING v_target.id;
  END IF;

  IF NOT v_has_history THEN
    BEGIN
      DELETE FROM auth.users WHERE id = v_target.id;
      DELETE FROM public.profiles WHERE id = v_target.id;
      IF v_target.company_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = v_target.company_id)
         AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.company_id = v_target.company_id)
         AND NOT EXISTS (SELECT 1 FROM public.purchases pu WHERE pu.company_id = v_target.company_id) THEN
        DELETE FROM public.company_config WHERE company_id = v_target.company_id;
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'mode', 'eliminado',
        'message', 'Perfil eliminado definitivamente de la plataforma.'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  UPDATE public.profiles SET active = false WHERE id = v_target.id;
  IF v_target.company_id IS NOT NULL THEN
    INSERT INTO public.member_profiles (user_id, company_id, archived, updated_at)
    VALUES (v_target.id, v_target.company_id, true, now())
    ON CONFLICT (user_id) DO UPDATE SET archived = true, updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'archivado',
    'message', 'Acceso revocado y perfil archivado (se preservó el rastro histórico de sus operaciones).'
  );
END $function$;

REVOKE ALL ON FUNCTION public.admin_eliminar_perfil(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_eliminar_perfil(uuid) TO authenticated, service_role;

COMMIT;
