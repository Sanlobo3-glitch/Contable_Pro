
-- ============================================================
-- INVENTARIO PRO
-- MIGRACION 01: SEPARAR ADMINISTRADOR GLOBAL Y EMPRESARIAL
-- Proyecto: Contable_Pro
-- Fecha: 2026-11-05
--
-- OBJETIVOS:
-- 1. Separar administrador global de administrador empresarial.
-- 2. El rol admin por sí solo no concede acceso global.
-- 3. Conservar la identidad maestra y platform_admins.
-- 4. Proteger la cuenta maestra antes de aplicar cambios.
--
-- NO MODIFICA:
-- - Datos de empresas.
-- - Políticas RLS existentes.
-- - Permisos de tablas.
-- - admin_ejecutar_migracion_sql.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. VALIDACIONES PREVIAS
-- ------------------------------------------------------------

DO $$
BEGIN
    IF to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION 'No existe public.profiles';
    END IF;

    IF to_regclass('public.platform_admins') IS NULL THEN
        RAISE EXCEPTION 'No existe public.platform_admins';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'platform_admins'
          AND column_name = 'user_id'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'platform_admins'
          AND column_name = 'active'
    ) THEN
        RAISE EXCEPTION
            'La estructura de platform_admins no coincide con la esperada';
    END IF;

    -- Debe existir exactamente un administrador global activo.
    IF (
        SELECT count(*)
        FROM public.platform_admins
        WHERE active = TRUE
    ) <> 1 THEN
        RAISE EXCEPTION
            'Cantidad inesperada de administradores globales activos. Migración cancelada';
    END IF;

    -- Debe existir exactamente un perfil activo con rol admin.
    IF (
        SELECT count(*)
        FROM public.profiles
        WHERE active = TRUE
          AND role = 'admin'
    ) <> 1 THEN
        RAISE EXCEPTION
            'Cantidad inesperada de perfiles admin activos. Migración cancelada';
    END IF;

    -- La cuenta maestra debe estar activa en ambos registros
    -- y tener el rol admin.
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.platform_admins pa
          ON pa.user_id = p.id
        WHERE p.active = TRUE
          AND pa.active = TRUE
          AND p.role = 'admin'
          AND lower(btrim(coalesce(p.email, ''))) =
              'sanlobo3@hotmail.com'
    ) THEN
        RAISE EXCEPTION
            'No se pudo validar la cuenta maestra. Migración cancelada';
    END IF;
END;
$$;


-- ------------------------------------------------------------
-- 1. ADMINISTRADOR GLOBAL
-- ------------------------------------------------------------
-- Se elimina la elevación automática por role = admin.
-- Se conserva la identidad maestra y la lista explícita
-- de administradores globales autorizados.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_ok boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    -- Identidad maestra previamente definida.
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = v_uid
          AND p.active = TRUE
          AND lower(btrim(coalesce(p.email, ''))) =
              'sanlobo3@hotmail.com'
    )
    INTO v_ok;

    IF v_ok THEN
        RETURN true;
    END IF;

    -- Administradores globales autorizados expresamente.
    SELECT EXISTS (
        SELECT 1
        FROM public.platform_admins pa
        WHERE pa.user_id = v_uid
          AND pa.active = TRUE
    )
    INTO v_ok;

    RETURN coalesce(v_ok, false);
END;
$function$;


-- ------------------------------------------------------------
-- 2. ADMINISTRADOR EMPRESARIAL
-- ------------------------------------------------------------
-- Solo reconoce roles empresariales asociados a company_id.
-- El rol admin global no se interpreta automáticamente
-- como administrador de una empresa.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_company_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active = TRUE
          AND p.company_id IS NOT NULL
          AND p.role IN (
              'dueno',
              'admin_empresa',
              'gerente'
          )
    );
$function$;


-- ------------------------------------------------------------
-- 3. FUNCIÓN GENERAL DE GERENCIA
-- ------------------------------------------------------------
-- Comprueba exclusivamente privilegios empresariales.
-- No hereda privilegios del administrador global.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT public.is_company_manager();
$function$;


-- ------------------------------------------------------------
-- 4. DOCUMENTACIÓN INTERNA
-- ------------------------------------------------------------

COMMENT ON FUNCTION public.is_platform_admin() IS
'Identifica administradores globales expresamente autorizados. El rol admin por sí solo no concede privilegios globales.';

COMMENT ON FUNCTION public.is_company_manager() IS
'Identifica gerentes empresariales activos con company_id y rol dueno, admin_empresa o gerente.';

COMMENT ON FUNCTION public.is_manager() IS
'Comprueba exclusivamente privilegios de gerencia empresarial. No hereda privilegios globales.';


-- ------------------------------------------------------------
-- 5. VERIFICACIÓN DE DEFINICIONES
-- ------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'is_platform_admin'
          AND p.prosecdef = TRUE
    ) THEN
        RAISE EXCEPTION
            'Falló la verificación de is_platform_admin';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'is_company_manager'
          AND p.prosecdef = TRUE
    ) THEN
        RAISE EXCEPTION
            'Falló la verificación de is_company_manager';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'is_manager'
          AND p.prosecdef = TRUE
    ) THEN
        RAISE EXCEPTION
            'Falló la verificación de is_manager';
    END IF;
END;
$$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 01
-- ============================================================
