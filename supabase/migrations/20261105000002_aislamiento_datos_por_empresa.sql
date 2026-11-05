-- ============================================================
-- INVENTARIO PRO
-- MIGRACION 02A: AISLAMIENTO DE DATOS POR EMPRESA
-- Version corregida: 2026-11-05
--
-- OBJETIVO:
-- 1. Eliminar 59 politicas de acceso global de plataforma.
-- 2. Crear 59 politicas limitadas a la empresa autenticada.
-- 3. Corregir 11 politicas adicionales que permitian
--    acceso mediante is_platform_admin().
--
-- NO MODIFICA:
-- - Datos existentes.
-- - Funciones RPC.
-- - Permisos GRANT.
-- - admin_ejecutar_migracion_sql.
-- - La estructura de las tablas.
--
-- IMPORTANTE:
-- Esta migracion establece aislamiento por empresa.
-- No implementa todavia la matriz completa de permisos
-- por usuario, modulo y operacion.
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_count integer;
    v_table record;
    v_policy_count integer := 0;
    v_company_count integer := 0;
    v_id_count integer := 0;
BEGIN
    -- --------------------------------------------------------
    -- 1. VALIDACIONES PREVIAS
    -- --------------------------------------------------------

    IF to_regprocedure('public.current_company_id()') IS NULL THEN
        RAISE EXCEPTION
            'No existe current_company_id(). Migracion cancelada.';
    END IF;

    IF to_regprocedure('public.my_company()') IS NULL THEN
        RAISE EXCEPTION
            'No existe my_company(). Migracion cancelada.';
    END IF;

    IF to_regprocedure('public._my_role()') IS NULL THEN
        RAISE EXCEPTION
            'No existe _my_role(). Migracion cancelada.';
    END IF;

    -- Deben existir exactamente 59 politicas globales.
    SELECT count(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'platform_admin_all';

    IF v_count <> 59 THEN
        RAISE EXCEPTION
            'Se esperaban 59 politicas platform_admin_all y existen %. Migracion cancelada.',
            v_count;
    END IF;

    -- No permitir duplicados de la politica nueva.
    SELECT count(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'company_scope_access';

    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'Ya existen politicas company_scope_access. Migracion cancelada.';
    END IF;

    -- Deben existir exactamente 11 politicas adicionales
    -- que contienen is_platform_admin().
    SELECT count(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname <> 'platform_admin_all'
      AND (
          coalesce(qual, '') ILIKE '%is_platform_admin%'
          OR coalesce(with_check, '') ILIKE '%is_platform_admin%'
      );

    IF v_count <> 11 THEN
        RAISE EXCEPTION
            'Se esperaban 11 politicas adicionales con is_platform_admin() y existen %. Migracion cancelada.',
            v_count;
    END IF;

    -- Validar que las 11 politicas sean exactamente las
    -- identificadas en la auditoria.
    SELECT count(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
          (tablename = 'audit_log'
           AND policyname = 'audit_log_select')
       OR (tablename = 'cash_closings'
           AND policyname = 'cash_closings_select')
       OR (tablename = 'cash_entries'
           AND policyname = 'cash_entries_insert')
       OR (tablename = 'cash_entries'
           AND policyname = 'cash_entries_select')
       OR (tablename = 'companies'
           AND policyname = 'companies_select')
       OR (tablename = 'company_subscriptions'
           AND policyname = 'company_subscriptions_read')
       OR (tablename = 'devices'
           AND policyname = 'devices_select')
       OR (tablename = 'member_profiles'
           AND policyname = 'member_profiles_select')
       OR (tablename = 'profiles'
           AND policyname = 'profiles_select_company')
       OR (tablename = 'sales'
           AND policyname = 'sales_select')
       OR (tablename = 'subscriptions'
           AND policyname = 'subscriptions_company_read')
      );

    IF v_count <> 11 THEN
        RAISE EXCEPTION
            'No se encontraron las 11 politicas esperadas. Migracion cancelada.';
    END IF;

    -- --------------------------------------------------------
    -- 2. VALIDAR ESTRUCTURA DE LAS 59 TABLAS
    -- --------------------------------------------------------

    FOR v_table IN
        SELECT DISTINCT p.tablename
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.policyname = 'platform_admin_all'
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n
              ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_table.tablename
              AND c.relkind = 'r'
              AND c.relrowsecurity = TRUE
        ) THEN
            RAISE EXCEPTION
                'Tabla inexistente o RLS deshabilitado: %. Migracion cancelada.',
                v_table.tablename;
        END IF;

        IF v_table.tablename = 'companies' THEN

            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'companies'
                  AND column_name = 'id'
                  AND data_type = 'uuid'
            ) THEN
                RAISE EXCEPTION
                    'companies.id no tiene la estructura UUID esperada.';
            END IF;

            v_id_count := v_id_count + 1;

        ELSE

            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = v_table.tablename
                  AND column_name = 'company_id'
                  AND data_type = 'uuid'
            ) THEN
                RAISE EXCEPTION
                    'No se encontro company_id UUID en %. Migracion cancelada.',
                    v_table.tablename;
            END IF;

            v_company_count := v_company_count + 1;

        END IF;
    END LOOP;

    IF v_id_count <> 1 OR v_company_count <> 58 THEN
        RAISE EXCEPTION
            'Distribucion inesperada: companies.id=%, company_id=%.',
            v_id_count,
            v_company_count;
    END IF;

    -- --------------------------------------------------------
    -- 3. ELIMINAR LAS 59 POLITICAS GLOBALES
    -- --------------------------------------------------------

    FOR v_table IN
        SELECT DISTINCT p.tablename
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.policyname = 'platform_admin_all'
        ORDER BY p.tablename
    LOOP

        EXECUTE format(
            'DROP POLICY %I ON public.%I',
            'platform_admin_all',
            v_table.tablename
        );

        IF v_table.tablename = 'companies' THEN

            EXECUTE format(
                'CREATE POLICY %I ON public.%I
                 FOR ALL TO authenticated
                 USING (id = public.current_company_id())
                 WITH CHECK (id = public.current_company_id())',
                'company_scope_access',
                v_table.tablename
            );

        ELSE

            EXECUTE format(
                'CREATE POLICY %I ON public.%I
                 FOR ALL TO authenticated
                 USING (company_id = public.current_company_id())
                 WITH CHECK (company_id = public.current_company_id())',
                'company_scope_access',
                v_table.tablename
            );

        END IF;

        v_policy_count := v_policy_count + 1;

    END LOOP;

    IF v_policy_count <> 59 THEN
        RAISE EXCEPTION
            'Solo se reemplazaron % politicas. Se esperaban 59.',
            v_policy_count;
    END IF;

    -- --------------------------------------------------------
    -- 4. CORREGIR LAS 11 POLITICAS ADICIONALES
    -- --------------------------------------------------------

    -- AUDITORIA: solo dueno y admin_empresa de su empresa.
    ALTER POLICY audit_log_select
    ON public.audit_log
    USING (
        company_id = current_company_id()
        AND _my_role() = ANY (
            ARRAY['dueno'::text, 'admin_empresa'::text]
        )
    );

    -- CIERRES DE CAJA.
    ALTER POLICY cash_closings_select
    ON public.cash_closings
    USING (
        company_id = current_company_id()
        AND _my_role() = ANY (
            ARRAY['dueno'::text, 'admin_empresa'::text]
        )
    );

    -- INSERTAR MOVIMIENTOS DE CAJA.
    ALTER POLICY cash_entries_insert
    ON public.cash_entries
    WITH CHECK (
        company_id = current_company_id()
        AND reference_type IS NULL
        AND reference_id IS NULL
        AND _my_role() = ANY (
            ARRAY['dueno'::text, 'admin_empresa'::text]
        )
    );

    -- CONSULTAR MOVIMIENTOS DE CAJA.
    ALTER POLICY cash_entries_select
    ON public.cash_entries
    USING (
        company_id = current_company_id()
        AND _my_role() = ANY (
            ARRAY['dueno'::text, 'admin_empresa'::text]
        )
    );

    -- EMPRESAS: solo la empresa del usuario.
    ALTER POLICY companies_select
    ON public.companies
    USING (
        id = current_company_id()
    );

    -- SUSCRIPCIONES DE EMPRESA.
    ALTER POLICY company_subscriptions_read
    ON public.company_subscriptions
    USING (
        company_id = my_company()
    );

    -- DISPOSITIVOS: solo gerentes de su empresa.
    ALTER POLICY devices_select
    ON public.devices
    USING (
        company_id = my_company()
        AND is_manager()
    );

    -- PERFILES DE MIEMBROS.
    ALTER POLICY member_profiles_select
    ON public.member_profiles
    USING (
        user_id = auth.uid()
        OR (
            company_id = current_company_id()
            AND is_manager()
        )
    );

    -- PERFILES: el usuario ve el suyo y los gerentes
    -- pueden consultar los perfiles de su empresa.
    ALTER POLICY profiles_select_company
    ON public.profiles
    USING (
        id = auth.uid()
        OR (
            company_id = current_company_id()
            AND is_manager()
        )
    );

    -- VENTAS: gerente de empresa o vendedor propietario.
    ALTER POLICY sales_select
    ON public.sales
    USING (
        company_id = current_company_id()
        AND (
            is_manager()
            OR seller_id = auth.uid()
        )
    );

    -- SUSCRIPCIONES: gerentes de su empresa.
    ALTER POLICY subscriptions_company_read
    ON public.subscriptions
    USING (
        company_id = my_company()
        AND is_manager()
    );

    -- --------------------------------------------------------
    -- 5. VERIFICACIONES FINALES
    -- --------------------------------------------------------

    -- No debe quedar ninguna politica global antigua.
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION
            'Todavia existen politicas platform_admin_all.';
    END IF;

    -- Deben existir exactamente 59 politicas nuevas.
    SELECT count(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'company_scope_access';

    IF v_count <> 59 THEN
        RAISE EXCEPTION
            'Se encontraron % politicas company_scope_access; se esperaban 59.',
            v_count;
    END IF;

    -- Ninguna politica debe conservar el acceso global
    -- mediante is_platform_admin().
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
              coalesce(qual, '') ILIKE '%is_platform_admin%'
              OR coalesce(with_check, '') ILIKE '%is_platform_admin%'
          )
    ) THEN
        RAISE EXCEPTION
            'Quedan politicas con referencias a is_platform_admin().';
    END IF;

END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 02A CORREGIDA
-- ============================================================
