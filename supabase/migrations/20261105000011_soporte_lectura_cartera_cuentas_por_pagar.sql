BEGIN;

-- 000011: Soporte temporal de lectura para cartera y cuentas por pagar.

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'customer_credit',
    'credit_payments',
    'credit_allocations',
    'supplier_payments',
    'supplier_allocations',
    'purchases'
  ];
BEGIN
  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Falta la función de autorización de soporte.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'No existe public.%.', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'RLS no está habilitado en public.%.', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'Falta company_id en public.%.', v_table;
    END IF;
  END LOOP;
END;
$$;

-- CARTERA: retirar acceso global.
DROP POLICY IF EXISTS platform_admin_all ON public.customer_credit;
DROP POLICY IF EXISTS platform_admin_all ON public.credit_payments;
DROP POLICY IF EXISTS platform_admin_all ON public.credit_allocations;

-- CARTERA: lectura temporal autorizada.
CREATE POLICY support_read_cartera_customer_credit
ON public.customer_credit
FOR SELECT TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'cartera', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'cartera', 'intervencion_asistida'
  )
);

CREATE POLICY support_read_cartera_credit_payments
ON public.credit_payments
FOR SELECT TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'cartera', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'cartera', 'intervencion_asistida'
  )
);

CREATE POLICY support_read_cartera_credit_allocations
ON public.credit_allocations
FOR SELECT TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'cartera', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'cartera', 'intervencion_asistida'
  )
);

-- CUENTAS POR PAGAR: retirar acceso global.
DROP POLICY IF EXISTS platform_admin_all ON public.supplier_payments;
DROP POLICY IF EXISTS platform_admin_all ON public.supplier_allocations;
DROP POLICY IF EXISTS platform_admin_all ON public.purchases;

-- CUENTAS POR PAGAR: lectura temporal autorizada.
CREATE POLICY support_read_payables_supplier_payments
ON public.supplier_payments
FOR SELECT TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'payables', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'payables', 'intervencion_asistida'
  )
);

CREATE POLICY support_read_payables_supplier_allocations
ON public.supplier_allocations
FOR SELECT TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'payables', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'payables', 'intervencion_asistida'
  )
);

CREATE POLICY support_read_payables_purchases
ON public.purchases
FOR SELECT TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'payables', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'payables', 'intervencion_asistida'
  )
);

-- Verificación.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'customer_credit',
        'credit_payments',
        'credit_allocations',
        'supplier_payments',
        'supplier_allocations',
        'purchases'
      )
      AND policyname = 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION 'Quedó una política global platform_admin_all.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN (
        'support_read_cartera_customer_credit',
        'support_read_cartera_credit_payments',
        'support_read_cartera_credit_allocations',
        'support_read_payables_supplier_payments',
        'support_read_payables_supplier_allocations',
        'support_read_payables_purchases'
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'No se verificaron las seis políticas de soporte.';
  END IF;
END;
$$;

COMMIT;
