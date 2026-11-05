
BEGIN;

-- ============================================================
-- 000017: AISLAMIENTO DE SUCURSALES Y ACCESO TECNICO AUTORIZADO
-- Tabla: public.branches
-- Modulo real: warehouses
-- ============================================================

-- 1. PREVALIDACIONES
DO $$
BEGIN
  IF to_regclass('public.branches') IS NULL THEN
    RAISE EXCEPTION 'No existe public.branches';
  END IF;

  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'No existe support_has_active_authorization(uuid,text,text)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'branches'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no esta habilitado en branches';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'branches'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'branches no tiene company_id UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
      AND policyname = 'branches_company_access'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No se encontro branches_company_access; se cancela para proteger permisos existentes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No se encontro platform_admin_all; revisar estado antes de continuar';
  END IF;
END;
$$;

-- 2. RETIRAR EL BYPASS GLOBAL DEL ADMINISTRADOR DE PLATAFORMA
DROP POLICY platform_admin_all ON public.branches;

-- 3. ACCESO TECNICO DE SOLO LECTURA
-- La funcion valida empresa, tecnico, modulo, alcance y vigencia.
-- No se agrega company_id=current_company_id() porque el tecnico
-- puede pertenecer a otra empresa y acceder solo mediante autorizacion.

DROP POLICY IF EXISTS support_read_branches ON public.branches;

CREATE POLICY support_read_branches
ON public.branches
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'warehouses',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'warehouses',
    'intervencion_asistida'
  )
);

-- 4. RETIRAR PRIVILEGIOS DIRECTOS DE ANON
-- La aplicacion no necesita acceso anonimo a sucursales.

REVOKE ALL PRIVILEGES
ON TABLE public.branches
FROM anon;

-- 5. VERIFICACIONES FINALES
DO $$
DECLARE
  v_global_count integer;
  v_support_count integer;
  v_tenant_count integer;
  v_anon_count integer;
BEGIN
  SELECT count(*)
  INTO v_global_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'branches'
    AND policyname = 'platform_admin_all';

  IF v_global_count <> 0 THEN
    RAISE EXCEPTION 'Sigue existiendo platform_admin_all en branches';
  END IF;

  SELECT count(*)
  INTO v_support_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'branches'
    AND policyname = 'support_read_branches'
    AND cmd = 'SELECT';

  IF v_support_count <> 1 THEN
    RAISE EXCEPTION 'No se creo correctamente support_read_branches';
  END IF;

  SELECT count(*)
  INTO v_tenant_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'branches'
    AND policyname = 'branches_company_access'
    AND cmd = 'ALL';

  IF v_tenant_count <> 1 THEN
    RAISE EXCEPTION 'La politica original de empresa no se preservo';
  END IF;

  SELECT count(*)
  INTO v_anon_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'branches'
    AND grantee = 'anon';

  IF v_anon_count <> 0 THEN
    RAISE EXCEPTION 'branches conserva privilegios directos para anon';
  END IF;
END;
$$;

COMMIT;
