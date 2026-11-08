
BEGIN;

-- ============================================================
-- 000023: PROTEGER DATOS PERSONALES DEL PERSONAL
-- Administrador central: CRUD solo en su empresa activa.
-- Responsables: acceso mediante RPC con validación empresarial.
-- No modifica funciones ni trigger de suscripción.
-- ============================================================

DO $$
DECLARE
    v_policy record;
BEGIN
    IF to_regclass('public.staff_details') IS NULL THEN
        RAISE EXCEPTION 'No existe public.staff_details';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff_details'
          AND column_name = 'company_id'
    ) THEN
        RAISE EXCEPTION 'staff_details no tiene company_id';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE oid = 'public.staff_details'::regclass
          AND relrowsecurity = TRUE
    ) THEN
        RAISE EXCEPTION 'RLS no está habilitado';
    END IF;

    -- Debe existir exactamente la política scoped vigente.
    IF (
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'staff_details'
    ) <> 1 THEN
        RAISE EXCEPTION
          'Cantidad inesperada de políticas en staff_details';
    END IF;

    SELECT *
    INTO v_policy
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff_details'
      AND policyname = 'platform_admin_company_all';

    IF NOT FOUND
       OR v_policy.cmd <> 'ALL'
       OR NOT ('authenticated' = ANY(v_policy.roles))
       OR position(
           'is_platform_admin()'
           IN coalesce(v_policy.qual, '')
       ) = 0
       OR position(
           'current_company_id()'
           IN coalesce(v_policy.qual, '')
       ) = 0
       OR position(
           'is_platform_admin()'
           IN coalesce(v_policy.with_check, '')
       ) = 0
       OR position(
           'current_company_id()'
           IN coalesce(v_policy.with_check, '')
       ) = 0 THEN
        RAISE EXCEPTION
          'La política del administrador no garantiza aislamiento empresarial';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'staff_details'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION 'Se detectó una política global insegura';
    END IF;

    -- Las RPC autorizadas deben existir y ser SECURITY DEFINER.
    IF to_regprocedure('public.list_team()') IS NULL
       OR to_regprocedure(
          'public.save_staff_details(uuid,text,text,text,text,text)'
       ) IS NULL THEN
        RAISE EXCEPTION 'Faltan las funciones autorizadas';
    END IF;

    IF NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = 'public.list_team()'::regprocedure
    ) OR NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid =
          'public.save_staff_details(uuid,text,text,text,text,text)'::regprocedure
    ) THEN
        RAISE EXCEPTION
          'Las funciones deben conservar SECURITY DEFINER';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.list_team()',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated',
        'public.save_staff_details(uuid,text,text,text,text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
          'authenticated necesita EXECUTE en las RPC';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.staff_details'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
          'No existe el trigger de protección de suscripción';
    END IF;
END;
$$;

-- ============================================================
-- PRIVILEGIOS
-- Se retiran privilegios heredados y se conceden solo CRUD.
-- La política RLS limita ese CRUD al administrador central
-- dentro de la empresa asociada a su propia sesión.
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.staff_details
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.staff_details
TO authenticated;

-- No se modifica:
-- platform_admin_company_all
-- list_team()
-- save_staff_details()
-- trg_company_subscription_guard

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'staff_details'
          AND policyname = 'platform_admin_all'
    ) THEN
        RAISE EXCEPTION 'Existe una política global';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'staff_details'
          AND policyname = 'platform_admin_company_all'
          AND cmd = 'ALL'
    ) THEN
        RAISE EXCEPTION 'Se perdió la política scoped';
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.staff_details',
        'SELECT, INSERT, UPDATE, DELETE'
    ) THEN
        RAISE EXCEPTION 'Faltan privilegios CRUD para authenticated';
    END IF;

    IF has_table_privilege(
        'anon',
        'public.staff_details',
        'SELECT'
    ) OR has_table_privilege(
        'anon',
        'public.staff_details',
        'INSERT'
    ) OR has_table_privilege(
        'anon',
        'public.staff_details',
        'UPDATE'
    ) OR has_table_privilege(
        'anon',
        'public.staff_details',
        'DELETE'
    ) THEN
        RAISE EXCEPTION 'anon conserva permisos sobre datos personales';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.list_team()',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated',
        'public.save_staff_details(uuid,text,text,text,text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Se perdió el acceso a las RPC';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.staff_details'::regclass
          AND tgname = 'trg_company_subscription_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Se perdió el trigger de suscripción';
    END IF;
END;
$$;

COMMIT;
