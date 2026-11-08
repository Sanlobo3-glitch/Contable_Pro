-- ============================================================
-- 000041: OCULTAR STOCK EXACTO EN VERIFICACION PUBLICA
-- ============================================================
-- Respeta company_config.catalog_show_stock.
-- Conserva la consulta publica de disponibilidad.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.verificar_stock_catalogo_publico(
    p_company_id uuid,
    p_product_id uuid,
    p_requested_base_qty numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_cfg record;
    v_prod public.products%ROWTYPE;
    v_stock numeric := 0;
    v_req numeric := greatest(0, coalesce(p_requested_base_qty, 0));
    v_public_stock numeric := 0;
BEGIN
    IF p_company_id IS NULL OR p_product_id IS NULL THEN
        RETURN jsonb_build_object(
            'available', false,
            'found', false,
            'in_stock', false,
            'stock', 0,
            'can_fulfill', false,
            'reason', 'Parámetros de verificación incompletos.'
        );
    END IF;

    SELECT
        coalesce(cc.catalog_enabled, true) AS catalog_enabled,
        coalesce(cc.catalog_show_stock, true) AS catalog_show_stock
    INTO v_cfg
    FROM public.company_config cc
    WHERE cc.company_id = p_company_id
    LIMIT 1;

    IF NOT FOUND OR NOT v_cfg.catalog_enabled THEN
        RETURN jsonb_build_object(
            'available', false,
            'found', false,
            'in_stock', false,
            'stock', 0,
            'can_fulfill', false,
            'reason', 'Este catálogo digital no se encuentra disponible.'
        );
    END IF;

    SELECT *
    INTO v_prod
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.company_id = p_company_id
      AND coalesce(p.catalog_visible, true) = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'available', false,
            'found', false,
            'in_stock', false,
            'stock', 0,
            'can_fulfill', false,
            'reason', 'El producto ya no se encuentra disponible en el catálogo.'
        );
    END IF;

    v_stock := greatest(0, coalesce(v_prod.stock, 0));

    -- Mantener el mismo criterio del catálogo público:
    -- stock exacto solo cuando la empresa lo permite.
    v_public_stock :=
        CASE
            WHEN v_cfg.catalog_show_stock THEN v_stock
            WHEN v_stock > 0 THEN 1
            ELSE 0
        END;

    RETURN jsonb_build_object(
        'available', true,
        'found', true,
        'product_id', v_prod.id,
        'name', v_prod.name,
        'unit', coalesce(v_prod.unit, 'unidad'),
        'stock', v_public_stock,
        'in_stock', (v_stock > 0),
        'show_stock', v_cfg.catalog_show_stock,
        'can_fulfill', (v_stock >= v_req),
        'variants', coalesce(v_prod.variants, '[]'::jsonb)
    );
END;
$function$;

-- ------------------------------------------------------------
-- VALIDACIONES
-- ------------------------------------------------------------

DO $validation$
BEGIN
    IF to_regprocedure(
        'public.verificar_stock_catalogo_publico(uuid,uuid,numeric)'
    ) IS NULL THEN
        RAISE EXCEPTION
            'No existe verificar_stock_catalogo_publico';
    END IF;

    IF NOT has_function_privilege(
        'anon',
        'public.verificar_stock_catalogo_publico(uuid,uuid,numeric)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Se perdió el acceso público requerido para verificar stock';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.verificar_stock_catalogo_publico(uuid,uuid,numeric)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Se perdió el acceso autenticado a la verificación de stock';
    END IF;
END;
$validation$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000041
-- ============================================================
