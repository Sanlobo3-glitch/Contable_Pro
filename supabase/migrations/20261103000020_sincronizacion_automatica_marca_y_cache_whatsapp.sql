-- ============================================================================
-- INVENTARIOPRO · MIGRACIÓN 000020
-- Sincronización Automática de Identidad Comercial (Nombre -> /tienda/<alias>),
-- Historial de Alias Previos sin Enlaces Rotos y Huella Anti-Caché para WhatsApp
-- 100% Idempotente
-- ============================================================================

BEGIN;

-- 1. Historial de alias anteriores para que enlaces ya enviados por WhatsApp jamás se rompan
ALTER TABLE public.company_config
  ADD COLUMN IF NOT EXISTS previous_catalog_slugs text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_company_config_prev_slugs_gin
  ON public.company_config USING gin (previous_catalog_slugs);

-- 2. Trigger automático al insertar o actualizar company_config desde Configuración o Identidad
CREATE OR REPLACE FUNCTION public.fn_sync_company_brand_and_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_old_name text := btrim(coalesce(CASE WHEN TG_OP = 'UPDATE' THEN OLD.name ELSE NULL END, ''));
  v_new_name text := btrim(coalesce(NEW.name, ''));
  v_old_auto_slug text;
  v_new_auto_slug text;
  v_candidate text;
  v_old_slug text := lower(btrim(coalesce(CASE WHEN TG_OP = 'UPDATE' THEN OLD.catalog_slug ELSE NULL END, '')));
  v_new_slug text := lower(btrim(coalesce(NEW.catalog_slug, '')));
  v_tagline text;
BEGIN
  v_new_auto_slug := coalesce(public.normalizar_slug_catalogo(v_new_name), 'tienda');

  IF TG_OP = 'INSERT' THEN
    IF v_new_slug = '' THEN
      v_candidate := v_new_auto_slug;
      IF EXISTS (
        SELECT 1 FROM public.company_config cc
        WHERE lower(btrim(coalesce(cc.catalog_slug, ''))) = v_candidate
      ) THEN
        v_candidate := left(v_new_auto_slug, 52) || '-' || left(replace(coalesce(NEW.company_id::text, gen_random_uuid()::text), '-', ''), 4);
      END IF;
      NEW.catalog_slug := v_candidate;
    ELSE
      NEW.catalog_slug := public.normalizar_slug_catalogo(v_new_slug);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_auto_slug := coalesce(public.normalizar_slug_catalogo(v_old_name), '');

    -- Si cambió el nombre de la empresa y no enviaron un alias manual distinto en este mismo UPDATE,
    -- actualizar el alias comercial cuando estaba vacío o derivado del nombre anterior.
    IF lower(v_old_name) IS DISTINCT FROM lower(v_new_name) AND v_new_name <> '' THEN
      IF v_new_slug = ''
         OR (
           v_new_slug = v_old_slug
           AND (
             v_old_slug = v_old_auto_slug
             OR (v_old_auto_slug <> '' AND v_old_slug LIKE v_old_auto_slug || '-%')
           )
         )
      THEN
        IF v_old_slug <> '' AND v_old_slug <> v_new_auto_slug THEN
          SELECT coalesce(array_agg(DISTINCT s), '{}'::text[])
          INTO NEW.previous_catalog_slugs
          FROM unnest(array_append(coalesce(NEW.previous_catalog_slugs, '{}'::text[]), v_old_slug)) AS s
          WHERE s IS NOT NULL AND btrim(s) <> '' AND lower(btrim(s)) <> v_new_auto_slug;
        END IF;

        v_candidate := v_new_auto_slug;
        IF EXISTS (
          SELECT 1 FROM public.company_config cc
          WHERE cc.id <> NEW.id
            AND lower(btrim(coalesce(cc.catalog_slug, ''))) = v_candidate
        ) THEN
          v_candidate := left(v_new_auto_slug, 52) || '-' || left(replace(coalesce(NEW.company_id::text, NEW.id::text), '-', ''), 4);
        END IF;
        NEW.catalog_slug := v_candidate;
      END IF;

      -- Si el eslogan de WhatsApp aún contenía el nombre anterior autogenerado, actualizarlo al nuevo nombre
      IF NEW.whatsapp_settings IS NOT NULL
         AND jsonb_typeof(NEW.whatsapp_settings) = 'object'
         AND v_old_name <> ''
      THEN
        v_tagline := coalesce(NEW.whatsapp_settings ->> 'brand_tagline', '');
        IF v_tagline <> '' AND position(lower(v_old_name) IN lower(v_tagline)) > 0 THEN
          v_tagline := regexp_replace(v_tagline, v_old_name, v_new_name, 'gi');
          NEW.whatsapp_settings := jsonb_set(NEW.whatsapp_settings, '{brand_tagline}', to_jsonb(v_tagline), true);
        END IF;
      END IF;
    ELSIF v_new_slug <> '' AND v_new_slug IS DISTINCT FROM v_old_slug THEN
      -- Si el usuario cambió explícitamente su alias /tienda/<slug>, guardar el anterior en el historial
      NEW.catalog_slug := public.normalizar_slug_catalogo(v_new_slug);
      IF v_old_slug <> '' AND v_old_slug IS DISTINCT FROM NEW.catalog_slug THEN
        SELECT coalesce(array_agg(DISTINCT s), '{}'::text[])
        INTO NEW.previous_catalog_slugs
        FROM unnest(array_append(coalesce(NEW.previous_catalog_slugs, '{}'::text[]), v_old_slug)) AS s
        WHERE s IS NOT NULL AND btrim(s) <> '' AND lower(btrim(s)) <> NEW.catalog_slug;
      END IF;
    END IF;
  END IF;

  -- Mantener sincronizado el nombre en public.companies si existe la tabla
  IF NEW.company_id IS NOT NULL AND v_new_name <> '' THEN
    BEGIN
      IF to_regclass('public.companies') IS NOT NULL THEN
        UPDATE public.companies
        SET name = v_new_name
        WHERE id = NEW.company_id
          AND name IS DISTINCT FROM v_new_name;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_company_brand_and_slug ON public.company_config;
CREATE TRIGGER trg_sync_company_brand_and_slug
BEFORE INSERT OR UPDATE ON public.company_config
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_company_brand_and_slug();

-- 3. Reparación inmediata de empresas cuyo nombre ya había sido actualizado antes del trigger
DO $$
DECLARE
  r record;
  v_expected_slug text;
  v_candidate text;
  v_current_slug text;
  v_tagline text;
  v_next_wa jsonb;
BEGIN
  FOR r IN
    SELECT id, company_id, name, catalog_slug, previous_catalog_slugs, whatsapp_settings
    FROM public.company_config
  LOOP
    v_expected_slug := coalesce(public.normalizar_slug_catalogo(r.name), 'tienda');
    v_current_slug := lower(btrim(coalesce(r.catalog_slug, '')));
    v_next_wa := coalesce(r.whatsapp_settings, '{}'::jsonb);
    v_tagline := coalesce(v_next_wa ->> 'brand_tagline', '');

    -- Limpiar eslóganes autogenerados que quedaron con un nombre anterior ("Catálogo oficial de X · ...")
    IF v_tagline ~* '^Catálogo oficial de .+ · Atención personalizada$'
       AND btrim(coalesce(r.name, '')) <> ''
       AND v_tagline <> ('Catálogo oficial de ' || btrim(r.name) || ' · Atención personalizada')
    THEN
      v_next_wa := jsonb_set(
        v_next_wa,
        '{brand_tagline}',
        to_jsonb('Catálogo oficial de ' || btrim(r.name) || ' · Atención personalizada'),
        true
      );
    END IF;

    -- Si el slug actual quedó rezagado respecto al nombre comercial actual, migrarlo conservando historial
    IF v_current_slug = '' OR (
      v_current_slug <> v_expected_slug
      AND (
        v_current_slug = 'prueba-lobo'
        OR v_tagline ~* '^Catálogo oficial de .+ · Atención personalizada$'
      )
    ) THEN
      v_candidate := v_expected_slug;
      IF EXISTS (
        SELECT 1 FROM public.company_config cc2
        WHERE cc2.id <> r.id
          AND lower(btrim(coalesce(cc2.catalog_slug, ''))) = v_candidate
      ) THEN
        v_candidate := left(v_expected_slug, 52) || '-' || left(replace(coalesce(r.company_id::text, r.id::text), '-', ''), 4);
      END IF;

      UPDATE public.company_config
      SET
        previous_catalog_slugs = CASE
          WHEN v_current_slug <> '' AND v_current_slug <> v_candidate
            THEN (
              SELECT coalesce(array_agg(DISTINCT s), '{}'::text[])
              FROM unnest(array_append(coalesce(r.previous_catalog_slugs, '{}'::text[]), v_current_slug)) AS s
              WHERE s IS NOT NULL AND btrim(s) <> '' AND lower(btrim(s)) <> v_candidate
            )
          ELSE coalesce(r.previous_catalog_slugs, '{}'::text[])
        END,
        catalog_slug = v_candidate,
        whatsapp_settings = v_next_wa
      WHERE id = r.id;
    ELSIF v_next_wa IS DISTINCT FROM coalesce(r.whatsapp_settings, '{}'::jsonb) THEN
      UPDATE public.company_config
      SET whatsapp_settings = v_next_wa
      WHERE id = r.id;
    END IF;

    IF r.company_id IS NOT NULL AND btrim(coalesce(r.name, '')) <> '' AND to_regclass('public.companies') IS NOT NULL THEN
      UPDATE public.companies
      SET name = btrim(r.name)
      WHERE id = r.company_id
        AND name IS DISTINCT FROM btrim(r.name);
    END IF;
  END LOOP;
END $$;

-- 4. Actualizar obtener_catalogo_publico incluyendo brand_version determinístico
CREATE OR REPLACE FUNCTION public.obtener_catalogo_publico(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cfg record;
  v_cats jsonb;
  v_prods jsonb;
  v_brand_version text;
  v_has_product_images boolean := to_regclass('public.product_images') IS NOT NULL;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'Enlace de catálogo incompleto.');
  END IF;

  SELECT
    cc.name,
    cc.rif,
    cc.email,
    cc.phone,
    cc.address,
    coalesce(cc.currency, 'USD') AS currency,
    coalesce(cc.tax_rate, 0) AS tax_rate,
    coalesce(cc.tax_mode, 'none') AS tax_mode,
    coalesce(cc.catalog_enabled, true) AS catalog_enabled,
    coalesce(cc.catalog_show_wholesale, true) AS catalog_show_wholesale,
    coalesce(cc.catalog_show_stock, true) AS catalog_show_stock,
    cc.catalog_welcome,
    cc.catalog_slug,
    cc.logo_url,
    coalesce(nullif(btrim(cc.brand_theme), ''), 'emerald') AS brand_theme,
    coalesce(cc.fx_rates, '{}'::jsonb) AS fx_rates,
    coalesce(cc.catalog_payment_methods, '[]'::jsonb) AS catalog_payment_methods,
    coalesce(cc.catalog_delivery_modes, '["pickup","delivery"]'::jsonb) AS catalog_delivery_modes,
    coalesce(cc.whatsapp_settings, '{}'::jsonb) AS whatsapp_settings
  INTO v_cfg
  FROM public.company_config cc
  WHERE cc.company_id = p_company_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'reason', 'No se encontró el catálogo solicitado.');
  END IF;

  IF NOT v_cfg.catalog_enabled THEN
    RETURN jsonb_build_object('available', false, 'reason', 'Este catálogo digital se encuentra temporalmente pausado por la empresa.');
  END IF;

  v_brand_version := left(
    md5(
      coalesce(v_cfg.name, '') || '|' ||
      coalesce(v_cfg.logo_url, '') || '|' ||
      coalesce(v_cfg.brand_theme, '') || '|' ||
      coalesce(v_cfg.catalog_welcome, '') || '|' ||
      coalesce(v_cfg.whatsapp_settings ->> 'brand_tagline', '')
    ),
    6
  );

  SELECT coalesce(jsonb_agg(
    jsonb_build_object('id', c.id, 'name', c.name)
    ORDER BY c.name ASC
  ), '[]'::jsonb)
  INTO v_cats
  FROM public.categories c
  WHERE c.company_id = p_company_id;

  IF v_has_product_images THEN
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'sku', p.sku,
        'description', p.description,
        'featured', coalesce(p.featured, false),
        'category_id', p.category_id,
        'category_name', cat.name,
        'price', p.price,
        'price_wholesale', CASE WHEN v_cfg.catalog_show_wholesale THEN p.price_wholesale ELSE NULL END,
        'wholesale_min_qty', CASE WHEN v_cfg.catalog_show_wholesale THEN p.wholesale_min_qty ELSE NULL END,
        'unit', p.unit,
        'stock', CASE WHEN v_cfg.catalog_show_stock THEN p.stock ELSE CASE WHEN p.stock > 0 THEN 1 ELSE 0 END END,
        'in_stock', (p.stock > 0),
        'image_url', coalesce(nullif(btrim(pi.image_url), ''), nullif(btrim(p.image_url), '')),
        'variant_group_label', p.variant_group_label,
        'variants', coalesce(p.variants, '[]'::jsonb)
      )
      ORDER BY coalesce(p.featured, false) DESC, (p.stock > 0) DESC, p.name ASC
    ), '[]'::jsonb)
    INTO v_prods
    FROM public.products p
    LEFT JOIN public.categories cat ON cat.id = p.category_id
    LEFT JOIN public.product_images pi ON pi.product_id = p.id
    WHERE p.company_id = p_company_id
      AND coalesce(p.catalog_visible, true) = true
      AND (p.price > 0 OR jsonb_array_length(coalesce(p.variants, '[]'::jsonb)) > 0);
  ELSE
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'sku', p.sku,
        'description', p.description,
        'featured', coalesce(p.featured, false),
        'category_id', p.category_id,
        'category_name', cat.name,
        'price', p.price,
        'price_wholesale', CASE WHEN v_cfg.catalog_show_wholesale THEN p.price_wholesale ELSE NULL END,
        'wholesale_min_qty', CASE WHEN v_cfg.catalog_show_wholesale THEN p.wholesale_min_qty ELSE NULL END,
        'unit', p.unit,
        'stock', CASE WHEN v_cfg.catalog_show_stock THEN p.stock ELSE CASE WHEN p.stock > 0 THEN 1 ELSE 0 END END,
        'in_stock', (p.stock > 0),
        'image_url', nullif(btrim(p.image_url), ''),
        'variant_group_label', p.variant_group_label,
        'variants', coalesce(p.variants, '[]'::jsonb)
      )
      ORDER BY coalesce(p.featured, false) DESC, (p.stock > 0) DESC, p.name ASC
    ), '[]'::jsonb)
    INTO v_prods
    FROM public.products p
    LEFT JOIN public.categories cat ON cat.id = p.category_id
    WHERE p.company_id = p_company_id
      AND coalesce(p.catalog_visible, true) = true
      AND (p.price > 0 OR jsonb_array_length(coalesce(p.variants, '[]'::jsonb)) > 0);
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'company', jsonb_build_object(
      'company_id', p_company_id,
      'catalog_slug', v_cfg.catalog_slug,
      'brand_version', v_brand_version,
      'name', coalesce(nullif(btrim(v_cfg.name), ''), 'Catálogo Digital'),
      'rif', v_cfg.rif,
      'email', v_cfg.email,
      'phone', v_cfg.phone,
      'address', v_cfg.address,
      'currency', v_cfg.currency,
      'tax_rate', v_cfg.tax_rate,
      'tax_mode', v_cfg.tax_mode,
      'show_wholesale', v_cfg.catalog_show_wholesale,
      'show_stock', v_cfg.catalog_show_stock,
      'welcome', v_cfg.catalog_welcome,
      'logo_url', v_cfg.logo_url,
      'brand_theme', v_cfg.brand_theme,
      'fx_rates', v_cfg.fx_rates,
      'payment_methods', v_cfg.catalog_payment_methods,
      'delivery_modes', v_cfg.catalog_delivery_modes,
      'whatsapp_settings', v_cfg.whatsapp_settings
    ),
    'categories', v_cats,
    'products', v_prods
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.obtener_catalogo_publico(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_catalogo_publico(uuid) TO anon, authenticated, service_role;

-- 5. Resolver catálogo público por alias activo, alias histórico o UUID
CREATE OR REPLACE FUNCTION public.resolver_catalogo_publico(p_slug_or_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_key text := lower(btrim(coalesce(p_slug_or_id, '')));
  v_cid uuid := NULL;
BEGIN
  IF v_key = '' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'Enlace de tienda incompleto.');
  END IF;

  IF v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_cid := v_key::uuid;
  ELSE
    SELECT cc.company_id
    INTO v_cid
    FROM public.company_config cc
    WHERE lower(btrim(coalesce(cc.catalog_slug, ''))) = v_key
       OR v_key = ANY(coalesce(cc.previous_catalog_slugs, '{}'::text[]))
    ORDER BY (lower(btrim(coalesce(cc.catalog_slug, ''))) = v_key) DESC
    LIMIT 1;
  END IF;

  IF v_cid IS NULL THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', 'No se encontró ninguna tienda registrada con este enlace.'
    );
  END IF;

  RETURN public.obtener_catalogo_publico(v_cid);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolver_catalogo_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolver_catalogo_publico(text) TO anon, authenticated, service_role;

-- 6. Metadatos OpenGraph ultraligeros con soporte de alias previos y huella brand_version
CREATE OR REPLACE FUNCTION public.obtener_metadatos_enlace_tienda(p_slug_or_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_key text := lower(btrim(coalesce(p_slug_or_id, '')));
  v_cfg record;
  v_prod_count integer := 0;
  v_brand_version text;
BEGIN
  IF v_key = '' THEN
    RETURN jsonb_build_object('found', false, 'available', false);
  END IF;

  IF v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT
      cc.company_id,
      cc.catalog_slug,
      cc.name,
      cc.rif,
      cc.phone,
      cc.address,
      cc.catalog_welcome,
      cc.logo_url,
      coalesce(nullif(btrim(cc.brand_theme), ''), 'emerald') AS brand_theme,
      coalesce(cc.currency, 'USD') AS currency,
      coalesce(cc.catalog_enabled, true) AS catalog_enabled,
      coalesce(cc.catalog_show_wholesale, true) AS catalog_show_wholesale,
      coalesce(cc.whatsapp_settings, '{}'::jsonb) AS whatsapp_settings
    INTO v_cfg
    FROM public.company_config cc
    WHERE cc.company_id = v_key::uuid
    LIMIT 1;
  ELSE
    SELECT
      cc.company_id,
      cc.catalog_slug,
      cc.name,
      cc.rif,
      cc.phone,
      cc.address,
      cc.catalog_welcome,
      cc.logo_url,
      coalesce(nullif(btrim(cc.brand_theme), ''), 'emerald') AS brand_theme,
      coalesce(cc.currency, 'USD') AS currency,
      coalesce(cc.catalog_enabled, true) AS catalog_enabled,
      coalesce(cc.catalog_show_wholesale, true) AS catalog_show_wholesale,
      coalesce(cc.whatsapp_settings, '{}'::jsonb) AS whatsapp_settings
    INTO v_cfg
    FROM public.company_config cc
    WHERE lower(btrim(coalesce(cc.catalog_slug, ''))) = v_key
       OR v_key = ANY(coalesce(cc.previous_catalog_slugs, '{}'::text[]))
    ORDER BY (lower(btrim(coalesce(cc.catalog_slug, ''))) = v_key) DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'available', false);
  END IF;

  SELECT count(*)::int
  INTO v_prod_count
  FROM public.products p
  WHERE p.company_id = v_cfg.company_id
    AND coalesce(p.catalog_visible, true) = true
    AND (p.price > 0 OR jsonb_array_length(coalesce(p.variants, '[]'::jsonb)) > 0);

  v_brand_version := left(
    md5(
      coalesce(v_cfg.name, '') || '|' ||
      coalesce(v_cfg.logo_url, '') || '|' ||
      coalesce(v_cfg.brand_theme, '') || '|' ||
      coalesce(v_cfg.catalog_welcome, '') || '|' ||
      coalesce(v_cfg.whatsapp_settings ->> 'brand_tagline', '')
    ),
    6
  );

  RETURN jsonb_build_object(
    'found', true,
    'available', v_cfg.catalog_enabled,
    'company_id', v_cfg.company_id,
    'catalog_slug', v_cfg.catalog_slug,
    'brand_version', v_brand_version,
    'name', coalesce(nullif(btrim(v_cfg.name), ''), 'Tienda Oficial'),
    'rif', v_cfg.rif,
    'phone', v_cfg.phone,
    'address', v_cfg.address,
    'welcome', v_cfg.catalog_welcome,
    'logo_url', v_cfg.logo_url,
    'brand_theme', v_cfg.brand_theme,
    'currency', v_cfg.currency,
    'show_wholesale', v_cfg.catalog_show_wholesale,
    'whatsapp_settings', v_cfg.whatsapp_settings,
    'products_count', v_prod_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.obtener_metadatos_enlace_tienda(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_metadatos_enlace_tienda(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
