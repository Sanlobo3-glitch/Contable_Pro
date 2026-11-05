
-- ============================================================
-- INVENTARIO PRO
-- MIGRACION 02A: AISLAMIENTO DE DATOS POR EMPRESA
-- Fecha: 2026-11-05
--
-- OBJETIVO:
-- Sustituir 59 politicas globales por acceso limitado
-- a la empresa del usuario autenticado.
--
-- NO MODIFICA:
-- - Datos existentes.
-- - Funciones RPC.
-- - Permisos GRANT de las tablas.
-- - admin_ejecutar_migracion_sql.
--
-- IMPORTANTE:
-- Esta migracion establece la frontera entre empresas.
-- No sustituye la futura matriz de permisos por rol.
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
    -- 1. Validar funcion de empresa actual.
    IF to_regprocedure('public.current_company_id()') IS NULL THEN
        RAISE EXCEPTION
            'No existe current_company_id(). Migracion cancelada.';
    END IF;

    -- 2. Validar cantidad exacta de politicas esperadas.
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

    -- 3. Validar estructura de las 59 tablas.
    FOR v_table IN
        SELECT DISTINCT p.tablename
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.policyname = 'platform_admin_all'
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
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
            'Distribucion inesperada de tablas: companies.id=%, company_id=%.',
            v_id_count, v_company_count;
    END IF;

    -- 4. Reemplazar las politicas globales.
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

    -- 5. Verificacion final.
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION
            'Todavia existen politicas globales. Migracion cancelada.';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname = 'company_scope_access'
    ) <> 59 THEN
        RAISE EXCEPTION
            'No se encontraron las 59 politicas nuevas.';
    END IF;
END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 02A
-- ============================================================
