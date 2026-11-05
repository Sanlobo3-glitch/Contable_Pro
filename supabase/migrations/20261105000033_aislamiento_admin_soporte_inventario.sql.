-- ============================================================
-- 000033: AISLAMIENTO DEL ADMINISTRADOR CENTRAL Y SOPORTE
--          AUTORIZADO DE SOLO LECTURA EN INVENTARIO
--
-- Consolida y corrige el objetivo de las migraciones 000006,
-- 000007 y 000032, sin modificar current_company_id().
--
-- Reglas:
--   1. El administrador central no obtiene acceso operativo
--      por tener un company_id en su perfil.
--   2. Se conservan las reglas existentes de los usuarios de
--      empresa, incluidos sus roles operativos.
--   3. Soporte solo obtiene SELECT con autorización vigente,
--      limitada por empresa, módulo y alcance.
--   4. Los detalles de traslados deben pertenecer a la misma
--      empresa que su traslado padre y este debe estar en draft.
--
-- IMPORTANTE SOBRE AUDITORÍA:
-- support_has_active_authorization() valida la autorización,
-- pero no registra cada lectura. El flujo de soporte debe llamar
-- support_register_access() antes de consultar los datos para
-- dejar el evento correspondiente en support_access_audit.
-- Esta migración no simula ni garantiza auditoría por fila.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. PREFLIGHT: dependencias, columnas y RLS
-- ------------------------------------------------------------

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'products',
    'categories',
    'product_images',
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
  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.is_platform_admin().';
  END IF;

  IF to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.current_company_id().';
  END IF;

  IF to_regprocedure('public.can_manage_inventory()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.can_manage_inventory().';
  END IF;

  IF to_regprocedure('public._my_role()') IS NULL THEN
    RAISE EXCEPTION 'Falta public._my_role().';
  END IF;

  IF to_regprocedure(
    'public.support_has_active_authorization(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Falta support_has_active_authorization(uuid,text,text). Aplicar primero 000003.';
  END IF;

  IF to_regprocedure(
    'public.support_register_access(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Falta support_register_access(uuid,text,text). Aplicar primero 000003.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'No existe public.%', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'Falta public.%.company_id.', v_table;
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
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'stock'
  ) THEN
    RAISE EXCEPTION 'Falta public.products.stock.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_transfers'
      AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'Falta public.inventory_transfers.status.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_transfer_items'
      AND column_name = 'transfer_id'
  ) THEN
    RAISE EXCEPTION 'Falta public.inventory_transfer_items.transfer_id.';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 2. AISLAR LA FUNCIÓN DE GESTIÓN DE INVENTARIO
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_manage_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND NOT public.is_platform_admin()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active = true
        AND p.company_id IS NOT NULL
        AND p.role IN (
          'admin',
          'dueno',
          'admin_empresa',
          'gerente',
          'almacen'
        )
    );
$function$;

-- ------------------------------------------------------------
-- 3. PRODUCTOS
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_all ON public.products;

DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select
ON public.products
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND public._my_role() = ANY (
    ARRAY['admin'::text, 'dueno'::text, 'admin_empresa'::text]
  )
  AND stock = (0)::numeric
);

DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update
ON public.products
FOR UPDATE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND public._my_role() = ANY (
    ARRAY['admin'::text, 'dueno'::text, 'admin_empresa'::text]
  )
)
WITH CHECK (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND public._my_role() = ANY (
    ARRAY['admin'::text, 'dueno'::text, 'admin_empresa'::text]
  )
);

DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_delete
ON public.products
FOR DELETE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND public._my_role() = ANY (
    ARRAY['admin'::text, 'dueno'::text, 'admin_empresa'::text]
  )
);
-- ------------------------------------------------------------
-- 4. CATEGORÍAS: conservar roles y aislar administrador central.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_all ON public.categories;

DROP POLICY IF EXISTS categories_select ON public.categories;
CREATE POLICY categories_select
ON public.categories
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

DROP POLICY IF EXISTS categories_write ON public.categories;
CREATE POLICY categories_write
ON public.categories
FOR ALL
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND public._my_role() = ANY (
    ARRAY['admin'::text, 'dueno'::text]
  )
)
WITH CHECK (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND public._my_role() = ANY (
    ARRAY['admin'::text, 'dueno'::text]
  )
);

-- ------------------------------------------------------------
-- 5. IMÁGENES DE PRODUCTOS: bloquear administrador central,
--    sin ampliar ni reducir la lista de roles empresariales.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS product_images_select ON public.product_images;
CREATE POLICY product_images_select
ON public.product_images
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

DROP POLICY IF EXISTS product_images_insert ON public.product_images;
CREATE POLICY product_images_insert
ON public.product_images
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.active, true) = true
      AND p.role = ANY (
        ARRAY[
          'admin'::text,
          'dueno'::text,
          'admin_empresa'::text,
          'gerente'::text,
          'almacen'::text,
          'comprador'::text,
          'cajero'::text,
          'vendedor'::text
        ]
      )
  )
);

DROP POLICY IF EXISTS product_images_update ON public.product_images;
CREATE POLICY product_images_update
ON public.product_images
FOR UPDATE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.active, true) = true
      AND p.role = ANY (
        ARRAY[
          'admin'::text,
          'dueno'::text,
          'admin_empresa'::text,
          'gerente'::text,
          'almacen'::text,
          'comprador'::text,
          'cajero'::text,
          'vendedor'::text
        ]
      )
  )
)
WITH CHECK (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

DROP POLICY IF EXISTS product_images_delete ON public.product_images;
CREATE POLICY product_images_delete
ON public.product_images
FOR DELETE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.active, true) = true
      AND p.role = ANY (
        ARRAY[
          'admin'::text,
          'dueno'::text,
          'admin_empresa'::text,
          'gerente'::text,
          'almacen'::text,
          'comprador'::text,
          'cajero'::text,
          'vendedor'::text
        ]
      )
  )
);

-- ------------------------------------------------------------
-- 6. POLÍTICAS DE LECTURA OPERATIVA SIN BYPASS CENTRAL
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_all ON public.product_lots;
DROP POLICY IF EXISTS product_lots_select ON public.product_lots;
CREATE POLICY product_lots_select
ON public.product_lots
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

DROP POLICY IF EXISTS platform_admin_all ON public.kardex;
DROP POLICY IF EXISTS kardex_select ON public.kardex;
CREATE POLICY kardex_select
ON public.kardex
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

DROP POLICY IF EXISTS platform_admin_all ON public.warehouse_movements;
DROP POLICY IF EXISTS warehouse_movements_select ON public.warehouse_movements;
CREATE POLICY warehouse_movements_select
ON public.warehouse_movements
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

DROP POLICY IF EXISTS platform_admin_all ON public.warehouse_stock;
DROP POLICY IF EXISTS warehouse_stock_select ON public.warehouse_stock;
CREATE POLICY warehouse_stock_select
ON public.warehouse_stock
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND NOT public.is_platform_admin()
);

-- La política warehouse_stock_write usa can_manage_inventory(),
-- que ahora excluye al administrador central.

DROP POLICY IF EXISTS platform_admin_all ON public.warehouse_stock_reservations;
-- stock_reservations_select usa can_manage_inventory(),
-- por lo que el nuevo helper ya bloquea al administrador central.

DROP POLICY IF EXISTS platform_admin_all ON public.warehouses;
-- warehouses_company_access usa can_manage_inventory(),
-- por lo que el nuevo helper ya bloquea al administrador central.

-- ------------------------------------------------------------
-- 7. TRASLADOS: retirar bypass global.
--    Las políticas normales ya requieren can_manage_inventory().
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_all ON public.inventory_transfers;
DROP POLICY IF EXISTS platform_admin_all ON public.inventory_transfer_items;

-- ------------------------------------------------------------
-- 8. DETALLES DE TRASLADOS: corregir correlación con traslado padre.
--    Se conserva el requisito de empresa, permiso operativo y draft.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS inventory_transfer_items_insert_draft
ON public.inventory_transfer_items;
CREATE POLICY inventory_transfer_items_insert_draft
ON public.inventory_transfer_items
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
);

DROP POLICY IF EXISTS inventory_transfer_items_update_draft
ON public.inventory_transfer_items;
CREATE POLICY inventory_transfer_items_update_draft
ON public.inventory_transfer_items
FOR UPDATE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
)
WITH CHECK (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
);

DROP POLICY IF EXISTS inventory_transfer_items_delete_draft
ON public.inventory_transfer_items;
CREATE POLICY inventory_transfer_items_delete_draft
ON public.inventory_transfer_items
FOR DELETE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
);
-- ------------------------------------------------------------
-- 9. SOPORTE: SELECT temporal por empresa, módulo y alcance.
--    No se crean políticas INSERT, UPDATE ni DELETE para soporte.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_products_select ON public.products;
CREATE POLICY support_products_select
ON public.products
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    products.company_id, 'products', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    products.company_id, 'products', 'intervencion_asistida'
  )
);

DROP POLICY IF EXISTS support_categories_select ON public.categories;
CREATE POLICY support_categories_select
ON public.categories
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    categories.company_id, 'categories', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    categories.company_id, 'categories', 'intervencion_asistida'
  )
);

DROP POLICY IF EXISTS support_warehouses_select ON public.warehouses;
CREATE POLICY support_warehouses_select
ON public.warehouses
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    warehouses.company_id, 'warehouses', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    warehouses.company_id, 'warehouses', 'intervencion_asistida'
  )
);

DROP POLICY IF EXISTS support_warehouse_stock_select ON public.warehouse_stock;
CREATE POLICY support_warehouse_stock_select
ON public.warehouse_stock
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    warehouse_stock.company_id, 'warehouses', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    warehouse_stock.company_id, 'warehouses', 'intervencion_asistida'
  )
);

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
  OR public.support_has_active_authorization(
    warehouse_stock_reservations.company_id,
    'warehouses',
    'intervencion_asistida'
  )
);

DROP POLICY IF EXISTS support_product_lots_select ON public.product_lots;
CREATE POLICY support_product_lots_select
ON public.product_lots
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    product_lots.company_id, 'lots', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    product_lots.company_id, 'lots', 'intervencion_asistida'
  )
);

DROP POLICY IF EXISTS support_kardex_select ON public.kardex;
CREATE POLICY support_kardex_select
ON public.kardex
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    kardex.company_id, 'kardex', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    kardex.company_id, 'kardex', 'intervencion_asistida'
  )
);

DROP POLICY IF EXISTS support_warehouse_movements_select
ON public.warehouse_movements;
CREATE POLICY support_warehouse_movements_select
ON public.warehouse_movements
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    warehouse_movements.company_id, 'kardex', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    warehouse_movements.company_id, 'kardex', 'intervencion_asistida'
  )
);

DROP POLICY IF EXISTS support_inventory_transfers_select
ON public.inventory_transfers;
CREATE POLICY support_inventory_transfers_select
ON public.inventory_transfers
FOR SELECT
TO authenticated
USING (
  public.support_has_active_authorization(
    inventory_transfers.company_id, 'warehouses', 'lectura_diagnostico'
  )
  OR public.support_has_active_authorization(
    inventory_transfers.company_id, 'warehouses', 'intervencion_asistida'
  )
);

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
  OR public.support_has_active_authorization(
    inventory_transfer_items.company_id,
    'warehouses',
    'intervencion_asistida'
  )
);
-- ------------------------------------------------------------
-- 10. VERIFICACIONES ESTRUCTURALES FINALES
-- ------------------------------------------------------------

DO $$
DECLARE
  i integer;
  v_table text;
  v_policy text;
  v_tables text[] := ARRAY[
    'products',
    'categories',
    'warehouses',
    'warehouse_stock',
    'warehouse_stock_reservations',
    'product_lots',
    'kardex',
    'warehouse_movements',
    'inventory_transfers',
    'inventory_transfer_items'
  ];
  v_support_policies text[] := ARRAY[
    'support_products_select',
    'support_categories_select',
    'support_warehouses_select',
    'support_warehouse_stock_select',
    'support_stock_reservations_select',
    'support_product_lots_select',
    'support_kardex_select',
    'support_warehouse_movements_select',
    'support_inventory_transfers_select',
    'support_inventory_transfer_items_select'
  ];
  v_expected_tables text[] := ARRAY[
    'products',
    'categories',
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
  -- No debe permanecer ningún bypass global de plataforma.
  FOREACH v_table IN ARRAY v_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = 'platform_admin_all'
    ) THEN
      RAISE EXCEPTION
        'Sigue activa platform_admin_all en public.%.', v_table;
    END IF;
  END LOOP;

  -- Las diez políticas de soporte deben ser SELECT para authenticated.
  FOR i IN 1..array_length(v_support_policies, 1) LOOP
    v_policy := v_support_policies[i];
    v_table := v_expected_tables[i];

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
        'No quedó creada la política SELECT % en public.%.',
        v_policy, v_table;
    END IF;
  END LOOP;

  -- La función compartida debe excluir expresamente al admin central.
  IF pg_get_functiondef(
    'public.can_manage_inventory()'::regprocedure
  ) NOT ILIKE '%NOT public.is_platform_admin()%' THEN
    RAISE EXCEPTION
      'can_manage_inventory() no excluye al administrador central.';
  END IF;

  -- Los tres predicados de escritura no deben conservar la tautología.
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_transfer_items'
      AND policyname IN (
        'inventory_transfer_items_insert_draft',
        'inventory_transfer_items_update_draft',
        'inventory_transfer_items_delete_draft'
      )
      AND (
        COALESCE(qual, '') ILIKE '%t.company_id = t.company_id%'
        OR COALESCE(with_check, '') ILIKE '%t.company_id = t.company_id%'
      )
  ) THEN
    RAISE EXCEPTION
      'Se detectó la comparación tautológica t.company_id = t.company_id.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_transfer_items'
      AND policyname = 'inventory_transfer_items_insert_draft'
      AND with_check ILIKE '%t.company_id = inventory_transfer_items.company_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_transfer_items'
      AND policyname = 'inventory_transfer_items_update_draft'
      AND qual ILIKE '%t.company_id = inventory_transfer_items.company_id%'
      AND with_check ILIKE '%t.company_id = inventory_transfer_items.company_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_transfer_items'
      AND policyname = 'inventory_transfer_items_delete_draft'
      AND qual ILIKE '%t.company_id = inventory_transfer_items.company_id%'
  ) THEN
    RAISE EXCEPTION
      'No quedó aplicada la correlación empresa-detalle-traslado en todas las operaciones.';
  END IF;

  -- Las políticas empresariales deben excluir al admin central.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'products_select'
      AND qual ILIKE '%is_platform_admin%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'categories'
      AND policyname = 'categories_select'
      AND qual ILIKE '%is_platform_admin%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_images'
      AND policyname = 'product_images_select'
      AND qual ILIKE '%is_platform_admin%'
  ) THEN
    RAISE EXCEPTION
      'Falta exclusión explícita del administrador central en lectura operativa.';
  END IF;
END;
$$;

COMMIT;
