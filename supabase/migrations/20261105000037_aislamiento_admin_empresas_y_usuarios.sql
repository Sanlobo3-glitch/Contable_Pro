-- ============================================================
-- 000037: AISLAMIENTO ADMINISTRATIVO DE EMPRESAS Y USUARIOS
--
-- 1. El administrador central solo puede actualizar su empresa.
-- 2. No se habilita INSERT ni DELETE directo sobre companies.
-- 3. El RPC de usuarios devuelve únicamente los usuarios
--    de la empresa vinculada al perfil del administrador.
-- 4. Se conservan SECURITY DEFINER y la estructura JSON.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. ACTUALIZACIÓN AISLADA DE LA EMPRESA PROPIA
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_company_update
ON public.companies;

CREATE POLICY platform_admin_company_update
ON public.companies
FOR UPDATE
TO authenticated
USING (
    public.is_platform_admin()
    AND id = public.current_company_id()
)
WITH CHECK (
    public.is_platform_admin()
    AND id = public.current_company_id()
);

-- El alta automática continúa a cargo de handle_new_user()
-- (SECURITY DEFINER). No se permite INSERT/DELETE directo.
REVOKE INSERT, DELETE
ON TABLE public.companies
FROM authenticated;

GRANT SELECT, UPDATE
ON TABLE public.companies
TO authenticated;

-- ------------------------------------------------------------
-- 2. LIMITAR EL RPC DE USUARIOS A LA EMPRESA PROPIA
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_listar_usuarios_completo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_res jsonb;
    v_company_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'No autorizado'
            USING ERRCODE = '42501';
    END IF;

    PERFORM public.assert_platform_admin();

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION
            'El administrador no tiene empresa vinculada';
    END IF;

    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', p.id,
                'email', p.email,
                'full_name', coalesce(p.full_name, ''),
                'role', p.role,
                'active', p.active,
                'created_at', p.created_at,
                'company_id', p.company_id,
                'company_name',
                    coalesce(
                        nullif(btrim(cc.name), ''),
                        c.name,
                        'Empresa ' || substr(
                            coalesce(p.company_id::text, '000000'),
                            1,
                            6
                        )
                    ),
                'trial_start',
                    CASE
                        WHEN coalesce(pa.active, false)
                        THEN NULL
                        ELSE cs.trial_start
                    END,
                'trial_end',
                    CASE
                        WHEN coalesce(pa.active, false)
                        THEN NULL
                        ELSE cs.trial_end
                    END,
                'subscription_status',
                    CASE
                        WHEN coalesce(pa.active, false)
                        THEN 'independent'
                        ELSE cs.status
                    END,
                'subscription_end',
                    CASE
                        WHEN coalesce(pa.active, false)
                        THEN NULL
                        ELSE cs.subscription_end
                    END,
                'paypal_order_id', p.paypal_order_id,
                'plan_type',
                    CASE
                        WHEN coalesce(pa.active, false)
                        THEN NULL
                        ELSE cs.plan_type
                    END,
                'platform_admin', coalesce(pa.active, false),
                'avatar_url', mp.avatar_url,
                'national_id', mp.national_id,
                'phone', mp.phone,
                'job_title', mp.job_title,
                'zone', mp.zone,
                'address', mp.address,
                'emergency_contact', mp.emergency_contact,
                'hire_date', mp.hire_date,
                'base_salary', coalesce(mp.base_salary, 0),
                'commission_pct', coalesce(mp.commission_pct, 0),
                'notes', mp.notes,
                'archived', coalesce(mp.archived, false)
            )
            ORDER BY
                coalesce(mp.archived, false) ASC,
                p.created_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_res
    FROM public.profiles p
    LEFT JOIN public.companies c
        ON c.id = p.company_id
    LEFT JOIN public.company_config cc
        ON cc.company_id = p.company_id
    LEFT JOIN public.company_subscriptions cs
        ON cs.company_id = p.company_id
    LEFT JOIN public.platform_admins pa
        ON pa.user_id = p.id
       AND pa.active = true
    LEFT JOIN public.member_profiles mp
        ON mp.user_id = p.id
    WHERE p.company_id = v_company_id;

    RETURN v_res;
END;
$function$;

-- El RPC solo queda disponible para sesiones autenticadas.
REVOKE ALL PRIVILEGES
ON FUNCTION public.admin_listar_usuarios_completo()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_listar_usuarios_completo()
TO authenticated;

-- ------------------------------------------------------------
-- 3. VALIDACIONES OBLIGATORIAS
-- ------------------------------------------------------------

DO $$
DECLARE
    v_definition text;
    v_policy record;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE oid = 'public.companies'::regclass
          AND relrowsecurity = true
    ) THEN
        RAISE EXCEPTION
            'RLS no está habilitado en companies';
    END IF;

    SELECT cmd, qual, with_check
    INTO v_policy
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies'
      AND policyname = 'platform_admin_company_update';

    IF NOT FOUND
       OR v_policy.cmd <> 'UPDATE'
       OR v_policy.qual NOT LIKE '%is_platform_admin()%'
       OR v_policy.qual NOT LIKE '%current_company_id()%'
       OR v_policy.with_check NOT LIKE '%is_platform_admin()%'
       OR v_policy.with_check NOT LIKE '%current_company_id()%' THEN
        RAISE EXCEPTION
            'La política UPDATE de companies no está aislada';
    END IF;

    IF has_table_privilege(
        'authenticated',
        'public.companies',
        'INSERT'
    ) OR has_table_privilege(
        'authenticated',
        'public.companies',
        'DELETE'
    ) THEN
        RAISE EXCEPTION
            'authenticated conserva INSERT o DELETE directo en companies';
    END IF;

    IF NOT has_table_privilege(
        'authenticated',
        'public.companies',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION
            'Falta UPDATE para authenticated en companies';
    END IF;

    SELECT lower(pg_get_functiondef(
        'public.admin_listar_usuarios_completo()'::regprocedure
    ))
    INTO v_definition;

    IF position('assert_platform_admin' IN v_definition) = 0
       OR position('current_company_id' IN v_definition) = 0
       OR position('where p.company_id = v_company_id' IN v_definition) = 0 THEN
        RAISE EXCEPTION
            'El RPC de usuarios no quedó limitado a la empresa propia';
    END IF;

    IF NOT (
        SELECT prosecdef
        FROM pg_proc
        WHERE oid =
            'public.admin_listar_usuarios_completo()'::regprocedure
    ) THEN
        RAISE EXCEPTION
            'Se perdió SECURITY DEFINER en el RPC';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.admin_listar_usuarios_completo()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'authenticated no tiene EXECUTE en el RPC';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.admin_listar_usuarios_completo()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'anon conserva EXECUTE en el RPC';
    END IF;
END;
$$;

COMMIT;
