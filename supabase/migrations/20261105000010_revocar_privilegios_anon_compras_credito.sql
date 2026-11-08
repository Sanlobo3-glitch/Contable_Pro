BEGIN;

-- ============================================================
-- MIGRACIÓN 000010
-- Retirar privilegios directos a usuarios no autenticados.
-- No modifica permisos de authenticated ni service_role.
-- ============================================================

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'purchase_orders',
    'purchase_order_items',
    'supplier_credit'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION
        'No existe la tabla public.%', v_table;
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
        'RLS no está habilitado en public.%', v_table;
    END IF;
  END LOOP;
END;
$$;

-- Los usuarios anónimos no deben operar directamente
-- sobre órdenes de compra, sus artículos ni créditos.
REVOKE ALL PRIVILEGES
ON TABLE
  public.purchase_orders,
  public.purchase_order_items,
  public.supplier_credit
FROM anon;

-- Verificación: anon no conserva privilegios.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'purchase_orders',
    'purchase_order_items',
    'supplier_credit'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND grantee = 'anon'
    ) THEN
      RAISE EXCEPTION
        'Persisten privilegios de anon en public.%', v_table;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
