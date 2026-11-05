BEGIN;

-- ============================================================
-- 000029: AISLAR SUSCRIPCIONES POR EMPRESA
-- Administrador central: lectura solo de su propia empresa.
-- Gestores: lectura solo de su propia empresa.
-- Eliminar bypass global sin modificar grants ni RPC.
-- ============================================================

-- 1. PREVALIDACIÓN

DO $$
DECLARE
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'company_subscriptions',
        'subscriptions'
    ]
    LOOP
        IF to_regclass(format('public.%I', v_table)) IS NULL THEN
            RAISE EXCEPTION 'No existe public.%', v_table;
        END IF;

        IF NOT (
            SELECT relrowsecurity
            FROM pg_class
            WHERE oid = to_regclass(format('public.%I', v_table))
        ) THEN
            RAISE EXCEPTION 'RLS no está habilitado en %', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_table
              AND column_name = 'company_id'
              AND data_type = 'uuid'
        ) THEN
            RAISE EXCEPTION 'Falta company_id UUID en %', v_table;
        END IF;

        IF (
            SELECT count(*)
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_table
        ) <> 2 THEN
            RAISE EXCEPTION
                'Políticas inesperadas en %; revisar antes de continuar',
                v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_table
              AND policyname = 'platform_admin_all'
              AND cmd = 'ALL'
        ) THEN
            RAISE EXCEPTION
                'No existe platform_admin_all en %',
                v_table;
        END IF;
    END LOOP;

    IF to_regprocedure('public.my_company()') IS NULL
       OR to_regprocedure('public.is_manager()') IS NULL
       OR to_regprocedure('public.is_platform_admin()') IS NULL THEN
        RAISE EXCEPTION 'Faltan funciones de autorización';
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.company_subscriptions',
        'SELECT'
    ) OR NOT has_table_privilege(
        'authenticated',
        'public.subscriptions',
        'SELECT'
    ) THEN
        RAISE EXCEPTION 'Faltan permisos SELECT para authenticated';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.company_subscriptions',
        'SELECT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.company_subscriptions',
        'INSERT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.subscriptions',
        'SELECT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.subscriptions',
        'INSERT'
    ) THEN
        RAISE EXCEPTION 'service_role no conserva los permisos esperados';
    END IF;
END;
$$;

-- 2. ELIMINAR POLÍTICAS GLOBALES

DROP POLICY platform_admin_all
ON public.company_subscriptions;

DROP POLICY platform_admin_all
ON public.subscriptions;

-- 3. RECONSTRUIR LECTURA DE SUSCRIPCIONES DE EMPRESA

DROP POLICY company_subscriptions_read
ON public.company_subscriptions;

CREATE POLICY company_subscriptions_read
ON public.company_subscriptions
FOR SELECT
TO authenticated
USING (
    company_id = public.my_company()
    AND (
        public.is_platform_admin()
        OR public.is_manager()
    )
);

-- 4. RECONSTRUIR LECTURA DE SUSCRIPCIONES

DROP POLICY subscriptions_company_read
ON public.subscriptions;

CREATE POLICY subscriptions_company_read
ON public.subscriptions
FOR SELECT
TO authenticated
USING (
    company_id = public.my_company()
    AND (
        public.is_platform_admin()
        OR public.is_manager()
    )
);

-- 5. VERIFICACIÓN FINAL

DO $$
DECLARE
    v_qual text;
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'company_subscriptions',
        'subscriptions'
    ]
    LOOP
        SELECT qual
        INTO v_qual
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = v_table
          AND cmd = 'SELECT'
          AND roles = ARRAY['authenticated']::name[];

        IF v_qual IS NULL THEN
            RAISE EXCEPTION
                'No existe política SELECT para %',
                v_table;
        END IF;

        IF v_qual NOT ILIKE '%company_id%'
           OR v_qual NOT ILIKE '%my_company%'
           OR v_qual NOT ILIKE '%is_platform_admin%'
           OR v_qual NOT ILIKE '%is_manager%' THEN
            RAISE EXCEPTION
                'La política de % no conserva el aislamiento esperado',
                v_table;
        END IF;

        IF v_qual ILIKE '%OR true%' THEN
            RAISE EXCEPTION
                'Se detectó un bypass global en %',
                v_table;
        END IF;

        IF (
            SELECT count(*)
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_table
        ) <> 1 THEN
            RAISE EXCEPTION
                'Hay políticas adicionales en %',
                v_table;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_table
              AND policyname = 'platform_admin_all'
        ) THEN
            RAISE EXCEPTION
                'Persiste platform_admin_all en %',
                v_table;
        END IF;
    END LOOP;

    IF NOT has_table_privilege(
        'authenticated',
        'public.company_subscriptions',
        'SELECT'
    ) OR NOT has_table_privilege(
        'authenticated',
        'public.subscriptions',
        'SELECT'
    ) THEN
        RAISE EXCEPTION 'Se perdió SELECT para authenticated';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.company_subscriptions',
        'INSERT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.subscriptions',
        'INSERT'
    ) THEN
        RAISE EXCEPTION 'Se alteraron permisos de service_role';
    END IF;
END;
$$;

COMMIT;
