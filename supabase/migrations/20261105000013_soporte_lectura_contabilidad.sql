
-- ============================================================
-- MIGRACION 000013
-- SOPORTE DE LECTURA CONTABLE
--
-- Modulo de autorizacion: accounting
--
-- - Elimina platform_admin_all de las tablas contables.
-- - Conserva las politicas normales de cada empresa.
-- - Agrega lectura temporal para soporte autorizado.
-- - No concede escritura al soporte.
-- - acc_counters permanece sin acceso directo authenticated.
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
        'acc_accounts',
        'acc_closings',
        'acc_counters',
        'acc_entries',
        'acc_lines',
        'acc_periods',
        'acc_settings'
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
            'Migracion cancelada: falta support_has_active_authorization. Aplicar primero 000003.';
    END IF;
END;
$$;


-- ============================================================
-- 2. ELIMINAR POLITICAS GLOBALES
-- ============================================================

DROP POLICY IF EXISTS platform_admin_all
ON public.acc_accounts;

DROP POLICY IF EXISTS platform_admin_all
ON public.acc_closings;

DROP POLICY IF EXISTS platform_admin_all
ON public.acc_counters;

DROP POLICY IF EXISTS platform_admin_all
ON public.acc_entries;

DROP POLICY IF EXISTS platform_admin_all
ON public.acc_lines;

DROP POLICY IF EXISTS platform_admin_all
ON public.acc_periods;

DROP POLICY IF EXISTS platform_admin_all
ON public.acc_settings;


-- ============================================================
-- 3. SOPORTE: LECTURA DE PLAN DE CUENTAS
-- ============================================================

DROP POLICY IF EXISTS support_read_acc_accounts
ON public.acc_accounts;

CREATE POLICY support_read_acc_accounts
ON public.acc_accounts
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 4. SOPORTE: LECTURA DE CIERRES CONTABLES
-- ============================================================

DROP POLICY IF EXISTS support_read_acc_closings
ON public.acc_closings;

CREATE POLICY support_read_acc_closings
ON public.acc_closings
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 5. SOPORTE: LECTURA DE ASIENTOS CONTABLES
-- ============================================================

DROP POLICY IF EXISTS support_read_acc_entries
ON public.acc_entries;

CREATE POLICY support_read_acc_entries
ON public.acc_entries
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 6. SOPORTE: LECTURA DE LINEAS CONTABLES
-- ============================================================

DROP POLICY IF EXISTS support_read_acc_lines
ON public.acc_lines;

CREATE POLICY support_read_acc_lines
ON public.acc_lines
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 7. SOPORTE: LECTURA DE PERIODOS CONTABLES
-- ============================================================

DROP POLICY IF EXISTS support_read_acc_periods
ON public.acc_periods;

CREATE POLICY support_read_acc_periods
ON public.acc_periods
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 8. SOPORTE: LECTURA DE CONFIGURACION CONTABLE
-- ============================================================

DROP POLICY IF EXISTS support_read_acc_settings
ON public.acc_settings;

CREATE POLICY support_read_acc_settings
ON public.acc_settings
FOR SELECT
TO authenticated
USING (
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
        company_id,
        'accounting',
        'intervencion_asistida'
    )
);


-- ============================================================
-- 9. VERIFICACIONES FINALES
-- ============================================================

DO $$
DECLARE
    v_policy_count INTEGER;
    v_global_count INTEGER;
    v_counter_auth_grants INTEGER;
BEGIN

    -- No deben quedar politicas globales en las siete tablas.
    SELECT COUNT(*)
    INTO v_global_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
          'acc_accounts',
          'acc_closings',
          'acc_counters',
          'acc_entries',
          'acc_lines',
          'acc_periods',
          'acc_settings'
      )
      AND policyname = 'platform_admin_all';

    IF v_global_count <> 0 THEN
        RAISE EXCEPTION
            'Verificacion fallida: quedan % politicas globales.',
            v_global_count;
    END IF;


    -- Deben existir exactamente seis politicas de soporte.
    SELECT COUNT(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
          (tablename = 'acc_accounts'
           AND policyname = 'support_read_acc_accounts')
          OR
          (tablename = 'acc_closings'
           AND policyname = 'support_read_acc_closings')
          OR
          (tablename = 'acc_entries'
           AND policyname = 'support_read_acc_entries')
          OR
          (tablename = 'acc_lines'
           AND policyname = 'support_read_acc_lines')
          OR
          (tablename = 'acc_periods'
           AND policyname = 'support_read_acc_periods')
          OR
          (tablename = 'acc_settings'
           AND policyname = 'support_read_acc_settings')
      );

    IF v_policy_count <> 6 THEN
        RAISE EXCEPTION
            'Verificacion fallida: se esperaban 6 politicas de soporte y existen %.',
            v_policy_count;
    END IF;


    -- acc_counters no debe tener privilegios directos
    -- para authenticated.
    SELECT COUNT(*)
    INTO v_counter_auth_grants
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'acc_counters'
      AND grantee = 'authenticated';

    IF v_counter_auth_grants <> 0 THEN
        RAISE EXCEPTION
            'Verificacion fallida: authenticated tiene privilegios directos sobre acc_counters.';
    END IF;


    RAISE NOTICE
        'Migracion 000013 verificada correctamente.';
END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000013
-- ============================================================
