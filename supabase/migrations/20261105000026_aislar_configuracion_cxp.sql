BEGIN;

-- ============================================================
-- 000026 - AISLAR CONFIGURACIÓN DE CUENTAS POR PAGAR (CXP)
-- Proyecto: Contable_Pro
--
-- Objetivos:
-- 1. Eliminar el acceso global platform_admin_all.
-- 2. Revocar acceso directo de anon y authenticated.
-- 3. Mantener las funciones RPC de configuración.
-- 4. Mantener el trigger de validación de suscripción.
-- 5. Conservar la política de lectura limitada por empresa.
-- 6. No modificar privilegios de service_role.
-- ============================================================

DO $$
DECLARE
    v_table_owner text;
    v_policy_count integer;
    v_trigger_count integer;
BEGIN
    -- Verificar existencia de tabla.
    IF to_regclass('public.cxp_settings') IS NULL THEN
        RAISE EXCEPTION 'No existe public.cxp_settings';
    END IF;

    -- Verificar RLS y propietario.
    SELECT pg_get_userbyid(c.relowner)
    INTO v_table_owner
    FROM pg_class c
    WHERE c.oid = 'public.cxp_settings'::regclass;

    IF NOT (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.cxp_settings'::regclass
    ) THEN
        RAISE EXCEPTION 'RLS no está habilitado en cxp_settings';
    END IF;

    IF v_table_owner <> 'postgres' THEN
        RAISE EXCEPTION
            'Propietario inesperado de cxp_settings: %',
            v_table_owner;
    END IF;

    -- Verificar política de lectura por empresa.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'cxp_settings_select'
          AND cmd = 'SELECT'
          AND qual = '(company_id = current_company_id())'
    ) THEN
        RAISE EXCEPTION
            'No existe la política de lectura por empresa esperada';
    END IF;

    -- Verificar política global que se va a retirar.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'platform_admin_all'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION
            'No existe platform_admin_all; revisar estado antes de continuar';
    END IF;

    -- No continuar si aparecieron políticas adicionales no auditadas.
    SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxp_settings';

    IF v_policy_count <> 2 THEN
        RAISE EXCEPTION
            'Número inesperado de políticas en cxp_settings: %',
            v_policy_count;
    END IF;

    -- Verificar RPC de lectura.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'cxp_config'
          AND pg_get_function_identity_arguments(p.oid) = ''
          AND p.prosecdef
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) THEN
        RAISE EXCEPTION
            'cxp_config() no existe como SECURITY DEFINER o no es ejecutable por authenticated';
    END IF;

    -- Verificar RPC de escritura.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'cxp_save_account'
          AND pg_get_function_identity_arguments(p.oid) = 'p_account uuid'
          AND p.prosecdef
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) THEN
        RAISE EXCEPTION
            'cxp_save_account(uuid) no existe como SECURITY DEFINER o no es ejecutable por authenticated';
    END IF;

    -- Verificar trigger de protección de suscripción.
    SELECT count(*)
    INTO v_trigger_count
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.cxp_settings'::regclass
      AND t.tgname = 'trg_company_subscription_guard'
      AND NOT t.tgisinternal;

    IF v_trigger_count <> 1 THEN
        RAISE EXCEPTION
            'No se encontró el trigger trg_company_subscription_guard';
    END IF;

    -- Verificar que service_role conserva sus permisos esenciales.
    IF NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'SELECT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'INSERT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'UPDATE'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'DELETE'
    ) THEN
        RAISE EXCEPTION
            'service_role no conserva los privilegios requeridos';
    END IF;
END;
$$;

-- ============================================================
-- 1. Retirar acceso global de administrador de plataforma.
-- ============================================================

DROP POLICY platform_admin_all
ON public.cxp_settings;

-- ============================================================
-- 2. Cerrar acceso directo a la tabla.
--
-- La aplicación utiliza:
--   cxp_config()
--   cxp_save_account(uuid)
--
-- Ambas funciones son SECURITY DEFINER y validan el contexto
-- de empresa mediante _ctx().
--
-- No se revocan los permisos de service_role.
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.cxp_settings
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. Verificaciones finales.
-- ============================================================

DO $$
DECLARE
    v_privilege text;
    v_role text;
BEGIN
    -- No debe quedar la política global.
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION
            'Sigue existiendo platform_admin_all';
    END IF;

    -- Debe conservarse la política de lectura por empresa.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'cxp_settings_select'
          AND cmd = 'SELECT'
          AND qual = '(company_id = current_company_id())'
    ) THEN
        RAISE EXCEPTION
            'Se perdió la política cxp_settings_select';
    END IF;

    -- No debe haber privilegios directos para anon ni authenticated.
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        FOREACH v_privilege IN ARRAY ARRAY[
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
        ]
        LOOP
            IF has_table_privilege(
                v_role,
                'public.cxp_settings',
                v_privilege
            ) THEN
                RAISE EXCEPTION
                    'Permanece el privilegio % para % en cxp_settings',
                    v_privilege,
                    v_role;
            END IF;
        END LOOP;
    END LOOP;

    -- Las funciones RPC deben continuar disponibles.
    IF NOT has_function_privilege(
        'authenticated',
        'public.cxp_config()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Se perdió EXECUTE de authenticated sobre cxp_config()';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.cxp_save_account(uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Se perdió EXECUTE de authenticated sobre cxp_save_account(uuid)';
    END IF;

    -- El trigger debe permanecer.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.cxp_settings'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'Desapareció el trigger de protección de suscripción';
    END IF;

    -- service_role debe conservar acceso.
    IF NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'SELECT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'INSERT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'UPDATE'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.cxp_settings',
        'DELETE'
    ) THEN
        RAISE EXCEPTION
            'Se alteraron los privilegios de service_role';
    END IF;
END;
$$;

COMMIT;
