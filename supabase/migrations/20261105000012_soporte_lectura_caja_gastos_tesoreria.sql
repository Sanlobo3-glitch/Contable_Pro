
-- ============================================================
-- MIGRACION 000012
-- SOPORTE DE LECTURA: CAJA, CATEGORIAS DE GASTOS Y TESORERIA
--
-- IMPORTANTE:
-- - expenses ya está cubierto por la migración 000008.
-- - No se concede escritura al personal de soporte.
-- - Se conservan las políticas normales de cada empresa.
-- - Se elimina el bypass global de platform_admin_all.
-- - Se revocan los privilegios de anon sobre financial_budgets.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PREFLIGHT: verificar tablas, RLS y función de autorización
-- ============================================================

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'cash_closings',
        'cash_entries',
        'expense_categories',
        'financial_budgets'
    ]
    LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION
                'Migración cancelada: no existe public.%', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_table
              AND c.relrowsecurity = TRUE
        ) THEN
            RAISE EXCEPTION
                'Migración cancelada: RLS no está habilitado en public.%',
                v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_table
              AND column_name = 'company_id'
        ) THEN
            RAISE EXCEPTION
                'Migración cancelada: falta company_id en public.%',
                v_table;
        END IF;
    END LOOP;

    IF to_regprocedure(
        'public.support_has_active_authorization(uuid,text,text)'
    ) IS NULL THEN
        RAISE EXCEPTION
            'Migración cancelada: no existe support_has_active_authorization(uuid,text,text). Debe aplicarse primero la migración 000003.';
    END IF;
END;
$$;


-- ============================================================
-- 2. ELIMINAR BYPASS GLOBAL DE CAJA Y CATEGORIAS DE GASTOS
-- ============================================================

DROP POLICY IF EXISTS platform_admin_all
ON public.cash_closings;

DROP POLICY IF EXISTS platform_admin_all
ON public.cash_entries;

DROP POLICY IF EXISTS platform_admin_all
ON public.expense_categories;


-- ============================================================
-- 3. RECONSTRUIR POLITICAS NORMALES DE CAJA
--    Sin bypass para administradores globales.
-- ============================================================

DROP POLICY IF EXISTS cash_closings_select
ON public.cash_closings;

CREATE POLICY cash_closings_select
ON public.cash_closings
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public._my_role() IN ('dueno', 'admin_empresa')
);


DROP POLICY IF EXISTS cash_entries_select
ON public.cash_entries;

CREATE POLICY cash_entries_select
ON public.cash_entries
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public._my_role() IN ('dueno', 'admin_empresa')
);


DROP POLICY IF EXISTS cash_entries_insert
ON public.cash_entries;

CREATE POLICY cash_entries_insert
ON public.cash_entries
FOR INSERT
TO authenticated
WITH CHECK (
    company_id = public.current_company_id()
    AND reference_type IS NULL
    AND reference_id IS NULL
    AND public._my_role() IN ('dueno', 'admin_empresa')
);


-- ============================================================
-- 4. SOPORTE: LECTURA DE CAJA
--    La función valida empresa, técnico, módulo, alcance y vigencia.
-- ============================================================

DROP POLICY IF EXISTS support_read_cash_closings
ON public.cash_closings;

CREATE POLICY support_read_cash_closings
ON public.cash_closings
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'cash',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'cash',
        'intervencion_asistida'
    )
);


DROP POLICY IF EXISTS support_read_cash_entries
ON public.cash_entries;

CREATE POLICY support_read_cash_entries
ON public.cash_entries
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'cash',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'cash',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 5. SOPORTE: LECTURA DE CATEGORIAS DE GASTOS
--    expenses ya está cubierto por la migración 000008.
-- ============================================================

DROP POLICY IF EXISTS support_read_expense_categories
ON public.expense_categories;

CREATE POLICY support_read_expense_categories
ON public.expense_categories
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'expenses',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'expenses',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 6. SOPORTE: LECTURA DE PRESUPUESTOS FINANCIEROS
--    No se concede INSERT, UPDATE ni DELETE a soporte.
-- ============================================================

DROP POLICY IF EXISTS support_read_financial_budgets
ON public.financial_budgets;

CREATE POLICY support_read_financial_budgets
ON public.financial_budgets
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'treasury',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'treasury',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 7. RESTRINGIR ACCESO ANON A financial_budgets
--    No se modifican los privilegios de authenticated ni
--    service_role.
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.financial_budgets
FROM anon;


-- ============================================================
-- 8. VERIFICACIONES FINALES
-- ============================================================

DO $$
DECLARE
    v_policy_count INTEGER;
    v_anon_access BOOLEAN;
BEGIN

    -- Verificar que no queden bypass globales en estas tablas.
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'cash_closings',
              'cash_entries',
              'expense_categories'
          )
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION
            'Verificación fallida: permanece una política platform_admin_all.';
    END IF;


    -- Verificar las cuatro políticas de soporte creadas.
    SELECT COUNT(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
          (tablename = 'cash_closings'
           AND policyname = 'support_read_cash_closings')
          OR
          (tablename = 'cash_entries'
           AND policyname = 'support_read_cash_entries')
          OR
          (tablename = 'expense_categories'
           AND policyname = 'support_read_expense_categories')
          OR
          (tablename = 'financial_budgets'
           AND policyname = 'support_read_financial_budgets')
      );

    IF v_policy_count <> 4 THEN
        RAISE EXCEPTION
            'Verificación fallida: se esperaban 4 políticas de soporte y se encontraron %.',
            v_policy_count;
    END IF;


    -- Verificar que anon no conserve privilegios sobre financial_budgets.
    SELECT
        has_table_privilege('anon', 'public.financial_budgets', 'SELECT')
        OR has_table_privilege('anon', 'public.financial_budgets', 'INSERT')
        OR has_table_privilege('anon', 'public.financial_budgets', 'UPDATE')
        OR has_table_privilege('anon', 'public.financial_budgets', 'DELETE')
        OR has_table_privilege('anon', 'public.financial_budgets', 'TRUNCATE')
        OR has_table_privilege('anon', 'public.financial_budgets', 'REFERENCES')
        OR has_table_privilege('anon', 'public.financial_budgets', 'TRIGGER')
    INTO v_anon_access;

    IF v_anon_access THEN
        RAISE EXCEPTION
            'Verificación fallida: anon conserva privilegios sobre financial_budgets.';
    END IF;

    RAISE NOTICE
        'Migración 000012 verificada correctamente.';
END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000012
-- ============================================================
