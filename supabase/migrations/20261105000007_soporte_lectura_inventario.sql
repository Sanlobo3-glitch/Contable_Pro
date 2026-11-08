
-- ============================================================
-- 000007: SOPORTE TEMPORAL DE SOLO LECTURA - INVENTARIO
-- Dependencia: 000003.
--
-- Permite diagnóstico técnico únicamente con autorización
-- vigente, por empresa, módulo y alcance.
--
-- No concede INSERT, UPDATE ni DELETE al soporte.
-- No modifica las políticas operativas de empresa.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. PREFLIGHT: dependencias y estructura
-- ------------------------------------------------------------

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'warehouses',
    'warehouse_stock',
    'warehouse_stock_reservations',
    'product_lots',
    'kardex',
    'warehouse_movements',
    'inventory_transfers',
    'inventory_transfer_items'
  ];
BEGIN
  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Falta support_has_active_authorization. Aplicar primero 000003.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP

    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION
        'No existe la tabla public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION
        'La tabla public.% no tiene company_id.', v_table;
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

-- ------------------------------------------------------------
-- 2. RETIRAR EL BYPASS GLOBAL DEL ADMINISTRADOR DE PLATAFORMA
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_all
ON public.warehouses;

DROP POLICY IF EXISTS platform_admin_all
ON public.warehouse_stock;

DROP POLICY IF EXISTS platform_admin_all
ON public.warehouse_stock_reservations;

DROP POLICY IF EXISTS platform_admin_all
ON public.product_lots;

DROP POLICY IF EXISTS platform_admin_all
ON public.kardex;

DROP POLICY IF EXISTS platform_admin_all
ON public.warehouse_movements;

DROP POLICY IF EXISTS platform_admin_all
ON public.inventory_transfers;

DROP POLICY IF EXISTS platform_admin_all
ON public.inventory_transfer_items;

-- ------------------------------------------------------------
-- 3. BODEGAS
-- Módulo real: warehouses
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_warehouses_select
ON public.warehouses;

CREATE POLICY support_warehouses_select
ON public.warehouses
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    warehouses.company_id,
    'warehouses',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    warehouses.company_id,
    'warehouses',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 4. EXISTENCIAS
-- Módulo real: warehouses
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_warehouse_stock_select
ON public.warehouse_stock;

CREATE POLICY support_warehouse_stock_select
ON public.warehouse_stock
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    warehouse_stock.company_id,
    'warehouses',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    warehouse_stock.company_id,
    'warehouses',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 5. RESERVAS DE EXISTENCIAS
-- Módulo real: warehouses
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_stock_reservations_select
ON public.warehouse_stock_reservations;

CREATE POLICY support_stock_reservations_select
ON public.warehouse_stock_reservations
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    warehouse_stock_reservations.company_id,
    'warehouses',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    warehouse_stock_reservations.company_id,
    'warehouses',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 6. LOTES Y VENCIMIENTOS
-- Módulo real: lots
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_product_lots_select
ON public.product_lots;

CREATE POLICY support_product_lots_select
ON public.product_lots
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    product_lots.company_id,
    'lots',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    product_lots.company_id,
    'lots',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 7. KARDEX
-- Módulo real: kardex
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_kardex_select
ON public.kardex;

CREATE POLICY support_kardex_select
ON public.kardex
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    kardex.company_id,
    'kardex',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    kardex.company_id,
    'kardex',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 8. MOVIMIENTOS DE BODEGA
-- Módulo real: kardex
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_warehouse_movements_select
ON public.warehouse_movements;

CREATE POLICY support_warehouse_movements_select
ON public.warehouse_movements
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    warehouse_movements.company_id,
    'kardex',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    warehouse_movements.company_id,
    'kardex',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 9. TRASLADOS ENTRE BODEGAS
-- Módulo real: warehouses
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_inventory_transfers_select
ON public.inventory_transfers;

CREATE POLICY support_inventory_transfers_select
ON public.inventory_transfers
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    inventory_transfers.company_id,
    'warehouses',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    inventory_transfers.company_id,
    'warehouses',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 10. DETALLES DE TRASLADOS
-- La autorización se comprueba contra la empresa del registro.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_inventory_transfer_items_select
ON public.inventory_transfer_items;

CREATE POLICY support_inventory_transfer_items_select
ON public.inventory_transfer_items
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    inventory_transfer_items.company_id,
    'warehouses',
    'lectura_diagnostico'
  )
  OR
  public.support_has_active_authorization(
    inventory_transfer_items.company_id,
    'warehouses',
    'intervencion_asistida'
  )
);

-- ------------------------------------------------------------
-- 11. VALIDACIÓN FINAL
-- ------------------------------------------------------------

DO $$
DECLARE
  v_table text;
  v_policy text;

  v_tables text[] := ARRAY[
    'warehouses',
    'warehouse_stock',
    'warehouse_stock_reservations',
    'product_lots',
    'kardex',
    'warehouse_movements',
    'inventory_transfers',
    'inventory_transfer_items'
  ];
BEGIN

  FOREACH v_table IN ARRAY v_tables LOOP

    v_policy := CASE v_table
      WHEN 'warehouses'
        THEN 'support_warehouses_select'
      WHEN 'warehouse_stock'
        THEN 'support_warehouse_stock_select'
      WHEN 'warehouse_stock_reservations'
        THEN 'support_stock_reservations_select'
      WHEN 'product_lots'
        THEN 'support_product_lots_select'
      WHEN 'kardex'
        THEN 'support_kardex_select'
      WHEN 'warehouse_movements'
        THEN 'support_warehouse_movements_select'
      WHEN 'inventory_transfers'
        THEN 'support_inventory_transfers_select'
      WHEN 'inventory_transfer_items'
        THEN 'support_inventory_transfer_items_select'
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = v_policy
        AND cmd = 'SELECT'
        AND roles @> ARRAY['authenticated']::name[]
    ) THEN
      RAISE EXCEPTION
        'No se creó correctamente la política % en %.',
        v_policy, v_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = 'platform_admin_all'
    ) THEN
      RAISE EXCEPTION
        'Permanece platform_admin_all en %.', v_table;
    END IF;

  END LOOP;

END;
$$;

COMMIT;
