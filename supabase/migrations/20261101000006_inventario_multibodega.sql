BEGIN;

-- =====================================================
-- 1. ASEGURAR REFERENCIAS DE PRODUCTOS POR EMPRESA
-- =====================================================

CREATE UNIQUE INDEX IF NOT EXISTS products_id_company_uidx
ON public.products(id, company_id);


-- =====================================================
-- 2. EXISTENCIAS POR BODEGA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.warehouse_stock (
    company_id uuid NOT NULL
        REFERENCES public.companies(id) ON DELETE CASCADE,

    warehouse_id uuid NOT NULL,
    product_id uuid NOT NULL,

    quantity numeric(14,3) NOT NULL DEFAULT 0,
    reserved_quantity numeric(14,3) NOT NULL DEFAULT 0,

    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (warehouse_id, product_id),

    CONSTRAINT warehouse_stock_quantity_check
        CHECK (quantity >= 0),

    CONSTRAINT warehouse_stock_reserved_check
        CHECK (
            reserved_quantity >= 0
            AND reserved_quantity <= quantity
        ),

    CONSTRAINT warehouse_stock_warehouse_fk
        FOREIGN KEY (warehouse_id, company_id)
        REFERENCES public.warehouses(id, company_id)
        ON DELETE RESTRICT,

    CONSTRAINT warehouse_stock_product_fk
        FOREIGN KEY (product_id, company_id)
        REFERENCES public.products(id, company_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS warehouse_stock_company_idx
ON public.warehouse_stock(company_id);

CREATE INDEX IF NOT EXISTS warehouse_stock_product_idx
ON public.warehouse_stock(product_id);


-- =====================================================
-- 3. DOCUMENTOS DE TRASLADO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.inventory_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id uuid NOT NULL
        REFERENCES public.companies(id) ON DELETE CASCADE,

    source_warehouse_id uuid NOT NULL,
    destination_warehouse_id uuid NOT NULL,

    status text NOT NULL DEFAULT 'draft'
        CHECK (
            status IN (
                'draft',
                'in_transit',
                'received',
                'cancelled'
            )
        ),

    notes text,

    created_by uuid REFERENCES auth.users(id),
    approved_by uuid REFERENCES auth.users(id),
    received_by uuid REFERENCES auth.users(id),

    created_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    received_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inventory_transfer_different_warehouses
        CHECK (source_warehouse_id <> destination_warehouse_id),

    CONSTRAINT inventory_transfer_source_fk
        FOREIGN KEY (source_warehouse_id, company_id)
        REFERENCES public.warehouses(id, company_id)
        ON DELETE RESTRICT,

    CONSTRAINT inventory_transfer_destination_fk
        FOREIGN KEY (destination_warehouse_id, company_id)
        REFERENCES public.warehouses(id, company_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_transfers_id_company_uidx
ON public.inventory_transfers(id, company_id);

CREATE INDEX IF NOT EXISTS inventory_transfers_company_idx
ON public.inventory_transfers(company_id);

CREATE INDEX IF NOT EXISTS inventory_transfers_status_idx
ON public.inventory_transfers(company_id, status);


-- =====================================================
-- 4. PRODUCTOS INCLUIDOS EN CADA TRASLADO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.inventory_transfer_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id uuid NOT NULL
        REFERENCES public.companies(id) ON DELETE CASCADE,

    transfer_id uuid NOT NULL,
    product_id uuid NOT NULL,

    quantity numeric(14,3) NOT NULL
        CHECK (quantity > 0),

    notes text,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inventory_transfer_item_transfer_fk
        FOREIGN KEY (transfer_id, company_id)
        REFERENCES public.inventory_transfers(id, company_id)
        ON DELETE CASCADE,

    CONSTRAINT inventory_transfer_item_product_fk
        FOREIGN KEY (product_id, company_id)
        REFERENCES public.products(id, company_id)
        ON DELETE RESTRICT,

    CONSTRAINT inventory_transfer_item_unique
        UNIQUE (transfer_id, product_id)
);

CREATE INDEX IF NOT EXISTS inventory_transfer_items_company_idx
ON public.inventory_transfer_items(company_id);

CREATE INDEX IF NOT EXISTS inventory_transfer_items_product_idx
ON public.inventory_transfer_items(product_id);


-- =====================================================
-- 5. SEGURIDAD: EXISTENCIAS
-- =====================================================

ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_stock_select ON public.warehouse_stock;
DROP POLICY IF EXISTS warehouse_stock_write ON public.warehouse_stock;

CREATE POLICY warehouse_stock_select
ON public.warehouse_stock
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
);

CREATE POLICY warehouse_stock_write
ON public.warehouse_stock
FOR ALL
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
)
WITH CHECK (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
);


-- =====================================================
-- 6. SEGURIDAD: TRASLADOS
-- =====================================================

ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_transfers_access
ON public.inventory_transfers;

CREATE POLICY inventory_transfers_access
ON public.inventory_transfers
FOR ALL
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
)
WITH CHECK (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
);


-- =====================================================
-- 7. SEGURIDAD: DETALLES DE TRASLADOS
-- =====================================================

ALTER TABLE public.inventory_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_transfer_items_access
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfer_items_access
ON public.inventory_transfer_items
FOR ALL
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
)
WITH CHECK (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
);


-- =====================================================
-- 8. REALTIME
-- =====================================================

DO $$
DECLARE
    v_table text;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) THEN
        FOREACH v_table IN ARRAY ARRAY[
            'warehouse_stock',
            'inventory_transfers',
            'inventory_transfer_items'
        ]
        LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = v_table
            ) THEN
                EXECUTE format(
                    'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
                    v_table
                );
            END IF;
        END LOOP;
    END IF;
END $$;

COMMIT;
