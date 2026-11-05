-- ============================================================================
-- INVENTARIO PRO · MIGRACIÓN 000004
-- Protección de papeles de trabajo del contador
--
-- Elimina el acceso global de soporte técnico a cpa_working_papers.
-- Conserva los permisos de los roles autorizados dentro de su empresa.
--
-- No modifica funciones contables.
-- No modifica admin_ejecutar_migracion_sql.
-- No concede acceso a soporte técnico mediante autorizaciones temporales.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ASEGURAR RLS
-- ============================================================================

ALTER TABLE public.cpa_working_papers
ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. REEMPLAZAR LA POLÍTICA ANTERIOR
--
-- Se elimina is_tech_support().
-- El usuario debe tener perfil activo y pertenecer a la misma empresa.
-- ============================================================================

DROP POLICY IF EXISTS cpa_working_papers_access
ON public.cpa_working_papers;

CREATE POLICY cpa_working_papers_access
ON public.cpa_working_papers
AS PERMISSIVE
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.active = true
          AND p.company_id = cpa_working_papers.company_id
          AND p.role IN (
              'admin',
              'dueno',
              'admin_empresa',
              'gerente',
              'contador'
          )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.active = true
          AND p.company_id = cpa_working_papers.company_id
          AND p.role IN (
              'admin',
              'dueno',
              'admin_empresa',
              'gerente',
              'contador'
          )
    )
);


-- ============================================================================
-- 3. RESTRINGIR PRIVILEGIOS DE TABLA
--
-- anon: sin acceso.
-- authenticated: solo SELECT, INSERT y UPDATE.
-- Se conserva el acceso administrativo interno de PostgreSQL/Supabase.
-- ============================================================================

REVOKE ALL PRIVILEGES
ON TABLE public.cpa_working_papers
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.cpa_working_papers
TO authenticated;


-- ============================================================================
-- 4. VERIFICACIÓN ESTRUCTURAL
-- ============================================================================

DO $verification$
DECLARE
    v_rls_enabled boolean;
    v_policy_count integer;
BEGIN
    SELECT c.relrowsecurity
    INTO v_rls_enabled
    FROM pg_class AS c
    JOIN pg_namespace AS n
      ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'cpa_working_papers';

    IF v_rls_enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION
            'Verificación fallida: RLS no está habilitado';
    END IF;

    SELECT count(*)
    INTO v_policy_count
    FROM pg_policies AS p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'cpa_working_papers'
      AND p.policyname = 'cpa_working_papers_access'
      AND p.cmd = 'ALL'
      AND p.roles = ARRAY['authenticated']::name[];

    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION
            'Verificación fallida: política de acceso no encontrada';
    END IF;
END;
$verification$;

COMMIT;

-- FIN MIGRACIÓN 000004
