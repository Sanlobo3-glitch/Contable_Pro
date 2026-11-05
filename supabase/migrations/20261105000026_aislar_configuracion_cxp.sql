BEGIN;

-- ============================================================
-- 000026: AISLAR CONFIGURACIÓN DE CUENTAS POR PAGAR (CXP)
--
-- Administrador central:
--   Solo opera sobre la empresa de su propio perfil.
--
-- Administrador/gerente de empresa:
--   Solo opera sobre su propia empresa.
--
-- Acceso directo:
--   authenticated: lectura RLS, sin escritura directa.
--   anon: sin acceso.
--   service_role: se conservan sus privilegios.
--
-- Se conservan RPC y protección de suscripción.
-- ============================================================

-- ============================================================
-- 1. PREVALIDACIÓN
-- ============================================================

DO $$
DECLARE
    v_owner text;
    v_policy_count integer;
BEGIN
    IF to_regclass('public.cxp_settings') IS NULL THEN
        RAISE EXCEPTION 'No existe public.cxp_settings';
    END IF;

    SELECT pg_get_userbyid(relowner)
    INTO v_owner
    FROM pg_class
    WHERE oid = 'public.cxp_settings'::regclass;

    IF v_owner <> 'postgres' THEN
        RAISE EXCEPTION 'Propietario inesperado: %', v_owner;
    END IF;

    IF NOT (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.cxp_settings'::regclass
    ) THEN
        RAISE EXCEPTION 'RLS no está habilitado';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'cxp_settings_select'
          AND cmd = 'SELECT'
          AND qual = '(company_id = current_company_id())'
    ) THEN
        RAISE EXCEPTION 'No coincide la política de lectura por empresa';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'platform_admin_all'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'No existe la política global esperada';
    END IF;

    SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cxp_settings';

    IF v_policy_count <> 2 THEN
        RAISE EXCEPTION 'Número inesperado de políticas: %', v_policy_count;
    END IF;

    IF to_regprocedure('public.cxp_config()') IS NULL
       OR to_regprocedure('public.cxp_save_account(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Faltan las funciones CXP';
    END IF;

    IF NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxp_config()'::regprocedure
    ) OR NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxp_save_account(uuid)'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Las RPC deben conservar SECURITY DEFINER';
    END IF;

    IF NOT has_function_privilege(
        'authenticated', 'public.cxp_config()', 'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated', 'public.cxp_save_account(uuid)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Falta EXECUTE en las RPC CXP';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.cxp_settings'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Falta trigger de protección de suscripción';
    END IF;

    IF NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'SELECT'
    ) OR NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'INSERT'
    ) OR NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'UPDATE'
    ) OR NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'DELETE'
    ) THEN
        RAISE EXCEPTION 'service_role no conserva sus privilegios';
    END IF;
END;
$$;

-- ============================================================
-- 2. ELIMINAR POLÍTICA GLOBAL
-- ============================================================

DROP POLICY platform_admin_all
ON public.cxp_settings;

-- ============================================================
-- 3. PRIVILEGIOS DIRECTOS
--
-- Se elimina acceso anónimo y escritura directa.
-- Se restablece SELECT para authenticated porque la política
-- RLS existente limita la lectura a current_company_id().
-- service_role no se modifica.
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.cxp_settings
FROM PUBLIC, anon, authenticated;

GRANT SELECT
ON TABLE public.cxp_settings
TO authenticated;

-- ============================================================
-- 4. RPC DE CONSULTA CXP
-- Administrador central y gestor: empresa del perfil propio.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cxp_config()
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
    FROM public.cxp_settings
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

-- ============================================================
-- 5. RPC DE CONFIGURACIÓN CXP
-- No acepta cuentas de otra empresa.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cxp_save_account(
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

    INSERT INTO public.cxp_settings (
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

    -- Se conserva el procesamiento contable pendiente.
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

-- ============================================================
-- 6. VERIFICACIÓN FINAL
-- ============================================================

DO $$
DECLARE
    v_role text;
    v_privilege text;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION 'Permanece la política global';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
    ) <> 1 THEN
        RAISE EXCEPTION 'Conjunto final de políticas inesperado';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cxp_settings'
          AND policyname = 'cxp_settings_select'
          AND cmd = 'SELECT'
          AND qual = '(company_id = current_company_id())'
    ) THEN
        RAISE EXCEPTION 'Se perdió la lectura RLS por empresa';
    END IF;

    IF NOT has_table_privilege(
        'authenticated', 'public.cxp_settings', 'SELECT'
    ) THEN
        RAISE EXCEPTION 'authenticated perdió SELECT';
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        FOREACH v_privilege IN ARRAY ARRAY[
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER'
        ]
        LOOP
            IF has_table_privilege(
                v_role,
                'public.cxp_settings',
                v_privilege
            ) THEN
                RAISE EXCEPTION
                    'Privilegio inesperado % para %',
                    v_privilege, v_role;
            END IF;
        END LOOP;
    END LOOP;

    IF has_table_privilege(
        'anon', 'public.cxp_settings', 'SELECT'
    ) THEN
        RAISE EXCEPTION 'anon conserva SELECT';
    END IF;

    IF NOT has_function_privilege(
        'authenticated', 'public.cxp_config()', 'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated', 'public.cxp_save_account(uuid)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Se perdió EXECUTE de las RPC';
    END IF;

    IF NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxp_config()'::regprocedure
    ) OR NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.cxp_save_account(uuid)'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Las RPC perdieron SECURITY DEFINER';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.cxp_settings'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Se perdió el trigger de suscripción';
    END IF;

    IF NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'SELECT'
    ) OR NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'INSERT'
    ) OR NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'UPDATE'
    ) OR NOT has_table_privilege(
        'service_role', 'public.cxp_settings', 'DELETE'
    ) THEN
        RAISE EXCEPTION 'Se alteraron privilegios de service_role';
    END IF;
END;
$$;

COMMIT;
