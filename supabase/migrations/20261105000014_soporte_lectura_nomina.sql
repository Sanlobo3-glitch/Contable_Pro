-- ============================================================
-- MIGRACION 000014
-- PROTECCION Y SOPORTE DE LECTURA DE NOMINA
-- Fecha: 2026-11-05
--
-- Administrador central: CRUD aislado por empresa.
-- Soporte: lectura temporal autorizada.
-- staff_details: sin acceso de soporte.
-- anon: sin privilegios en las tres tablas.
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
        'payroll_movements',
        'payroll_payments',
        'staff_details'
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
                'Migracion cancelada: RLS no habilitado en public.%',
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

    IF to_regprocedure('public.support_has_active_authorization(uuid,text,text)') IS NULL
       OR to_regprocedure('public.is_platform_admin()') IS NULL
       OR to_regprocedure('public.current_company_id()') IS NULL THEN
        RAISE EXCEPTION
            'Migracion cancelada: faltan funciones de seguridad requeridas.';
    END IF;
END;
$$;


-- ============================================================
-- 2. ELIMINAR BYPASS GLOBAL
-- ============================================================

DROP POLICY IF EXISTS platform_admin_all
ON public.payroll_movements;

DROP POLICY IF EXISTS platform_admin_all
ON public.payroll_payments;

DROP POLICY IF EXISTS platform_admin_all
ON public.staff_details;


-- ============================================================
-- 3. ADMINISTRADOR CENTRAL AISLADO POR EMPRESA
-- ============================================================

DROP POLICY IF EXISTS platform_admin_company_all
ON public.payroll_movements;

CREATE POLICY platform_admin_company_all
ON public.payroll_movements
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
ON public.payroll_payments;

CREATE POLICY platform_admin_company_all
ON public.payroll_payments
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
ON public.staff_details;

CREATE POLICY platform_admin_company_all
ON public.staff_details
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
-- 4. SOPORTE: LECTURA DE MOVIMIENTOS DE NOMINA
-- ============================================================

DROP POLICY IF EXISTS support_read_payroll_movements
ON public.payroll_movements;

CREATE POLICY support_read_payroll_movements
ON public.payroll_movements
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'sellers',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'sellers',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 5. SOPORTE: LECTURA DE PAGOS DE NOMINA
-- ============================================================

DROP POLICY IF EXISTS support_read_payroll_payments
ON public.payroll_payments;

CREATE POLICY support_read_payroll_payments
ON public.payroll_payments
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'sellers',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'sellers',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 6. REVOCAR PRIVILEGIOS ANON EN LAS TRES TABLAS
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.payroll_movements
FROM anon;

REVOKE ALL PRIVILEGES
ON TABLE public.payroll_payments
FROM anon;

REVOKE ALL PRIVILEGES
ON TABLE public.staff_details
FROM anon;


-- ============================================================
-- 7. VERIFICACIONES FINALES
-- ============================================================

DO $$
DECLARE
    v_global_count INTEGER;
    v_admin_count INTEGER;
    v_support_count INTEGER;
    v_anon_access BOOLEAN;
    v_rls_count INTEGER;
BEGIN

    -- No deben quedar bypass globales.
    SELECT COUNT(*)
    INTO v_global_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
          'payroll_movements',
          'payroll_payments',
          'staff_details'
      )
      AND policyname = 'platform_admin_all';

    IF v_global_count <> 0 THEN
        RAISE EXCEPTION
            'Verificacion fallida: quedan % politicas globales.',
            v_global_count;
    END IF;


    -- Deben existir exactamente tres politicas centrales.
    SELECT COUNT(*)
    INTO v_admin_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
          'payroll_movements',
          'payroll_payments',
          'staff_details'
      )
      AND policyname = 'platform_admin_company_all'
      AND cmd = 'ALL'
      AND qual LIKE '%is_platform_admin()%'
      AND qual LIKE '%current_company_id()%'
      AND with_check LIKE '%is_platform_admin()%'
      AND with_check LIKE '%current_company_id()%';

    IF v_admin_count <> 3 THEN
        RAISE EXCEPTION
            'Verificacion fallida: se esperaban 3 politicas centrales aisladas; existen %.',
            v_admin_count;
    END IF;


    -- Deben existir exactamente dos politicas de soporte.
    SELECT COUNT(*)
    INTO v_support_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
          (
              tablename = 'payroll_movements'
              AND policyname = 'support_read_payroll_movements'
              AND cmd = 'SELECT'
          )
          OR
          (
              tablename = 'payroll_payments'
              AND policyname = 'support_read_payroll_payments'
              AND cmd = 'SELECT'
          )
      );

    IF v_support_count <> 2 THEN
        RAISE EXCEPTION
            'Verificacion fallida: se esperaban 2 politicas de soporte; existen %.',
            v_support_count;
    END IF;


    -- staff_details nunca debe tener politica de soporte.
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'staff_details'
          AND policyname LIKE 'support_read_%'
    ) THEN
        RAISE EXCEPTION
            'Verificacion fallida: staff_details tiene una politica de soporte.';
    END IF;


    -- Las tres tablas deben conservar RLS.
    SELECT COUNT(*)
    INTO v_rls_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
          'payroll_movements',
          'payroll_payments',
          'staff_details'
      )
      AND c.relrowsecurity = TRUE;

    IF v_rls_count <> 3 THEN
        RAISE EXCEPTION
            'Verificacion fallida: RLS no esta activo en las tres tablas.';
    END IF;


    -- anon no debe conservar ningun privilegio.
    SELECT
        bool_or(
            has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'SELECT')
            OR has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'INSERT')
            OR has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'UPDATE')
            OR has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'DELETE')
            OR has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'TRUNCATE')
            OR has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'REFERENCES')
            OR has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'TRIGGER')
        )
    INTO v_anon_access
    FROM (
        VALUES
            ('payroll_movements'),
            ('payroll_payments'),
            ('staff_details')
    ) AS t(table_name);

    IF coalesce(v_anon_access, false) THEN
        RAISE EXCEPTION
            'Verificacion fallida: anon conserva privilegios sobre nomina.';
    END IF;


    RAISE NOTICE
        'Migracion 000014 verificada correctamente.';
END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000014
-- ============================================================
