
-- ============================================================
-- 000006: SOPORTE TEMPORAL DE SOLO LECTURA - PRODUCTOS
-- Dependencias: migraciones 000003, 000004 y 000005.
-- No concede permisos de escritura al soporte técnico.
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Falta support_has_active_authorization. Aplicar primero la migración 000003.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'products'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado en products.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'categories'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado en categories.';
  END IF;
END;
$$;

-- El administrador de plataforma deja de tener
-- acceso global automático a estas tablas.
DROP POLICY IF EXISTS platform_admin_all
ON public.products;

DROP POLICY IF EXISTS platform_admin_all
ON public.categories;

-- Lectura temporal de productos:
-- solo con autorización activa para el módulo products.
DROP POLICY IF EXISTS support_products_select
ON public.products;

CREATE POLICY support_products_select
ON public.products
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    products.company_id,
    'products',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    products.company_id,
    'products',
    'intervencion_asistida'
  )
);

-- Lectura temporal de categorías:
-- solo con autorización activa para el módulo categories.
DROP POLICY IF EXISTS support_categories_select
ON public.categories;

CREATE POLICY support_categories_select
ON public.categories
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    categories.company_id,
    'categories',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    categories.company_id,
    'categories',
    'intervencion_asistida'
  )
);

-- Verificación de las políticas instaladas.
DO $$
DECLARE
  v_products_policy integer;
  v_categories_policy integer;
  v_global_products integer;
  v_global_categories integer;
BEGIN
  SELECT count(*)
  INTO v_products_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'products'
    AND policyname = 'support_products_select'
    AND cmd = 'SELECT';

  SELECT count(*)
  INTO v_categories_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'categories'
    AND policyname = 'support_categories_select'
    AND cmd = 'SELECT';

  SELECT count(*)
  INTO v_global_products
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'products'
    AND policyname = 'platform_admin_all';

  SELECT count(*)
  INTO v_global_categories
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'categories'
    AND policyname = 'platform_admin_all';

  IF v_products_policy <> 1
     OR v_categories_policy <> 1
     OR v_global_products <> 0
     OR v_global_categories <> 0 THEN
    RAISE EXCEPTION
      'Falló la verificación de las políticas de soporte de productos.';
  END IF;
END;
$$;

COMMIT;
