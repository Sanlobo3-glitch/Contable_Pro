
BEGIN;

-- ============================================================
-- 000011: AISLAMIENTO DE CARTERA Y CUENTAS POR PAGAR
--
-- Administrador central:
-- CRUD dentro de su empresa de prueba exclusivamente.
--
-- Soporte:
-- SELECT temporal con autorización por empresa y módulo.
--
-- Usuarios empresariales:
-- Se conservan sus políticas existentes.
-- ============================================================

-- 1. PREVALIDACIONES
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'customer_credit',
    'credit_payments',
    'credit_allocations',
    'supplier_payments',
    'supplier_allocations',
    'purchases'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'No existe public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'RLS no está habilitado en public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'Falta company_id en public.%', v_table;
    END IF;
  END LOOP;

  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Falta support_has_active_authorization. Requiere 000003';
  END IF;

  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.is_platform_admin()';
  END IF;

  IF to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.current_company_id()';
  END IF;
END;
$$;

-- 2. PRIVILEGIOS SQL
-- Las tres tablas de cartera tenían únicamente SELECT
-- para authenticated. RLS restringe las escrituras al
-- administrador central de su propia empresa.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE
  public.customer_credit,
  public.credit_payments,
  public.credit_allocations
TO authenticated;

-- Retirar todos los privilegios directos de anon.
REVOKE ALL PRIVILEGES
ON TABLE
  public.customer_credit,
  public.credit_payments,
  public.credit_allocations,
  public.supplier_payments,
  public.supplier_allocations,
  public.purchases
FROM anon;

-- 3. CARTERA: CUSTOMER CREDIT
DROP POLICY IF EXISTS platform_admin_all
ON public.customer_credit;

DROP POLICY IF EXISTS platform_admin_company_all
ON public.customer_credit;

DROP POLICY IF EXISTS support_read_cartera_customer_credit
ON public.customer_credit;

CREATE POLICY platform_admin_company_all
ON public.customer_credit
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

CREATE POLICY support_read_cartera_customer_credit
ON public.customer_credit
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'cartera', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'cartera', 'intervencion_asistida'
  )
);

-- 4. CARTERA: CREDIT PAYMENTS
DROP POLICY IF EXISTS platform_admin_all
ON public.credit_payments;

DROP POLICY IF EXISTS platform_admin_company_all
ON public.credit_payments;

DROP POLICY IF EXISTS support_read_cartera_credit_payments
ON public.credit_payments;

CREATE POLICY platform_admin_company_all
ON public.credit_payments
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

CREATE POLICY support_read_cartera_credit_payments
ON public.credit_payments
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'cartera', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'cartera', 'intervencion_asistida'
  )
);

-- 5. CARTERA: CREDIT ALLOCATIONS
DROP POLICY IF EXISTS platform_admin_all
ON public.credit_allocations;

DROP POLICY IF EXISTS platform_admin_company_all
ON public.credit_allocations;

DROP POLICY IF EXISTS support_read_cartera_credit_allocations
ON public.credit_allocations;

CREATE POLICY platform_admin_company_all
ON public.credit_allocations
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

CREATE POLICY support_read_cartera_credit_allocations
ON public.credit_allocations
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'cartera', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'cartera', 'intervencion_asistida'
  )
);

-- 6. CUENTAS POR PAGAR: SUPPLIER PAYMENTS
DROP POLICY IF EXISTS platform_admin_all
ON public.supplier_payments;

DROP POLICY IF EXISTS platform_admin_company_all
ON public.supplier_payments;

DROP POLICY IF EXISTS support_read_payables_supplier_payments
ON public.supplier_payments;

CREATE POLICY platform_admin_company_all
ON public.supplier_payments
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

CREATE POLICY support_read_payables_supplier_payments
ON public.supplier_payments
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'payables', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'payables', 'intervencion_asistida'
  )
);

-- 7. CUENTAS POR PAGAR: SUPPLIER ALLOCATIONS
DROP POLICY IF EXISTS platform_admin_all
ON public.supplier_allocations;

DROP POLICY IF EXISTS platform_admin_company_all
ON public.supplier_allocations;

DROP POLICY IF EXISTS support_read_payables_supplier_allocations
ON public.supplier_allocations;

CREATE POLICY platform_admin_company_all
ON public.supplier_allocations
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

CREATE POLICY support_read_payables_supplier_allocations
ON public.supplier_allocations
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'payables', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'payables', 'intervencion_asistida'
  )
);

-- 8. COMPRAS: PURCHASES
DROP POLICY IF EXISTS platform_admin_all
ON public.purchases;

DROP POLICY IF EXISTS platform_admin_company_all
ON public.purchases;

-- Sustituir la política anterior de soporte.
DROP POLICY IF EXISTS support_purchases_select
ON public.purchases;

DROP POLICY IF EXISTS support_read_payables_purchases
ON public.purchases;

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

CREATE POLICY support_read_payables_purchases
ON public.purchases
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    company_id, 'payables', 'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    company_id, 'payables', 'intervencion_asistida'
  )
);

-- 9. VERIFICACIÓN ESTRUCTURAL
DO $$
DECLARE
  v_count integer;
  v_table text;
  v_qual text;
  v_check text;
  v_support_count integer;
  v_privilege text;
BEGIN
  -- Seis políticas CRUD del administrador central.
  SELECT count(*)
  INTO v_count
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
    AND policyname = 'platform_admin_company_all'
    AND cmd = 'ALL';

  IF v_count <> 6 THEN
    RAISE EXCEPTION
      'Se esperaban 6 políticas CRUD centrales; encontradas %',
      v_count;
  END IF;

  -- Seis políticas SELECT de soporte.
  SELECT count(*)
  INTO v_support_count
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
    AND cmd = 'SELECT';

  IF v_support_count <> 6 THEN
    RAISE EXCEPTION
      'Se esperaban 6 políticas SELECT de soporte; encontradas %',
      v_support_count;
  END IF;

  -- Validar aislamiento central por empresa en cada tabla.
  FOREACH v_table IN ARRAY ARRAY[
    'customer_credit',
    'credit_payments',
    'credit_allocations',
    'supplier_payments',
    'supplier_allocations',
    'purchases'
  ]
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
        'Aislamiento central incorrecto en public.%', v_table;
    END IF;
  END LOOP;

  -- No debe quedar ninguna política global anterior.
  SELECT count(*)
  INTO v_count
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
    AND policyname = 'platform_admin_all';

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'Persisten políticas globales platform_admin_all';
  END IF;

  -- Verificar privilegios CRUD SQL de authenticated.
  FOREACH v_table IN ARRAY ARRAY[
    'customer_credit',
    'credit_payments',
    'credit_allocations',
    'supplier_payments',
    'supplier_allocations',
    'purchases'
  ]
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE'
    ]
    LOOP
      IF NOT has_table_privilege(
        'authenticated',
        format('public.%I', v_table),
        v_privilege
      ) THEN
        RAISE EXCEPTION
          'Falta privilegio % para authenticated en public.%',
          v_privilege, v_table;
      END IF;
    END LOOP;
  END LOOP;

  -- Confirmar que anon no conserva privilegios directos.
  FOREACH v_table IN ARRAY ARRAY[
    'customer_credit',
    'credit_payments',
    'credit_allocations',
    'supplier_payments',
    'supplier_allocations',
    'purchases'
  ]
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE',
      'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege(
        'anon',
        format('public.%I', v_table),
        v_privilege
      ) THEN
        RAISE EXCEPTION
          'anon conserva privilegio % en public.%',
          v_privilege, v_table;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE
    '000011 validada: CRUD central aislado, soporte SELECT y privilegios anon revocados';
END;
$$;

COMMIT;
