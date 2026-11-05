-- ============================================================================
-- 000015: SEGURIDAD DE DISPOSITIVOS Y SESIONES
-- Fecha: 2026-11-05
--
-- Administrador central: CRUD limitado a su empresa actual.
-- Empresa: conserva lectura de dispositivos para sus administradores.
-- Soporte: lectura temporal autorizada del módulo team.
-- device_settings: gestión central aislada y soporte de solo lectura.
-- No modifica RPC, triggers ni privilegios de escritura existentes.
-- ============================================================================

BEGIN;

-- 1. PREVALIDACIONES

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['devices', 'device_settings']
    LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION 'No existe public.%', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_table
              AND column_name = 'company_id'
              AND data_type = 'uuid'
        ) THEN
            RAISE EXCEPTION
                'Falta company_id UUID en public.%', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_table
              AND c.relrowsecurity = TRUE
        ) THEN
            RAISE EXCEPTION 'RLS no está habilitado en public.%', v_table;
        END IF;
    END LOOP;

    IF to_regprocedure(
        'public.support_has_active_authorization(uuid,text,text)'
    ) IS NULL
       OR to_regprocedure('public.is_platform_admin()') IS NULL
       OR to_regprocedure('public.current_company_id()') IS NULL
       OR to_regprocedure('public.my_company()') IS NULL
       OR to_regprocedure('public.is_manager()') IS NULL THEN
        RAISE EXCEPTION
            'Falta una función de seguridad requerida.';
    END IF;
END;
$$;

-- 2. ELIMINAR BYPASS GLOBAL

DROP POLICY IF EXISTS platform_admin_all ON public.devices;
DROP POLICY IF EXISTS platform_admin_all ON public.device_settings;

-- 3. DISPOSITIVOS: ADMINISTRACIÓN CENTRAL AISLADA

DROP POLICY IF EXISTS platform_admin_company_all ON public.devices;

CREATE POLICY platform_admin_company_all
ON public.devices
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

-- 4. DISPOSITIVOS: LECTURA NORMAL DE ADMINISTRADORES DE EMPRESA
-- Se elimina el OR is_platform_admin() que permitía lectura global.

DROP POLICY IF EXISTS devices_select ON public.devices;

CREATE POLICY devices_select
ON public.devices
FOR SELECT
TO authenticated
USING (
    company_id = public.my_company()
    AND public.is_manager()
);

-- 5. DISPOSITIVOS: SOPORTE TEMPORAL DE SOLO LECTURA

DROP POLICY IF EXISTS support_read_devices ON public.devices;

CREATE POLICY support_read_devices
ON public.devices
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'team', 'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id, 'team', 'intervencion_asistida'
    )
);

-- 6. CONFIGURACIÓN: ADMINISTRACIÓN CENTRAL AISLADA

DROP POLICY IF EXISTS platform_admin_company_all
ON public.device_settings;

CREATE POLICY platform_admin_company_all
ON public.device_settings
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

-- 7. CONFIGURACIÓN: SOPORTE TEMPORAL DE SOLO LECTURA

DROP POLICY IF EXISTS support_read_device_settings
ON public.device_settings;

CREATE POLICY support_read_device_settings
ON public.device_settings
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'team', 'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id, 'team', 'intervencion_asistida'
    )
);

-- 8. VERIFICACIONES

DO $$
DECLARE
    v_global INTEGER;
    v_admin INTEGER;
    v_devices_select INTEGER;
    v_support INTEGER;
    v_support_write INTEGER;
    v_rls INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_global
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('devices', 'device_settings')
      AND policyname = 'platform_admin_all';

    IF v_global <> 0 THEN
        RAISE EXCEPTION
            'Persisten políticas globales platform_admin_all.';
    END IF;

    SELECT COUNT(*)
    INTO v_admin
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('devices', 'device_settings')
      AND policyname = 'platform_admin_company_all'
      AND cmd = 'ALL'
      AND qual LIKE '%is_platform_admin()%'
      AND qual LIKE '%current_company_id()%'
      AND with_check LIKE '%is_platform_admin()%'
      AND with_check LIKE '%current_company_id()%';

    IF v_admin <> 2 THEN
        RAISE EXCEPTION
            'Se esperaban 2 políticas centrales aisladas; existen %.',
            v_admin;
    END IF;

    SELECT COUNT(*)
    INTO v_devices_select
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'devices'
      AND policyname = 'devices_select'
      AND cmd = 'SELECT'
      AND qual NOT LIKE '%is_platform_admin()%';

    IF v_devices_select <> 1 THEN
        RAISE EXCEPTION
            'La política normal devices_select no quedó correctamente aislada.';
    END IF;

    SELECT COUNT(*)
    INTO v_support
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
          (tablename = 'devices'
           AND policyname = 'support_read_devices'
           AND cmd = 'SELECT')
          OR
          (tablename = 'device_settings'
           AND policyname = 'support_read_device_settings'
           AND cmd = 'SELECT')
      );

    IF v_support <> 2 THEN
        RAISE EXCEPTION
            'Se esperaban 2 políticas SELECT de soporte; existen %.',
            v_support;
    END IF;

    SELECT COUNT(*)
    INTO v_support_write
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('devices', 'device_settings')
      AND policyname IN (
          'support_read_devices',
          'support_read_device_settings'
      )
      AND cmd <> 'SELECT';

    IF v_support_write <> 0 THEN
        RAISE EXCEPTION
            'Soporte tiene una política distinta de SELECT.';
    END IF;

    SELECT COUNT(*)
    INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('devices', 'device_settings')
      AND c.relrowsecurity = TRUE;

    IF v_rls <> 2 THEN
        RAISE EXCEPTION
            'RLS debe permanecer activo en ambas tablas.';
    END IF;
END;
$$;

COMMIT;

-- FIN MIGRACION 000015
