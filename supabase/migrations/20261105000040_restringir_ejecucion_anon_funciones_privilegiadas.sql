-- ============================================================
-- 000040: RESTRINGIR EJECUCION ANON EN FUNCIONES PRIVILEGIADAS
-- ============================================================
-- Objetivo:
--   1. Retirar EXECUTE a anon en funciones internas y privadas.
--   2. Mantener EXECUTE autenticado donde corresponde.
--   3. Proteger funciones de trigger contra llamadas RPC directas.
--   4. Fijar search_path de push_public_key.
--
-- Se conservan las funciones públicas del catálogo, pedidos
-- e invitaciones que requieren acceso anónimo.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. FUNCIONES INTERNAS: SOLO USUARIOS AUTENTICADOS
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.clonar_presupuesto_mes(
    date, date, numeric, boolean
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.clonar_presupuesto_mes(
    date, date, numeric, boolean
) TO authenticated;


REVOKE ALL ON FUNCTION public.company_device_usage(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.company_device_usage(uuid)
TO authenticated;


REVOKE ALL ON FUNCTION public.my_company_subscription()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_company_subscription()
TO authenticated;


REVOKE ALL ON FUNCTION public.registrar_venta_bodega(
    uuid, jsonb, uuid, text, jsonb, uuid,
    timestamptz, text, numeric, numeric,
    text, numeric, numeric, numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.registrar_venta_bodega(
    uuid, jsonb, uuid, text, jsonb, uuid,
    timestamptz, text, numeric, numeric,
    text, numeric, numeric, numeric
) TO authenticated;


REVOKE ALL ON FUNCTION public.resumen_presupuesto_ejecucion(
    date, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.resumen_presupuesto_ejecucion(
    date, uuid
) TO authenticated;


-- ------------------------------------------------------------
-- 2. FUNCIONES EXCLUSIVAS DE TRIGGERS
-- No deben exponerse como endpoints RPC.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public._sales_stamp_seller()
FROM PUBLIC, anon, authenticated;


REVOKE ALL ON FUNCTION public._sync_product_image_to_product()
FROM PUBLIC, anon, authenticated;


REVOKE ALL ON FUNCTION public.fn_sync_company_brand_and_slug()
FROM PUBLIC, anon, authenticated;


REVOKE ALL ON FUNCTION public.protect_admin_role()
FROM PUBLIC, anon, authenticated;


REVOKE ALL ON FUNCTION public.route_stops_autoclose()
FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------
-- 3. FIJAR SEARCH_PATH DE LA CLAVE PUBLICA VAPID
-- La clave continúa siendo pública; solo se fija el esquema.
-- ------------------------------------------------------------

ALTER FUNCTION public.push_public_key()
SET search_path = pg_catalog;


-- ------------------------------------------------------------
-- 4. VALIDACIONES
-- ------------------------------------------------------------

DO $validation$
DECLARE
    v_function text;
BEGIN
    FOREACH v_function IN ARRAY ARRAY[
        'public.clonar_presupuesto_mes(date,date,numeric,boolean)',
        'public.company_device_usage(uuid)',
        'public.my_company_subscription()',
        'public.registrar_venta_bodega(uuid,jsonb,uuid,text,jsonb,uuid,timestamptz,text,numeric,numeric,text,numeric,numeric,numeric)',
        'public.resumen_presupuesto_ejecucion(date,uuid)',
        'public._sales_stamp_seller()',
        'public._sync_product_image_to_product()',
        'public.fn_sync_company_brand_and_slug()',
        'public.protect_admin_role()',
        'public.route_stops_autoclose()'
    ]
    LOOP
        IF to_regprocedure(v_function) IS NULL THEN
            RAISE EXCEPTION
                'No existe la función requerida: %', v_function;
        END IF;
    END LOOP;

    IF has_function_privilege(
        'anon',
        'public.clonar_presupuesto_mes(date,date,numeric,boolean)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'La función clonar_presupuesto_mes continúa accesible a anon';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.registrar_venta_bodega(uuid,jsonb,uuid,text,jsonb,uuid,timestamptz,text,numeric,numeric,text,numeric,numeric,numeric)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'registrar_venta_bodega continúa accesible a anon';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.my_company_subscription()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'my_company_subscription continúa accesible a anon';
    END IF;
END;
$validation$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000040
-- ============================================================
