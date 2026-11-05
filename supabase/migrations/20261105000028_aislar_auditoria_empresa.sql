
BEGIN;

-- ============================================================
-- 000028 - AISLAR AUDITORÍA POR EMPRESA
-- ============================================================

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
        RAISE EXCEPTION 'RLS no está habilitado en audit_log';
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

    IF (
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'audit_log'
    ) <> 1 THEN
        RAISE EXCEPTION
            'Hay políticas adicionales no auditadas en audit_log';
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.audit_log',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'authenticated no tiene SELECT sobre audit_log';
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
            'authenticated tiene permisos de escritura inesperados';
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
END;
$$;

-- ============================================================
-- Retirar el bypass del administrador global.
-- Conservar la lectura de auditoría de la propia empresa
-- para dueños y administradores de empresa.
-- ============================================================

DROP POLICY audit_log_select
ON public.audit_log;

CREATE POLICY audit_log_select
ON public.audit_log
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public._my_role() IN ('dueno', 'admin_empresa')
);

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'audit_log'
          AND policyname = 'audit_log_select'
          AND cmd = 'SELECT'
          AND qual =
            '( (company_id = current_company_id()) AND (_my_role() = ANY (ARRAY[''dueno''::text, ''admin_empresa''::text])) )'
    ) THEN
        -- Verificación alternativa normalizada.
        IF NOT EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'audit_log'
              AND policyname = 'audit_log_select'
              AND cmd = 'SELECT'
              AND qual ILIKE '%company_id%'
              AND qual ILIKE '%current_company_id%'
              AND qual ILIKE '%dueno%'
              AND qual ILIKE '%admin_empresa%'
              AND qual NOT ILIKE '%is_platform_admin%'
        ) THEN
            RAISE EXCEPTION
                'La política de auditoría no quedó correctamente aislada';
        END IF;
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.audit_log',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Se perdió el permiso de lectura de auditoría';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.audit_log',
        'INSERT'
    ) THEN
        RAISE EXCEPTION
            'Se perdió el permiso de escritura de service_role';
    END IF;
END;
$$;

COMMIT;
