-- ============================================================
-- MIGRACION 000012
-- SOPORTE DE LECTURA: CAJA, CATEGORIAS DE GASTOS Y TESORERIA
--
-- ADMINISTRADOR CENTRAL:
-- - CRUD completo dentro de su propia empresa.
-- - Sin acceso operativo global a otras empresas.
--
-- SOPORTE:
-- - Solo SELECT con autorizacion temporal y vigente.
-- - Sin escritura directa.
--
-- SEGURIDAD:
-- - RLS obligatorio.
-- - Aislamiento por company_id.
-- - Revocacion de privilegios anon en financial_budgets.
-- - Sin privilegios innecesarios de TRUNCATE, REFERENCES
--   ni TRIGGER para authenticated.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PREFLIGHT
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
                'Migracion cancelada: no existe public.%',
                v_table;
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
                'Migracion cancelada: RLS no esta habilitado en public.%',
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
                'Migracion cancelada: falta company_id en public.%',
                v_table;
        END IF;
    END LOOP;

    IF to_regprocedure(
        'public.support_has_active_authorization(uuid,text,text)'
    ) IS NULL THEN
        RAISE EXCEPTION
            'Falta support_has_active_authorization. Aplicar primero la migracion 000003.';
    END IF;

    IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
        RAISE EXCEPTION
            'No existe public.is_platform_admin().';
    END IF;

    IF to_regprocedure('public.current_company_id()') IS NULL THEN
        RAISE EXCEPTION
            'No existe public.current_company_id().';
    END IF;
END;
$$;


-- ============================================================
-- 2. ELIMINAR POLITICAS ADMINISTRATIVAS GLOBALES
-- ============================================================

DROP POLICY IF EXISTS platform_admin_all
ON public.cash_closings;

DROP POLICY IF EXISTS platform_admin_all
ON public.cash_entries;

DROP POLICY IF EXISTS platform_admin_all
ON public.expense_categories;

DROP POLICY IF EXISTS platform_admin_all
ON public.financial_budgets;


-- ============================================================
-- 3. ADMINISTRADOR CENTRAL
-- CRUD SOLO DENTRO DE SU EMPRESA ACTUAL
--
-- La condicion se aplica tanto a USING como a WITH CHECK.
-- Esto impide consultar, modificar, insertar o trasladar
-- registros hacia empresas ajenas.
-- ============================================================

DROP POLICY IF EXISTS platform_admin_company_all
ON public.cash_closings;

CREATE POLICY platform_admin_company_all
ON public.cash_closings
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);


DROP POLICY IF EXISTS platform_admin_company_all
ON public.cash_entries;

CREATE POLICY platform_admin_company_all
ON public.cash_entries
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);


DROP POLICY IF EXISTS platform_admin_company_all
ON public.expense_categories;

CREATE POLICY platform_admin_company_all
ON public.expense_categories
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);


DROP POLICY IF EXISTS platform_admin_company_all
ON public.financial_budgets;

CREATE POLICY platform_admin_company_all
ON public.financial_budgets
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);


-- ============================================================
-- 4. POLITICAS NORMALES DE CAJA
-- Se conservan las restricciones funcionales de la empresa.
-- El administrador central dispone adicionalmente de su
-- politica company-scoped anterior.
-- ============================================================

DROP POLICY IF EXISTS cash_closings_select
ON public.cash_closings;

CREATE POLICY cash_closings_select
ON public.cash_closings
FOR SELECT
TO authenticated
USING (
    company_id = (SELECT public.current_company_id())
    AND public._my_role() IN ('dueno', 'admin_empresa')
);


DROP POLICY IF EXISTS cash_entries_select
ON public.cash_entries;

CREATE POLICY cash_entries_select
ON public.cash_entries
FOR SELECT
TO authenticated
USING (
    company_id = (SELECT public.current_company_id())
    AND public._my_role() IN ('dueno', 'admin_empresa')
);


DROP POLICY IF EXISTS cash_entries_insert
ON public.cash_entries;

CREATE POLICY cash_entries_insert
ON public.cash_entries
FOR INSERT
TO authenticated
WITH CHECK (
    company_id = (SELECT public.current_company_id())
    AND reference_type IS NULL
    AND reference_id IS NULL
    AND public._my_role() IN ('dueno', 'admin_empresa')
);


-- ============================================================
-- 5. SOPORTE: LECTURA DE CIERRES DE CAJA
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


-- ============================================================
-- 6. SOPORTE: LECTURA DE MOVIMIENTOS DE CAJA
-- ============================================================

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
-- 7. SOPORTE: LECTURA DE CATEGORIAS DE GASTOS
-- expenses ya esta cubierto por la migracion 000008.
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
-- 8. SOPORTE: LECTURA DE PRESUPUESTOS FINANCIEROS
-- No se concede escritura al personal de soporte.
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
-- 9. PRIVILEGIOS DE TABLA
--
-- RLS sigue siendo el control de acceso a las filas.
-- Los GRANT no sustituyen las politicas.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.cash_closings
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.cash_entries
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.expense_categories
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.financial_budgets
TO authenticated;


-- Eliminar privilegios de tabla innecesarios.
REVOKE TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.cash_closings,
          public.cash_entries,
          public.expense_categories,
          public.financial_budgets
FROM authenticated;


-- ============================================================
-- 10. REVOCAR ACCESO ANON A TESORERIA
-- No se modifican privilegios de service_role.
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.financial_budgets
FROM anon;


-- ============================================================
-- 11. VERIFICACIONES FINALES
-- ============================================================

DO $$
DECLARE
    v_count INTEGER;
    v_anon_access BOOLEAN;
    v_table TEXT;
BEGIN

    -- --------------------------------------------------------
    -- A. No debe quedar ninguna politica administrativa global.
    -- --------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'cash_closings',
              'cash_entries',
              'expense_categories',
              'financial_budgets'
          )
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION
            'Fallo: permanece una politica platform_admin_all.';
    END IF;


    -- --------------------------------------------------------
    -- B. Deben existir cuatro politicas centrales.
    -- --------------------------------------------------------

    SELECT COUNT(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
          'cash_closings',
          'cash_entries',
          'expense_categories',
          'financial_budgets'
      )
      AND policyname = 'platform_admin_company_all'
      AND cmd = 'ALL'
      AND qual ILIKE '%is_platform_admin%'
      AND qual ILIKE '%company_id%'
      AND with_check ILIKE '%is_platform_admin%'
      AND with_check ILIKE '%company_id%';

    IF v_count <> 4 THEN
        RAISE EXCEPTION
            'Fallo: se esperaban 4 politicas centrales aisladas por empresa; encontradas: %.',
            v_count;
    END IF;


    -- --------------------------------------------------------
    -- C. Deben existir cuatro politicas de soporte SELECT.
    -- --------------------------------------------------------

    SELECT COUNT(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'SELECT'
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

    IF v_count <> 4 THEN
        RAISE EXCEPTION
            'Fallo: se esperaban 4 politicas SELECT de soporte; encontradas: %.',
            v_count;
    END IF;


    -- --------------------------------------------------------
    -- D. authenticated debe disponer de CRUD en las cuatro.
    -- --------------------------------------------------------

    FOREACH v_table IN ARRAY ARRAY[
        'cash_closings',
        'cash_entries',
        'expense_categories',
        'financial_budgets'
    ]
    LOOP
        IF NOT has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'SELECT'
        ) OR NOT has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'INSERT'
        ) OR NOT has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'UPDATE'
        ) OR NOT has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'DELETE'
        ) THEN
            RAISE EXCEPTION
                'Fallo: authenticated no tiene CRUD completo en public.%.',
                v_table;
        END IF;

        IF has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'TRUNCATE'
        ) OR has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'REFERENCES'
        ) OR has_table_privilege(
            'authenticated',
            'public.' || v_table,
            'TRIGGER'
        ) THEN
            RAISE EXCEPTION
                'Fallo: authenticated conserva privilegios innecesarios en public.%.',
                v_table;
        END IF;
    END LOOP;


    -- --------------------------------------------------------
    -- E. anon no debe conservar privilegios en financial_budgets.
    -- --------------------------------------------------------

    SELECT
        has_table_privilege(
            'anon',
            'public.financial_budgets',
            'SELECT'
        )
        OR has_table_privilege(
            'anon',
            'public.financial_budgets',
            'INSERT'
        )
        OR has_table_privilege(
            'anon',
            'public.financial_budgets',
            'UPDATE'
        )
        OR has_table_privilege(
            'anon',
            'public.financial_budgets',
            'DELETE'
        )
        OR has_table_privilege(
            'anon',
            'public.financial_budgets',
            'TRUNCATE'
        )
        OR has_table_privilege(
            'anon',
            'public.financial_budgets',
            'REFERENCES'
        )
        OR has_table_privilege(
            'anon',
            'public.financial_budgets',
            'TRIGGER'
        )
    INTO v_anon_access;

    IF v_anon_access THEN
        RAISE EXCEPTION
            'Fallo: anon conserva privilegios sobre financial_budgets.';
    END IF;


    -- --------------------------------------------------------
    -- F. RLS debe permanecer habilitado en las cuatro tablas.
    -- --------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
              'cash_closings',
              'cash_entries',
              'expense_categories',
              'financial_budgets'
          )
          AND c.relrowsecurity IS NOT TRUE
    ) THEN
        RAISE EXCEPTION
            'Fallo: RLS no esta habilitado en una o mas tablas.';
    END IF;


    RAISE NOTICE
        'Migracion 000012 verificada: 4 politicas centrales aisladas, 4 politicas de soporte SELECT, CRUD authenticated y anon revocado en financial_budgets.';

END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000012
-- ============================================================
