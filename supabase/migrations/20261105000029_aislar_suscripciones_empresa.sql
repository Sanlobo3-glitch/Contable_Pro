BEGIN;

-- ============================================================
-- 000029: AISLAR SUSCRIPCIONES POR EMPRESA
-- Administrador central: solo su empresa de prueba.
-- Gestores: solo su propia empresa.
-- Sin bypass global.
-- ============================================================

-- 1. PREVALIDACIÓN DEL ESTADO REAL

DO $$
DECLARE
    v_table text;
    v_policy text;
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

        v_policy := CASE
            WHEN v_table = 'company_subscriptions'
                THEN 'company_subscriptions_read'
            ELSE 'subscriptions_company_read'
        END;

        IF (
            SELECT count(*)
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_table
        ) <> 1 THEN
            RAISE EXCEPTION
                'Políticas adicionales no auditadas en %',
                v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_table
              AND policyname = v_policy
              AND cmd = 'SELECT'
              AND roles = ARRAY['authenticated']::name[]
        ) THEN
            RAISE EXCEPTION
                'No existe la política SELECT esperada en %',
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
        RAISE EXCEPTION 'Faltan permisos SELECT';
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
        RAISE EXCEPTION 'service_role no conserva INSERT';
    END IF;
END;
$$;

-- 2. CERRAR EL ACCESO GLOBAL Y RECONSTRUIR POLÍTICAS

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

-- 3. VERIFICACIÓN FINAL

DO $$
DECLARE
    v_table text;
    v_qual text;
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

        IF v_qual IS NULL
           OR v_qual NOT ILIKE '%company_id%'
           OR v_qual NOT ILIKE '%my_company%'
           OR v_qual NOT ILIKE '%is_platform_admin%'
           OR v_qual NOT ILIKE '%is_manager%' THEN
            RAISE EXCEPTION
                'Aislamiento incorrecto en %',
                v_table;
        END IF;

        IF v_qual ILIKE '%OR true%' THEN
            RAISE EXCEPTION
                'Bypass global detectado en %',
                v_table;
        END IF;

        IF (
            SELECT count(*)
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_table
        ) <> 1 THEN
            RAISE EXCEPTION
                'Políticas adicionales detectadas en %',
                v_table;
        END IF;
    END LOOP;

    IF NOT has_table_privilege(
        'service_role',
        'public.company_subscriptions',
        'INSERT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.subscriptions',
        'INSERT'
    ) THEN
        RAISE EXCEPTION
            'Se alteraron permisos de service_role';
    END IF;
END;
$$;

COMMIT;
