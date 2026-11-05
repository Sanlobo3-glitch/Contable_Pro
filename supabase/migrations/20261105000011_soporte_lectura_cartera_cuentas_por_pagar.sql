BEGIN;

-- ============================================================
-- 000011: Soporte temporal de lectura para cartera y CxP
--
-- Modulos confirmados en src/lib/navigation.ts:
--   cartera  = Cartera (fiado)
--   payables = Cuentas por pagar
--
-- No concede INSERT, UPDATE ni DELETE.
-- No modifica RPC financieras ni _ctx().
-- ============================================================

-- 1. PREVALIDACIONES
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
    RAISE EXCEPTION
      'Falta public.support_has_active_authorization(uuid,text,text). Aplicación cancelada.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION
        'No existe public.%. Aplicación cancelada.', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION
        'RLS no está habilitado en public.%. Aplicación cancelada.',
        v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION
        'Falta company_id en public.%. Aplicación cancelada.',
        v_table;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 2. CARTERA DE CLIENTES
-- ============================================================

-- Retirar el acceso global del administrador de plataforma.
DROP POLICY IF EXISTS platform_admin_all
  ON public.customer_credit;

DROP POLICY IF EXISTS platform_admin_all
  ON public.credit_payments;

DROP POLICY IF EXISTS platform_admin_all
  ON public.credit_allocations;

-- Lectura temporal únicamente con autorización vigente
-- para el módulo exacto "cartera".
CREATE POLICY support_read_cartera_customer_credit
ON public.customer_credit
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND (
    public.support_has_active_authorization(
      company_id,
      'cartera',
      'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
      company_id,
      'cartera',
      'intervencion_asistida'
    )
  )
);

CREATE POLICY support_read_cartera_credit_payments
ON public.credit_payments
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND (
    public.support_has_active_authorization(
      company_id,
      'cartera',
      'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
      company_id,
      'cartera',
      'intervencion_asistida'
    )
  )
);

CREATE POLICY support_read_cartera_credit_allocations
ON public.credit_allocations
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND (
    public.support_has_active_authorization(
      company_id,
      'cartera',
      'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
      company_id,
      'cartera',
      'intervencion_asistida'
    )
  )
);

-- ============================================================
-- 3. CUENTAS POR PAGAR
-- ============================================================

DROP POLICY IF EXISTS platform_admin_all
  ON public.supplier_payments;

DROP POLICY IF EXISTS platform_admin_all
  ON public.supplier_allocations;

DROP POLICY IF EXISTS platform_admin_all
  ON public.purchases;

-- Lectura temporal únicamente con autorización vigente
-- para el módulo exacto "payables".
CREATE POLICY support_read_payables_supplier_payments
ON public.supplier_payments
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND (
    public.support_has_active_authorization(
      company_id,
      'payables',
      'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
      company_id,
      'payables',
      'intervencion_asistida'
    )
  )
);

CREATE POLICY support_read_payables_supplier_allocations
ON public.supplier_allocations
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND (
    public.support_has_active_authorization(
      company_id,
      'payables',
      'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
      company_id,
      'payables',
      'intervencion_asistida'
    )
  )
);

CREATE POLICY support_read_payables_purchases
ON public.purchases
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT public.current_company_id())
  AND (
    public.support_has_active_authorization(
      company_id,
      'payables',
      'lectura_diagnostico'
    )
    OR
    public.support_has_active_authorization(
      company_id,
      'payables',
      'intervencion_asistida'
    )
  )
);

-- ============================================================
-- 4. VERIFICACIÓN DE SEGURIDAD
-- ============================================================

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
  v_remaining integer;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP

    -- Confirmar que no quedó la política global.
    SELECT count(*)
    INTO v_remaining
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = v_table
      AND policyname = 'platform_admin_all';

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'Permanece platform_admin_all en public.%.', v_table;
    END IF;

  END LOOP;

  -- Confirmar las seis políticas temporales.
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
    RAISE EXCEPTION
      'No se pudieron verificar las seis políticas temporales de soporte.';
  END IF;

  RAISE NOTICE
    'Migración 000011: verificaciones completadas correctamente.';
END;
$$;

COMMIT;
