BEGIN;

-- =========================================================
-- 000025: AISLAR CONFIGURACION DE CUENTAS POR COBRAR
--
-- Administrador central:
--   Acceso exclusivamente a la empresa de su propio perfil.
--
-- Administradores y responsables de empresa:
--   Conservan el acceso a su propia empresa.
--
-- Soporte técnico:
--   Sin acceso directo ni autorización automática.
--
-- Se conservan las protecciones de suscripción y triggers.
-- =========================================================

DO $$
DECLARE
    v_rls boolean;
BEGIN
    IF to_regclass('public.cxc_settings') IS NULL THEN
        RAISE EXCEPTION 'No existe public.cxc_settings';
    END IF;

    SELECT relrowsecurity
    INTO v_rls
    FROM pg_class
    WHERE oid = 'public.cxc_settings'::regclass;

    IF v_rls IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'RLS no está habilitado en cxc_settings';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cxc_settings'
          AND column_name = 'company_id'
          AND data_type = 'uuid'
    ) THEN
        RAISE EXCEPTION 'company_id no existe o no es UUID';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxc_settings'
          AND policyname = 'cxc_settings_select'
          AND cmd = 'SELECT'
          AND qual = '(company_id = current_company_id())'
    ) THEN
        RAISE EXCEPTION 'La política original de lectura no coincide';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxc_settings'
          AND policyname = 'platform_admin_all'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'No existe la política global esperada';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxc_settings'
    ) <> 2 THEN
        RAISE EXCEPTION 'Hay políticas adicionales no auditadas';
    END IF;

    IF has_table_privilege(
        'anon', 'public.cxc_settings', 'SELECT'
    ) OR has_table_privilege(
        'authenticated', 'public.cxc_settings', 'INSERT'
    ) OR has_table_privilege(
        'authenticated', 'public.cxc_settings', 'UPDATE'
    ) OR has_table_privilege(
        'authenticated', 'public.cxc_settings', 'DELETE'
    ) THEN
        RAISE EXCEPTION 'Hay privilegios directos inesperados';
    END IF;

    IF to_regprocedure('public.cxc_config()') IS NULL
       OR to_regprocedure('public.cxc_save_account(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Faltan las funciones CXC';
    END IF;

    IF NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxc_config()'::regprocedure
    ) OR NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxc_save_account(uuid)'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Las funciones deben conservar SECURITY DEFINER';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.cxc_config()',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated',
        'public.cxc_save_account(uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Falta EXECUTE en las funciones CXC';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.cxc_settings'::regclass
          AND tgname = 'cxc_settings_check_subscription'
          AND NOT tgisinternal
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.cxc_settings'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Faltan triggers originales de protección';
    END IF;
END;
$$;

-- =========================================================
-- ELIMINAR ACCESO GLOBAL INSEGURO
-- Se conserva la lectura por empresa.
-- =========================================================

DROP POLICY platform_admin_all
ON public.cxc_settings;

-- =========================================================
-- RPC DE CONSULTA CXC
-- El administrador central solo consulta su empresa activa.
-- Los gestores siguen limitados a su propia empresa.
-- =========================================================

CREATE OR REPLACE FUNCTION public.cxc_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_co uuid;
    v_acc uuid;
    v_active boolean := false;
    a public.acc_accounts%rowtype;
BEGIN
    IF auth.uid() IS NULL
       OR NOT (
           public.is_platform_admin()
           OR public.is_company_manager()
       ) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    v_co := public.current_company_id();

    IF v_co IS NULL THEN
        RAISE EXCEPTION 'El usuario no tiene empresa activa';
    END IF;

    SELECT account_id
    INTO v_acc
    FROM public.cxc_settings
    WHERE company_id = v_co;

    SELECT coalesce(active, false)
    INTO v_active
    FROM public.acc_settings
    WHERE company_id = v_co;

    IF v_acc IS NOT NULL THEN
        SELECT *
        INTO a
        FROM public.acc_accounts
        WHERE id = v_acc
          AND company_id = v_co;
    END IF;

    RETURN jsonb_build_object(
        'account_id', v_acc,
        'account_code', a.code,
        'account_name', a.name,
        'accounting_active', coalesce(v_active, false)
    );
END;
$function$;

-- =========================================================
-- RPC DE CONFIGURACIÓN CXC
-- No acepta cuentas pertenecientes a otra empresa.
-- =========================================================

CREATE OR REPLACE FUNCTION public.cxc_save_account(
    p_account uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_co uuid;
    v_res jsonb := NULL;
BEGIN
    IF auth.uid() IS NULL
       OR NOT (
           public.is_platform_admin()
           OR public.is_company_manager()
       ) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    v_co := public.current_company_id();

    IF v_co IS NULL THEN
        RAISE EXCEPTION 'El usuario no tiene empresa activa';
    END IF;

    IF p_account IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.acc_accounts
           WHERE id = p_account
             AND company_id = v_co
             AND is_postable = TRUE
             AND active = TRUE
       ) THEN
        RAISE EXCEPTION
          'La cuenta elegida no existe, está inactiva o no admite movimientos';
    END IF;

    INSERT INTO public.cxc_settings (
        company_id,
        account_id
    )
    VALUES (
        v_co,
        p_account
    )
    ON CONFLICT (company_id)
    DO UPDATE SET
        account_id = EXCLUDED.account_id,
        updated_at = now();

    -- Conserva la contabilización de pendientes.
    IF p_account IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM public.acc_settings
           WHERE company_id = v_co
             AND active = TRUE
       ) THEN
        BEGIN
            v_res := public.acc_post_pending();
        EXCEPTION WHEN OTHERS THEN
            v_res := NULL;
        END;
    END IF;

    RETURN coalesce(v_res, '{}'::jsonb);
END;
$function$;

-- =========================================================
-- VERIFICACIÓN FINAL
-- =========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxc_settings'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION 'Sigue existiendo la política global';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxc_settings'
          AND policyname = 'cxc_settings_select'
          AND cmd = 'SELECT'
          AND qual = '(company_id = current_company_id())'
    ) THEN
        RAISE EXCEPTION 'Se perdió la lectura aislada por empresa';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxc_settings'
    ) <> 1 THEN
        RAISE EXCEPTION 'El conjunto final de políticas es inesperado';
    END IF;

    IF has_table_privilege(
        'anon', 'public.cxc_settings', 'SELECT'
    ) OR has_table_privilege(
        'authenticated', 'public.cxc_settings', 'INSERT'
    ) OR has_table_privilege(
        'authenticated', 'public.cxc_settings', 'UPDATE'
    ) OR has_table_privilege(
        'authenticated', 'public.cxc_settings', 'DELETE'
    ) THEN
        RAISE EXCEPTION 'Se detectaron privilegios directos inesperados';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.cxc_config()',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated',
        'public.cxc_save_account(uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Se perdió EXECUTE en las funciones CXC';
    END IF;

    IF NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxc_config()'::regprocedure
    ) OR NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxc_save_account(uuid)'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Las RPC perdieron SECURITY DEFINER';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.cxc_settings'::regclass
          AND tgname = 'cxc_settings_check_subscription'
          AND NOT tgisinternal
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.cxc_settings'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Se perdió un trigger de protección';
    END IF;
END;
$$;

COMMIT;
