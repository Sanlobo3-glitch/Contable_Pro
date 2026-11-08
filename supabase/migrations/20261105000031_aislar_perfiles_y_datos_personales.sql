
-- =============================================================================
-- 000031 - AISLAR PERFILES Y DATOS PERSONALES
-- Contable Pro
--
-- Objetivos:
-- 1. Retirar el acceso global de plataforma a través de RLS.
-- 2. Mantener la lectura del perfil propio.
-- 3. Mantener la lectura de perfiles de la misma empresa para sus gestores.
-- 4. Eliminar permisos directos innecesarios de anon.
-- 5. Impedir escrituras directas en member_profiles.
-- 6. Conservar las funciones SECURITY DEFINER de la aplicación.
--
-- IMPORTANTE:
-- No crea políticas generales FOR ALL.
-- No concede acceso de soporte técnico a datos personales.
-- No modifica funciones, triggers ni datos.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT: tablas y RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.member_profiles') IS NULL THEN
    RAISE EXCEPTION 'Preflight: no existe public.member_profiles';
  END IF;

  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Preflight: no existe public.profiles';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('member_profiles', 'profiles')
    AND c.relrowsecurity = true;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Preflight: ambas tablas deben tener RLS habilitado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'member_profiles'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Preflight: member_profiles.company_id no es UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Preflight: profiles.company_id no es UUID';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. PREFLIGHT: políticas actuales
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_member_count integer;
  v_profiles_count integer;
BEGIN
  SELECT count(*)
  INTO v_member_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'member_profiles';

  IF v_member_count <> 2 THEN
    RAISE EXCEPTION
      'Preflight: member_profiles debía tener 2 políticas; encontradas: %',
      v_member_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'member_profiles'
      AND policyname = 'member_profiles_select'
      AND cmd = 'SELECT'
      AND qual ILIKE '%is_platform_admin%'
  ) THEN
    RAISE EXCEPTION
      'Preflight: no coincide member_profiles_select esperada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'member_profiles'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION
      'Preflight: no existe platform_admin_all en member_profiles';
  END IF;

  SELECT count(*)
  INTO v_profiles_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'profiles';

  IF v_profiles_count <> 2 THEN
    RAISE EXCEPTION
      'Preflight: profiles debía tener 2 políticas; encontradas: %',
      v_profiles_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_company'
      AND cmd = 'SELECT'
      AND qual ILIKE '%is_platform_admin%'
  ) THEN
    RAISE EXCEPTION
      'Preflight: no coincide profiles_select_company esperada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
      AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'Preflight: no existe profiles_update_own';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. PREFLIGHT: funciones críticas de la aplicación
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'guardar_mi_perfil',
    'guardar_ficha_miembro',
    'retirar_miembro_empresa',
    'admin_listar_usuarios_completo',
    'admin_guardar_usuario_completo',
    'admin_eliminar_perfil'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_name
        AND p.prosecdef = true
      ) THEN
      RAISE EXCEPTION
        'Preflight: falta función SECURITY DEFINER: %',
        v_name;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. RETIRAR EL BYPASS GLOBAL DE member_profiles
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_all
ON public.member_profiles;

DROP POLICY IF EXISTS member_profiles_select
ON public.member_profiles;

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
);

-- ---------------------------------------------------------------------------
-- 5. RETIRAR EL BYPASS GLOBAL DE profiles
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_select_company
ON public.profiles;

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
);

-- profiles_update_own se conserva intacta.
-- No se crea ninguna política adicional de escritura.

-- ---------------------------------------------------------------------------
-- 6. RESTRINGIR PRIVILEGIOS DIRECTOS EN member_profiles
-- ---------------------------------------------------------------------------

REVOKE ALL PRIVILEGES
ON TABLE public.member_profiles
FROM PUBLIC, anon, authenticated;

-- La aplicación necesita lectura directa del perfil propio.
-- Las escrituras se realizan mediante funciones SECURITY DEFINER.
GRANT SELECT
ON TABLE public.member_profiles
TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RETIRAR DELETE DIRECTO EN profiles
-- ---------------------------------------------------------------------------

-- La eliminación de usuarios debe pasar por las funciones administrativas
-- que validan identidad, rol y empresa.
REVOKE DELETE
ON TABLE public.profiles
FROM PUBLIC, anon, authenticated;

-- No se alteran los privilegios SELECT ni las funciones administrativas.

-- ---------------------------------------------------------------------------
-- 8. VERIFICACIONES FINALES
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
BEGIN
  -- member_profiles debe conservar solamente su política SELECT.
  SELECT count(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'member_profiles';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Verificación: member_profiles debe tener una política; encontradas: %',
      v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'member_profiles'
      AND policyname = 'member_profiles_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'Verificación: falta member_profiles_select';
  END IF;

  -- profiles conserva SELECT y UPDATE propio.
  SELECT count(*)
  INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'profiles';

  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'Verificación: profiles debe conservar dos políticas; encontradas: %',
      v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('member_profiles', 'profiles')
      AND coalesce(qual, '') ILIKE '%is_platform_admin%'
  ) THEN
    RAISE EXCEPTION
      'Verificación: permanece un bypass is_platform_admin en USING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('member_profiles', 'profiles')
      AND coalesce(with_check, '') ILIKE '%is_platform_admin%'
  ) THEN
    RAISE EXCEPTION
      'Verificación: permanece un bypass is_platform_admin en WITH CHECK';
  END IF;

  -- anon no debe conservar privilegios directos sobre member_profiles.
  IF has_table_privilege('anon', 'public.member_profiles', 'SELECT')
     OR has_table_privilege('anon', 'public.member_profiles', 'INSERT')
     OR has_table_privilege('anon', 'public.member_profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.member_profiles', 'DELETE')
     OR has_table_privilege('anon', 'public.member_profiles', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.member_profiles', 'REFERENCES')
     OR has_table_privilege('anon', 'public.member_profiles', 'TRIGGER') THEN
    RAISE EXCEPTION
      'Verificación: anon conserva privilegios sobre member_profiles';
  END IF;

  -- authenticated conserva lectura, pero no escritura directa.
  IF NOT has_table_privilege(
    'authenticated', 'public.member_profiles', 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'Verificación: authenticated perdió SELECT en member_profiles';
  END IF;

  IF has_table_privilege(
    'authenticated', 'public.member_profiles', 'INSERT'
  ) OR has_table_privilege(
    'authenticated', 'public.member_profiles', 'UPDATE'
  ) OR has_table_privilege(
    'authenticated', 'public.member_profiles', 'DELETE'
  ) THEN
    RAISE EXCEPTION
      'Verificación: authenticated conserva escritura directa en member_profiles';
  END IF;

  -- profiles no debe permitir DELETE directo.
  IF has_table_privilege(
    'authenticated', 'public.profiles', 'DELETE'
  ) THEN
    RAISE EXCEPTION
      'Verificación: authenticated conserva DELETE directo en profiles';
  END IF;

  -- Las funciones necesarias deben seguir disponibles.
  IF NOT has_function_privilege(
    'authenticated',
    'public.guardar_mi_perfil(text,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Verificación: guardar_mi_perfil dejó de ser ejecutable';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.admin_listar_usuarios_completo()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Verificación: admin_listar_usuarios_completo dejó de ser ejecutable';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.admin_guardar_usuario_completo(uuid,text,text,uuid,boolean,text,text,text,text,text,text,text,date,numeric,numeric,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Verificación: admin_guardar_usuario_completo dejó de ser ejecutable';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.retirar_miembro_empresa(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Verificación: retirar_miembro_empresa dejó de ser ejecutable';
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- FIN 000031
-- =============================================================================
