BEGIN;

-- =====================================================
-- 1. AGREGAR LA BODEGA DE ORIGEN A LAS VENTAS
-- =====================================================

ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS warehouse_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sales_warehouse_id_fkey'
          AND conrelid = 'public.sales'::regclass
    ) THEN
        ALTER TABLE public.sales
        ADD CONSTRAINT sales_warehouse_id_fkey
        FOREIGN KEY (warehouse_id)
        REFERENCES public.warehouses(id)
        ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS sales_warehouse_id_idx
ON public.sales (company_id, warehouse_id);


-- =====================================================
-- 2. FUNCIÓN DE VENTA CON BODEGA SELECCIONADA
-- =====================================================

CREATE OR REPLACE FUNCTION public.registrar_venta_bodega(
    p_warehouse_id uuid,
    p_items jsonb,
    p_customer_id uuid DEFAULT NULL,
    p_payment_method text DEFAULT 'efectivo',
    p_geo jsonb DEFAULT NULL,
    p_client_id uuid DEFAULT NULL,
    p_captured_at timestamptz DEFAULT NULL,
    p_channel text DEFAULT 'ruta',
    p_discount numeric DEFAULT 0,
    p_received numeric DEFAULT NULL,
    p_fx_currency text DEFAULT NULL,
    p_fx_amount numeric DEFAULT NULL,
    p_fx_rate numeric DEFAULT NULL,
    p_base_amount numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$

DECLARE
    v_co uuid := public._ctx(NULL);
    v_sale_id uuid;
    v_existing_id uuid;
    v_existing_warehouse uuid;

    v_warehouse_active boolean;

    v_product_id uuid;
    v_qty numeric;

    v_stock numeric;
    v_reserved numeric;
    v_after numeric;

    r record;

BEGIN

    -- =============================================
    -- 1. VALIDAR BODEGA
    -- =============================================

    SELECT active
    INTO v_warehouse_active
    FROM public.warehouses
    WHERE id = p_warehouse_id
      AND company_id = v_co;

    IF NOT FOUND OR v_warehouse_active IS NOT TRUE THEN
        RAISE EXCEPTION
            'La bodega seleccionada no existe o está inactiva';
    END IF;


    -- =============================================
    -- 2. PROTEGER LA IDEMPOTENCIA
    -- =============================================

    IF p_client_id IS NOT NULL THEN

        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                v_co::text || ':' || p_client_id::text,
                0
            )
        );

        SELECT id, warehouse_id
        INTO v_existing_id, v_existing_warehouse
        FROM public.sales
        WHERE company_id = v_co
          AND client_uuid = p_client_id
        LIMIT 1;

        IF FOUND THEN

            IF v_existing_warehouse IS NULL THEN
                RAISE EXCEPTION
                    'Esta venta ya existe sin bodega asociada. No se repetirá el descuento de inventario.';
            END IF;

            IF v_existing_warehouse <> p_warehouse_id THEN
                RAISE EXCEPTION
                    'Esta venta ya fue registrada desde otra bodega';
            END IF;

            RETURN v_existing_id;

        END IF;

    END IF;


    -- =============================================
    -- 3. REGISTRAR LA VENTA ORIGINAL
    -- =============================================
    -- Conserva toda la lógica existente:
    -- impuestos, descuentos, clientes, fiados,
    -- lotes, monedas, caja, visitas y kardex.

    v_sale_id := public.registrar_venta(
        p_customer_id,
        p_items,
        p_payment_method,
        p_geo,
        p_client_id,
        p_captured_at,
        p_channel,
        p_discount,
        p_received,
        p_fx_currency,
        p_fx_amount,
        p_fx_rate,
        p_base_amount
    );


    -- =============================================
    -- 4. DESCONTAR EXISTENCIAS DE LA BODEGA
    -- =============================================

    FOR r IN

        SELECT
            public._item_uuid(x, 'product_id') AS product_id,
            SUM(public._item_num(x, 'quantity')) AS quantity
        FROM jsonb_array_elements(p_items) AS t(x)
        GROUP BY public._item_uuid(x, 'product_id')
        ORDER BY public._item_uuid(x, 'product_id')

    LOOP

        v_product_id := r.product_id;
        v_qty := r.quantity;

        -- Crear existencia inicial si no existe.

        INSERT INTO public.warehouse_stock (
            company_id,
            warehouse_id,
            product_id,
            quantity,
            reserved_quantity
        )
        VALUES (
            v_co,
            p_warehouse_id,
            v_product_id,
            0,
            0
        )
        ON CONFLICT (warehouse_id, product_id)
        DO NOTHING;


        -- Bloquear existencia para evitar
        -- descuentos simultáneos.

        SELECT quantity, reserved_quantity
        INTO v_stock, v_reserved
        FROM public.warehouse_stock
        WHERE company_id = v_co
          AND warehouse_id = p_warehouse_id
          AND product_id = v_product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'No se pudo bloquear el inventario del producto %',
                v_product_id;
        END IF;


        -- Respetar las unidades reservadas.

        IF v_stock - v_reserved < v_qty THEN

            RAISE EXCEPTION
                'Stock insuficiente en la bodega seleccionada. Producto: %. Disponible: %, solicitado: %',
                v_product_id,
                v_stock - v_reserved,
                v_qty;

        END IF;


        v_after := v_stock - v_qty;


        -- Actualizar inventario de la bodega.

        UPDATE public.warehouse_stock
        SET quantity = v_after,
            updated_at = now()
        WHERE company_id = v_co
          AND warehouse_id = p_warehouse_id
          AND product_id = v_product_id;


        -- Registrar movimiento de salida.

        INSERT INTO public.warehouse_movements (
            company_id,
            warehouse_id,
            product_id,
            movement_type,
            quantity_delta,
            quantity_before,
            quantity_after,
            reference_type,
            reference_id,
            notes,
            created_by
        )
        VALUES (
            v_co,
            p_warehouse_id,
            v_product_id,
            'exit',
            -v_qty,
            v_stock,
            v_after,
            'sale',
            v_sale_id,
            'Salida por venta',
            auth.uid()
        );

    END LOOP;


    -- =============================================
    -- 5. ASOCIAR LA VENTA A SU BODEGA
    -- =============================================

    UPDATE public.sales
    SET warehouse_id = p_warehouse_id
    WHERE id = v_sale_id
      AND company_id = v_co;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'No se pudo asociar la venta a la bodega';
    END IF;


    RETURN v_sale_id;

END;
$function$;


-- =====================================================
-- 6. PERMISOS DE EJECUCIÓN
-- =====================================================

REVOKE ALL ON FUNCTION public.registrar_venta_bodega(
    uuid,
    jsonb,
    uuid,
    text,
    jsonb,
    uuid,
    timestamptz,
    text,
    numeric,
    numeric,
    text,
    numeric,
    numeric,
    numeric
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.registrar_venta_bodega(
    uuid,
    jsonb,
    uuid,
    text,
    jsonb,
    uuid,
    timestamptz,
    text,
    numeric,
    numeric,
    text,
    numeric,
    numeric,
    numeric
) TO authenticated;

COMMIT;
