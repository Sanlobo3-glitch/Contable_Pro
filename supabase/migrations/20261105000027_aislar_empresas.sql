
BEGIN;

-- ============================================================
-- 000027 - AISLAMIENTO DE LA TABLA COMPANIES
-- ============================================================

DO $$
DECLARE
    v_policy_count integer;
BEGIN
    IF to_regclass('public.companies') IS NULL THEN
        RAISE EXCEPTION 'No existe public.companies';
    END IF;

    IF NOT (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.companies'::regclass
    ) THEN
        RAISE EXCEPTION 'RLS no está habilitado en companies';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'companies'
          AND column_name = 'id'
          AND data_type = 'uuid'
    ) THEN
        RAISE EXCEPTION 'companies.id no es UUID';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'companies'
          AND policyname = 'companies_select'
          AND cmd = 'SELECT'
    ) THEN
        RAISE EXCEPTION 'No existe companies_select';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'companies'
          AND policyname = 'platform_admin_all'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'No existe platform_admin_all';
    END IF;

    SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies';

    IF v_policy_count <> 2 THEN
        RAISE EXCEPTION
            'Cantidad inesperada de políticas en companies: %',
            v_policy_count;
    END IF;

    -- El RPC administrativo debe seguir protegido.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'admin_listar_empresas'
          AND p.prosecdef
          AND has_function_privilege(
              'authenticated',
              p.oid,
              'EXECUTE'
          )
    ) THEN
        RAISE EXCEPTION
            'admin_listar_empresas no está disponible como SECURITY DEFINER';
    END IF;

    -- El RPC debe validar explícitamente al administrador global.
    IF position(
        'assert_platform_admin'
        IN lower(pg_get_functiondef(
            'public.admin_listar_empresas()'::regprocedure
        ))
    ) = 0 THEN
        RAISE EXCEPTION
            'admin_listar_empresas no contiene assert_platform_admin';
    END IF;

    -- El alta de usuario debe conservar su función SECURITY DEFINER.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'handle_new_user'
          AND p.prosecdef
    ) THEN
        RAISE EXCEPTION
            'handle_new_user no existe como SECURITY DEFINER';
    END IF;

    -- El trigger de inicialización de suscripción debe existir.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.companies'::regclass
          AND tgname = 'initialize_company_subscription'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'Falta initialize_company_subscription';
    END IF;
END;
$$;

-- ============================================================
-- 1. Retirar acceso global.
-- ============================================================

DROP POLICY platform_admin_all
ON public.companies;

-- ============================================================
-- 2. Corregir lectura de empresas.
--
-- Cada usuario autenticado solo puede leer su empresa.
-- El administrador global consulta empresas mediante el RPC
-- admin_listar_empresas(), que valida assert_platform_admin().
-- ============================================================

DROP POLICY companies_select
ON public.companies;

CREATE POLICY companies_select
ON public.companies
FOR SELECT
TO authenticated
USING (
    id = public.current_company_id()
);

-- ============================================================
-- 3. Verificaciones finales.
-- ============================================================

DO $$
DECLARE
    v_policy_count integer;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'companies'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION
            'Sigue existiendo platform_admin_all';
    END IF;

    SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies';

    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION
            'Se esperaba una sola política en companies; encontradas: %',
            v_policy_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'companies'
          AND policyname = 'companies_select'
          AND cmd = 'SELECT'
          AND qual = '(id = current_company_id())'
    ) THEN
        RAISE EXCEPTION
            'La política companies_select no quedó correctamente aislada';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.admin_listar_empresas()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Se perdió el acceso al RPC administrativo';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.companies'::regclass
          AND tgname = 'initialize_company_subscription'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'Se perdió el trigger de suscripción';
    END IF;
END;
$$;

COMMIT;
