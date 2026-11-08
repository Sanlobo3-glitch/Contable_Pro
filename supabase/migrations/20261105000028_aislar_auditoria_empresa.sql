BEGIN;

-- ============================================================
-- 000028: AISLAR AUDITORÍA POR EMPRESA
--
-- Administrador central:
--   Lectura únicamente de la auditoría de su empresa.
--
-- Dueño / administrador de empresa:
--   Lectura únicamente de la auditoría de su empresa.
--
-- Sin escritura directa para authenticated.
-- service_role conserva sus permisos.
-- ============================================================

-- 1. PREVALIDACIÓN

DO $$
BEGIN
    IF to_regclass('public.audit_log') IS NULL THEN
        RAISE EXCEPTION 'No existe public.audit_log';
    END IF;

    IF NOT (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.audit_log'::regclass
    ) THEN
        RAISE EXCEPTION 'RLS no está habilitado';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'audit_log'
          AND column_name = 'company_id'
          AND data_type = 'uuid'
    ) THEN
        RAISE EXCEPTION 'audit_log.company_id no es UUID';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'audit_log'
    ) <> 1 THEN
        RAISE EXCEPTION
            'Hay políticas adicionales no auditadas';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'audit_log'
          AND policyname = 'audit_log_select'
          AND cmd = 'SELECT'
    ) THEN
        RAISE EXCEPTION 'No existe audit_log_select';
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.audit_log',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'authenticated no tiene SELECT';
    END IF;

    IF has_table_privilege(
        'authenticated',
        'public.audit_log',
        'INSERT'
    ) OR has_table_privilege(
        'authenticated',
        'public.audit_log',
        'UPDATE'
    ) OR has_table_privilege(
        'authenticated',
        'public.audit_log',
        'DELETE'
    ) THEN
        RAISE EXCEPTION
            'authenticated tiene escritura directa inesperada';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.audit_log',
        'SELECT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.audit_log',
        'INSERT'
    ) THEN
        RAISE EXCEPTION
            'service_role no conserva SELECT e INSERT';
    END IF;

    IF to_regprocedure(
        'public.current_company_id()'
    ) IS NULL
    OR to_regprocedure(
        'public.is_platform_admin()'
    ) IS NULL
    OR to_regprocedure(
        'public._my_role()'
    ) IS NULL THEN
        RAISE EXCEPTION
            'Faltan funciones de autorización';
    END IF;
END;
$$;

-- 2. REEMPLAZAR POLÍTICA

DROP POLICY audit_log_select
ON public.audit_log;

CREATE POLICY audit_log_select
ON public.audit_log
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
    AND (
        public.is_platform_admin()
        OR public._my_role() IN (
            'dueno',
            'admin_empresa'
        )
    )
);

-- 3. VERIFICACIÓN FINAL

DO $$
DECLARE
    v_qual text;
BEGIN
    SELECT qual
    INTO v_qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_select'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[];

    IF v_qual IS NULL THEN
        RAISE EXCEPTION
            'No se encontró la política final';
    END IF;

    IF v_qual NOT ILIKE '%company_id%'
       OR v_qual NOT ILIKE '%current_company_id%'
       OR v_qual NOT ILIKE '%is_platform_admin%'
       OR v_qual NOT ILIKE '%_my_role%'
       OR v_qual NOT ILIKE '%dueno%'
       OR v_qual NOT ILIKE '%admin_empresa%' THEN
        RAISE EXCEPTION
            'La política no conserva el aislamiento esperado';
    END IF;

    IF v_qual ILIKE '%OR true%' THEN
        RAISE EXCEPTION
            'Se detectó una condición global insegura';
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.audit_log',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Se perdió SELECT para authenticated';
    END IF;

    IF has_table_privilege(
        'authenticated',
        'public.audit_log',
        'INSERT'
    ) OR has_table_privilege(
        'authenticated',
        'public.audit_log',
        'UPDATE'
    ) OR has_table_privilege(
        'authenticated',
        'public.audit_log',
        'DELETE'
    ) THEN
        RAISE EXCEPTION
            'authenticated conserva escritura directa';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.audit_log',
        'INSERT'
    ) THEN
        RAISE EXCEPTION
            'service_role perdió INSERT';
    END IF;
END;
$$;

COMMIT;
