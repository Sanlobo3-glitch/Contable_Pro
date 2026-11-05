
-- ============================================================================
-- INVENTARIO PRO · MIGRACIÓN 000004
-- Protección de papeles de trabajo del contador
--
-- Elimina el acceso global de soporte técnico y del administrador
-- de plataforma a cpa_working_papers.
-- Conserva los permisos de los roles autorizados dentro de su empresa.
--
-- No modifica funciones contables.
-- No modifica admin_ejecutar_migracion_sql.
-- No concede acceso a soporte técnico mediante autorizaciones temporales.
-- ============================================================================

BEGIN;

-- 1. ASEGURAR RLS
ALTER TABLE public.cpa_working_papers
ENABLE ROW LEVEL SECURITY;

-- 2. REEMPLAZAR LA POLÍTICA ANTERIOR
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
              'dueno',
              'admin_empresa',
              'gerente',
              'contador'
          )
    )
);

-- 3. RESTRINGIR PRIVILEGIOS DE TABLA
REVOKE ALL PRIVILEGES
ON TABLE public.cpa_working_papers
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.cpa_working_papers
TO authenticated;

-- 4. VERIFICACIÓN ESTRUCTURAL
DO $verification$
DECLARE
    v_rls_enabled boolean;
    v_policy_count integer;
    v_policy_qual text;
    v_policy_check text;
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

    SELECT count(*), min(qual), min(with_check)
    INTO v_policy_count, v_policy_qual, v_policy_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cpa_working_papers'
      AND policyname = 'cpa_working_papers_access'
      AND cmd = 'ALL'
      AND roles = ARRAY['authenticated']::name[];

    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION
            'Verificación fallida: política de acceso no encontrada';
    END IF;

    IF v_policy_qual NOT LIKE '%contador%'
       OR v_policy_check NOT LIKE '%contador%' THEN
        RAISE EXCEPTION
            'Verificación fallida: condición de roles incorrecta';
    END IF;

    IF v_policy_qual LIKE '%admin%'
       OR v_policy_check LIKE '%admin%' THEN
        RAISE EXCEPTION
            'Verificación fallida: se detectó un rol administrativo global';
    END IF;
END;
$verification$;

COMMIT;

-- FIN MIGRACIÓN 000004
