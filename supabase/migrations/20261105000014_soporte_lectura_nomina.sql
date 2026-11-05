
-- ============================================================
-- MIGRACION 000014
-- PROTECCION Y SOPORTE DE LECTURA DE NOMINA
--
-- Modulo: sellers (Equipo y nomina)
--
-- - Elimina bypass global de platform_admin_all.
-- - Conserva las politicas normales de empresa.
-- - Habilita lectura temporal de soporte en movimientos y pagos.
-- - No permite escritura al soporte.
-- - Revoca todos los privilegios anon sobre tablas de nomina.
-- - No expone staff_details al equipo de soporte.
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

    IF to_regprocedure(
        'public.support_has_active_authorization(uuid,text,text)'
    ) IS NULL THEN
        RAISE EXCEPTION
            'Migracion cancelada: falta support_has_active_authorization. Aplicar primero 000003.';
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
-- 3. SOPORTE: LECTURA DE MOVIMIENTOS DE NOMINA
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
-- 4. SOPORTE: LECTURA DE PAGOS DE NOMINA
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
-- 5. REVOCAR PRIVILEGIOS ANON
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.payroll_movements
FROM anon;

REVOKE ALL PRIVILEGES
ON TABLE public.payroll_payments
FROM anon;


-- ============================================================
-- 6. VERIFICACIONES FINALES
-- ============================================================

DO $$
DECLARE
    v_global_count INTEGER;
    v_support_count INTEGER;
    v_anon_access BOOLEAN;
BEGIN

    -- No deben quedar politicas globales.
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


    -- Deben existir exactamente dos politicas de soporte.
    SELECT COUNT(*)
    INTO v_support_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
          (tablename = 'payroll_movements'
           AND policyname = 'support_read_payroll_movements')
          OR
          (tablename = 'payroll_payments'
           AND policyname = 'support_read_payroll_payments')
      );

    IF v_support_count <> 2 THEN
        RAISE EXCEPTION
            'Verificacion fallida: se esperaban 2 politicas de soporte y existen %.',
            v_support_count;
    END IF;


    -- anon no debe conservar privilegios sobre movimientos.
    SELECT
        has_table_privilege('anon', 'public.payroll_movements', 'SELECT')
        OR has_table_privilege('anon', 'public.payroll_movements', 'INSERT')
        OR has_table_privilege('anon', 'public.payroll_movements', 'UPDATE')
        OR has_table_privilege('anon', 'public.payroll_movements', 'DELETE')
        OR has_table_privilege('anon', 'public.payroll_movements', 'TRUNCATE')
        OR has_table_privilege('anon', 'public.payroll_movements', 'REFERENCES')
        OR has_table_privilege('anon', 'public.payroll_movements', 'TRIGGER')
        OR has_table_privilege('anon', 'public.payroll_payments', 'SELECT')
        OR has_table_privilege('anon', 'public.payroll_payments', 'INSERT')
        OR has_table_privilege('anon', 'public.payroll_payments', 'UPDATE')
        OR has_table_privilege('anon', 'public.payroll_payments', 'DELETE')
        OR has_table_privilege('anon', 'public.payroll_payments', 'TRUNCATE')
        OR has_table_privilege('anon', 'public.payroll_payments', 'REFERENCES')
        OR has_table_privilege('anon', 'public.payroll_payments', 'TRIGGER')
    INTO v_anon_access;

    IF v_anon_access THEN
        RAISE EXCEPTION
            'Verificacion fallida: anon conserva privilegios sobre tablas de nomina.';
    END IF;


    -- staff_details no debe recibir politicas de soporte.
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


    RAISE NOTICE
        'Migracion 000014 verificada correctamente.';
END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000014
-- ============================================================
