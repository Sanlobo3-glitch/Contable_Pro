
-- ============================================================================
-- 000015: Seguridad de dispositivos y sesiones
-- Contable Pro
--
-- Objetivos:
-- 1. Retirar el bypass global platform_admin_all de devices.
-- 2. Conservar la lectura de dispositivos para administradores de su empresa.
-- 3. Permitir lectura técnica temporal mediante autorización del módulo team.
-- 4. Proteger device_settings y permitir diagnóstico autorizado de solo lectura.
-- 5. No modificar RPC, triggers ni privilegios de escritura.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PREVALIDACIONES
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.devices') IS NULL THEN
    RAISE EXCEPTION 'No existe public.devices';
  END IF;

  IF to_regclass('public.device_settings') IS NULL THEN
    RAISE EXCEPTION 'No existe public.device_settings';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'devices'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'devices.company_id no existe o no es UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'device_settings'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'device_settings.company_id no existe o no es UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'devices'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado en devices';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'device_settings'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado en device_settings';
  END IF;

  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'No existe support_has_active_authorization(uuid,text,text)';
  END IF;
END;
$$;

-- ============================================================================
-- 2. DEVICES: RETIRAR BYPASS GLOBAL
-- ============================================================================

DROP POLICY IF EXISTS platform_admin_all
ON public.devices;

-- Se conserva el acceso normal de los administradores de su empresa.
-- Se elimina exclusivamente el bypass global del administrador de plataforma.

DROP POLICY IF EXISTS devices_select
ON public.devices;

CREATE POLICY devices_select
ON public.devices
FOR SELECT
TO authenticated
USING (
  company_id = public.my_company()
  AND public.is_manager()
);

-- ============================================================================
-- 3. DEVICES: SOPORTE TÉCNICO DE SOLO LECTURA
-- ============================================================================

DROP POLICY IF EXISTS support_read_devices
ON public.devices;

CREATE POLICY support_read_devices
ON public.devices
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'team',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'team',
    'intervencion_asistida'
  )
);

-- ============================================================================
-- 4. DEVICE_SETTINGS: RETIRAR BYPASS GLOBAL
-- ============================================================================

DROP POLICY IF EXISTS platform_admin_all
ON public.device_settings;

-- No se crea una política general para usuarios de empresa.
-- La configuración se administra mediante las RPC existentes.
-- El soporte únicamente podrá consultar el valor cuando tenga autorización.

DROP POLICY IF EXISTS support_read_device_settings
ON public.device_settings;

CREATE POLICY support_read_device_settings
ON public.device_settings
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'team',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'team',
    'intervencion_asistida'
  )
);

-- ============================================================================
-- 5. VERIFICACIONES FINALES
-- ============================================================================

DO $$
DECLARE
  v_global_policies integer;
  v_devices_select integer;
  v_support_devices integer;
  v_support_settings integer;
  v_write_support integer;
BEGIN
  SELECT count(*)
  INTO v_global_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('devices', 'device_settings')
    AND policyname = 'platform_admin_all';

  IF v_global_policies <> 0 THEN
    RAISE EXCEPTION
      'Todavía existen políticas platform_admin_all en dispositivos';
  END IF;

  SELECT count(*)
  INTO v_devices_select
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'devices'
    AND policyname = 'devices_select'
    AND cmd = 'SELECT';

  IF v_devices_select <> 1 THEN
    RAISE EXCEPTION
      'No quedó correctamente instalada devices_select';
  END IF;

  SELECT count(*)
  INTO v_support_devices
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'devices'
    AND policyname = 'support_read_devices'
    AND cmd = 'SELECT';

  IF v_support_devices <> 1 THEN
    RAISE EXCEPTION
      'No quedó correctamente instalada support_read_devices';
  END IF;

  SELECT count(*)
  INTO v_support_settings
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'device_settings'
    AND policyname = 'support_read_device_settings'
    AND cmd = 'SELECT';

  IF v_support_settings <> 1 THEN
    RAISE EXCEPTION
      'No quedó correctamente instalada support_read_device_settings';
  END IF;

  SELECT count(*)
  INTO v_write_support
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('devices', 'device_settings')
    AND policyname IN (
      'support_read_devices',
      'support_read_device_settings'
    )
    AND cmd <> 'SELECT';

  IF v_write_support <> 0 THEN
    RAISE EXCEPTION
      'Se detectó una política de soporte con permisos distintos de SELECT';
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- FIN 000015
-- ============================================================================
