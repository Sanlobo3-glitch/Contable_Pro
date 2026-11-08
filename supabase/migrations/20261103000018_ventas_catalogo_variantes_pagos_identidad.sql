-- ============================================================================
-- INVENTARIOPRO · MIGRACIÓN 000018
-- Sistema de Ventas Autogestionadas por Catálogo (B2B Jurídico & B2C Natural),
-- Cualidades / Presentaciones por Producto (Tallas, ml, L, g, kg, Bultos),
-- Capture de Comprobantes de Pago (Pago Móvil, Nequi, Zelle, Transferencia),
-- Verificación Administrativa e Identidad Corporativa (Logo + Color de Marca)
-- 100% Idempotente · Compatible con ejecución directa y Motor SQL en 1 clic
-- ============================================================================

BEGIN;

-- 1. Identidad corporativa y pasarelas de cobro manual en company_config
ALTER TABLE public.company_config
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS brand_theme text NOT NULL DEFAULT 'emerald',
  ADD COLUMN IF NOT EXISTS catalog_payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS catalog_delivery_modes jsonb NOT NULL DEFAULT '["pickup","delivery"]'::jsonb;

-- 2. Cualidades, tallas, volúmenes, pesos y presentaciones en products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS variant_group_label text,
  ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Bucket público para logos corporativos y captures de pago de clientes
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('product-images', 'product-images', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

  DROP POLICY IF EXISTS product_images_public_read ON storage.objects;
  CREATE POLICY product_images_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'product-images');

  DROP POLICY IF EXISTS product_images_public_receipts_insert ON storage.objects;
  CREATE POLICY product_images_public_receipts_insert
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = 'receipts'
  );

  DROP POLICY IF EXISTS product_images_auth_logos_insert ON storage.objects;
  CREATE POLICY product_images_auth_logos_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IN ('logos', 'products')
  );
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    NULL;
END $$;

-- 4. Tabla principal de pedidos autogestionados del catálogo y verificación de pago
CREATE TABLE IF NOT EXISTS public.catalog_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  order_number text NOT NULL,
  tracking_pin text NOT NULL DEFAULT '0000',
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_type text NOT NULL DEFAULT 'natural'
    CHECK (customer_type IN ('natural', 'juridica')),
  customer_name text NOT NULL,
  customer_document text,
  contact_person text,
  requires_invoice boolean NOT NULL DEFAULT false,
  customer_phone text NOT NULL,
  customer_email text,
  delivery_mode text NOT NULL DEFAULT 'pickup'
    CHECK (delivery_mode IN ('pickup', 'delivery', 'shipping')),
  delivery_address text,
  notes text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'USD',
  fx_currency text,
  fx_rate numeric,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_rate numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'pago_movil',
  payment_reference text,
  payment_sender_bank text,
  payment_amount_reported numeric,
  payment_proof_url text,
  payment_status text NOT NULL DEFAULT 'pendiente_verificacion'
    CHECK (payment_status IN ('pendiente_verificacion', 'verificado', 'observado', 'rechazado', 'contra_entrega')),
  order_status text NOT NULL DEFAULT 'nuevo'
    CHECK (order_status IN ('nuevo', 'alistando', 'despachado', 'entregado', 'cancelado')),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by_name text,
  verified_at timestamptz,
  admin_notes text,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_orders_company_created
  ON public.catalog_orders (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_orders_company_number
  ON public.catalog_orders (company_id, order_number);

CREATE INDEX IF NOT EXISTS idx_catalog_orders_payment_status
  ON public.catalog_orders (company_id, payment_status);

ALTER TABLE public.catalog_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.catalog_orders FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_orders TO authenticated, service_role;

DROP POLICY IF EXISTS catalog_orders_select_company ON public.catalog_orders;
CREATE POLICY catalog_orders_select_company
ON public.catalog_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND (
        p.company_id = catalog_orders.company_id
        OR p.role IN ('admin', 'tecnico')
        OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
      )
  )
);

DROP POLICY IF EXISTS catalog_orders_update_company ON public.catalog_orders;
CREATE POLICY catalog_orders_update_company
ON public.catalog_orders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND (
        (p.company_id = catalog_orders.company_id AND p.role IN ('dueno', 'admin_empresa', 'encargado', 'vendedor', 'cajero'))
        OR p.role IN ('admin', 'tecnico')
        OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND (
        (p.company_id = catalog_orders.company_id AND p.role IN ('dueno', 'admin_empresa', 'encargado', 'vendedor', 'cajero'))
        OR p.role IN ('admin', 'tecnico')
        OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
      )
  )
);

DROP POLICY IF EXISTS catalog_orders_delete_company ON public.catalog_orders;
CREATE POLICY catalog_orders_delete_company
ON public.catalog_orders
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND (
        (p.company_id = catalog_orders.company_id AND p.role IN ('dueno', 'admin_empresa'))
        OR p.role = 'admin'
        OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
      )
  )
);

-- 5. Guardar identidad de marca, logo corporativo y cuentas de cobro del catálogo
CREATE OR REPLACE FUNCTION public.guardar_identidad_catalogo(
  p_enabled boolean DEFAULT true,
  p_show_wholesale boolean DEFAULT true,
  p_show_stock boolean DEFAULT true,
  p_welcome text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_brand_theme text DEFAULT 'emerald',
  p_payment_methods jsonb DEFAULT '[]'::jsonb,
  p_delivery_modes jsonb DEFAULT '["pickup","delivery"]'::jsonb
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
  v_theme text := lower(btrim(coalesce(p_brand_theme, 'emerald')));
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

  IF v_role NOT IN ('dueno', 'admin_empresa', 'encargado', 'admin')
     AND v_email <> 'sanlobo3@hotmail.com' THEN
    RAISE EXCEPTION 'Solo dirección o administración puede modificar la identidad del catálogo';
  END IF;

  IF v_theme NOT IN ('emerald', 'slate', 'blue', 'indigo', 'rose', 'amber', 'teal', 'violet') THEN
    v_theme := 'emerald';
  END IF;

  UPDATE public.company_config
  SET
    catalog_enabled = coalesce(p_enabled, true),
    catalog_show_wholesale = coalesce(p_show_wholesale, true),
    catalog_show_stock = coalesce(p_show_stock, true),
    catalog_welcome = nullif(left(btrim(coalesce(p_welcome, '')), 260), ''),
    logo_url = nullif(btrim(coalesce(p_logo_url, '')), ''),
    brand_theme = v_theme,
    catalog_payment_methods = CASE
      WHEN p_payment_methods IS NOT NULL AND jsonb_typeof(p_payment_methods) = 'array'
        THEN p_payment_methods
      ELSE '[]'::jsonb
    END,
    catalog_delivery_modes = CASE
      WHEN p_delivery_modes IS NOT NULL AND jsonb_typeof(p_delivery_modes) = 'array' AND jsonb_array_length(p_delivery_modes) > 0
        THEN p_delivery_modes
      ELSE '["pickup","delivery"]'::jsonb
    END
  WHERE company_id = v_cid;

  IF NOT FOUND THEN
    INSERT INTO public.company_config (
      company_id,
      name,
      catalog_enabled,
      catalog_show_wholesale,
      catalog_show_stock,
      catalog_welcome,
      logo_url,
      brand_theme,
      catalog_payment_methods,
      catalog_delivery_modes
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
      coalesce(p_payment_methods, '[]'::jsonb),
      coalesce(p_delivery_modes, '["pickup","delivery"]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', v_cid,
    'brand_theme', v_theme
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_identidad_catalogo(boolean, boolean, boolean, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_identidad_catalogo(boolean, boolean, boolean, text, text, text, jsonb, jsonb) TO authenticated, service_role;

-- 6. Catálogo público enriquecido (logo, tema corporativo, multimoneda, imágenes reales y variantes)
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
    cc.logo_url,
    coalesce(nullif(btrim(cc.brand_theme), ''), 'emerald') AS brand_theme,
    coalesce(cc.fx_rates, '{}'::jsonb) AS fx_rates,
    coalesce(cc.catalog_payment_methods, '[]'::jsonb) AS catalog_payment_methods,
    coalesce(cc.catalog_delivery_modes, '["pickup","delivery"]'::jsonb) AS catalog_delivery_modes
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
      'delivery_modes', v_cfg.catalog_delivery_modes
    ),
    'categories', v_cats,
    'products', v_prods
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.obtener_catalogo_publico(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_catalogo_publico(uuid) TO anon, authenticated, service_role;

-- 6B. Verificación en tiempo real de stock disponible por producto antes de añadir al carrito
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

  RETURN jsonb_build_object(
    'available', true,
    'found', true,
    'product_id', v_prod.id,
    'name', v_prod.name,
    'unit', coalesce(v_prod.unit, 'unidad'),
    'stock', v_stock,
    'in_stock', (v_stock > 0),
    'show_stock', v_cfg.catalog_show_stock,
    'can_fulfill', (v_stock >= v_req),
    'variants', coalesce(v_prod.variants, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.verificar_stock_catalogo_publico(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verificar_stock_catalogo_publico(uuid, uuid, numeric) TO anon, authenticated, service_role;

-- 7. Crear pedido público con soporte para Persona Natural / Jurídica, Variantes y Capture de Pago
-- Eliminamos primero la firma antigua de 7 argumentos para evitar ambigüedad de sobrecarga
DROP FUNCTION IF EXISTS public.crear_pedido_catalogo_publico(uuid, text, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.crear_pedido_catalogo_publico(
  p_company_id uuid,
  p_customer_name text,
  p_phone text,
  p_document text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_type text DEFAULT 'natural',
  p_contact_person text DEFAULT NULL,
  p_requires_invoice boolean DEFAULT false,
  p_email text DEFAULT NULL,
  p_delivery_mode text DEFAULT 'pickup',
  p_payment_method text DEFAULT 'pago_movil',
  p_payment_reference text DEFAULT NULL,
  p_payment_bank text DEFAULT NULL,
  p_payment_amount numeric DEFAULT NULL,
  p_payment_proof_url text DEFAULT NULL,
  p_fx_currency text DEFAULT NULL,
  p_fx_rate numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg record;
  v_cname text := left(btrim(coalesce(p_customer_name, '')), 140);
  v_phone text := left(btrim(coalesce(p_phone, '')), 40);
  v_doc text := nullif(left(btrim(coalesce(p_document, '')), 45), '');
  v_addr text := nullif(left(btrim(coalesce(p_address, '')), 220), '');
  v_notes text := nullif(left(btrim(coalesce(p_notes, '')), 300), '');
  v_ctype text := CASE WHEN lower(btrim(coalesce(p_customer_type, 'natural'))) = 'juridica' THEN 'juridica' ELSE 'natural' END;
  v_contact text := nullif(left(btrim(coalesce(p_contact_person, '')), 100), '');
  v_email text := nullif(left(btrim(coalesce(p_email, '')), 120), '');
  v_dmode text := CASE WHEN lower(btrim(coalesce(p_delivery_mode, 'pickup'))) IN ('pickup', 'delivery', 'shipping') THEN lower(btrim(p_delivery_mode)) ELSE 'pickup' END;
  v_pmethod text := left(btrim(coalesce(p_payment_method, 'pago_movil')), 40);
  v_pref text := nullif(left(btrim(coalesce(p_payment_reference, '')), 80), '');
  v_pbank text := nullif(left(btrim(coalesce(p_payment_bank, '')), 80), '');
  v_pproof text := nullif(btrim(coalesce(p_payment_proof_url, '')), '');
  v_pstatus text;
  v_cust_id uuid := NULL;
  v_item jsonb;
  v_pid uuid;
  v_vid text;
  v_vobj jsonb;
  v_vlabel text;
  v_mult numeric;
  v_qty numeric;
  v_req_stock numeric;
  v_prod public.products%ROWTYPE;
  v_base_price numeric;
  v_wholesale_price numeric;
  v_unit_price numeric;
  v_order_lines jsonb := '[]'::jsonb;
  v_quote_lines jsonb := '[]'::jsonb;
  v_sum numeric := 0;
  v_sub numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_qid uuid := NULL;
  v_oid uuid;
  v_seq integer;
  v_order_num text;
  v_digits text;
  v_pin text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida';
  END IF;
  IF v_cname = '' THEN
    RAISE EXCEPTION 'Por favor ingresa tu nombre completo o razón social';
  END IF;
  IF v_phone = '' THEN
    RAISE EXCEPTION 'Por favor ingresa tu número de teléfono o WhatsApp';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Tu pedido está vacío';
  END IF;
  IF jsonb_array_length(p_items) > 80 THEN
    RAISE EXCEPTION 'El pedido excede el máximo de líneas permitidas';
  END IF;

  SELECT
    cc.name,
    cc.phone,
    coalesce(cc.currency, 'USD') AS currency,
    coalesce(cc.tax_rate, 0) AS tax_rate,
    coalesce(cc.tax_mode, 'none') AS tax_mode,
    coalesce(cc.catalog_enabled, true) AS catalog_enabled,
    coalesce(cc.catalog_show_wholesale, true) AS catalog_show_wholesale
  INTO v_cfg
  FROM public.company_config cc
  WHERE cc.company_id = p_company_id
  LIMIT 1;

  IF NOT FOUND OR NOT v_cfg.catalog_enabled THEN
    RAISE EXCEPTION 'El catálogo digital no está disponible en este momento';
  END IF;

  -- Vincular o crear ficha de cliente en la empresa
  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_cust_id
    FROM public.customers
    WHERE company_id = p_company_id
      AND lower(btrim(coalesce(document, ''))) = lower(v_doc)
    LIMIT 1;
  END IF;

  IF v_cust_id IS NULL THEN
    SELECT id INTO v_cust_id
    FROM public.customers
    WHERE company_id = p_company_id
      AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g')
      AND length(regexp_replace(v_phone, '[^0-9]', '', 'g')) >= 7
    LIMIT 1;
  END IF;

  IF v_cust_id IS NULL THEN
    BEGIN
      INSERT INTO public.customers (company_id, name, document, phone, email, address)
      VALUES (p_company_id, v_cname, v_doc, v_phone, v_email, v_addr)
      RETURNING id INTO v_cust_id;
    EXCEPTION WHEN OTHERS THEN
      v_cust_id := NULL;
    END;
  END IF;

  -- Calcular precios oficiales en el servidor respetando cualidades/variantes y escala mayorista
  FOR v_item IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_vid := nullif(btrim(coalesce(v_item->>'variant_id', '')), '');
    v_qty := round(coalesce((v_item->>'quantity')::numeric, 0), 3);

    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_prod
    FROM public.products
    WHERE id = v_pid
      AND company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos seleccionados ya no está disponible';
    END IF;

    v_vobj := NULL;
    v_vlabel := NULL;
    v_mult := 1;
    v_base_price := coalesce(v_prod.price, 0);
    v_wholesale_price := coalesce(v_prod.price_wholesale, 0);

    IF v_vid IS NOT NULL AND jsonb_typeof(v_prod.variants) = 'array' THEN
      SELECT elem INTO v_vobj
      FROM jsonb_array_elements(v_prod.variants) elem
      WHERE elem->>'id' = v_vid
      LIMIT 1;

      IF v_vobj IS NOT NULL THEN
        v_vlabel := nullif(btrim(coalesce(v_vobj->>'label', '')), '');
        v_base_price := coalesce((v_vobj->>'price')::numeric, v_base_price);
        v_wholesale_price := coalesce((v_vobj->>'price_wholesale')::numeric, 0);
        v_mult := greatest(0.001, coalesce((v_vobj->>'stock_multiplier')::numeric, 1));
      END IF;
    END IF;

    v_req_stock := round(v_qty * v_mult, 3);
    IF coalesce(v_prod.stock, 0) < v_req_stock THEN
      RAISE EXCEPTION 'Stock insuficiente para "%" (disponibles: % %)',
        v_prod.name, v_prod.stock, coalesce(v_prod.unit, 'und');
    END IF;

    v_unit_price := v_base_price;
    IF v_cfg.catalog_show_wholesale
       AND v_wholesale_price > 0
       AND coalesce(v_prod.wholesale_min_qty, 0) > 0
       AND v_qty >= v_prod.wholesale_min_qty THEN
      v_unit_price := v_wholesale_price;
    END IF;

    v_sum := v_sum + round(v_unit_price * v_qty, 2);

    v_order_lines := v_order_lines || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_prod.id,
        'product_name', v_prod.name,
        'sku', v_prod.sku,
        'variant_id', v_vid,
        'variant_label', v_vlabel,
        'stock_multiplier', v_mult,
        'quantity', v_qty,
        'unit_price', v_unit_price,
        'subtotal', round(v_unit_price * v_qty, 2),
        'unit', v_prod.unit,
        'image_url', coalesce(nullif(btrim(v_item->>'image_url'), ''), v_prod.image_url)
      )
    );

    v_quote_lines := v_quote_lines || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_prod.id,
        'product_name', CASE WHEN v_vlabel IS NOT NULL THEN v_prod.name || ' (' || v_vlabel || ')' ELSE v_prod.name END,
        'quantity', v_qty,
        'price', v_unit_price,
        'subtotal', round(v_unit_price * v_qty, 2)
      )
    );
  END LOOP;

  IF jsonb_array_length(v_order_lines) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto válido';
  END IF;

  v_sum := round(v_sum, 2);
  IF v_cfg.tax_mode = 'adicional' AND v_cfg.tax_rate > 0 THEN
    v_sub := v_sum;
    v_tax := round(v_sum * v_cfg.tax_rate / 100.0, 2);
    v_total := round(v_sub + v_tax, 2);
  ELSIF v_cfg.tax_mode = 'incluido' AND v_cfg.tax_rate > 0 THEN
    v_total := v_sum;
    v_tax := round(v_total - v_total / (1 + v_cfg.tax_rate / 100.0), 2);
    v_sub := round(v_total - v_tax, 2);
  ELSE
    v_sub := v_sum;
    v_tax := 0;
    v_total := v_sum;
  END IF;

  -- Respaldo espejo en cotizaciones para trazabilidad comercial tradicional
  BEGIN
    INSERT INTO public.quotations (
      company_id,
      customer_id,
      customer_name,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      total,
      status,
      valid_until
    ) VALUES (
      p_company_id,
      v_cust_id,
      v_cname || CASE WHEN v_pref IS NOT NULL THEN ' · Ref #' || left(v_pref, 24) ELSE '' END,
      v_quote_lines,
      v_sub,
      CASE WHEN v_tax > 0 THEN v_cfg.tax_rate ELSE 0 END,
      v_tax,
      v_total,
      'enviada',
      (current_date + 7)
    )
    RETURNING id INTO v_qid;
  EXCEPTION WHEN OTHERS THEN
    v_qid := NULL;
  END;

  SELECT count(*) + 1001
  INTO v_seq
  FROM public.catalog_orders
  WHERE company_id = p_company_id;

  v_order_num := 'WEB-' || v_seq::text;
  v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  IF length(v_digits) >= 4 THEN
    v_pin := right(v_digits, 4);
  ELSE
    v_pin := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
  END IF;

  v_pstatus := CASE
    WHEN v_pmethod = 'efectivo_entrega' THEN 'contra_entrega'
    ELSE 'pendiente_verificacion'
  END;

  INSERT INTO public.catalog_orders (
    company_id,
    order_number,
    tracking_pin,
    customer_id,
    customer_type,
    customer_name,
    customer_document,
    contact_person,
    requires_invoice,
    customer_phone,
    customer_email,
    delivery_mode,
    delivery_address,
    notes,
    items,
    currency,
    fx_currency,
    fx_rate,
    subtotal,
    tax_rate,
    tax_amount,
    total,
    payment_method,
    payment_reference,
    payment_sender_bank,
    payment_amount_reported,
    payment_proof_url,
    payment_status,
    order_status,
    quotation_id
  )
  VALUES (
    p_company_id,
    v_order_num,
    v_pin,
    v_cust_id,
    v_ctype,
    v_cname,
    v_doc,
    v_contact,
    coalesce(p_requires_invoice, false),
    v_phone,
    v_email,
    v_dmode,
    v_addr,
    v_notes,
    v_order_lines,
    v_cfg.currency,
    nullif(left(btrim(coalesce(p_fx_currency, '')), 10), ''),
    p_fx_rate,
    v_sub,
    CASE WHEN v_tax > 0 THEN v_cfg.tax_rate ELSE 0 END,
    v_tax,
    v_total,
    v_pmethod,
    v_pref,
    v_pbank,
    coalesce(p_payment_amount, v_total),
    v_pproof,
    v_pstatus,
    'nuevo',
    v_qid
  )
  RETURNING id INTO v_oid;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_oid,
    'quotation_id', v_qid,
    'order_number', v_order_num,
    'tracking_pin', v_pin,
    'payment_status', v_pstatus,
    'order_status', 'nuevo',
    'subtotal', v_sub,
    'tax_amount', v_tax,
    'total', v_total,
    'currency', v_cfg.currency,
    'company_phone', v_cfg.phone,
    'company_name', v_cfg.name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_pedido_catalogo_publico(
  uuid, text, text, text, text, text, jsonb, text, text, boolean, text, text, text, text, text, numeric, text, text, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_pedido_catalogo_publico(
  uuid, text, text, text, text, text, jsonb, text, text, boolean, text, text, text, text, text, numeric, text, text, numeric
) TO anon, authenticated, service_role;

-- 8. Consulta pública segura de estatus de pedido (por código WEB-XXXX + PIN o teléfono)
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
  v_secret text := regexp_replace(coalesce(p_pin_or_phone, ''), '[^0-9]', '', 'g');
  v_phone_digits text;
BEGIN
  IF p_company_id IS NULL OR v_code = '' OR length(v_secret) < 4 THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'Ingresa el código del pedido (ej. WEB-1001) y los últimos 4 dígitos de tu teléfono o PIN.'
    );
  END IF;

  SELECT * INTO v_ord
  FROM public.catalog_orders co
  WHERE co.company_id = p_company_id
    AND upper(btrim(co.order_number)) = v_code
  ORDER BY co.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'No encontramos ningún pedido con ese código en este catálogo.'
    );
  END IF;

  v_phone_digits := regexp_replace(coalesce(v_ord.customer_phone, ''), '[^0-9]', '', 'g');

  IF v_ord.tracking_pin <> right(v_secret, 4)
     AND right(v_phone_digits, 4) <> right(v_secret, 4)
     AND v_phone_digits <> v_secret THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'El PIN o teléfono ingresado no coincide con el titular del pedido.'
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'order', jsonb_build_object(
      'order_number', v_ord.order_number,
      'customer_name', v_ord.customer_name,
      'customer_type', v_ord.customer_type,
      'total', v_ord.total,
      'currency', v_ord.currency,
      'payment_method', v_ord.payment_method,
      'payment_reference', v_ord.payment_reference,
      'payment_status', v_ord.payment_status,
      'order_status', v_ord.order_status,
      'delivery_mode', v_ord.delivery_mode,
      'verified_at', v_ord.verified_at,
      'admin_notes', v_ord.admin_notes,
      'created_at', v_ord.created_at,
      'items', coalesce(v_ord.items, '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.consultar_pedido_catalogo_publico(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultar_pedido_catalogo_publico(uuid, text, text) TO anon, authenticated, service_role;

-- 9. Gestión administrativa de pedidos y corroboración de capture de pago
CREATE OR REPLACE FUNCTION public.gestionar_pedido_catalogo(
  p_order_id uuid,
  p_payment_status text,
  p_order_status text,
  p_admin_notes text DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor record;
  v_ord public.catalog_orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;

  SELECT p.company_id, p.role, p.full_name, p.email
  INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de usuario inactivo o no encontrado';
  END IF;

  SELECT * INTO v_ord
  FROM public.catalog_orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de catálogo no encontrado';
  END IF;

  IF v_actor.company_id IS DISTINCT FROM v_ord.company_id
     AND v_actor.role NOT IN ('admin', 'tecnico')
     AND lower(btrim(coalesce(v_actor.email, ''))) <> 'sanlobo3@hotmail.com' THEN
    RAISE EXCEPTION 'No tienes permisos sobre los pedidos de esta empresa';
  END IF;

  IF p_payment_status NOT IN ('pendiente_verificacion', 'verificado', 'observado', 'rechazado', 'contra_entrega') THEN
    RAISE EXCEPTION 'Estatus de pago inválido';
  END IF;

  IF p_order_status NOT IN ('nuevo', 'alistando', 'despachado', 'entregado', 'cancelado') THEN
    RAISE EXCEPTION 'Estatus logístico inválido';
  END IF;

  UPDATE public.catalog_orders
  SET
    payment_status = p_payment_status,
    order_status = p_order_status,
    admin_notes = nullif(left(btrim(coalesce(p_admin_notes, '')), 500), ''),
    sale_id = coalesce(p_sale_id, sale_id),
    verified_by = CASE
      WHEN p_payment_status = 'verificado' AND verified_at IS NULL THEN v_uid
      ELSE verified_by
    END,
    verified_by_name = CASE
      WHEN p_payment_status = 'verificado' AND verified_at IS NULL
        THEN coalesce(nullif(btrim(v_actor.full_name), ''), v_actor.email, 'Administración')
      ELSE verified_by_name
    END,
    verified_at = CASE
      WHEN p_payment_status = 'verificado' AND verified_at IS NULL THEN now()
      ELSE verified_at
    END,
    updated_at = now()
  WHERE id = p_order_id;

  IF v_ord.quotation_id IS NOT NULL THEN
    UPDATE public.quotations
    SET status = CASE
      WHEN p_order_status = 'cancelado' OR p_payment_status = 'rechazado' THEN 'rechazada'
      WHEN p_payment_status = 'verificado' THEN 'aprobada'
      ELSE status
    END
    WHERE id = v_ord.quotation_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'payment_status', p_payment_status,
    'order_status', p_order_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.gestionar_pedido_catalogo(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestionar_pedido_catalogo(uuid, text, text, text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
