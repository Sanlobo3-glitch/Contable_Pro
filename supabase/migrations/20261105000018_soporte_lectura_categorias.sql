
BEGIN;

-- ============================================================
-- 000018: AISLAMIENTO Y SOPORTE TECNICO DE CATEGORIAS
-- Tabla: public.categories
-- Modulo real: categories
-- ============================================================

-- 1. PREVALIDACIONES
DO $$
BEGIN
  IF to_regclass('public.categories') IS NULL THEN
    RAISE EXCEPTION 'No existe public.categories';
  END IF;

  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'No existe la funcion de autorizacion tecnica';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'categories'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no esta habilitado en categories';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'categories'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'categories no tiene company_id UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'categories'
      AND policyname = 'categories_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Falta categories_select';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'categories'
      AND policyname = 'categories_write'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'Falta categories_write';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'categories'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No se encontro platform_admin_all';
  END IF;
END;
$$;

-- 2. ELIMINAR EL BYPASS GLOBAL
DROP POLICY platform_admin_all ON public.categories;

-- 3. LECTURA TECNICA CON AUTORIZACION TEMPORAL
DROP POLICY IF EXISTS support_read_categories
ON public.categories;

CREATE POLICY support_read_categories
ON public.categories
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'categories',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'categories',
    'intervencion_asistida'
  )
);

-- 4. VERIFICACIONES
DO $$
DECLARE
  v_global integer;
  v_support integer;
  v_select integer;
  v_write integer;
  v_anon integer;
BEGIN
  SELECT count(*)
  INTO v_global
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'categories'
    AND policyname = 'platform_admin_all';

  IF v_global <> 0 THEN
    RAISE EXCEPTION 'Permanece el acceso global';
  END IF;

  SELECT count(*)
  INTO v_support
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'categories'
    AND policyname = 'support_read_categories'
    AND cmd = 'SELECT';

  IF v_support <> 1 THEN
    RAISE EXCEPTION 'No se creo correctamente la politica tecnica';
  END IF;

  SELECT count(*)
  INTO v_select
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'categories'
    AND policyname = 'categories_select'
    AND cmd = 'SELECT';

  IF v_select <> 1 THEN
    RAISE EXCEPTION 'Se altero la politica original de lectura';
  END IF;

  SELECT count(*)
  INTO v_write
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'categories'
    AND policyname = 'categories_write'
    AND cmd = 'ALL';

  IF v_write <> 1 THEN
    RAISE EXCEPTION 'Se altero la politica original de escritura';
  END IF;

  SELECT count(*)
  INTO v_anon
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'categories'
    AND grantee = 'anon';

  IF v_anon <> 0 THEN
    RAISE EXCEPTION 'Se detectaron privilegios anon inesperados';
  END IF;
END;
$$;

COMMIT;
