BEGIN;

-- =====================================================
-- 1. PERMISOS: LOS TRASLADOS SE PROCESAN POR FUNCIÓN
-- =====================================================

DROP POLICY IF EXISTS inventory_transfers_access
ON public.inventory_transfers;

DROP POLICY IF EXISTS inventory_transfer_items_access
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfers_select
ON public.inventory_transfers
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
);

CREATE POLICY inventory_transfers_insert_draft
ON public.inventory_transfers
FOR INSERT
TO authenticated
WITH CHECK (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
    AND status = 'draft'
);

CREATE POLICY inventory_transfers_update_draft
ON public.inventory_transfers
FOR UPDATE
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
    AND status = 'draft'
)
WITH CHECK (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
    AND status = 'draft'
);

CREATE POLICY inventory_transfers_delete_draft
ON public.inventory_transfers
FOR DELETE
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
    AND status = 'draft'
);


-- =====================================================
-- 2. PERMISOS PARA LOS PRODUCTOS DEL TRASLADO
-- =====================================================

CREATE POLICY inventory_transfer_items_select
ON public.inventory_transfer_items
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
);

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
        WHERE t.id = transfer_id
          AND t.company_id = company_id
          AND t.status = 'draft'
    )
);

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
        WHERE t.id = transfer_id
          AND t.company_id = company_id
          AND t.status = 'draft'
    )
)
WITH CHECK (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
    AND EXISTS (
        SELECT 1
        FROM public.inventory_transfers t
        WHERE t.id = transfer_id
          AND t.company_id = company_id
          AND t.status = 'draft'
    )
);

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
        WHERE t.id = transfer_id
          AND t.company_id = company_id
          AND t.status = 'draft'
    )
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.inventory_transfers,
   public.inventory_transfer_items
TO authenticated;


-- =====================================================
-- 3. FUNCIÓN PARA DESPACHAR Y RECIBIR TRASLADOS
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

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'No tienes una empresa asignada';
    END IF;

    IF NOT public.can_manage_inventory() THEN
        RAISE EXCEPTION 'No tienes permisos para gestionar inventario';
    END IF;

    IF p_action NOT IN ('dispatch', 'receive') THEN
        RAISE EXCEPTION 'Acción no válida';
    END IF;

    -- Bloquear el traslado para impedir procesamiento simultáneo.
    SELECT *
    INTO v_transfer
    FROM public.inventory_transfers t
    WHERE t.id = p_transfer_id
      AND t.company_id = v_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Traslado no encontrado';
    END IF;

    -- =================================================
    -- DESPACHAR: descontar de la bodega de origen
    -- =================================================

    IF p_action = 'dispatch' THEN

        IF v_transfer.status <> 'draft' THEN
            RAISE EXCEPTION 'Solo se pueden despachar traslados en borrador';
        END IF;

        FOR v_item IN
            SELECT
                i.product_id,
                i.quantity
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

    END IF;


    -- =================================================
    -- RECIBIR: aumentar existencias en destino
    -- =================================================

    IF p_action = 'receive' THEN

        IF v_transfer.status <> 'in_transit' THEN
            RAISE EXCEPTION 'El traslado no está en tránsito';
        END IF;

        FOR v_item IN
            SELECT
                i.product_id,
                i.quantity
            FROM public.inventory_transfer_items i
            WHERE i.transfer_id = p_transfer_id
              AND i.company_id = v_company_id
            ORDER BY i.product_id
        LOOP

            v_item_count := v_item_count + 1;

            v_movement_id :=
                public.register_warehouse_movement(
                    v_transfer.destination_warehouse_id,
                    v_item.product_id,
                    'entry',
                    v_item.quantity,
                    'inventory_transfer',
                    p_transfer_id,
                    gen_random_uuid(),
                    'Recepción de traslado'
                );

        END LOOP;

        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'El traslado no contiene productos';
        END IF;

        UPDATE public.inventory_transfers
        SET status = 'received',
            received_by = auth.uid(),
            received_at = now(),
            updated_at = now()
        WHERE id = p_transfer_id
          AND company_id = v_company_id;

        RETURN 'Traslado recibido correctamente';

    END IF;

    RAISE EXCEPTION 'No se pudo procesar el traslado';

END;
$$;


-- =====================================================
-- 4. PERMISOS DE EJECUCIÓN
-- =====================================================

REVOKE ALL ON FUNCTION public.process_inventory_transfer(
    uuid, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.process_inventory_transfer(
    uuid, text
) TO authenticated, service_role;


-- =====================================================
-- 5. DOCUMENTACIÓN
-- =====================================================

COMMENT ON FUNCTION public.process_inventory_transfer(uuid, text)
IS 'Despacha o recibe traslados de inventario de forma transaccional y registra los movimientos en el kardex. Acciones: dispatch y receive.';

COMMIT;
