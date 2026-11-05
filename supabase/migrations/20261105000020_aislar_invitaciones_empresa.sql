
BEGIN;

-- =====================================================
-- 000020: AISLAR INVITACIONES POR EMPRESA
-- =====================================================

DO $$
BEGIN
  IF to_regclass('public.company_invites') IS NULL THEN
    RAISE EXCEPTION 'No existe public.company_invites';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'company_invites'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado en company_invites';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_invites'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'company_invites no tiene company_id UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_invites'
      AND policyname = 'company_invites_select'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY(roles)
  ) THEN
    RAISE EXCEPTION
      'No existe la política de lectura de gestores';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_invites'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION
      'No existe la política global esperada';
  END IF;
END;
$$;

-- Retirar exclusivamente el acceso global.
DROP POLICY platform_admin_all
ON public.company_invites;

-- =====================================================
-- VERIFICACIONES FINALES
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_invites'
      AND policyname = 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION
      'Sigue existiendo platform_admin_all';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_invites'
      AND policyname = 'company_invites_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'Se perdió la política de lectura de gestores';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_invites'
      AND policyname LIKE 'support_%'
  ) THEN
    RAISE EXCEPTION
      'No debe existir acceso de soporte a invitaciones';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'company_invites'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION
      'La tabla tiene permisos directos para anon';
  END IF;
END;
$$;

COMMIT;
