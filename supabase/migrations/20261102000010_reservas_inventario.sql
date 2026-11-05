BEGIN;

-- =====================================================
-- 1. TABLA DE RESERVAS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.warehouse_stock_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id uuid NOT NULL
        REFERENCES public.companies(id) ON DELETE CASCADE,

    warehouse_id uuid NOT NULL,
    product_id uuid NOT NULL,

    quantity numeric(14,3) NOT NULL
        CHECK (quantity > 0),

    status text NOT NULL DEFAULT 'active'
        CHECK (
            status IN (
                'active',
                'consumed',
                'released',
                'expired'
            )
        ),

    reference_type text,
    reference_id uuid,

    idempotency_key uuid,

    expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),

    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reservation_stock_fk
        FOREIGN KEY (warehouse_id, product_id)
        REFERENCES public.warehouse_stock(warehouse_id, product_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS stock_reservations_company_idx
ON public.warehouse_stock_reservations(company_id, status);

CREATE INDEX IF NOT EXISTS stock_reservations_product_idx
ON public.warehouse_stock_reservations(
    company_id, warehouse_id, product_id, status
);

CREATE INDEX IF NOT EXISTS stock_reservations_expiry_idx
ON public.warehouse_stock_reservations(expires_at)
WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS stock_reservations_idempotency_uidx
ON public.warehouse_stock_reservations(company_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;


-- =====================================================
-- 2. SEGURIDAD
-- =====================================================

ALTER TABLE public.warehouse_stock_reservations
ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_reservations_select
ON public.warehouse_stock_reservations;

CREATE POLICY stock_reservations_select
ON public.warehouse_stock_reservations
FOR SELECT
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
);

REVOKE ALL ON public.warehouse_stock_reservations
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.warehouse_stock_reservations
TO authenticated;


-- =====================================================
-- 3. FUNCIÓN: RESERVAR EXISTENCIAS
-- =====================================================

CREATE OR REPLACE FUNCTION public.reserve_warehouse_stock(
    p_warehouse_id uuid,
    p_product_id uuid,
    p_quantity numeric,
    p_reference_type text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL,
    p_idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id uuid;
    v_reservation_id uuid;
    v_quantity numeric(14,3);
    v_reserved numeric(14,3);
    v_active boolean;
    v_existing public.warehouse_stock_reservations%ROWTYPE;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL
       OR NOT public.can_manage_inventory() THEN
        RAISE EXCEPTION 'No tienes permisos para reservar inventario';
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
    END IF;

    -- Evitar duplicados por reintentos.
    IF p_idempotency_key IS NOT NULL THEN

        SELECT *
        INTO v_existing
        FROM public.warehouse_stock_reservations r
        WHERE r.company_id = v_company_id
          AND r.idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing.warehouse_id <> p_warehouse_id
               OR v_existing.product_id <> p_product_id
               OR v_existing.quantity <> p_quantity THEN
                RAISE EXCEPTION 'La clave de operación ya fue utilizada con otros datos';
            END IF;

            IF v_existing.status <> 'active' THEN
                RAISE EXCEPTION 'La reserva anterior ya no está activa';
            END IF;

            RETURN v_existing.id;
        END IF;

    END IF;

    SELECT w.active
    INTO v_active
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.company_id = v_company_id;

    IF NOT FOUND OR v_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Bodega inexistente o inactiva';
    END IF;

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

    SELECT ws.quantity, ws.reserved_quantity
    INTO v_quantity, v_reserved
    FROM public.warehouse_stock ws
    WHERE ws.company_id = v_company_id
      AND ws.warehouse_id = p_warehouse_id
      AND ws.product_id = p_product_id
    FOR UPDATE;

    IF v_quantity - v_reserved < p_quantity THEN
        RAISE EXCEPTION
            'Stock disponible insuficiente. Disponible: %',
            v_quantity - v_reserved;
    END IF;

    UPDATE public.warehouse_stock
    SET reserved_quantity = reserved_quantity + p_quantity,
        updated_at = now()
    WHERE company_id = v_company_id
      AND warehouse_id = p_warehouse_id
      AND product_id = p_product_id;

    INSERT INTO public.warehouse_stock_reservations (
        company_id,
        warehouse_id,
        product_id,
        quantity,
        reference_type,
        reference_id,
        idempotency_key,
        created_by
    )
    VALUES (
        v_company_id,
        p_warehouse_id,
        p_product_id,
        p_quantity,
        p_reference_type,
        p_reference_id,
        p_idempotency_key,
        auth.uid()
    )
    RETURNING id INTO v_reservation_id;

    RETURN v_reservation_id;

END;
$$;


-- =====================================================
-- 4. FUNCIÓN: LIBERAR RESERVA
-- =====================================================

CREATE OR REPLACE FUNCTION public.release_warehouse_reservation(
    p_reservation_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id uuid;
    v_reservation public.warehouse_stock_reservations%ROWTYPE;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL
       OR NOT public.can_manage_inventory() THEN
        RAISE EXCEPTION 'No tienes permisos para liberar reservas';
    END IF;

    SELECT *
    INTO v_reservation
    FROM public.warehouse_stock_reservations r
    WHERE r.id = p_reservation_id
      AND r.company_id = v_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserva no encontrada';
    END IF;

    IF v_reservation.status <> 'active' THEN
        RETURN 'La reserva ya fue procesada';
    END IF;

    UPDATE public.warehouse_stock
    SET reserved_quantity = reserved_quantity - v_reservation.quantity,
        updated_at = now()
    WHERE company_id = v_company_id
      AND warehouse_id = v_reservation.warehouse_id
      AND product_id = v_reservation.product_id
      AND reserved_quantity >= v_reservation.quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo liberar la cantidad reservada';
    END IF;

    UPDATE public.warehouse_stock_reservations
    SET status = CASE
            WHEN expires_at <= now() THEN 'expired'
            ELSE 'released'
        END,
        updated_at = now()
    WHERE id = p_reservation_id;

    RETURN 'Reserva liberada correctamente';

END;
$$;


-- =====================================================
-- 5. FUNCIÓN: CONFIRMAR RESERVA Y DESCONTAR STOCK
-- =====================================================

CREATE OR REPLACE FUNCTION public.consume_warehouse_reservation(
    p_reservation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id uuid;
    v_reservation public.warehouse_stock_reservations%ROWTYPE;
    v_quantity numeric(14,3);
    v_reserved numeric(14,3);
    v_movement_id uuid;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    v_company_id := public.current_company_id();

    IF v_company_id IS NULL
       OR NOT public.can_manage_inventory() THEN
        RAISE EXCEPTION 'No tienes permisos para confirmar reservas';
    END IF;

    SELECT *
    INTO v_reservation
    FROM public.warehouse_stock_reservations r
    WHERE r.id = p_reservation_id
      AND r.company_id = v_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserva no encontrada';
    END IF;

    IF v_reservation.status <> 'active' THEN
        RAISE EXCEPTION 'La reserva no está activa';
    END IF;

    IF v_reservation.expires_at <= now() THEN
        UPDATE public.warehouse_stock
        SET reserved_quantity = reserved_quantity - v_reservation.quantity,
            updated_at = now()
        WHERE company_id = v_company_id
          AND warehouse_id = v_reservation.warehouse_id
          AND product_id = v_reservation.product_id
          AND reserved_quantity >= v_reservation.quantity;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se pudo liberar la reserva vencida';
        END IF;

        UPDATE public.warehouse_stock_reservations
        SET status = 'expired',
            updated_at = now()
        WHERE id = p_reservation_id;

        RETURN NULL;
    END IF;

    SELECT ws.quantity, ws.reserved_quantity
    INTO v_quantity, v_reserved
    FROM public.warehouse_stock ws
    WHERE ws.company_id = v_company_id
      AND ws.warehouse_id = v_reservation.warehouse_id
      AND ws.product_id = v_reservation.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Existencia no encontrada';
    END IF;

    IF v_quantity < v_reservation.quantity
       OR v_reserved < v_reservation.quantity THEN
        RAISE EXCEPTION 'Existencia reservada inconsistente';
    END IF;

    UPDATE public.warehouse_stock
    SET quantity = quantity - v_reservation.quantity,
        reserved_quantity = reserved_quantity - v_reservation.quantity,
        updated_at = now()
    WHERE company_id = v_company_id
      AND warehouse_id = v_reservation.warehouse_id
      AND product_id = v_reservation.product_id;

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
        v_reservation.warehouse_id,
        v_reservation.product_id,
        'exit',
        -v_reservation.quantity,
        v_quantity,
        v_quantity - v_reservation.quantity,
        COALESCE(v_reservation.reference_type, 'reservation'),
        COALESCE(v_reservation.reference_id, v_reservation.id),
        v_reservation.id,
        'Consumo de reserva de inventario',
        auth.uid()
    )
    RETURNING id INTO v_movement_id;

    UPDATE public.warehouse_stock_reservations
    SET status = 'consumed',
        updated_at = now()
    WHERE id = p_reservation_id;

    RETURN v_movement_id;

END;
$$;


-- =====================================================
-- 6. PERMISOS DE FUNCIONES
-- =====================================================

REVOKE ALL ON FUNCTION public.reserve_warehouse_stock(
    uuid, uuid, numeric, text, uuid, uuid
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.release_warehouse_reservation(
    uuid
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.consume_warehouse_reservation(
    uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reserve_warehouse_stock(
    uuid, uuid, numeric, text, uuid, uuid
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.release_warehouse_reservation(
    uuid
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.consume_warehouse_reservation(
    uuid
) TO authenticated, service_role;


-- =====================================================
-- 7. REALTIME
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
          AND tablename = 'warehouse_stock_reservations'
    ) THEN
        ALTER PUBLICATION supabase_realtime
        ADD TABLE public.warehouse_stock_reservations;
    END IF;
END $$;

COMMIT;
