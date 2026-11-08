
BEGIN;

-- ============================================================
-- 000024: AISLAMIENTO DE VISITAS Y GPS
-- Administrador central: CRUD solo en su empresa.
-- Gestores: lectura de su propia empresa.
-- Soporte técnico: sin acceso a GPS.
-- ============================================================

DO $$
DECLARE
    v_company_policy boolean;
BEGIN
    IF to_regclass('public.visits') IS NULL THEN
        RAISE EXCEPTION 'No existe public.visits';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.visits'::regclass
          AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'RLS no está habilitado';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'visits'
          AND column_name = 'company_id'
          AND data_type = 'uuid'
    ) THEN
        RAISE EXCEPTION 'company_id UUID no existe';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'visits'
          AND policyname = 'visits_select_managers'
          AND cmd = 'SELECT'
          AND position('current_company_id()' IN coalesce(qual,'')) > 0
          AND position('is_company_manager()' IN coalesce(qual,'')) > 0
    ) THEN
        RAISE EXCEPTION 'Política de lectura de gestores incorrecta';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'visits'
          AND policyname = 'platform_admin_all'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'No existe la política global esperada';
    END IF;

    IF (
        SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'visits'
    ) <> 2 THEN
        RAISE EXCEPTION 'Hay políticas adicionales no auditadas';
    END IF;

    IF to_regprocedure(
        'public._record_visit(uuid,uuid,uuid,text,jsonb)'
    ) IS NULL OR to_regprocedure(
        'public.registrar_visita(uuid,jsonb,uuid,timestamp with time zone)'
    ) IS NULL THEN
        RAISE EXCEPTION 'Faltan funciones de registro';
    END IF;

    IF NOT (
        SELECT prosecdef FROM pg_proc
        WHERE oid = 'public._record_visit(uuid,uuid,uuid,text,jsonb)'::regprocedure
    ) OR NOT (
        SELECT prosecdef FROM pg_proc
        WHERE oid = 'public.registrar_visita(uuid,jsonb,uuid,timestamp with time zone)'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Las funciones deben conservar SECURITY DEFINER';
    END IF;

    IF has_function_privilege(
        'authenticated',
        'public._record_visit(uuid,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ) OR has_function_privilege(
        'anon',
        'public._record_visit(uuid,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'La función interna tiene EXECUTE no autorizado';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.registrar_visita(uuid,jsonb,uuid,timestamp with time zone)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Se perdió EXECUTE de registrar_visita';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.visits'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Falta trigger de protección de suscripción';
    END IF;
END;
$$;

-- Retirar el acceso global.
DROP POLICY platform_admin_all ON public.visits;

-- Administrador central: control total exclusivamente
-- sobre la empresa asociada a su propia sesión.
CREATE POLICY platform_admin_company_all
ON public.visits
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

-- GPS no debe estar disponible para usuarios anónimos.
REVOKE ALL PRIVILEGES ON public.visits FROM anon;

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'visits'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION 'Permanece una política global';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'visits'
          AND policyname = 'platform_admin_company_all'
          AND cmd = 'ALL'
          AND position('is_platform_admin()' IN coalesce(qual,'')) > 0
          AND position('current_company_id()' IN coalesce(qual,'')) > 0
          AND position('is_platform_admin()' IN coalesce(with_check,'')) > 0
          AND position('current_company_id()' IN coalesce(with_check,'')) > 0
    ) THEN
        RAISE EXCEPTION 'No quedó el acceso central limitado a su empresa';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'visits'
          AND policyname = 'visits_select_managers'
    ) THEN
        RAISE EXCEPTION 'Se perdió la lectura de gestores';
    END IF;

    IF (
        SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'visits'
    ) <> 2 THEN
        RAISE EXCEPTION 'Cantidad inesperada de políticas finales';
    END IF;

    IF has_table_privilege('anon','public.visits','SELECT')
       OR has_table_privilege('anon','public.visits','INSERT')
       OR has_table_privilege('anon','public.visits','UPDATE')
       OR has_table_privilege('anon','public.visits','DELETE') THEN
        RAISE EXCEPTION 'anon conserva permisos sobre visits';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.registrar_visita(uuid,jsonb,uuid,timestamp with time zone)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Se perdió la RPC de registro';
    END IF;

    IF has_function_privilege(
        'authenticated',
        'public._record_visit(uuid,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'La función interna quedó expuesta';
    END IF;
END;
$$;

COMMIT;
