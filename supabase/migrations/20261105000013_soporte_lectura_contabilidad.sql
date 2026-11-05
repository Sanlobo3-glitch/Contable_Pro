
-- ============================================================
-- MIGRACION 000013
-- AISLAMIENTO ADMINISTRATIVO Y SOPORTE DE LECTURA CONTABLE
--
-- Modulo de autorizacion: accounting
--
-- - Elimina politicas administrativas globales.
-- - Da CRUD al administrador central solo en su empresa actual.
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
            RAISE EXCEPTION 'No existe public.%', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_table
              AND c.relrowsecurity = TRUE
        ) THEN
            RAISE EXCEPTION 'RLS no habilitado en public.%', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_table
              AND column_name = 'company_id'
        ) THEN
            RAISE EXCEPTION 'Falta company_id en public.%', v_table;
        END IF;
    END LOOP;

    IF to_regprocedure(
        'public.support_has_active_authorization(uuid,text,text)'
    ) IS NULL THEN
        RAISE EXCEPTION 'Falta support_has_active_authorization. Aplicar 000003.';
    END IF;

    IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
        RAISE EXCEPTION 'Falta is_platform_admin().';
    END IF;

    IF to_regprocedure('public.current_company_id()') IS NULL THEN
        RAISE EXCEPTION 'Falta current_company_id().';
    END IF;
END;
$$;


-- ============================================================
-- 2. ELIMINAR POLITICAS ADMINISTRATIVAS GLOBALES
-- ============================================================

DROP POLICY IF EXISTS platform_admin_all ON public.acc_accounts;
DROP POLICY IF EXISTS platform_admin_all ON public.acc_closings;
DROP POLICY IF EXISTS platform_admin_all ON public.acc_counters;
DROP POLICY IF EXISTS platform_admin_all ON public.acc_entries;
DROP POLICY IF EXISTS platform_admin_all ON public.acc_lines;
DROP POLICY IF EXISTS platform_admin_all ON public.acc_periods;
DROP POLICY IF EXISTS platform_admin_all ON public.acc_settings;


-- ============================================================
-- 3. ADMINISTRADOR CENTRAL: CRUD SOLO EN SU EMPRESA ACTUAL
-- ============================================================

DROP POLICY IF EXISTS platform_admin_company_all ON public.acc_accounts;
CREATE POLICY platform_admin_company_all
ON public.acc_accounts
FOR ALL TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

DROP POLICY IF EXISTS platform_admin_company_all ON public.acc_closings;
CREATE POLICY platform_admin_company_all
ON public.acc_closings
FOR ALL TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

DROP POLICY IF EXISTS platform_admin_company_all ON public.acc_entries;
CREATE POLICY platform_admin_company_all
ON public.acc_entries
FOR ALL TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

DROP POLICY IF EXISTS platform_admin_company_all ON public.acc_lines;
CREATE POLICY platform_admin_company_all
ON public.acc_lines
FOR ALL TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

DROP POLICY IF EXISTS platform_admin_company_all ON public.acc_periods;
CREATE POLICY platform_admin_company_all
ON public.acc_periods
FOR ALL TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);

DROP POLICY IF EXISTS platform_admin_company_all ON public.acc_settings;
CREATE POLICY platform_admin_company_all
ON public.acc_settings
FOR ALL TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = (SELECT public.current_company_id())
);


-- ============================================================
-- 4. SOPORTE: LECTURA TEMPORAL AUTORIZADA
-- ============================================================

DROP POLICY IF EXISTS support_read_acc_accounts ON public.acc_accounts;
CREATE POLICY support_read_acc_accounts
ON public.acc_accounts
FOR SELECT TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'accounting', 'lectura_diagnostico'
    )
    OR public.support_has_active_authorization(
        company_id, 'accounting', 'intervencion_asistida'
    )
);

DROP POLICY IF EXISTS support_read_acc_closings ON public.acc_closings;
CREATE POLICY support_read_acc_closings
ON public.acc_closings
FOR SELECT TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'accounting', 'lectura_diagnostico'
    )
    OR public.support_has_active_authorization(
        company_id, 'accounting', 'intervencion_asistida'
    )
);

DROP POLICY IF EXISTS support_read_acc_entries ON public.acc_entries;
CREATE POLICY support_read_acc_entries
ON public.acc_entries
FOR SELECT TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'accounting', 'lectura_diagnostico'
    )
    OR public.support_has_active_authorization(
        company_id, 'accounting', 'intervencion_asistida'
    )
);

DROP POLICY IF EXISTS support_read_acc_lines ON public.acc_lines;
CREATE POLICY support_read_acc_lines
ON public.acc_lines
FOR SELECT TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'accounting', 'lectura_diagnostico'
    )
    OR public.support_has_active_authorization(
        company_id, 'accounting', 'intervencion_asistida'
    )
);

DROP POLICY IF EXISTS support_read_acc_periods ON public.acc_periods;
CREATE POLICY support_read_acc_periods
ON public.acc_periods
FOR SELECT TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'accounting', 'lectura_diagnostico'
    )
    OR public.support_has_active_authorization(
        company_id, 'accounting', 'intervencion_asistida'
    )
);

DROP POLICY IF EXISTS support_read_acc_settings ON public.acc_settings;
CREATE POLICY support_read_acc_settings
ON public.acc_settings
FOR SELECT TO authenticated
USING (
    public.support_has_active_authorization(
        company_id, 'accounting', 'lectura_diagnostico'
    )
    OR public.support_has_active_authorization(
        company_id, 'accounting', 'intervencion_asistida'
    )
);


-- ============================================================
-- 5. PRIVILEGIOS DIRECTOS
-- ============================================================

-- El administrador central necesita privilegios de tabla
-- para ejercer CRUD; RLS limita las filas a su empresa.

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE
    public.acc_accounts,
    public.acc_closings,
    public.acc_entries,
    public.acc_lines,
    public.acc_periods,
    public.acc_settings
TO authenticated;

-- No conceder privilegios estructurales innecesarios.

REVOKE TRUNCATE, REFERENCES, TRIGGER
ON TABLE
    public.acc_accounts,
    public.acc_closings,
    public.acc_entries,
    public.acc_lines,
    public.acc_periods,
    public.acc_settings
FROM authenticated;

-- No acceso anon directo a las tablas contables.

REVOKE ALL PRIVILEGES
ON TABLE
    public.acc_accounts,
    public.acc_closings,
    public.acc_counters,
    public.acc_entries,
    public.acc_lines,
    public.acc_periods,
    public.acc_settings
FROM anon;

-- acc_counters queda sin acceso directo authenticated.
-- No se modifica el acceso de service_role.

REVOKE ALL PRIVILEGES
ON TABLE public.acc_counters
FROM authenticated;


-- ============================================================
-- 6. VERIFICACIONES FINALES
-- ============================================================

DO $$
DECLARE
    v_count INTEGER;
    v_global_count INTEGER;
    v_grant_count INTEGER;
    v_counter_grants INTEGER;
    v_table TEXT;
BEGIN

    -- No deben quedar politicas administrativas globales.

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
            'Quedan % politicas administrativas globales.',
            v_global_count;
    END IF;


    -- Deben existir seis politicas administrativas por empresa.

    SELECT COUNT(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'platform_admin_company_all'
      AND tablename IN (
          'acc_accounts',
          'acc_closings',
          'acc_entries',
          'acc_lines',
          'acc_periods',
          'acc_settings'
      )
      AND cmd = 'ALL'
      AND qual LIKE '%is_platform_admin()%'
      AND qual LIKE '%current_company_id()%'
      AND with_check LIKE '%is_platform_admin()%'
      AND with_check LIKE '%current_company_id()%';

    IF v_count <> 6 THEN
        RAISE EXCEPTION
            'Se esperaban seis politicas administrativas aisladas; encontradas: %.',
            v_count;
    END IF;


    -- Deben existir seis politicas de soporte SELECT.

    SELECT COUNT(*)
    INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN (
          'support_read_acc_accounts',
          'support_read_acc_closings',
          'support_read_acc_entries',
          'support_read_acc_lines',
          'support_read_acc_periods',
          'support_read_acc_settings'
      )
      AND cmd = 'SELECT';

    IF v_count <> 6 THEN
        RAISE EXCEPTION
            'Se esperaban seis politicas SELECT de soporte; encontradas: %.',
            v_count;
    END IF;


    -- Verificar CRUD authenticated en las seis tablas.

    FOREACH v_table IN ARRAY ARRAY[
        'acc_accounts',
        'acc_closings',
        'acc_entries',
        'acc_lines',
        'acc_periods',
        'acc_settings'
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
                'Faltan privilegios CRUD authenticated en public.%.',
                v_table;
        END IF;
    END LOOP;


    -- acc_counters no debe tener privilegios directos.

    SELECT COUNT(*)
    INTO v_counter_grants
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'acc_counters'
      AND grantee = 'authenticated';

    IF v_counter_grants <> 0 THEN
        RAISE EXCEPTION
            'authenticated conserva privilegios directos sobre acc_counters.';
    END IF;


    -- anon no debe conservar privilegios en las siete tablas.

    SELECT COUNT(*)
    INTO v_grant_count
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (
          'acc_accounts',
          'acc_closings',
          'acc_counters',
          'acc_entries',
          'acc_lines',
          'acc_periods',
          'acc_settings'
      )
      AND grantee = 'anon';

    IF v_grant_count <> 0 THEN
        RAISE EXCEPTION
            'anon conserva % privilegios directos en tablas contables.',
            v_grant_count;
    END IF;


    RAISE NOTICE
        '000013 verificada: CRUD central aislado, soporte SELECT autorizado y acc_counters protegido.';
END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000013
-- ============================================================
