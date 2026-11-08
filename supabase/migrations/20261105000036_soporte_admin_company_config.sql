
-- ============================================================
-- 000036: ACCESO ADMINISTRATIVO AISLADO A COMPANY_CONFIG
--
-- El administrador central obtiene control CRUD únicamente
-- sobre la empresa vinculada a su perfil.
--
-- Se conservan las políticas de los usuarios de empresa.
-- No se habilita acceso global ni acceso técnico de soporte.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS platform_admin_company_config_all
ON public.company_config;

CREATE POLICY platform_admin_company_config_all
ON public.company_config
FOR ALL
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

DO $$
DECLARE
    v_rls boolean;
    v_policy record;
BEGIN
    SELECT relrowsecurity
    INTO v_rls
    FROM pg_class
    WHERE oid = 'public.company_config'::regclass;

    IF v_rls IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'RLS no está habilitado en company_config';
    END IF;

    SELECT cmd, qual, with_check
    INTO v_policy
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_config'
      AND policyname = 'platform_admin_company_config_all';

    IF NOT FOUND
       OR v_policy.cmd <> 'ALL'
       OR v_policy.qual NOT LIKE '%current_company_id()%'
       OR v_policy.with_check NOT LIKE '%current_company_id()%'
       OR v_policy.qual NOT LIKE '%is_platform_admin()%'
       OR v_policy.with_check NOT LIKE '%is_platform_admin()%' THEN
        RAISE EXCEPTION
            'La política administrativa no cumple el aislamiento requerido';
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.company_config',
        'SELECT'
    ) OR NOT has_table_privilege(
        'authenticated',
        'public.company_config',
        'INSERT'
    ) OR NOT has_table_privilege(
        'authenticated',
        'public.company_config',
        'UPDATE'
    ) OR NOT has_table_privilege(
        'authenticated',
        'public.company_config',
        'DELETE'
    ) THEN
        RAISE EXCEPTION
            'Faltan permisos SQL CRUD en company_config';
    END IF;
END;
$$;

COMMIT;
