BEGIN;

-- =====================================================
-- 1. HISTORIAL DE MOVIMIENTOS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.warehouse_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id uuid NOT NULL
        REFERENCES public.companies(id) ON DELETE CASCADE,

    warehouse_id uuid NOT NULL,
    product_id uuid NOT NULL,

    movement_type text NOT NULL
        CHECK (
            movement_type IN (
                'entry',
                'exit',
                'adjustment'
            )
        ),

    quantity_delta numeric(14,3) NOT NULL
        CHECK (quantity_delta <> 0),

    quantity_before numeric(14,3) NOT NULL,
    quantity_after numeric(14,3) NOT NULL,

    reference_type text,
    reference_id uuid,
    idempotency_key uuid,

    notes text,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT warehouse_movements_warehouse_fk
        FOREIGN KEY (warehouse_id, company_id)
        REFERENCES public.warehouses(id, company_id)
        ON DELETE RESTRICT,

    CONSTRAINT warehouse_movements_product_fk
        FOREIGN KEY (product_id, company_id)
        REFERENCES public.products(id, company_id)
        ON DELETE RESTRICT,

    CONSTRAINT warehouse_movements_quantity_check
        CHECK (quantity_after >= 0)
);

CREATE INDEX IF NOT EXISTS warehouse_movements_company_date_idx
ON public.warehouse_movements(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS warehouse_movements_product_idx
ON public.warehouse_movements(company_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS warehouse_movements_warehouse_idx
ON public.warehouse_movements(company_id, warehouse_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_movements_idempotency_uidx
ON public.warehouse_movements(company_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;


-- =====================================================
-- 2. SEGURIDAD RLS DEL KARDEX
-- =====================================================

ALTER TABLE public.warehouse_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_movements_select
ON public.warehouse_movements;

CREATE POLICY warehouse_movements_select
ON public.warehouse_movements
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
);

REVOKE ALL ON public.warehouse_movements FROM PUBLIC, anon;
GRANT SELECT ON public.warehouse_movements TO authenticated;


-- =====================================================
-- 3. FUNCIÓN TRANSACCIONAL DE MOVIMIENTOS
-- =====================================================

CREATE OR REPLACE FUNCTION public.register_warehouse_movement(
    p_warehouse_id uuid,
    p_product_id uuid,
    p_movement_type text,
    p_quantity numeric,
    p_reference_type text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL,
    p_idempotency_key uuid DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id uuid;
    v_movement_id uuid;
    v_quantity_before numeric(14,3);
    v_quantity_after numeric(14,3);
    v_reserved numeric(14,3);
    v_warehouse_active boolean;
    v_delta numeric(14,3);
BEGIN

    -- Usuario autenticado
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'El usuario no tiene empresa asignada';
    END IF;

    IF NOT public.can_manage_inventory() THEN
        RAISE EXCEPTION 'No tienes permisos para gestionar inventario';
    END IF;

    -- Validar tipo de movimiento
    IF p_movement_type NOT IN ('entry', 'exit', 'adjustment') THEN
        RAISE EXCEPTION 'Tipo de movimiento no válido';
    END IF;

    IF p_quantity IS NULL OR p_quantity = 0 THEN
        RAISE EXCEPTION 'La cantidad no puede ser cero';
    END IF;

    IF p_movement_type IN ('entry', 'exit') AND p_quantity < 0 THEN
        RAISE EXCEPTION 'Entradas y salidas requieren cantidad positiva';
    END IF;

    -- Reintentos con la misma clave no deben duplicar movimientos.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT wm.id
        INTO v_movement_id
        FROM public.warehouse_movements wm
        WHERE wm.company_id = v_company_id
          AND wm.idempotency_key = p_idempotency_key;

        IF v_movement_id IS NOT NULL THEN
            RETURN v_movement_id;
        END IF;
    END IF;

    -- Verificar que la bodega esté activa y pertenezca a la empresa.
    SELECT w.active
    INTO v_warehouse_active
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.company_id = v_company_id;

    IF NOT FOUND OR v_warehouse_active IS NOT TRUE THEN
        RAISE EXCEPTION 'La bodega no existe o está inactiva';
    END IF;

    -- Crear registro inicial si el producto aún no tiene stock en bodega.
    INSERT INTO public.warehouse_stock (
        company_id,
        warehouse_id,
        product_id,
        quantity,
        reserved_quantity
    )
    VALUES (
        v_company_id,
        p_warehouse_id,
        p_product_id,
        0,
        0
    )
    ON CONFLICT (warehouse_id, product_id) DO NOTHING;

    -- Bloqueo de fila para impedir descuentos simultáneos.
    SELECT ws.quantity, ws.reserved_quantity
    INTO v_quantity_before, v_reserved
    FROM public.warehouse_stock ws
    WHERE ws.company_id = v_company_id
      AND ws.warehouse_id = p_warehouse_id
      AND ws.product_id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo bloquear la existencia';
    END IF;

    -- Calcular variación.
    IF p_movement_type = 'entry' THEN
        v_delta := p_quantity;

    ELSIF p_movement_type = 'exit' THEN
        v_delta := -p_quantity;

    ELSE
        -- En ajustes se permite cantidad positiva o negativa.
        v_delta := p_quantity;
    END IF;

    v_quantity_after := v_quantity_before + v_delta;

    -- No permitir salidas superiores al stock disponible.
    IF p_movement_type = 'exit'
       AND (v_quantity_before - v_reserved) < p_quantity THEN
        RAISE EXCEPTION 'Stock disponible insuficiente. Disponible: %',
            v_quantity_before - v_reserved;
    END IF;

    -- Un ajuste no puede dejar el stock por debajo de lo reservado.
    IF v_quantity_after < v_reserved THEN
        RAISE EXCEPTION 'El ajuste dejaría existencias por debajo de lo reservado';
    END IF;

    IF v_quantity_after < 0 THEN
        RAISE EXCEPTION 'La existencia no puede ser negativa';
    END IF;

    -- Actualizar existencia.
    UPDATE public.warehouse_stock
    SET quantity = v_quantity_after,
        updated_at = now()
    WHERE company_id = v_company_id
      AND warehouse_id = p_warehouse_id
      AND product_id = p_product_id;

    -- Registrar el movimiento en el kardex.
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
        idempotency_key,
        notes,
        created_by
    )
    VALUES (
        v_company_id,
        p_warehouse_id,
        p_product_id,
        p_movement_type,
        v_delta,
        v_quantity_before,
        v_quantity_after,
        p_reference_type,
        p_reference_id,
        p_idempotency_key,
        p_notes,
        auth.uid()
    )
    RETURNING id INTO v_movement_id;

    RETURN v_movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_warehouse_movement(
    uuid, uuid, text, numeric, text, uuid, uuid, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.register_warehouse_movement(
    uuid, uuid, text, numeric, text, uuid, uuid, text
) TO authenticated, service_role;


-- =====================================================
-- 4. REALTIME
-- =====================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'warehouse_movements'
    ) THEN
        ALTER PUBLICATION supabase_realtime
        ADD TABLE public.warehouse_movements;
    END IF;
END $$;

COMMIT;
