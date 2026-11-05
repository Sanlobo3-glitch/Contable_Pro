BEGIN;

-- ============================================================
-- 000044: SEGURIDAD DEL PIN Y SEGUIMIENTO DE PEDIDOS PÚBLICOS
-- ============================================================
-- 1. Los pedidos nuevos reciben PIN aleatorio de seis dígitos.
-- 2. El teléfono deja de funcionar como credencial de seguimiento.
-- 3. La consulta pública no expone notas administrativas ni
--    referencias internas de pago.
-- 4. Se conserva la firma y los permisos de las funciones.
-- 5. No se modifica la gestión administrativa de pedidos.
-- ============================================================

DO $migration$
DECLARE
    v_signature text :=
      'public.crear_pedido_catalogo_publico(uuid,text,text,text,text,text,jsonb,text,text,boolean,text,text,text,text,text,numeric,text,text,numeric)';
    v_definition text;
    v_old text;
    v_new text;
BEGIN
    IF to_regprocedure(v_signature) IS NULL THEN
        RAISE EXCEPTION
          'No existe la función esperada: %', v_signature;
    END IF;

    v_definition := pg_get_functiondef(
      to_regprocedure(v_signature)
    );

    -- Bloque anterior: PIN derivado del teléfono.
    v_old := $old$
  v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  IF length(v_digits) >= 4 THEN
    v_pin := right(v_digits, 4);
  ELSE
    v_pin := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
  END IF;
$old$;

    -- Nuevo PIN aleatorio de seis dígitos.
    v_new := $new$
  v_pin := lpad(
    (
      (
        ('x' || substr(
          replace(gen_random_uuid()::text, '-', ''),
          1,
          8
        ))::bit(32)::bigint % 900000
      ) + 100000
    )::text,
    6,
    '0'
  );
$new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION
          'No coincide el bloque original de generación del PIN. No se modificó la función.';
    END IF;

    v_definition := replace(v_definition, v_old, v_new);

    EXECUTE v_definition;

    -- Confirmar que la modificación quedó en la definición.
    v_definition := pg_get_functiondef(
      to_regprocedure(v_signature)
    );

    IF position('gen_random_uuid' IN v_definition) = 0
       OR position('right(v_digits, 4)' IN v_definition) > 0 THEN
        RAISE EXCEPTION
          'La validación de generación aleatoria del PIN falló.';
    END IF;
END;
$migration$;


-- ============================================================
-- CONSULTA PÚBLICA: EXIGIR PIN EXACTO
-- ============================================================

CREATE OR REPLACE FUNCTION public.consultar_pedido_catalogo_publico(
    p_company_id uuid,
    p_order_number text,
    p_pin_or_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ord public.catalog_orders%ROWTYPE;
    v_code text := upper(btrim(coalesce(p_order_number, '')));
    v_pin text := regexp_replace(
        coalesce(p_pin_or_phone, ''),
        '[^0-9]',
        '',
        'g'
    );
BEGIN
    IF p_company_id IS NULL
       OR v_code = ''
       OR length(v_pin) <> 6 THEN
        RETURN jsonb_build_object(
            'found', false,
            'reason',
            'Ingresa el código del pedido y el PIN de seis dígitos.'
        );
    END IF;

    SELECT *
    INTO v_ord
    FROM public.catalog_orders co
    WHERE co.company_id = p_company_id
      AND upper(btrim(co.order_number)) = v_code
    ORDER BY co.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'found', false,
            'reason',
            'No encontramos ningún pedido con ese código en este catálogo.'
        );
    END IF;

    -- Ya no se acepta el teléfono ni sus últimos cuatro dígitos.
    IF v_ord.tracking_pin IS NULL
       OR v_ord.tracking_pin <> v_pin THEN
        RETURN jsonb_build_object(
            'found', false,
            'reason',
            'El PIN ingresado no coincide con el pedido.'
        );
    END IF;

    -- Respuesta limitada a información de seguimiento del cliente.
    RETURN jsonb_build_object(
        'found', true,
        'order', jsonb_build_object(
            'order_number', v_ord.order_number,
            'customer_name', v_ord.customer_name,
            'customer_type', v_ord.customer_type,
            'total', v_ord.total,
            'currency', v_ord.currency,
            'payment_method', v_ord.payment_method,
            'payment_status', v_ord.payment_status,
            'order_status', v_ord.order_status,
            'delivery_mode', v_ord.delivery_mode,
            'verified_at', v_ord.verified_at,
            'created_at', v_ord.created_at,
            'items', coalesce(v_ord.items, '[]'::jsonb)
        )
    );
END;
$function$;


-- ============================================================
-- PERMISOS: CONSERVAR EL ACCESO PÚBLICO NECESARIO
-- ============================================================

REVOKE ALL ON FUNCTION
  public.consultar_pedido_catalogo_publico(uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.consultar_pedido_catalogo_publico(uuid, text, text)
TO anon, authenticated, service_role;


-- ============================================================
-- VALIDACIONES
-- ============================================================

DO $validation$
DECLARE
    v_definition text;
    v_signature text :=
      'public.crear_pedido_catalogo_publico(uuid,text,text,text,text,text,jsonb,text,text,boolean,text,text,text,text,text,numeric,text,text,numeric)';
BEGIN
    v_definition := pg_get_functiondef(
      'public.consultar_pedido_catalogo_publico(uuid,text,text)'::regprocedure
    );

    IF position('admin_notes' IN v_definition) > 0 THEN
        RAISE EXCEPTION
          'La consulta pública todavía contiene admin_notes.';
    END IF;

    IF position('payment_reference' IN v_definition) > 0 THEN
        RAISE EXCEPTION
          'La consulta pública todavía contiene payment_reference.';
    END IF;

    IF position('v_phone_digits' IN v_definition) > 0 THEN
        RAISE EXCEPTION
          'La consulta pública todavía contiene validación por teléfono.';
    END IF;

    IF NOT has_function_privilege(
        'anon',
        'public.consultar_pedido_catalogo_publico(uuid,text,text)'::regprocedure,
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
          'Se perdió el permiso público de consulta del catálogo.';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.consultar_pedido_catalogo_publico(uuid,text,text)'::regprocedure,
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
          'Se perdió el permiso de authenticated para consultar pedidos.';
    END IF;

    IF to_regprocedure(v_signature) IS NULL THEN
        RAISE EXCEPTION
          'La función de creación de pedidos dejó de existir.';
    END IF;

    IF NOT has_function_privilege(
        'anon',
        to_regprocedure(v_signature),
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
          'Se perdió el permiso público de creación de pedidos.';
    END IF;
END;
$validation$;

NOTIFY pgrst, 'reload schema';

COMMIT;
