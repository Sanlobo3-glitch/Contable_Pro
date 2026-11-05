BEGIN;

-- =====================================================
-- 1. CAMPOS DE RECEPCIÓN POR PRODUCTO
-- =====================================================

ALTER TABLE public.inventory_transfer_items
ADD COLUMN IF NOT EXISTS received_quantity numeric(14,3)
NOT NULL DEFAULT 0;

ALTER TABLE public.inventory_transfer_items
ADD COLUMN IF NOT EXISTS damaged_quantity numeric(14,3)
NOT NULL DEFAULT 0;

ALTER TABLE public.inventory_transfer_items
ADD COLUMN IF NOT EXISTS missing_quantity numeric(14,3)
NOT NULL DEFAULT 0;

ALTER TABLE public.inventory_transfer_items
ADD COLUMN IF NOT EXISTS receipt_notes text;


-- =====================================================
-- 2. VALIDACIONES DE CANTIDADES
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transfer_received_nonnegative'
          AND conrelid = 'public.inventory_transfer_items'::regclass
    ) THEN
        ALTER TABLE public.inventory_transfer_items
        ADD CONSTRAINT transfer_received_nonnegative
        CHECK (received_quantity >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transfer_damaged_nonnegative'
          AND conrelid = 'public.inventory_transfer_items'::regclass
    ) THEN
        ALTER TABLE public.inventory_transfer_items
        ADD CONSTRAINT transfer_damaged_nonnegative
        CHECK (damaged_quantity >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transfer_missing_nonnegative'
          AND conrelid = 'public.inventory_transfer_items'::regclass
    ) THEN
        ALTER TABLE public.inventory_transfer_items
        ADD CONSTRAINT transfer_missing_nonnegative
        CHECK (missing_quantity >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transfer_receipt_total_check'
          AND conrelid = 'public.inventory_transfer_items'::regclass
    ) THEN
        ALTER TABLE public.inventory_transfer_items
        ADD CONSTRAINT transfer_receipt_total_check
        CHECK (
            received_quantity
            + damaged_quantity
            + missing_quantity
            <= quantity
        );
    END IF;
END $$;


-- =====================================================
-- 3. BLOQUEAR RECEPCIÓN ANTIGUA SIN DETALLE
-- =====================================================

CREATE OR REPLACE FUNCTION public.process_inventory_transfer(
    p_transfer_id uuid,
    p_action text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id uuid;
    v_transfer public.inventory_transfers%ROWTYPE;
    v_item record;
    v_item_count integer := 0;
    v_movement_id uuid;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL
       OR NOT public.can_manage_inventory() THEN
        RAISE EXCEPTION 'No tienes permisos para gestionar inventario';
    END IF;

    IF p_action <> 'dispatch' THEN
        RAISE EXCEPTION
            'La recepción ahora requiere cantidades detalladas. Utiliza receive_inventory_transfer().';
    END IF;

    SELECT *
    INTO v_transfer
    FROM public.inventory_transfers t
    WHERE t.id = p_transfer_id
      AND t.company_id = v_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Traslado no encontrado';
    END IF;

    IF v_transfer.status <> 'draft' THEN
        RAISE EXCEPTION 'Solo se pueden despachar traslados en borrador';
    END IF;

    FOR v_item IN
        SELECT i.product_id, i.quantity
        FROM public.inventory_transfer_items i
        WHERE i.transfer_id = p_transfer_id
          AND i.company_id = v_company_id
        ORDER BY i.product_id
    LOOP

        v_item_count := v_item_count + 1;

        v_movement_id :=
            public.register_warehouse_movement(
                v_transfer.source_warehouse_id,
                v_item.product_id,
                'exit',
                v_item.quantity,
                'inventory_transfer',
                p_transfer_id,
                gen_random_uuid(),
                'Despacho de traslado'
            );

    END LOOP;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'El traslado no contiene productos';
    END IF;

    UPDATE public.inventory_transfers
    SET status = 'in_transit',
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    WHERE id = p_transfer_id
      AND company_id = v_company_id;

    RETURN 'Traslado despachado correctamente';

END;
$$;


-- =====================================================
-- 4. FUNCIÓN DE RECEPCIÓN CON CANTIDADES REALES
-- =====================================================

CREATE OR REPLACE FUNCTION public.receive_inventory_transfer(
    p_transfer_id uuid,
    p_items jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id uuid;
    v_transfer public.inventory_transfers%ROWTYPE;
    v_item record;
    v_expected_count integer;
    v_received_count integer;
    v_movement_id uuid;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL
       OR NOT public.can_manage_inventory() THEN
        RAISE EXCEPTION 'No tienes permisos para gestionar inventario';
    END IF;

    IF p_items IS NULL
       OR jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Debes enviar el detalle de recepción';
    END IF;

    SELECT *
    INTO v_transfer
    FROM public.inventory_transfers t
    WHERE t.id = p_transfer_id
      AND t.company_id = v_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Traslado no encontrado';
    END IF;

    IF v_transfer.status <> 'in_transit' THEN
        RAISE EXCEPTION 'El traslado no está en tránsito';
    END IF;

    SELECT count(*)
    INTO v_expected_count
    FROM public.inventory_transfer_items i
    WHERE i.transfer_id = p_transfer_id
      AND i.company_id = v_company_id;

    SELECT count(*)
    INTO v_received_count
    FROM jsonb_to_recordset(p_items) AS x(
        product_id uuid,
        received_quantity numeric,
        damaged_quantity numeric,
        missing_quantity numeric,
        notes text
    );

    IF v_received_count <> v_expected_count THEN
        RAISE EXCEPTION
            'Debes informar todos los productos del traslado. Esperados: %, recibidos: %',
            v_expected_count, v_received_count;
    END IF;

    -- No permitir productos repetidos en el detalle.
    IF (
        SELECT count(DISTINCT x.product_id)
        FROM jsonb_to_recordset(p_items) AS x(
            product_id uuid,
            received_quantity numeric,
            damaged_quantity numeric,
            missing_quantity numeric,
            notes text
        )
    ) <> v_received_count THEN
        RAISE EXCEPTION 'Hay productos repetidos en la recepción';
    END IF;

    FOR v_item IN
        SELECT
            x.product_id,
            x.received_quantity,
            x.damaged_quantity,
            x.missing_quantity,
            x.notes
        FROM jsonb_to_recordset(p_items) AS x(
            product_id uuid,
            received_quantity numeric,
            damaged_quantity numeric,
            missing_quantity numeric,
            notes text
        )
        ORDER BY x.product_id
    LOOP

        IF v_item.received_quantity IS NULL
           OR v_item.damaged_quantity IS NULL
           OR v_item.missing_quantity IS NULL
           OR v_item.received_quantity < 0
           OR v_item.damaged_quantity < 0
           OR v_item.missing_quantity < 0 THEN
            RAISE EXCEPTION 'Las cantidades de recepción deben ser válidas y no negativas';
        END IF;

        -- Validar que el producto pertenezca al traslado.
        PERFORM 1
        FROM public.inventory_transfer_items i
        WHERE i.transfer_id = p_transfer_id
          AND i.company_id = v_company_id
          AND i.product_id = v_item.product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'El producto % no pertenece al traslado',
                v_item.product_id;
        END IF;

        -- Las cantidades deben explicar exactamente lo despachado.
        IF (
            v_item.received_quantity
            + v_item.damaged_quantity
            + v_item.missing_quantity
        ) <> (
            SELECT i.quantity
            FROM public.inventory_transfer_items i
            WHERE i.transfer_id = p_transfer_id
              AND i.company_id = v_company_id
              AND i.product_id = v_item.product_id
        ) THEN
            RAISE EXCEPTION
                'La suma de recibido, dañado y faltante debe coincidir con lo enviado para el producto %',
                v_item.product_id;
        END IF;

        -- Guardar el detalle de recepción.
        UPDATE public.inventory_transfer_items
        SET received_quantity = v_item.received_quantity,
            damaged_quantity = v_item.damaged_quantity,
            missing_quantity = v_item.missing_quantity,
            receipt_notes = v_item.notes
        WHERE transfer_id = p_transfer_id
          AND company_id = v_company_id
          AND product_id = v_item.product_id;

        -- Solo las unidades buenas ingresan al inventario destino.
        IF v_item.received_quantity > 0 THEN

            v_movement_id :=
                public.register_warehouse_movement(
                    v_transfer.destination_warehouse_id,
                    v_item.product_id,
                    'entry',
                    v_item.received_quantity,
                    'inventory_transfer',
                    p_transfer_id,
                    gen_random_uuid(),
                    'Recepción de traslado'
                );

        END IF;

    END LOOP;

    UPDATE public.inventory_transfers
    SET status = 'received',
        received_by = auth.uid(),
        received_at = now(),
        updated_at = now()
    WHERE id = p_transfer_id
      AND company_id = v_company_id;

    RETURN 'Recepción registrada correctamente';

END;
$$;


-- =====================================================
-- 5. PERMISOS
-- =====================================================

REVOKE ALL ON FUNCTION public.receive_inventory_transfer(
    uuid, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.receive_inventory_transfer(
    uuid, jsonb
) TO authenticated, service_role;

COMMIT;
