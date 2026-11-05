
BEGIN;

-- =========================================================
-- 000008: SOPORTE TEMPORAL DE LECTURA
-- VENTAS, COMPRAS Y GASTOS
--
-- Requiere la migración 000003.
-- No concede permisos de escritura al equipo técnico.
-- No modifica las RPC operativas.
-- =========================================================

-- 1. PREVALIDACIONES
DO $$
BEGIN
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.purchases') IS NULL
     OR to_regclass('public.expenses') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas operativas requeridas';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'support_has_active_authorization'
      AND pg_get_function_identity_arguments(p.oid) =
          'p_company_id uuid, p_module text, p_scope text'
  ) THEN
    RAISE EXCEPTION
      'Falta public.support_has_active_authorization(uuid,text,text). Aplicar primero 000003';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.sales'::regclass
  ) OR NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.purchases'::regclass
  ) OR NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.expenses'::regclass
  ) THEN
    RAISE EXCEPTION 'RLS debe estar habilitado en las tres tablas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales'
      AND policyname = 'sales_select'
  ) THEN
    RAISE EXCEPTION 'No se encontró la política original sales_select';
  END IF;
END;
$$;

-- 2. VENTAS
DROP POLICY IF EXISTS platform_admin_all ON public.sales;
DROP POLICY IF EXISTS sales_select ON public.sales;

CREATE POLICY sales_select
ON public.sales
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND (
    public.is_manager()
    OR seller_id = (SELECT auth.uid())
  )
);

CREATE POLICY support_sales_select
ON public.sales
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'sales',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'sales',
    'intervencion_asistida'
  )
);

-- 3. COMPRAS
DROP POLICY IF EXISTS platform_admin_all ON public.purchases;

CREATE POLICY support_purchases_select
ON public.purchases
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'purchases',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'purchases',
    'intervencion_asistida'
  )
);

-- 4. GASTOS
DROP POLICY IF EXISTS platform_admin_all ON public.expenses;

CREATE POLICY support_expenses_select
ON public.expenses
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id,
    'expenses',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id,
    'expenses',
    'intervencion_asistida'
  )
);

-- 5. VERIFICACIÓN
DO $$
DECLARE
  v_support_policies integer;
  v_global_policies integer;
  v_sales_qual text;
BEGIN
  SELECT count(*)
  INTO v_support_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'sales' AND policyname = 'support_sales_select')
      OR
      (tablename = 'purchases' AND policyname = 'support_purchases_select')
      OR
      (tablename = 'expenses' AND policyname = 'support_expenses_select')
    );

  IF v_support_policies <> 3 THEN
    RAISE EXCEPTION
      'Verificación fallida: se esperaban 3 políticas de soporte, encontradas %',
      v_support_policies;
  END IF;

  SELECT count(*)
  INTO v_global_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('sales', 'purchases', 'expenses')
    AND policyname = 'platform_admin_all';

  IF v_global_policies <> 0 THEN
    RAISE EXCEPTION
      'Persisten políticas platform_admin_all en ventas/compras/gastos';
  END IF;

  SELECT qual
  INTO v_sales_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'sales'
    AND policyname = 'sales_select';

  IF v_sales_qual ILIKE '%is_platform_admin%' THEN
    RAISE EXCEPTION
      'La política sales_select todavía contiene bypass de administrador global';
  END IF;
END;
$$;

COMMIT;
