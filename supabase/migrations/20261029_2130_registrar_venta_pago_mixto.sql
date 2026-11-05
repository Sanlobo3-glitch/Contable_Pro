-- Pago mixto: divisa + parte en moneda de la empresa (p_base_amount).
-- El total recibido (divisa convertida + parte en COP) es lo que debe cubrir la venta.
-- Se elimina la firma anterior (12 parametros) para que no queden dos versiones.
DROP FUNCTION IF EXISTS public.registrar_venta(uuid, jsonb, text, jsonb, uuid, timestamptz, text, numeric, numeric, text, numeric, numeric);

CREATE OR REPLACE FUNCTION public.registrar_venta(p_customer_id uuid, p_items jsonb, p_payment_method text DEFAULT 'efectivo'::text, p_geo jsonb DEFAULT NULL::jsonb, p_client_id uuid DEFAULT NULL::uuid, p_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_channel text DEFAULT 'ruta'::text, p_discount numeric DEFAULT 0, p_received numeric DEFAULT NULL::numeric, p_fx_currency text DEFAULT NULL::text, p_fx_amount numeric DEFAULT NULL::numeric, p_fx_rate numeric DEFAULT NULL::numeric, p_base_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_co uuid := public._ctx(null);
  v_prod products%rowtype; v_pid uuid;
  v_qty numeric; v_price numeric; v_total numeric := 0;
  v_cust text; v_id uuid; v_items jsonb := '[]'::jsonb; v_new numeric;
  v_pay text := coalesce(p_payment_method, 'efectivo');
  v_mode text; v_role text;
  v_at timestamptz := now();
  v_taxmode text; v_rate numeric; v_tax numeric := 0; v_base numeric;
  v_chan text := coalesce(p_channel, 'ruta');
  v_disc numeric := 0;
  v_sdate date; v_due date; v_limit numeric := 0; v_days int := 30; v_tz text; v_owed numeric;
  v_ccur text; v_fxc text := null; v_fxa numeric := null; v_fxr numeric := null; v_eq numeric := null;
  v_basea numeric := 0;
  e jsonb;
BEGIN
  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_id FROM sales WHERE company_id = v_co AND client_uuid = p_client_id;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  IF v_chan NOT IN ('ruta', 'mostrador') THEN
    RAISE EXCEPTION 'Canal de venta inválido';
  END IF;

  IF p_captured_at IS NOT NULL AND p_captured_at < now() AND p_captured_at > now() - interval '30 days' THEN
    v_at := p_captured_at;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta no tiene items';
  END IF;
  IF v_pay NOT IN ('efectivo', 'tarjeta', 'transferencia', 'fiado') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;
  IF coalesce(p_discount, 0) < 0 THEN
    RAISE EXCEPTION 'El descuento no puede ser negativo';
  END IF;

  -- Pago en otra moneda (opcional)
  IF p_fx_currency IS NOT NULL THEN
    v_fxc := upper(btrim(p_fx_currency));
    IF v_fxc !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Moneda de pago inválida'; END IF;
    IF v_pay = 'fiado' THEN RAISE EXCEPTION 'Una venta fiada no puede registrar un pago en otra moneda'; END IF;
    IF coalesce(p_fx_amount, 0) <= 0 OR coalesce(p_fx_rate, 0) <= 0 THEN
      RAISE EXCEPTION 'Indica el monto recibido y la tasa de cambio';
    END IF;
    IF p_fx_rate > 1000000000 OR p_fx_amount > 1000000000000 THEN
      RAISE EXCEPTION 'Monto o tasa fuera de rango';
    END IF;
    v_fxa := round(p_fx_amount, 4);
    v_fxr := p_fx_rate;
    v_basea := round(greatest(coalesce(p_base_amount, 0), 0), 2);
    -- Total recibido = divisa convertida + parte en moneda de la empresa
    v_eq := round(v_fxa * v_fxr, 2) + v_basea;
  END IF;

  SELECT geo_mode, tax_mode, tax_rate, currency INTO v_mode, v_taxmode, v_rate, v_ccur
    FROM company_config WHERE company_id = v_co LIMIT 1;
  v_taxmode := coalesce(v_taxmode, 'none');
  v_rate := coalesce(v_rate, 0);

  IF v_fxc IS NOT NULL AND v_fxc = upper(btrim(coalesce(v_ccur, ''))) THEN
    RAISE EXCEPTION 'Ese pago es en la moneda de la empresa (%): no es un pago en otra moneda', v_fxc;
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_chan = 'ruta' AND p_geo IS NULL AND (coalesce(v_mode, 'off') = 'todos'
    OR (coalesce(v_mode, 'off') = 'vendedores' AND v_role = 'vendedor')) THEN
    RAISE EXCEPTION 'La empresa exige confirmar la ubicación de la venta';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_cust FROM customers WHERE id = p_customer_id AND company_id = v_co;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no existe'; END IF;
  END IF;

  IF v_pay = 'fiado' THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'El fiado requiere un cliente registrado'; END IF;
    PERFORM 1 FROM customers WHERE id = p_customer_id AND company_id = v_co FOR UPDATE;
    SELECT coalesce(credit_limit, 0), coalesce(credit_days, 30) INTO v_limit, v_days
      FROM customer_credit WHERE customer_id = p_customer_id AND company_id = v_co;
    IF NOT FOUND THEN v_limit := 0; v_days := 30; END IF;
    SELECT timezone INTO v_tz FROM acc_settings WHERE company_id = v_co;
    v_due := (v_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date + v_days;
  END IF;

  INSERT INTO sales (company_id, customer_id, customer_name, items, total, payment_method, status, client_uuid, created_at, channel)
    VALUES (v_co, p_customer_id, v_cust, '[]', 0, v_pay, 'completada', p_client_id, v_at, v_chan)
    RETURNING id INTO v_id;

  FOR e IN SELECT x FROM jsonb_array_elements(p_items) x ORDER BY x->>'product_id' LOOP
    v_pid   := _item_uuid(e, 'product_id');
    v_qty   := _item_num(e, 'quantity');
    v_price := _item_num(e, 'price');
    IF v_qty <= 0 OR v_price < 0 THEN RAISE EXCEPTION 'Cantidad o precio inválido'; END IF;

    SELECT * INTO v_prod FROM products WHERE id = v_pid AND company_id = v_co FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no existe'; END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %)', v_prod.name, v_prod.stock;
    END IF;

    IF v_prod.tracks_expiry THEN
      v_sdate := (v_at AT TIME ZONE coalesce((SELECT timezone FROM acc_settings WHERE company_id = v_co), 'America/Bogota'))::date;
      IF v_prod.stock - coalesce((SELECT sum(qty_remaining) FROM product_lots
        WHERE company_id = v_co AND product_id = v_prod.id AND expiry_date < v_sdate), 0) < v_qty THEN
        RAISE EXCEPTION 'No hay stock vendible de %: lo que queda está vencido. Dalo de baja en Lotes.', v_prod.name;
      END IF;
    END IF;

    v_new := v_prod.stock - v_qty;
    UPDATE products SET stock = v_new WHERE id = v_prod.id;
    IF v_prod.tracks_expiry THEN PERFORM public._lot_consume(v_co, v_id, v_prod.id, v_qty); END IF;

    INSERT INTO kardex (company_id, product_id, product_name, type, quantity, balance, reference_type, reference_id)
      VALUES (v_co, v_prod.id, v_prod.name, 'salida', v_qty, v_new, 'sale', v_id);

    v_total := v_total + v_qty * v_price;
    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'product_name', v_prod.name,
      'quantity', v_qty, 'price', v_price, 'subtotal', v_qty * v_price);
  END LOOP;

  v_disc := round(least(coalesce(p_discount, 0), v_total), 2);
  v_total := v_total - v_disc;

  v_base := v_total;
  IF v_taxmode = 'adicional' AND v_rate > 0 THEN
    v_tax := round(v_total * v_rate / 100, 2);
    v_total := v_total + v_tax;
  ELSIF v_taxmode = 'incluido' AND v_rate > 0 THEN
    v_tax := round(v_total - v_total / (1 + v_rate / 100), 2);
    v_base := v_total - v_tax;
  ELSE
    v_rate := 0;
  END IF;

  -- Lo recibido (divisa convertida + parte en moneda de la empresa) debe cubrir el total
  IF v_eq IS NOT NULL AND v_eq < v_total - greatest(0.01, v_fxr * 0.005) THEN
    RAISE EXCEPTION 'El pago en % equivale a %, y no cubre el total de la venta (%)', v_fxc, v_eq, v_total;
  END IF;

  IF v_pay = 'fiado' AND v_limit > 0 THEN
    v_owed := public._customer_owed(v_co, p_customer_id);
    IF v_owed + v_total > v_limit THEN
      RAISE EXCEPTION 'Supera el cupo de crédito del cliente (cupo: %, debe: %, esta venta: %)',
        round(v_limit, 2), round(v_owed, 2), round(v_total, 2);
    END IF;
  END IF;

  UPDATE sales
    SET items = v_items, total = v_total, subtotal = v_base, tax_rate = v_rate, tax_amount = v_tax,
    discount_amount = v_disc,
    amount_received = CASE WHEN v_pay = 'fiado' THEN NULL WHEN v_eq IS NOT NULL THEN v_eq ELSE p_received END,
    fx_currency = v_fxc, fx_amount = v_fxa, fx_rate = v_fxr,
    due_date = v_due
    WHERE id = v_id;

  IF v_pay = 'efectivo' THEN
    INSERT INTO cash_entries (company_id, type, amount, description, reference_type, reference_id, created_at)
      VALUES (v_co, 'ingreso', v_total,
      'Venta - ' || coalesce(v_cust, 'Cliente general')
      || CASE WHEN v_fxc IS NOT NULL THEN ' (pagó ' || round(v_fxa, 2) || ' ' || v_fxc || ' a tasa ' || v_fxr
      || CASE WHEN v_basea > 0 THEN ' + ' || v_basea || ' en moneda local' ELSE '' END || ')' ELSE '' END,
      'sale', v_id, v_at);
  END IF;

  IF p_geo IS NOT NULL THEN
    PERFORM public._record_visit(v_co, p_customer_id, v_id, 'venta', p_geo);
    IF v_at <> now() THEN
      UPDATE visits SET created_at = v_at WHERE sale_id = v_id;
    END IF;
  END IF;

  RETURN v_id;
END
$function$;

GRANT EXECUTE ON FUNCTION public.registrar_venta(uuid, jsonb, text, jsonb, uuid, timestamptz, text, numeric, numeric, text, numeric, numeric, numeric) TO authenticated, service_role;
