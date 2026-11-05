-- ============================================================================
-- INVENTARIO PRO · MIGRACIÓN 000005
-- Restricción de acceso a solicitudes de soporte
--
-- El usuario consulta sus solicitudes.
-- Los responsables de empresa consultan las de su empresa.
-- El técnico consulta los casos que tiene asignados.
-- El administrador global conserva la gestión administrativa.
--
-- Las modificaciones se realizan mediante RPC autorizadas.
-- Requiere la migración 000003.
-- No modifica admin_ejecutar_migracion_sql.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ASEGURAR RLS
-- ============================================================================

ALTER TABLE public.support_tickets
ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. ELIMINAR POLÍTICAS ANTERIORES
-- ============================================================================

DROP POLICY IF EXISTS support_tickets_insert
ON public.support_tickets;

DROP POLICY IF EXISTS support_tickets_select
ON public.support_tickets;

DROP POLICY IF EXISTS support_tickets_update
ON public.support_tickets;


-- ============================================================================
-- 3. CONSULTA DE SOLICITUDES
--
-- Usuario: sus propios tickets.
-- Gerencia: tickets de su empresa.
-- Técnico: tickets asignados a su usuario.
-- Administrador global: gestión administrativa.
-- ============================================================================

CREATE POLICY support_tickets_select
ON public.support_tickets
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
    user_id = (SELECT auth.uid())

    OR public.is_platform_admin()

    OR (
        company_id IS NOT NULL
        AND assigned_to = (SELECT auth.uid())
        AND public.is_tech_support()
    )

    OR EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.active = true
          AND p.company_id = support_tickets.company_id
          AND p.role IN (
              'dueno',
              'admin_empresa',
              'gerente'
          )
    )
);


-- ============================================================================
-- 4. CREACIÓN DE SOLICITUDES
--
-- Solo se permite crear solicitudes en nombre del usuario autenticado
-- y dentro de su propia empresa.
-- ============================================================================

CREATE POLICY support_tickets_insert
ON public.support_tickets
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.active = true
          AND (
              p.company_id = support_tickets.company_id
              OR (
                  p.company_id IS NULL
                  AND support_tickets.company_id IS NULL
              )
          )
    )
);


-- ============================================================================
-- 5. PRIVILEGIOS DE TABLA
--
-- Se elimina UPDATE directo.
-- Las operaciones técnicas y de autorización se hacen mediante RPC.
-- ============================================================================

REVOKE ALL PRIVILEGES
ON TABLE public.support_tickets
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT
ON TABLE public.support_tickets
TO authenticated;


-- ============================================================================
-- 6. VERIFICACIÓN ESTRUCTURAL
-- ============================================================================

DO $verification$
DECLARE
    v_rls boolean;
    v_select_count integer;
    v_insert_count integer;
    v_update_count integer;
BEGIN
    SELECT c.relrowsecurity
    INTO v_rls
    FROM pg_class AS c
    JOIN pg_namespace AS n
      ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'support_tickets';

    IF v_rls IS DISTINCT FROM true THEN
        RAISE EXCEPTION
            'Verificación fallida: RLS no está habilitado';
    END IF;

    SELECT count(*)
    INTO v_select_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_tickets'
      AND policyname = 'support_tickets_select'
      AND cmd = 'SELECT';

    SELECT count(*)
    INTO v_insert_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_tickets'
      AND policyname = 'support_tickets_insert'
      AND cmd = 'INSERT';

    SELECT count(*)
    INTO v_update_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_tickets'
      AND cmd = 'UPDATE';

    IF v_select_count <> 1 OR v_insert_count <> 1 THEN
        RAISE EXCEPTION
            'Verificación fallida: políticas de consulta o creación';
    END IF;

    IF v_update_count <> 0 THEN
        RAISE EXCEPTION
            'Verificación fallida: todavía existe una política UPDATE';
    END IF;
END;
$verification$;

COMMIT;

-- FIN MIGRACIÓN 000005
