
BEGIN;

-- =========================================================
-- 000008
-- AISLAMIENTO Y SOPORTE DE VENTAS, COMPRAS Y GASTOS
--
-- Administrador central:
-- Control total exclusivamente sobre su empresa vinculada.
--
-- Usuarios empresariales:
-- Conservan sus permisos de lectura originales.
--
-- Soporte:
-- Lectura temporal con autorización por empresa, módulo
-- y alcance.
--
-- No se concede acceso operativo global.
-- No se modifican RPC operativas.
-- =========================================================

-- 1. PREVALIDACIONES
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['sales', 'purchases', 'expenses']
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Falta la tabla public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class
      WHERE oid = to_regclass('public.' || v_table)
        AND relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'RLS no está habilitado en %', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'Falta company_id en %', v_table;
    END IF;
  END LOOP;

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
      'Falta support_has_active_authorization. Aplicar primero 000003';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales'
      AND policyname = 'sales_select'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchases'
      AND policyname = 'purchases_select'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'expenses_select'
  ) THEN
    RAISE EXCEPTION
      'No se encontraron las políticas SELECT originales';
  END IF;
END;
$$;

-- 2. VENTAS
DROP POLICY IF EXISTS platform_admin_all ON public.sales;
DROP POLICY IF EXISTS platform_admin_company_all ON public.sales;
DROP POLICY IF EXISTS sales_select ON public.sales;
DROP POLICY IF EXISTS support_sales_select ON public.sales;

-- Control total del administrador central,
-- únicamente dentro de su empresa vinculada.
CREATE POLICY platform_admin_company_all
ON public.sales
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

-- Lectura empresarial normal, sin bypass global.
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

-- Lectura temporal de soporte.
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
DROP POLICY IF EXISTS platform_admin_company_all ON public.purchases;
DROP POLICY IF EXISTS purchases_select ON public.purchases;
DROP POLICY IF EXISTS support_purchases_select ON public.purchases;

CREATE POLICY platform_admin_company_all
ON public.purchases
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

CREATE POLICY purchases_select
ON public.purchases
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
);

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
DROP POLICY IF EXISTS platform_admin_company_all ON public.expenses;
DROP POLICY IF EXISTS expenses_select ON public.expenses;
DROP POLICY IF EXISTS support_expenses_select ON public.expenses;

CREATE POLICY platform_admin_company_all
ON public.expenses
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

CREATE POLICY expenses_select
ON public.expenses
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND public._my_role() = ANY (
    ARRAY['admin'::text, 'dueno'::text]
  )
);

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

-- 5. PRIVILEGIOS SQL
-- RLS decide qué filas puede operar cada usuario.
-- Los privilegios de tabla habilitan las operaciones CRUD.
-- No se concede TRUNCATE, REFERENCES ni TRIGGER.

REVOKE REFERENCES, TRUNCATE, TRIGGER
ON TABLE public.sales, public.purchases, public.expenses
FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.sales, public.purchases, public.expenses
TO authenticated;

-- 6. VERIFICACIÓN FINAL
DO $$
DECLARE
  v_table text;
  v_policy_count integer;
  v_global_count integer;
  v_admin_policy_count integer;
  v_qual text;
  v_check text;
BEGIN
  -- Deben existir las tres políticas de soporte.
  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'sales'
        AND policyname = 'support_sales_select')
      OR
      (tablename = 'purchases'
        AND policyname = 'support_purchases_select')
      OR
      (tablename = 'expenses'
        AND policyname = 'support_expenses_select')
    );

  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION
      'Se esperaban 3 políticas de soporte; encontradas %',
      v_policy_count;
  END IF;

  -- No debe quedar ninguna política global anterior.
  SELECT count(*)
  INTO v_global_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('sales', 'purchases', 'expenses')
    AND policyname = 'platform_admin_all';

  IF v_global_count <> 0 THEN
    RAISE EXCEPTION
      'Persisten políticas globales platform_admin_all';
  END IF;

  -- Debe existir una política de administrador por tabla.
  SELECT count(*)
  INTO v_admin_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('sales', 'purchases', 'expenses')
    AND policyname = 'platform_admin_company_all'
    AND cmd = 'ALL';

  IF v_admin_policy_count <> 3 THEN
    RAISE EXCEPTION
      'No se encontraron las 3 políticas CRUD del administrador central';
  END IF;

  -- Validar aislamiento tanto en USING como WITH CHECK.
  FOREACH v_table IN ARRAY ARRAY['sales', 'purchases', 'expenses']
  LOOP
    SELECT qual, with_check
    INTO v_qual, v_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = v_table
      AND policyname = 'platform_admin_company_all';

    IF v_qual IS NULL
       OR v_check IS NULL
       OR v_qual NOT ILIKE '%is_platform_admin%'
       OR v_qual NOT ILIKE '%current_company_id%'
       OR v_check NOT ILIKE '%is_platform_admin%'
       OR v_check NOT ILIKE '%current_company_id%' THEN
      RAISE EXCEPTION
        'Aislamiento CRUD incorrecto en %', v_table;
    END IF;
  END LOOP;

  -- Confirmar privilegios CRUD.
  FOREACH v_table IN ARRAY ARRAY['sales', 'purchases', 'expenses']
  LOOP
    IF NOT has_table_privilege(
      'authenticated',
      'public.' || v_table,
      'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
      RAISE EXCEPTION
        'Faltan privilegios CRUD en %', v_table;
    END IF;
  END LOOP;

  RAISE NOTICE
    '000008 correcta: administrador limitado a su empresa, soporte temporal y CRUD habilitado';
END;
$$;

COMMIT;
