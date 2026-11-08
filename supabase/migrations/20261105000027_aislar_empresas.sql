BEGIN;

-- ============================================================
-- 000027: AISLAMIENTO DE EMPRESAS
--
-- Administrador central:
--   Solo consulta su empresa vinculada al perfil.
--
-- Usuarios autenticados:
--   Solo consultan su propia empresa.
--
-- No se permite acceso global a otras empresas.
-- Se conserva el alta automática y el trigger de suscripción.
-- ============================================================

-- 1. PREVALIDACIÓN

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
            'Cantidad inesperada de políticas: %',
            v_policy_count;
    END IF;

    IF to_regprocedure(
        'public.admin_listar_empresas()'
    ) IS NULL THEN
        RAISE EXCEPTION 'No existe admin_listar_empresas()';
    END IF;

    IF NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid =
            'public.admin_listar_empresas()'::regprocedure
    ) THEN
        RAISE EXCEPTION
            'admin_listar_empresas debe conservar SECURITY DEFINER';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.admin_listar_empresas()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'authenticated no tiene EXECUTE en admin_listar_empresas';
    END IF;

    IF to_regprocedure(
        'public.current_company_id()'
    ) IS NULL THEN
        RAISE EXCEPTION 'No existe current_company_id()';
    END IF;

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

-- 2. ELIMINAR ACCESO GLOBAL

DROP POLICY platform_admin_all
ON public.companies;

-- 3. LECTURA LIMITADA A LA EMPRESA DEL PERFIL

DROP POLICY companies_select
ON public.companies;

CREATE POLICY companies_select
ON public.companies
FOR SELECT
TO authenticated
USING (
    id = public.current_company_id()
);

-- 4. LIMITAR EL RPC ADMINISTRATIVO
--
-- Se conserva la función y su estructura de respuesta,
-- pero ahora devuelve exclusivamente la empresa del perfil
-- del administrador central.

CREATE OR REPLACE FUNCTION public.admin_listar_empresas()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_res jsonb;
    v_company_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'No autorizado'
            USING ERRCODE = '42501';
    END IF;

    PERFORM public.assert_platform_admin();

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION
            'El administrador no tiene empresa vinculada';
    END IF;

    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'company_id', c.id,
                'company_name',
                    coalesce(
                        nullif(btrim(cc.name), ''),
                        c.name
                    ),
                'owner_name', owner.full_name,
                'owner_email', owner.email,
                'members_count',
                    coalesce(m.members_count, 0),
                'plan_type', cs.plan_type,
                'subscription_status', cs.status,
                'trial_end', cs.trial_end,
                'subscription_end', cs.subscription_end
            )
            ORDER BY c.created_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_res
    FROM public.companies c
    LEFT JOIN public.company_config cc
        ON cc.company_id = c.id
    LEFT JOIN public.company_subscriptions cs
        ON cs.company_id = c.id
    JOIN LATERAL (
        SELECT p.full_name, p.email
        FROM public.profiles p
        WHERE p.company_id = c.id
        ORDER BY
            (p.role = 'dueno') DESC,
            p.created_at ASC
        LIMIT 1
    ) owner ON true
    LEFT JOIN LATERAL (
        SELECT count(*)::int AS members_count
        FROM public.profiles p
        WHERE p.company_id = c.id
    ) m ON true
    WHERE c.id = v_company_id;

    RETURN v_res;
END;
$function$;

-- 5. PRIVILEGIOS DEL RPC
--
-- Solo authenticated puede invocarlo.
-- La función valida internamente al administrador central.

REVOKE ALL PRIVILEGES
ON FUNCTION public.admin_listar_empresas()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_listar_empresas()
TO authenticated;

-- 6. VERIFICACIÓN FINAL

DO $$
DECLARE
    v_policy_count integer;
    v_definition text;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'companies'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION
            'Permanece la política global platform_admin_all';
    END IF;

    SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies';

    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION
            'Se esperaba una política; encontradas: %',
            v_policy_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'companies'
          AND policyname = 'companies_select'
          AND cmd = 'SELECT'
          AND roles = ARRAY['authenticated']::name[]
          AND qual = '(id = current_company_id())'
    ) THEN
        RAISE EXCEPTION
            'companies_select no quedó limitada a la empresa propia';
    END IF;

    SELECT lower(pg_get_functiondef(
        'public.admin_listar_empresas()'::regprocedure
    ))
    INTO v_definition;

    IF position(
        'assert_platform_admin' IN v_definition
    ) = 0 THEN
        RAISE EXCEPTION
            'Falta validación del administrador central';
    END IF;

    IF position(
        'current_company_id' IN v_definition
    ) = 0 OR position(
        'where c.id = v_company_id' IN v_definition
    ) = 0 THEN
        RAISE EXCEPTION
            'El RPC no quedó limitado a la empresa del perfil';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.admin_listar_empresas()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Se perdió EXECUTE para authenticated';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.admin_listar_empresas()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'anon conserva EXECUTE en el RPC administrativo';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.companies'::regclass
          AND tgname = 'initialize_company_subscription'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'Se perdió el trigger de inicialización';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'handle_new_user'
          AND p.prosecdef
    ) THEN
        RAISE EXCEPTION
            'Se alteró handle_new_user';
    END IF;
END;
$$;

COMMIT;
