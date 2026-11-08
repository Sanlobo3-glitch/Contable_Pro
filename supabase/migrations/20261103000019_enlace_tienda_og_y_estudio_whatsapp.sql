-- ============================================================================
-- INVENTARIOPRO · MIGRACIÓN 000019
-- Enlace Personalizado por Empresa (/tienda/<alias>), Metadatos OpenGraph
-- Dinámicos para Tarjetas de WhatsApp (Logo + Identidad Propia de la Empresa)
-- y Estudio Corporativo Multiempresa de Plantillas WhatsApp
-- 100% Idempotente · Preserva el enlace raíz (/) exclusivo para InventarioPro
-- ============================================================================

BEGIN;

-- 1. Nuevas columnas en company_config para alias único de tienda y estudio WhatsApp
ALTER TABLE public.company_config
  ADD COLUMN IF NOT EXISTS catalog_slug text,
  ADD COLUMN IF NOT EXISTS whatsapp_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Normalizador inmutable de alias de tienda (/tienda/<slug>)
CREATE OR REPLACE FUNCTION public.normalizar_slug_catalogo(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_clean text;
BEGIN
  v_clean := coalesce(p_raw, '');
  v_clean := translate(
    v_clean,
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'
  );
  v_clean := lower(v_clean);
  v_clean := regexp_replace(v_clean, '[^a-z0-9]+', '-', 'g');
  v_clean := regexp_replace(v_clean, '(^-+|-+$)', '', 'g');
  v_clean := left(v_clean, 60);
  v_clean := regexp_replace(v_clean, '-+$', '', 'g');

  IF v_clean = '' THEN
    RETURN NULL;
  END IF;

  IF v_clean IN (
    'api', 'admin', 'login', 'registro', 'register',
    'terminos', 'privacidad', 'manual', 'reset-password',
    'assets', 'static', 'index-html'
  ) THEN
    v_clean := 'tienda-' || v_clean;
  END IF;

  IF length(v_clean) < 2 THEN
    v_clean := 'tienda-' || v_clean;
  END IF;

  RETURN v_clean;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.normalizar_slug_catalogo(text) TO anon, authenticated, service_role;

-- 3. Generar alias inicial limpio para empresas existentes que aún no tengan catalog_slug
DO $$
DECLARE
  r record;
  v_base text;
  v_candidate text;
BEGIN
  FOR r IN
    SELECT id, company_id, name
    FROM public.company_config
    WHERE catalog_slug IS NULL OR btrim(catalog_slug) = ''
  LOOP
    v_base := coalesce(public.normalizar_slug_catalogo(r.name), 'tienda');
    v_candidate := v_base;

    IF EXISTS (
      SELECT 1
      FROM public.company_config cc2
      WHERE cc2.id <> r.id
        AND lower(btrim(coalesce(cc2.catalog_slug, ''))) = v_candidate
    ) THEN
      v_candidate := left(v_base, 52) || '-' || left(replace(coalesce(r.company_id::text, r.id::text), '-', ''), 4);
    END IF;

    UPDATE public.company_config
    SET catalog_slug = v_candidate
    WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_config_catalog_slug_unique
  ON public.company_config (lower(btrim(catalog_slug)))
  WHERE catalog_slug IS NOT NULL AND btrim(catalog_slug) <> '';

-- 4. Actualizar guardar_identidad_catalogo con soporte de alias propio y estudio WhatsApp
DROP FUNCTION IF EXISTS public.guardar_identidad_catalogo(boolean, boolean, boolean, text, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.guardar_identidad_catalogo(
  p_enabled boolean DEFAULT true,
  p_show_wholesale boolean DEFAULT true,
  p_show_stock boolean DEFAULT true,
  p_welcome text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_brand_theme text DEFAULT 'emerald',
  p_payment_methods jsonb DEFAULT '[]'::jsonb,
  p_delivery_modes jsonb DEFAULT '["pickup","delivery"]'::jsonb,
  p_catalog_slug text DEFAULT NULL,
  p_whatsapp_settings jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cid uuid;
  v_role text;
  v_email text;
  v_company_name text;
  v_theme text := lower(btrim(coalesce(p_brand_theme, 'emerald')));
  v_slug text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;

  SELECT p.company_id, p.role, lower(btrim(coalesce(p.email, '')))
  INTO v_cid, v_role, v_email
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = true;

  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'No se encontró empresa asociada a tu usuario';
  END IF;

  IF v_role NOT IN ('dueno', 'admin_empresa', 'encargado', 'gerente', 'admin')
     AND v_email <> 'sanlobo3@hotmail.com' THEN
    RAISE EXCEPTION 'Solo dirección o administración puede modificar la identidad del catálogo';
  END IF;

  IF v_theme NOT IN ('emerald', 'slate', 'blue', 'indigo', 'rose', 'amber', 'teal', 'violet') THEN
    v_theme := 'emerald';
  END IF;

  SELECT cc.name INTO v_company_name
  FROM public.company_config cc
  WHERE cc.company_id = v_cid
  LIMIT 1;

  IF p_catalog_slug IS NOT NULL THEN
    v_slug := public.normalizar_slug_catalogo(p_catalog_slug);
  END IF;

  IF v_slug IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.company_config cc
      WHERE cc.company_id IS DISTINCT FROM v_cid
        AND lower(btrim(coalesce(cc.catalog_slug, ''))) = v_slug
    ) THEN
      RAISE EXCEPTION 'Ese alias de enlace (/tienda/%) ya está en uso por otra empresa. Elige un alias diferente.', v_slug;
    END IF;
  END IF;

  UPDATE public.company_config
  SET
    catalog_enabled = coalesce(p_enabled, true),
    catalog_show_wholesale = coalesce(p_show_wholesale, true),
    catalog_show_stock = coalesce(p_show_stock, true),
    catalog_welcome = nullif(left(btrim(coalesce(p_welcome, '')), 260), ''),
    logo_url = nullif(btrim(coalesce(p_logo_url, '')), ''),
    brand_theme = v_theme,
    catalog_slug = coalesce(
      v_slug,
      catalog_slug,
      public.normalizar_slug_catalogo(coalesce(v_company_name, 'tienda')) || '-' || left(replace(v_cid::text, '-', ''), 4)
    ),
    catalog_payment_methods = CASE
      WHEN p_payment_methods IS NOT NULL AND jsonb_typeof(p_payment_methods) = 'array'
        THEN p_payment_methods
      ELSE '[]'::jsonb
    END,
    catalog_delivery_modes = CASE
      WHEN p_delivery_modes IS NOT NULL AND jsonb_typeof(p_delivery_modes) = 'array' AND jsonb_array_length(p_delivery_modes) > 0
        THEN p_delivery_modes
      ELSE '["pickup","delivery"]'::jsonb
    END,
    whatsapp_settings = CASE
      WHEN p_whatsapp_settings IS NOT NULL AND jsonb_typeof(p_whatsapp_settings) = 'object'
        THEN p_whatsapp_settings
      ELSE coalesce(whatsapp_settings, '{}'::jsonb)
    END
  WHERE company_id = v_cid
  RETURNING catalog_slug INTO v_slug;

  IF NOT FOUND THEN
    v_slug := coalesce(
      v_slug,
      'tienda-' || left(replace(v_cid::text, '-', ''), 6)
    );
    INSERT INTO public.company_config (
      company_id,
      name,
      catalog_enabled,
      catalog_show_wholesale,
      catalog_show_stock,
      catalog_welcome,
      logo_url,
      brand_theme,
      catalog_slug,
      catalog_payment_methods,
      catalog_delivery_modes,
      whatsapp_settings
    )
    VALUES (
      v_cid,
      'Mi Empresa',
      coalesce(p_enabled, true),
      coalesce(p_show_wholesale, true),
      coalesce(p_show_stock, true),
      nullif(left(btrim(coalesce(p_welcome, '')), 260), ''),
      nullif(btrim(coalesce(p_logo_url, '')), ''),
      v_theme,
      v_slug,
      coalesce(p_payment_methods, '[]'::jsonb),
      coalesce(p_delivery_modes, '["pickup","delivery"]'::jsonb),
      CASE
        WHEN p_whatsapp_settings IS NOT NULL AND jsonb_typeof(p_whatsapp_settings) = 'object'
          THEN p_whatsapp_settings
        ELSE '{}'::jsonb
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', v_cid,
    'brand_theme', v_theme,
    'catalog_slug', v_slug
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_identidad_catalogo(boolean, boolean, boolean, text, text, text, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_identidad_catalogo(boolean, boolean, boolean, text, text, text, jsonb, jsonb, text, jsonb) TO authenticated, service_role;

-- 5. Enriquecer obtener_catalogo_publico con catalog_slug y whatsapp_settings
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

-- 6. Resolver catálogo público por alias amigable (/tienda/<slug>) o por UUID
CREATE OR REPLACE FUNCTION public.resolver_catalogo_publico(p_slug_or_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_key text := btrim(coalesce(p_slug_or_id, ''));
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
    WHERE lower(btrim(coalesce(cc.catalog_slug, ''))) = lower(v_key)
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

-- 7. Consulta ultraligera de metadatos OpenGraph para vista previa en WhatsApp / Redes Sociales
CREATE OR REPLACE FUNCTION public.obtener_metadatos_enlace_tienda(p_slug_or_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_key text := btrim(coalesce(p_slug_or_id, ''));
  v_cfg record;
  v_prod_count integer := 0;
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
    WHERE lower(btrim(coalesce(cc.catalog_slug, ''))) = lower(v_key)
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

  RETURN jsonb_build_object(
    'found', true,
    'available', v_cfg.catalog_enabled,
    'company_id', v_cfg.company_id,
    'catalog_slug', v_cfg.catalog_slug,
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

-- 8. Bucket privado payment-proofs para captures bancarios con URLs firmadas (15 min)
--    Respeta políticas personalizadas ya activas y crea las faltantes en entornos nuevos
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'payment-proofs',
    'payment-proofs',
    false,
    6291456,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = COALESCE(storage.buckets.file_size_limit, 6291456),
        allowed_mime_types = COALESCE(
          storage.buckets.allowed_mime_types,
          ARRAY['image/jpeg', 'image/png', 'image/webp']
        );

  -- Retirar inserción pública antigua de recibos en product-images (ahora van a payment-proofs)
  DROP POLICY IF EXISTS product_images_public_receipts_insert ON storage.objects;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'payment_proofs_public_insert'
  ) THEN
    CREATE POLICY payment_proofs_public_insert
    ON storage.objects
    FOR INSERT
    TO anon
    WITH CHECK (
      bucket_id = 'payment-proofs'
      AND (storage.foldername(name))[1] = 'receipts'
      AND EXISTS (
        SELECT 1
        FROM public.company_config cc
        WHERE cc.company_id::text = (storage.foldername(name))[2]
          AND coalesce(cc.catalog_enabled, true) = true
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'payment_proofs_company_insert'
  ) THEN
    CREATE POLICY payment_proofs_company_insert
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'payment-proofs'
      AND (storage.foldername(name))[1] = 'receipts'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active = true
          AND (
            p.company_id::text = (storage.foldername(name))[2]
            OR p.role IN ('admin', 'tecnico')
            OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
          )
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'payment_proofs_company_select'
  ) THEN
    CREATE POLICY payment_proofs_company_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'payment-proofs'
      AND (storage.foldername(name))[1] = 'receipts'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active = true
          AND (
            p.company_id::text = (storage.foldername(name))[2]
            OR p.role IN ('admin', 'tecnico')
            OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
          )
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'payment_proofs_company_delete'
  ) THEN
    CREATE POLICY payment_proofs_company_delete
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'payment-proofs'
      AND (storage.foldername(name))[1] = 'receipts'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active = true
          AND (
            p.company_id::text = (storage.foldername(name))[2]
            OR p.role = 'admin'
            OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
          )
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('product_images_auth_receipts_delete', 'product_images_legacy_receipts_delete')
  ) THEN
    CREATE POLICY product_images_auth_receipts_delete
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'product-images'
      AND (storage.foldername(name))[1] = 'receipts'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active = true
          AND (
            p.company_id::text = (storage.foldername(name))[2]
            OR p.role = 'admin'
            OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
          )
      )
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    NULL;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
