
BEGIN;

-- =====================================================
-- 1. ROLES PERMITIDOS
-- =====================================================

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check
CHECK (role IN ('admin', 'dueno', 'admin_empresa', 'vendedor'));


-- =====================================================
-- 2. IDENTIFICAR AL ADMINISTRADOR CENTRAL
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin()
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
      AND p.role = 'admin'
      AND p.active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;


-- =====================================================
-- 3. FUNCIÓN DE JERARQUÍA DE EMPRESA
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_manager()
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
      AND p.company_id IS NOT NULL
      AND p.role IN ('admin', 'dueno', 'admin_empresa')
  );
$$;


-- =====================================================
-- 4. ROL ACTIVO DEL USUARIO
-- =====================================================

CREATE OR REPLACE FUNCTION public._my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.active = true;
$$;


-- =====================================================
-- 5. VENTAS
-- Dueño y administrador de empresa ven las ventas
-- de su empresa.
-- Vendedor solamente ve sus propias ventas.
-- Admin central puede consultar todas.
-- =====================================================

DROP POLICY IF EXISTS sales_select ON public.sales;

CREATE POLICY sales_select
ON public.sales
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR (
    company_id = public.current_company_id()
    AND (
      public.is_manager()
      OR seller_id = auth.uid()
    )
  )
);


-- =====================================================
-- 6. FICHAS DEL PERSONAL Y NÓMINA
-- Solo el propio usuario, los gestores de su empresa
-- y el administrador central pueden consultar.
-- =====================================================

DROP POLICY IF EXISTS member_profiles_select ON public.member_profiles;

CREATE POLICY member_profiles_select
ON public.member_profiles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    company_id = public.current_company_id()
    AND public.is_manager()
  )
  OR public.is_platform_admin()
);


-- =====================================================
-- 7. PERFILES
-- Evita que cualquier vendedor consulte los perfiles
-- completos de todos sus compañeros.
-- =====================================================

DROP POLICY IF EXISTS profiles_select_company ON public.profiles;

CREATE POLICY profiles_select_company
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR (
    company_id = public.current_company_id()
    AND public.is_manager()
  )
  OR public.is_platform_admin()
);


-- =====================================================
-- 8. PRODUCTOS
-- Admin_empresa puede gestionar inventario.
-- Se conserva la condición stock = 0 al crear.
-- =====================================================

DROP POLICY IF EXISTS products_delete ON public.products;

CREATE POLICY products_delete
ON public.products
FOR DELETE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND public._my_role() IN ('admin', 'dueno', 'admin_empresa')
);


DROP POLICY IF EXISTS products_insert ON public.products;

CREATE POLICY products_insert
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = public.current_company_id()
  AND public._my_role() IN ('admin', 'dueno', 'admin_empresa')
  AND stock = 0
);


DROP POLICY IF EXISTS products_update ON public.products;

CREATE POLICY products_update
ON public.products
FOR UPDATE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND public._my_role() IN ('admin', 'dueno', 'admin_empresa')
)
WITH CHECK (
  company_id = public.current_company_id()
  AND public._my_role() IN ('admin', 'dueno', 'admin_empresa')
);


-- =====================================================
-- 9. DISPOSITIVOS
-- Gestores activos de la empresa pueden consultar
-- sus dispositivos autorizados.
-- =====================================================

DROP POLICY IF EXISTS devices_select ON public.devices;

CREATE POLICY devices_select
ON public.devices
FOR SELECT
TO authenticated
USING (
  company_id = public.my_company()
  AND public.is_manager()
);


-- =====================================================
-- 10. NÓMINA DEL EQUIPO
-- =====================================================

CREATE OR REPLACE FUNCTION public.listar_nomina_equipo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(
    ARRAY['admin', 'dueno', 'admin_empresa']
  );
  v_res jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(
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
      ORDER BY
        (p.role = 'vendedor') DESC,
        p.active DESC,
        coalesce(p.full_name, p.email) ASC
    ),
    '[]'::jsonb
  )
  INTO v_res
  FROM public.profiles p
  LEFT JOIN public.member_profiles mp
    ON mp.user_id = p.id
  WHERE p.company_id = v_co
    AND coalesce(mp.archived, false) = false;

  RETURN v_res;
END;
$function$;


-- =====================================================
-- 11. GUARDAR FICHA DE MIEMBRO
-- admin_empresa puede gestionar vendedores,
-- pero no ascenderse ni modificar dueños o admins.
-- =====================================================

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
  v_co uuid := public._ctx(
    ARRAY['admin', 'dueno', 'admin_empresa']
  );
  v_caller_role text;
  v_target public.profiles%ROWTYPE;
  v_new_role text;
  v_new_active boolean;
  v_sal numeric := greatest(coalesce(p_base_salary, 0), 0);
  v_comm numeric := least(
    greatest(coalesce(p_commission_pct, 0), 0),
    100
  );
BEGIN
  SELECT role
  INTO v_caller_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND active = true;

  SELECT *
  INTO v_target
  FROM public.profiles p
  WHERE p.id = p_user_id
    AND p.company_id = v_co
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El miembro no pertenece a tu empresa';
  END IF;

  v_new_role := coalesce(
    nullif(btrim(p_role), ''),
    v_target.role
  );

  IF v_new_role NOT IN (
    'vendedor',
    'dueno',
    'admin_empresa',
    'admin'
  ) THEN
    RAISE EXCEPTION 'Rol inválido';
  END IF;

  -- Administrador de empresa: solamente vendedores.
  IF v_caller_role = 'admin_empresa' THEN
    IF v_target.role <> 'vendedor'
       OR v_new_role <> 'vendedor' THEN
      RAISE EXCEPTION
        'El administrador de empresa solo puede gestionar vendedores';
    END IF;
  END IF;

  -- Dueño puede asignar administrador de empresa,
  -- pero no administrador central.
  IF v_new_role = 'admin'
     AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION
      'Solo el administrador central puede asignar admin';
  END IF;

  IF v_new_role = 'admin_empresa'
     AND v_caller_role NOT IN ('admin', 'dueno') THEN
    RAISE EXCEPTION
      'No tienes permiso para asignar administrador de empresa';
  END IF;

  IF v_target.role = 'admin'
     AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION
      'No puedes modificar un administrador central';
  END IF;

  IF v_target.role = 'dueno'
     AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION
      'No puedes modificar al dueño de la empresa';
  END IF;

  v_new_active := coalesce(p_active, v_target.active);

  IF v_target.id = auth.uid() AND v_new_active = false THEN
    RAISE EXCEPTION 'No puedes desactivar tu propio usuario';
  END IF;

  UPDATE public.profiles
  SET
    full_name = coalesce(
      nullif(btrim(p_full_name), ''),
      full_name
    ),
    role = v_new_role,
    active = v_new_active
  WHERE id = v_target.id;

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
    v_co,
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
  ON CONFLICT (user_id)
  DO UPDATE SET
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

  -- Mantener compatibilidad con la función auxiliar existente.
  IF to_regprocedure(
    'public.save_staff_details(uuid,text,text,text,text,text)'
  ) IS NOT NULL THEN
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

  -- Suspender dispositivos cuando se desactiva un miembro.
  IF v_new_active = false
     AND to_regclass('public.devices') IS NOT NULL THEN
    BEGIN
      UPDATE public.devices
      SET status = 'bloqueado'
      WHERE company_id = v_co
        AND user_id = v_target.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_target.id
  );
END;
$function$;


-- =====================================================
-- 12. PROTEGER INVITACIONES
-- admin y admin_empresa no pueden convertirse
-- accidentalmente en vendedores por una invitación.
-- =====================================================

CREATE OR REPLACE FUNCTION public.aceptar_invitacion_vendedor(
  p_code text
)
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
    RAISE EXCEPTION
      'Debes iniciar sesión para aceptar la invitación';
  END IF;

  IF v_clean = ''
     OR to_regclass('public.company_invites') IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  SELECT *
  INTO v_me
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

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
    RAISE EXCEPTION
      'La invitación no existe, venció o fue revocada';
  END IF;

  -- Ya pertenece a esa empresa: no cambiar roles de gestores.
  IF v_me.company_id = v_inv.company_id THEN
    IF v_me.role NOT IN (
      'dueno',
      'admin',
      'admin_empresa'
    ) THEN
      UPDATE public.profiles
      SET role = 'vendedor',
          active = true
      WHERE id = v_uid;
    END IF;

    INSERT INTO public.member_profiles (
      user_id,
      company_id,
      archived,
      updated_at
    )
    VALUES (
      v_uid,
      v_inv.company_id,
      false,
      now()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      company_id = EXCLUDED.company_id,
      archived = false,
      updated_at = now();

    RETURN jsonb_build_object(
      'ok', true,
      'already_member', true,
      'company_id', v_inv.company_id
    );
  END IF;

  IF v_me.role IN ('admin', 'admin_empresa') THEN
    RAISE EXCEPTION
      'Esta cuenta administrativa no puede convertirse en vendedor mediante una invitación';
  END IF;

  IF v_inv.used_count >= v_inv.max_uses THEN
    RAISE EXCEPTION
      'Este enlace de invitación ya alcanzó el máximo de usos permitidos';
  END IF;

  v_old_co := v_me.company_id;

  IF v_old_co IS NOT NULL THEN
    SELECT (
      EXISTS (
        SELECT 1
        FROM public.sales s
        WHERE s.company_id = v_old_co
      )
      OR EXISTS (
        SELECT 1
        FROM public.purchases pu
        WHERE pu.company_id = v_old_co
      )
    )
    INTO v_has_ops;

    IF v_has_ops THEN
      RAISE EXCEPTION
        'Tu cuenta ya registra ventas o compras propias como dueño y no puede trasladarse con una invitación';
    END IF;
  END IF;

  SELECT *
  INTO v_owner
  FROM public.profiles p
  WHERE p.company_id = v_inv.company_id
    AND p.role IN ('dueno', 'admin')
    AND p.active = true
  ORDER BY
    (p.role = 'dueno') DESC,
    p.created_at ASC
  LIMIT 1;

  UPDATE public.profiles
  SET
    company_id = v_inv.company_id,
    role = 'vendedor',
    active = true,
    subscription_status = coalesce(
      v_owner.subscription_status,
      subscription_status
    ),
    subscription_end = coalesce(
      v_owner.subscription_end,
      subscription_end
    ),
    trial_end = coalesce(
      v_owner.trial_end,
      trial_end
    ),
    plan_type = coalesce(
      v_owner.plan_type,
      plan_type
    )
  WHERE id = v_uid;

  UPDATE public.company_invites
  SET used_count = used_count + 1
  WHERE id = v_inv.id;

  INSERT INTO public.member_profiles (
    user_id,
    company_id,
    hire_date,
    archived,
    updated_at
  )
  VALUES (
    v_uid,
    v_inv.company_id,
    current_date,
    false,
    now()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    company_id = EXCLUDED.company_id,
    archived = false,
    hire_date = coalesce(
      public.member_profiles.hire_date,
      current_date
    ),
    updated_at = now();

  IF v_old_co IS NOT NULL
     AND v_old_co <> v_inv.company_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.company_id = v_old_co
    ) THEN
      DELETE FROM public.company_config
      WHERE company_id = v_old_co;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_member', false,
    'company_id', v_inv.company_id
  );
END;
$function$;

COMMIT;
