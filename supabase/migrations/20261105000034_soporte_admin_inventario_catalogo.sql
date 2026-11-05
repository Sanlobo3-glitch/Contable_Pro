-- ============================================================
-- 000034: ACCESO ADMINISTRATIVO AISLADO AL CATALOGO
--          Y LECTURA DEL HISTORIAL DE INVENTARIO
--
-- El administrador central solo opera sobre su empresa
-- vinculada mediante current_company_id().
--
-- No elimina ni modifica las políticas de soporte.
-- No habilita escrituras directas en libros de movimientos.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. PRODUCTOS
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_products_select
ON public.products;

CREATE POLICY platform_admin_products_select
ON public.products
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

DROP POLICY IF EXISTS platform_admin_products_insert
ON public.products;

CREATE POLICY platform_admin_products_insert
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
    AND stock = 0
);

DROP POLICY IF EXISTS platform_admin_products_update
ON public.products;

CREATE POLICY platform_admin_products_update
ON public.products
FOR UPDATE
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

DROP POLICY IF EXISTS platform_admin_products_delete
ON public.products;

CREATE POLICY platform_admin_products_delete
ON public.products
FOR DELETE
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

-- ------------------------------------------------------------
-- 2. IMAGENES DE PRODUCTOS
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_product_images_select
ON public.product_images;

CREATE POLICY platform_admin_product_images_select
ON public.product_images
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

DROP POLICY IF EXISTS platform_admin_product_images_insert
ON public.product_images;

CREATE POLICY platform_admin_product_images_insert
ON public.product_images
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

DROP POLICY IF EXISTS platform_admin_product_images_update
ON public.product_images;

CREATE POLICY platform_admin_product_images_update
ON public.product_images
FOR UPDATE
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
)
WITH CHECK (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

DROP POLICY IF EXISTS platform_admin_product_images_delete
ON public.product_images;

CREATE POLICY platform_admin_product_images_delete
ON public.product_images
FOR DELETE
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

-- ------------------------------------------------------------
-- 3. LOTES: LECTURA ADMINISTRATIVA AISLADA
-- Las escrituras siguen protegidas por sus procesos actuales.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_product_lots_select
ON public.product_lots;

CREATE POLICY platform_admin_product_lots_select
ON public.product_lots
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

-- ------------------------------------------------------------
-- 4. KARDEX: CONSULTA ADMINISTRATIVA AISLADA
-- No se habilita INSERT, UPDATE ni DELETE directo.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_kardex_select
ON public.kardex;

CREATE POLICY platform_admin_kardex_select
ON public.kardex
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

-- ------------------------------------------------------------
-- 5. MOVIMIENTOS DE BODEGA: SOLO LECTURA ADMINISTRATIVA
-- Se conserva la trazabilidad de los movimientos.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS platform_admin_warehouse_movements_select
ON public.warehouse_movements;

CREATE POLICY platform_admin_warehouse_movements_select
ON public.warehouse_movements
FOR SELECT
TO authenticated
USING (
    public.is_platform_admin()
    AND company_id = public.current_company_id()
);

-- ------------------------------------------------------------
-- 6. VERIFICACION ESTRUCTURAL
-- ------------------------------------------------------------

DO $$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(required.policy_name, ', ')
    INTO v_missing
    FROM (
        VALUES
            ('products', 'platform_admin_products_select'),
            ('products', 'platform_admin_products_insert'),
            ('products', 'platform_admin_products_update'),
            ('products', 'platform_admin_products_delete'),
            ('product_images', 'platform_admin_product_images_select'),
            ('product_images', 'platform_admin_product_images_insert'),
            ('product_images', 'platform_admin_product_images_update'),
            ('product_images', 'platform_admin_product_images_delete'),
            ('product_lots', 'platform_admin_product_lots_select'),
            ('kardex', 'platform_admin_kardex_select'),
            ('warehouse_movements', 'platform_admin_warehouse_movements_select')
    ) AS required(table_name, policy_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = required.table_name
          AND p.policyname = required.policy_name
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Migración 34 incompleta. Políticas faltantes: %',
            v_missing;
    END IF;
END;
$$;

COMMIT;

Resultado esperado: 11 políticas administrativas nuevas, todas restringidas a "current_company_id()". Los permisos SQL existentes siguen siendo necesarios; esta migración no los amplía ni concede permisos de escritura sobre kardex, lotes o movimientos.
