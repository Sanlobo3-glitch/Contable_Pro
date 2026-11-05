BEGIN;

-- ============================================================
-- 000016 - AISLAMIENTO Y SEGURIDAD DEL MODULO DE IA
-- Fecha: 2026-11-05
--
-- Administrador central: CRUD dentro de su empresa actual.
-- Usuarios: conservan sus políticas originales.
-- Soporte: sin acceso a consultas ni datos de IA.
-- ai_cache: permanece sin acceso directo de authenticated.
-- anon: sin privilegios en las cinco tablas.
-- ============================================================

-- 1. PREVALIDACIONES

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'ai_cache',
        'ai_company_settings',
        'ai_proposals',
        'ai_queries',
        'ai_usage_daily'
    ]
    LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION 'Falta la tabla public.%', v_table;
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
              AND data_type = 'uuid'
        ) THEN
            RAISE EXCEPTION
                'Falta company_id UUID en public.%', v_table;
        END IF;
    END LOOP;

    IF to_regprocedure('public.is_platform_admin()') IS NULL
       OR to_regprocedure('public.current_company_id()') IS NULL THEN
        RAISE EXCEPTION
            'Faltan funciones de seguridad del administrador central.';
    END IF;

    -- Verificar las políticas normales que deben conservarse.
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'ai_company_settings'
          AND policyname = 'ai_company_settings_select'
          AND cmd = 'SELECT'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'ai_proposals'
          AND policyname = 'ai_proposals_select'
          AND cmd = 'SELECT'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'ai_queries'
          AND policyname = 'ai_queries_select'
          AND cmd = 'SELECT'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'ai_usage_daily'
          AND policyname = 'ai_usage_daily_select'
          AND cmd = 'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Falta alguna política SELECT empresarial original.';
    END IF;
END;
$$;

-- 2. ELIMINAR BYPASS GLOBAL

DROP POLICY IF EXISTS platform_admin_all ON public.ai_cache;
DROP POLICY IF EXISTS platform_admin_all ON public.ai_company_settings;
DROP POLICY IF EXISTS platform_admin_all ON public.ai_proposals;
DROP POLICY IF EXISTS platform_admin_all ON public.ai_queries;
DROP POLICY IF EXISTS platform_admin_all ON public.ai_usage_daily;

-- 3. ADMINISTRADOR CENTRAL: CONFIGURACIÓN DE IA

DROP POLICY IF EXISTS platform_admin_company_all
ON public.ai_company_settings;

CREATE POLICY platform_admin_company_all
ON public.ai_company_settings
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

-- 4. ADMINISTRADOR CENTRAL: PROPUESTAS DE IA

DROP POLICY IF EXISTS platform_admin_company_all
ON public.ai_proposals;

CREATE POLICY platform_admin_company_all
ON public.ai_proposals
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

-- 5. ADMINISTRADOR CENTRAL: CONSULTAS DE IA

DROP POLICY IF EXISTS platform_admin_company_all
ON public.ai_queries;

CREATE POLICY platform_admin_company_all
ON public.ai_queries
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

-- 6. ADMINISTRADOR CENTRAL: USO DIARIO DE IA

DROP POLICY IF EXISTS platform_admin_company_all
ON public.ai_usage_daily;

CREATE POLICY platform_admin_company_all
ON public.ai_usage_daily
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

-- 7. PRIVILEGIOS CRUD PARA AUTHENTICATED
-- RLS sigue determinando qué filas puede modificar cada usuario.

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.ai_company_settings
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.ai_proposals
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.ai_queries
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.ai_usage_daily
TO authenticated;

-- 8. AI_CACHE: CONSERVAR SIN ACCESO DIRECTO
-- No se concede CRUD ni se crea política central para esta tabla.

-- 9. ANON: REVOCAR TODOS LOS PRIVILEGIOS

REVOKE ALL PRIVILEGES ON TABLE public.ai_cache FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.ai_company_settings FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.ai_proposals FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.ai_queries FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.ai_usage_daily FROM anon;

-- 10. VERIFICACIONES FINALES

DO $$
DECLARE
    v_global INTEGER;
    v_admin INTEGER;
    v_original INTEGER;
    v_anon BOOLEAN;
    v_cache BOOLEAN;
    v_rls INTEGER;
BEGIN
    -- No debe quedar ningún bypass global.
    SELECT COUNT(*)
    INTO v_global
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
          'ai_cache',
          'ai_company_settings',
          'ai_proposals',
          'ai_queries',
          'ai_usage_daily'
      )
      AND policyname = 'platform_admin_all';

    IF v_global <> 0 THEN
        RAISE EXCEPTION
            'Persisten % políticas globales de administrador.', v_global;
    END IF;

    -- Deben existir cuatro políticas centrales aisladas.
    SELECT COUNT(*)
    INTO v_admin
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
          'ai_company_settings',
          'ai_proposals',
          'ai_queries',
          'ai_usage_daily'
      )
      AND policyname = 'platform_admin_company_all'
      AND cmd = 'ALL'
      AND qual LIKE '%is_platform_admin()%'
      AND qual LIKE '%current_company_id()%'
      AND with_check LIKE '%is_platform_admin()%'
      AND with_check LIKE '%current_company_id()%';

    IF v_admin <> 4 THEN
        RAISE EXCEPTION
            'Se esperaban 4 políticas centrales aisladas; existen %.',
            v_admin;
    END IF;

    -- Las cuatro políticas originales deben permanecer.
    SELECT COUNT(*)
    INTO v_original
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
          (tablename = 'ai_company_settings'
           AND policyname = 'ai_company_settings_select')
          OR
          (tablename = 'ai_proposals'
           AND policyname = 'ai_proposals_select')
          OR
          (tablename = 'ai_queries'
           AND policyname = 'ai_queries_select')
          OR
          (tablename = 'ai_usage_daily'
           AND policyname = 'ai_usage_daily_select')
      )
      AND cmd = 'SELECT';

    IF v_original <> 4 THEN
        RAISE EXCEPTION
            'No se conservaron las cuatro políticas originales.';
    END IF;

    -- ai_cache no debe tener privilegios directos.
    SELECT
        has_table_privilege('authenticated','public.ai_cache','SELECT')
        OR has_table_privilege('authenticated','public.ai_cache','INSERT')
        OR has_table_privilege('authenticated','public.ai_cache','UPDATE')
        OR has_table_privilege('authenticated','public.ai_cache','DELETE')
    INTO v_cache;

    IF coalesce(v_cache, false) THEN
        RAISE EXCEPTION
            'ai_cache tiene privilegios directos inesperados.';
    END IF;

    -- CRUD debe estar concedido en las cuatro tablas operativas.
    IF NOT (
        has_table_privilege('authenticated','public.ai_company_settings','SELECT')
        AND has_table_privilege('authenticated','public.ai_company_settings','INSERT')
        AND has_table_privilege('authenticated','public.ai_company_settings','UPDATE')
        AND has_table_privilege('authenticated','public.ai_company_settings','DELETE')
        AND has_table_privilege('authenticated','public.ai_proposals','SELECT')
        AND has_table_privilege('authenticated','public.ai_proposals','INSERT')
        AND has_table_privilege('authenticated','public.ai_proposals','UPDATE')
        AND has_table_privilege('authenticated','public.ai_proposals','DELETE')
        AND has_table_privilege('authenticated','public.ai_queries','SELECT')
        AND has_table_privilege('authenticated','public.ai_queries','INSERT')
        AND has_table_privilege('authenticated','public.ai_queries','UPDATE')
        AND has_table_privilege('authenticated','public.ai_queries','DELETE')
        AND has_table_privilege('authenticated','public.ai_usage_daily','SELECT')
        AND has_table_privilege('authenticated','public.ai_usage_daily','INSERT')
        AND has_table_privilege('authenticated','public.ai_usage_daily','UPDATE')
        AND has_table_privilege('authenticated','public.ai_usage_daily','DELETE')
    ) THEN
        RAISE EXCEPTION
            'Faltan privilegios CRUD authenticated en tablas operativas de IA.';
    END IF;

    -- anon no debe conservar privilegios en ninguna tabla.
    SELECT bool_or(
        has_table_privilege('anon','public.' || quote_ident(t.table_name),'SELECT')
        OR has_table_privilege('anon','public.' || quote_ident(t.table_name),'INSERT')
        OR has_table_privilege('anon','public.' || quote_ident(t.table_name),'UPDATE')
        OR has_table_privilege('anon','public.' || quote_ident(t.table_name),'DELETE')
        OR has_table_privilege('anon','public.' || quote_ident(t.table_name),'TRUNCATE')
        OR has_table_privilege('anon','public.' || quote_ident(t.table_name),'REFERENCES')
        OR has_table_privilege('anon','public.' || quote_ident(t.table_name),'TRIGGER')
    )
    INTO v_anon
    FROM (
        VALUES
            ('ai_cache'),
            ('ai_company_settings'),
            ('ai_proposals'),
            ('ai_queries'),
            ('ai_usage_daily')
    ) AS t(table_name);

    IF coalesce(v_anon, false) THEN
        RAISE EXCEPTION
            'anon conserva privilegios en tablas del módulo de IA.';
    END IF;

    -- RLS debe permanecer activo en las cinco tablas.
    SELECT COUNT(*)
    INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
          'ai_cache',
          'ai_company_settings',
          'ai_proposals',
          'ai_queries',
          'ai_usage_daily'
      )
      AND c.relrowsecurity = TRUE;

    IF v_rls <> 5 THEN
        RAISE EXCEPTION
            'RLS no está activo en las cinco tablas de IA.';
    END IF;
END;
$$;

COMMIT;

-- FIN MIGRACION 000016
