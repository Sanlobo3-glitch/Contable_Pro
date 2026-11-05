-- =============================================================================
-- InventarioPro · Liquidación Real de Nómina, Despacho de Rutas y Catálogo Digital
-- =============================================================================
-- Qué incorpora este script:
--   1. Sello automático de vendedor en ventas (sales.seller_id) con relleno
--      histórico seguro desde visitas y auditoría.
--   2. Liquidación Real de Nómina, Adelantos/Vales, Bonos y Recibos:
--      - Tablas payroll_movements y payroll_payments con seguridad por empresa (RLS).
--      - Los adelantos y las liquidaciones generan automáticamente su Gasto en
--        «Nómina y comisiones», salida de Caja (si es efectivo) y asiento contable,
--        sin duplicar comisiones ni gastos. Permite anular revirtiendo todo.
--   3. Despacho de Ruta («Bodega en Vehículo») y Liquidación Diaria del Vendedor:
--      - Tablas route_dispatches y route_dispatch_items.
--      - Controla mercancía cargada en la mañana, ventas del día del vendedor,
--        unidades que deben regresar a bodega y cuadre exacto del efectivo a entregar
--        (fondo inicial + ventas efectivo + cobros de cartera en efectivo).
--   4. Fotos en Productos + Actualizador Masivo de Precios + Catálogo Digital Público:
--      - Columna products.image_url y opciones de catálogo en company_config.
--      - Función actualizar_precios_masivo (% sobre precio o margen sobre costo).
--      - Funciones públicas seguras obtener_catalogo_publico y
--        crear_pedido_catalogo_publico (crea cliente si no existe y registra el
--        pedido directamente en Cotizaciones listo para convertir en venta).
--
-- 100% idempotente: seguro de ejecutar una o varias veces en Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. IDENTIFICACIÓN AUTOMÁTICA DEL VENDEDOR EN VENTAS (sales.seller_id)
-- =============================================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS seller_id uuid DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_sales_company_seller_created
  ON public.sales (company_id, seller_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._sales_stamp_seller()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.seller_id IS NULL THEN
    NEW.seller_id := auth.uid();
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS sales_stamp_seller_trg ON public.sales;
CREATE TRIGGER sales_stamp_seller_trg
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public._sales_stamp_seller();

-- Relleno histórico desde visitas y registro de auditoría si había ventas previas sin seller_id
DO $$
BEGIN
  IF to_regclass('public.visits') IS NOT NULL THEN
    BEGIN
      UPDATE public.sales s
         SET seller_id = v.seller_id
        FROM public.visits v
       WHERE v.sale_id = s.id
         AND s.seller_id IS NULL
         AND v.seller_id IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF to_regclass('public.audit_log') IS NOT NULL THEN
    BEGIN
      UPDATE public.sales s
         SET seller_id = a.user_id
        FROM public.audit_log a
       WHERE a.table_name = 'sales'
         AND a.action = 'INSERT'
         AND a.record_id = s.id::text
         AND s.seller_id IS NULL
         AND a.user_id IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;


-- =============================================================================
-- 1. LIQUIDACIÓN REAL DE NÓMINA, ADELANTOS, BONOS Y DESCUENTOS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payroll_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  member_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('adelanto', 'bono', 'descuento')),
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'sin_desembolso'
    CHECK (method IN ('efectivo', 'tarjeta', 'transferencia', 'sin_desembolso')),
  movement_date date NOT NULL DEFAULT current_date,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'aplicado', 'anulado')),
  expense_id uuid,
  payment_id uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_movements_company_user
  ON public.payroll_movements (company_id, user_id, status, movement_date DESC);

CREATE TABLE IF NOT EXISTS public.payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  member_name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  payment_date date NOT NULL DEFAULT current_date,
  base_amount numeric NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  sales_amount numeric NOT NULL DEFAULT 0 CHECK (sales_amount >= 0),
  commission_pct numeric NOT NULL DEFAULT 0 CHECK (commission_pct >= 0),
  commission_amount numeric NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  bonuses_amount numeric NOT NULL DEFAULT 0 CHECK (bonuses_amount >= 0),
  deductions_amount numeric NOT NULL DEFAULT 0 CHECK (deductions_amount >= 0),
  advances_deducted numeric NOT NULL DEFAULT 0 CHECK (advances_deducted >= 0),
  net_paid numeric NOT NULL DEFAULT 0 CHECK (net_paid >= 0),
  method text NOT NULL DEFAULT 'efectivo'
    CHECK (method IN ('efectivo', 'tarjeta', 'transferencia')),
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'activo'
    CHECK (status IN ('activo', 'anulado')),
  expense_id uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_company_date
  ON public.payroll_payments (company_id, payment_date DESC, created_at DESC);

ALTER TABLE public.payroll_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_movements_select ON public.payroll_movements;
CREATE POLICY payroll_movements_select ON public.payroll_movements
  FOR SELECT USING (
    company_id = public.current_company_id()
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role IN ('dueno', 'admin') AND p.active = true
      )
    )
  );

DROP POLICY IF EXISTS payroll_payments_select ON public.payroll_payments;
CREATE POLICY payroll_payments_select ON public.payroll_payments
  FOR SELECT USING (
    company_id = public.current_company_id()
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role IN ('dueno', 'admin') AND p.active = true
      )
    )
  );

-- Auxiliar interno para obtener o crear la categoría de gasto «Nómina y comisiones»
CREATE OR REPLACE FUNCTION public._nomina_expense_category(p_company_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_cat_id uuid;
BEGIN
  IF to_regclass('public.expense_categories') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_cat_id
  FROM public.expense_categories
  WHERE company_id = p_company_id
    AND lower(btrim(name)) IN ('nómina y comisiones', 'nomina y comisiones')
  LIMIT 1;

  IF v_cat_id IS NULL THEN
    INSERT INTO public.expense_categories (company_id, name, active)
    VALUES (p_company_id, 'Nómina y comisiones', true)
    ON CONFLICT (company_id, name) DO UPDATE SET active = true
    RETURNING id INTO v_cat_id;
  ELSE
    UPDATE public.expense_categories SET active = true WHERE id = v_cat_id;
  END IF;

  RETURN v_cat_id;
END $function$;

REVOKE ALL ON FUNCTION public._nomina_expense_category(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nomina_expense_category(uuid) TO service_role;

-- Registrar adelanto/vale, bono o descuento para un miembro del equipo
CREATE OR REPLACE FUNCTION public.registrar_movimiento_nomina(
  p_user_id uuid,
  p_type text,
  p_amount numeric,
  p_method text DEFAULT 'efectivo',
  p_reason text DEFAULT '',
  p_date date DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_target public.profiles%ROWTYPE;
  v_amt numeric := round(coalesce(p_amount, 0), 2);
  v_reason text := left(btrim(coalesce(p_reason, '')), 200);
  v_method text := coalesce(nullif(btrim(p_method), ''), 'sin_desembolso');
  v_date date := coalesce(p_date, current_date);
  v_actor_name text;
  v_member_name text;
  v_cat_id uuid;
  v_exp_id uuid := NULL;
  v_id uuid;
BEGIN
  IF p_type NOT IN ('adelanto', 'bono', 'descuento') THEN
    RAISE EXCEPTION 'Tipo de novedad inválido (usa adelanto, bono o descuento)';
  END IF;
  IF v_amt <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Escribe el motivo o concepto';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_user_id AND company_id = v_co;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El miembro seleccionado no pertenece a tu empresa';
  END IF;

  v_member_name := coalesce(nullif(btrim(v_target.full_name), ''), v_target.email);
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  IF p_type = 'adelanto' THEN
    IF v_method NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
      v_method := 'efectivo';
    END IF;
    -- Si existe el módulo de Gastos, registramos de inmediato la salida de dinero real
    IF to_regprocedure('public.registrar_gasto(uuid,numeric,text,text,text,text,date)') IS NOT NULL THEN
      v_cat_id := public._nomina_expense_category(v_co);
      IF v_cat_id IS NOT NULL THEN
        v_exp_id := public.registrar_gasto(
          v_cat_id,
          v_amt,
          v_method,
          'Adelanto de nómina - ' || v_member_name || ': ' || v_reason,
          v_member_name,
          'VALE-NOMINA',
          v_date
        );
      END IF;
    ELSIF v_method = 'efectivo' AND to_regclass('public.cash_entries') IS NOT NULL THEN
      INSERT INTO public.cash_entries (company_id, type, amount, description, reference_type)
      VALUES (v_co, 'egreso', v_amt, 'Adelanto de nómina - ' || v_member_name || ': ' || v_reason, 'nomina');
    END IF;
  ELSE
    -- Bonos y descuentos se liquidan al cerrar el periodo de nómina
    v_method := 'sin_desembolso';
  END IF;

  INSERT INTO public.payroll_movements (
    company_id, user_id, member_name, type, amount, method, movement_date,
    reason, status, expense_id, created_by, created_by_name
  ) VALUES (
    v_co, v_target.id, v_member_name, p_type, v_amt, v_method, v_date,
    v_reason, 'pendiente', v_exp_id, auth.uid(), v_actor_name
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.registrar_movimiento_nomina(uuid,text,numeric,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_nomina(uuid,text,numeric,text,text,date) TO authenticated, service_role;

-- Anular un adelanto, bono o descuento aún pendiente
CREATE OR REPLACE FUNCTION public.anular_movimiento_nomina(p_movement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  m public.payroll_movements%ROWTYPE;
BEGIN
  SELECT * INTO m
  FROM public.payroll_movements
  WHERE id = p_movement_id AND company_id = v_co
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El registro no existe';
  END IF;
  IF m.status = 'anulado' THEN
    RAISE EXCEPTION 'Este registro ya fue anulado';
  END IF;
  IF m.status = 'aplicado' THEN
    RAISE EXCEPTION 'Ya fue descontado en una liquidación de nómina. Anula primero esa liquidación si deseas revertirlo.';
  END IF;

  UPDATE public.payroll_movements
  SET status = 'anulado'
  WHERE id = m.id;

  IF m.expense_id IS NOT NULL AND to_regprocedure('public.anular_gasto(uuid)') IS NOT NULL THEN
    BEGIN
      PERFORM public.anular_gasto(m.expense_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.anular_movimiento_nomina(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_movimiento_nomina(uuid) TO authenticated, service_role;

-- Previsualizar cálculo exacto de liquidación de nómina para un miembro y rango de fechas
CREATE OR REPLACE FUNCTION public.previsualizar_liquidacion_nomina(
  p_user_id uuid,
  p_from date,
  p_to date
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_base numeric := 0;
  v_comm_pct numeric := 0;
  v_sales_total numeric := 0;
  v_sales_count int := 0;
  v_advances numeric := 0;
  v_bonuses numeric := 0;
  v_deductions numeric := 0;
  v_overlap_count int := 0;
  v_tz text := 'America/Bogota';
  v_movements jsonb := '[]'::jsonb;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'La fecha final no puede ser anterior a la fecha inicial';
  END IF;

  IF to_regclass('public.acc_settings') IS NOT NULL THEN
    SELECT coalesce(timezone, 'America/Bogota') INTO v_tz
    FROM public.acc_settings WHERE company_id = v_co LIMIT 1;
  END IF;

  SELECT coalesce(mp.base_salary, 0), coalesce(mp.commission_pct, 0)
    INTO v_base, v_comm_pct
  FROM public.profiles p
  LEFT JOIN public.member_profiles mp ON mp.user_id = p.id
  WHERE p.id = p_user_id AND p.company_id = v_co;

  -- Ventas completadas del vendedor en el periodo que NO estén ya cubiertas por otra liquidación activa
  SELECT coalesce(sum(s.total), 0), count(*)::int
    INTO v_sales_total, v_sales_count
  FROM public.sales s
  WHERE s.company_id = v_co
    AND s.seller_id = p_user_id
    AND s.status <> 'anulada'
    AND (s.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date BETWEEN p_from AND p_to
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_payments pp
      WHERE pp.company_id = v_co
        AND pp.user_id = p_user_id
        AND pp.status = 'activo'
        AND (s.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date BETWEEN pp.period_from AND pp.period_to
    );

  SELECT count(*)::int INTO v_overlap_count
  FROM public.payroll_payments pp
  WHERE pp.company_id = v_co
    AND pp.user_id = p_user_id
    AND pp.status = 'activo'
    AND pp.period_from <= p_to
    AND pp.period_to >= p_from;

  SELECT
    coalesce(sum(CASE WHEN type = 'adelanto' THEN amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN type = 'bono' THEN amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN type = 'descuento' THEN amount ELSE 0 END), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'type', type,
        'amount', amount,
        'movement_date', movement_date,
        'reason', reason
      ) ORDER BY movement_date ASC, created_at ASC
    ), '[]'::jsonb)
  INTO v_advances, v_bonuses, v_deductions, v_movements
  FROM public.payroll_movements
  WHERE company_id = v_co
    AND user_id = p_user_id
    AND status = 'pendiente'
    AND movement_date <= p_to;

  RETURN jsonb_build_object(
    'base_salary', round(v_base, 2),
    'commission_pct', round(v_comm_pct, 2),
    'sales_amount', round(v_sales_total, 2),
    'sales_count', v_sales_count,
    'commission_amount', round(v_sales_total * v_comm_pct / 100.0, 2),
    'advances_amount', round(v_advances, 2),
    'bonuses_amount', round(v_bonuses, 2),
    'deductions_amount', round(v_deductions, 2),
    'overlapping_payments', v_overlap_count,
    'pending_movements', v_movements
  );
END $function$;

REVOKE ALL ON FUNCTION public.previsualizar_liquidacion_nomina(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.previsualizar_liquidacion_nomina(uuid,date,date) TO authenticated, service_role;

-- Liquidar y pagar periodo de nómina (genera gasto, salida de caja y asiento contable)
CREATE OR REPLACE FUNCTION public.liquidar_pago_nomina(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_base_amount numeric,
  p_sales_amount numeric,
  p_commission_pct numeric,
  p_commission_amount numeric,
  p_method text DEFAULT 'efectivo',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_payment_date date DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_target public.profiles%ROWTYPE;
  v_member_name text;
  v_actor_name text;
  v_base numeric := round(greatest(coalesce(p_base_amount, 0), 0), 2);
  v_sales numeric := round(greatest(coalesce(p_sales_amount, 0), 0), 2);
  v_cpct numeric := round(greatest(coalesce(p_commission_pct, 0), 0), 2);
  v_comm numeric := round(greatest(coalesce(p_commission_amount, 0), 0), 2);
  v_adv numeric := 0;
  v_bon numeric := 0;
  v_ded numeric := 0;
  v_net numeric := 0;
  v_pdate date := coalesce(p_payment_date, current_date);
  v_cat_id uuid;
  v_exp_id uuid := NULL;
  v_pay_id uuid;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'El rango de fechas del periodo es inválido';
  END IF;
  IF coalesce(p_method, '') NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'Selecciona una forma de pago válida (efectivo, transferencia o tarjeta)';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_user_id AND company_id = v_co
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El miembro no pertenece a tu empresa';
  END IF;

  v_member_name := coalesce(nullif(btrim(v_target.full_name), ''), v_target.email);
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  SELECT
    coalesce(sum(CASE WHEN type = 'adelanto' THEN amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN type = 'bono' THEN amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN type = 'descuento' THEN amount ELSE 0 END), 0)
  INTO v_adv, v_bon, v_ded
  FROM public.payroll_movements
  WHERE company_id = v_co
    AND user_id = p_user_id
    AND status = 'pendiente'
    AND movement_date <= p_to;

  v_net := round(greatest(v_base + v_comm + v_bon - v_ded - v_adv, 0), 2);

  IF v_base + v_comm + v_bon <= 0 AND v_adv <= 0 THEN
    RAISE EXCEPTION 'El total a liquidar debe ser mayor a cero';
  END IF;

  IF v_net > 0 THEN
    IF to_regprocedure('public.registrar_gasto(uuid,numeric,text,text,text,text,date)') IS NOT NULL THEN
      v_cat_id := public._nomina_expense_category(v_co);
      IF v_cat_id IS NOT NULL THEN
        v_exp_id := public.registrar_gasto(
          v_cat_id,
          v_net,
          p_method,
          'Liquidación de nómina (' || p_from::text || ' a ' || p_to::text || ') - ' || v_member_name,
          v_member_name,
          nullif(btrim(coalesce(p_reference, '')), ''),
          v_pdate
        );
      END IF;
    ELSIF p_method = 'efectivo' AND to_regclass('public.cash_entries') IS NOT NULL THEN
      INSERT INTO public.cash_entries (company_id, type, amount, description, reference_type)
      VALUES (v_co, 'egreso', v_net, 'Liquidación de nómina - ' || v_member_name, 'nomina');
    END IF;
  END IF;

  INSERT INTO public.payroll_payments (
    company_id, user_id, member_name, period_from, period_to, payment_date,
    base_amount, sales_amount, commission_pct, commission_amount,
    bonuses_amount, deductions_amount, advances_deducted, net_paid,
    method, reference, notes, status, expense_id, created_by, created_by_name
  ) VALUES (
    v_co, p_user_id, v_member_name, p_from, p_to, v_pdate,
    v_base, v_sales, v_cpct, v_comm,
    round(v_bon, 2), round(v_ded, 2), round(v_adv, 2), v_net,
    p_method,
    nullif(left(btrim(coalesce(p_reference, '')), 80), ''),
    nullif(left(btrim(coalesce(p_notes, '')), 300), ''),
    'activo', v_exp_id, auth.uid(), v_actor_name
  )
  RETURNING id INTO v_pay_id;

  UPDATE public.payroll_movements
     SET status = 'aplicado',
         payment_id = v_pay_id
   WHERE company_id = v_co
     AND user_id = p_user_id
     AND status = 'pendiente'
     AND movement_date <= p_to;

  RETURN v_pay_id;
END $function$;

REVOKE ALL ON FUNCTION public.liquidar_pago_nomina(uuid,date,date,numeric,numeric,numeric,numeric,text,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liquidar_pago_nomina(uuid,date,date,numeric,numeric,numeric,numeric,text,text,text,date) TO authenticated, service_role;

-- Anular una liquidación de nómina (revierte gasto, caja, contabilidad y libera vales/bonos)
CREATE OR REPLACE FUNCTION public.anular_pago_nomina(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  pp public.payroll_payments%ROWTYPE;
BEGIN
  SELECT * INTO pp
  FROM public.payroll_payments
  WHERE id = p_payment_id AND company_id = v_co
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La liquidación de nómina no existe';
  END IF;
  IF pp.status = 'anulado' THEN
    RAISE EXCEPTION 'Esta liquidación ya fue anulada';
  END IF;

  UPDATE public.payroll_payments
     SET status = 'anulado'
   WHERE id = pp.id;

  UPDATE public.payroll_movements
     SET status = 'pendiente',
         payment_id = NULL
   WHERE company_id = v_co
     AND payment_id = pp.id
     AND status = 'aplicado';

  IF pp.expense_id IS NOT NULL AND to_regprocedure('public.anular_gasto(uuid)') IS NOT NULL THEN
    BEGIN
      PERFORM public.anular_gasto(pp.expense_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.anular_pago_nomina(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_pago_nomina(uuid) TO authenticated, service_role;


-- =============================================================================
-- 2. DESPACHO DE RUTA («BODEGA EN VEHÍCULO») Y LIQUIDACIÓN DIARIA
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.route_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  seller_name text NOT NULL,
  dispatch_date date NOT NULL DEFAULT current_date,
  vehicle_label text,
  zone text,
  opening_cash numeric NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  status text NOT NULL DEFAULT 'abierto'
    CHECK (status IN ('abierto', 'liquidado', 'anulado')),
  sales_cash numeric NOT NULL DEFAULT 0,
  sales_bank numeric NOT NULL DEFAULT 0,
  sales_credit numeric NOT NULL DEFAULT 0,
  collections_cash numeric NOT NULL DEFAULT 0,
  collections_bank numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  delivered_cash numeric,
  cash_diff numeric,
  notes text,
  closed_at timestamptz,
  closed_by_name text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_dispatches_company_date
  ON public.route_dispatches (company_id, dispatch_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.route_dispatch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.route_dispatches(id) ON DELETE CASCADE,
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'unidad',
  unit_price numeric NOT NULL DEFAULT 0,
  qty_loaded numeric NOT NULL CHECK (qty_loaded > 0),
  qty_sold numeric NOT NULL DEFAULT 0,
  qty_returned numeric,
  qty_diff numeric
);

CREATE INDEX IF NOT EXISTS idx_route_dispatch_items_dispatch
  ON public.route_dispatch_items (dispatch_id);

ALTER TABLE public.route_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_dispatch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS route_dispatches_select ON public.route_dispatches;
CREATE POLICY route_dispatches_select ON public.route_dispatches
  FOR SELECT USING (
    company_id = public.current_company_id()
    AND (
      seller_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role IN ('dueno', 'admin') AND p.active = true
      )
    )
  );

DROP POLICY IF EXISTS route_dispatch_items_select ON public.route_dispatch_items;
CREATE POLICY route_dispatch_items_select ON public.route_dispatch_items
  FOR SELECT USING (
    company_id = public.current_company_id()
  );

-- Crear una Hoja de Carga / Despacho de Ruta para un vendedor
CREATE OR REPLACE FUNCTION public.crear_despacho_ruta(
  p_seller_id uuid,
  p_date date,
  p_vehicle_label text DEFAULT NULL,
  p_opening_cash numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  v_seller public.profiles%ROWTYPE;
  v_zone text;
  v_actor_name text;
  v_seller_name text;
  v_open numeric := round(greatest(coalesce(p_opening_cash, 0), 0), 2);
  v_ddate date := coalesce(p_date, current_date);
  v_disp_id uuid;
  v_item jsonb;
  v_pid uuid;
  v_qty numeric;
  v_prod public.products%ROWTYPE;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto a la hoja de carga';
  END IF;

  SELECT * INTO v_seller
  FROM public.profiles
  WHERE id = p_seller_id AND company_id = v_co;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El vendedor seleccionado no pertenece a tu empresa';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.route_dispatches
    WHERE company_id = v_co
      AND seller_id = p_seller_id
      AND dispatch_date = v_ddate
      AND status = 'abierto'
  ) THEN
    RAISE EXCEPTION 'Este vendedor ya tiene una hoja de carga abierta para esa fecha. Liquídala o anúlala antes de abrir otra.';
  END IF;

  SELECT mp.zone INTO v_zone
  FROM public.member_profiles mp
  WHERE mp.user_id = p_seller_id;

  v_seller_name := coalesce(nullif(btrim(v_seller.full_name), ''), v_seller.email);
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.route_dispatches (
    company_id, seller_id, seller_name, dispatch_date, vehicle_label, zone,
    opening_cash, status, expected_cash, notes, created_by, created_by_name
  ) VALUES (
    v_co, p_seller_id, v_seller_name, v_ddate,
    nullif(left(btrim(coalesce(p_vehicle_label, '')), 80), ''),
    v_zone,
    v_open, 'abierto', v_open,
    nullif(left(btrim(coalesce(p_notes, '')), 300), ''),
    auth.uid(), v_actor_name
  )
  RETURNING id INTO v_disp_id;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := round(coalesce((v_item->>'qty_loaded')::numeric, 0), 3);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Todas las cantidades cargadas deben ser mayores a cero';
    END IF;

    SELECT * INTO v_prod
    FROM public.products
    WHERE id = v_pid AND company_id = v_co;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos ya no existe en el catálogo';
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente en bodega para % (disponible: %, solicitado: %)',
        v_prod.name, v_prod.stock, v_qty;
    END IF;

    INSERT INTO public.route_dispatch_items (
      dispatch_id, company_id, product_id, product_name, sku, unit, unit_price, qty_loaded
    ) VALUES (
      v_disp_id, v_co, v_prod.id, v_prod.name, coalesce(v_prod.sku, ''),
      coalesce(v_prod.unit, 'unidad'), coalesce(v_prod.price, 0), v_qty
    );
  END LOOP;

  RETURN v_disp_id;
END $function$;

REVOKE ALL ON FUNCTION public.crear_despacho_ruta(uuid,date,text,numeric,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_despacho_ruta(uuid,date,text,numeric,text,jsonb) TO authenticated, service_role;

-- Consultar despachos con cálculo en vivo de unidades vendidas y dinero recaudado hoy
CREATE OR REPLACE FUNCTION public.listar_despachos_ruta(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
  v_uid uuid := auth.uid();
  v_role text;
  v_tz text := 'America/Bogota';
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date + 7);
  v_out jsonb := '[]'::jsonb;
  d public.route_dispatches%ROWTYPE;
  v_scash numeric;
  v_sbank numeric;
  v_scred numeric;
  v_ccash numeric;
  v_cbank numeric;
  v_exp_cash numeric;
  v_items jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

  IF to_regclass('public.acc_settings') IS NOT NULL THEN
    SELECT coalesce(timezone, 'America/Bogota') INTO v_tz
    FROM public.acc_settings WHERE company_id = v_co LIMIT 1;
  END IF;

  FOR d IN
    SELECT *
    FROM public.route_dispatches rd
    WHERE rd.company_id = v_co
      AND rd.dispatch_date BETWEEN v_from AND v_to
      AND (v_role IN ('dueno', 'admin') OR rd.seller_id = v_uid)
    ORDER BY rd.dispatch_date DESC, rd.created_at DESC
    LIMIT 120
  LOOP
    IF d.status = 'abierto' THEN
      SELECT
        coalesce(sum(CASE WHEN s.payment_method = 'efectivo' THEN s.total ELSE 0 END), 0),
        coalesce(sum(CASE WHEN s.payment_method IN ('transferencia', 'tarjeta') THEN s.total ELSE 0 END), 0),
        coalesce(sum(CASE WHEN s.payment_method = 'fiado' THEN s.total ELSE 0 END), 0)
      INTO v_scash, v_sbank, v_scred
      FROM public.sales s
      WHERE s.company_id = v_co
        AND s.seller_id = d.seller_id
        AND s.status <> 'anulada'
        AND (s.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date = d.dispatch_date;

      v_ccash := 0;
      v_cbank := 0;
      IF to_regclass('public.credit_payments') IS NOT NULL THEN
        SELECT
          coalesce(sum(CASE WHEN cp.method = 'efectivo' THEN cp.amount ELSE 0 END), 0),
          coalesce(sum(CASE WHEN cp.method IN ('transferencia', 'tarjeta') THEN cp.amount ELSE 0 END), 0)
        INTO v_ccash, v_cbank
        FROM public.credit_payments cp
        WHERE cp.company_id = v_co
          AND cp.created_by = d.seller_id
          AND cp.status = 'activo'
          AND (cp.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date = d.dispatch_date;
      END IF;

      v_exp_cash := round(d.opening_cash + v_scash + v_ccash, 2);

      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'product_id', i.product_id,
          'product_name', i.product_name,
          'sku', i.sku,
          'unit', i.unit,
          'unit_price', i.unit_price,
          'qty_loaded', i.qty_loaded,
          'qty_sold', coalesce(sold.q, 0),
          'qty_expected_return', greatest(i.qty_loaded - coalesce(sold.q, 0), 0),
          'qty_returned', i.qty_returned,
          'qty_diff', i.qty_diff
        ) ORDER BY i.product_name ASC
      ), '[]'::jsonb)
      INTO v_items
      FROM public.route_dispatch_items i
      LEFT JOIN LATERAL (
        SELECT coalesce(sum((x->>'quantity')::numeric), 0) AS q
        FROM public.sales s
        CROSS JOIN LATERAL jsonb_array_elements(s.items) x
        WHERE s.company_id = v_co
          AND s.seller_id = d.seller_id
          AND s.status <> 'anulada'
          AND (s.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date = d.dispatch_date
          AND (x->>'product_id')::uuid = i.product_id
      ) sold ON true
      WHERE i.dispatch_id = d.id;
    ELSE
      v_scash := d.sales_cash;
      v_sbank := d.sales_bank;
      v_scred := d.sales_credit;
      v_ccash := d.collections_cash;
      v_cbank := d.collections_bank;
      v_exp_cash := d.expected_cash;

      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'product_id', i.product_id,
          'product_name', i.product_name,
          'sku', i.sku,
          'unit', i.unit,
          'unit_price', i.unit_price,
          'qty_loaded', i.qty_loaded,
          'qty_sold', i.qty_sold,
          'qty_expected_return', greatest(i.qty_loaded - i.qty_sold, 0),
          'qty_returned', i.qty_returned,
          'qty_diff', i.qty_diff
        ) ORDER BY i.product_name ASC
      ), '[]'::jsonb)
      INTO v_items
      FROM public.route_dispatch_items i
      WHERE i.dispatch_id = d.id;
    END IF;

    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'id', d.id,
        'seller_id', d.seller_id,
        'seller_name', d.seller_name,
        'dispatch_date', d.dispatch_date,
        'vehicle_label', d.vehicle_label,
        'zone', d.zone,
        'opening_cash', d.opening_cash,
        'status', d.status,
        'sales_cash', round(v_scash, 2),
        'sales_bank', round(v_sbank, 2),
        'sales_credit', round(v_scred, 2),
        'collections_cash', round(v_ccash, 2),
        'collections_bank', round(v_cbank, 2),
        'expected_cash', round(v_exp_cash, 2),
        'delivered_cash', d.delivered_cash,
        'cash_diff', d.cash_diff,
        'notes', d.notes,
        'closed_at', d.closed_at,
        'closed_by_name', d.closed_by_name,
        'created_by_name', d.created_by_name,
        'created_at', d.created_at,
        'items', v_items
      )
    );
  END LOOP;

  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.listar_despachos_ruta(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_despachos_ruta(date,date) TO authenticated, service_role;

-- Liquidar y cerrar la ruta en la tarde registrando devolución física y entrega de efectivo
CREATE OR REPLACE FUNCTION public.liquidar_despacho_ruta(
  p_dispatch_id uuid,
  p_delivered_cash numeric,
  p_returns jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  d public.route_dispatches%ROWTYPE;
  v_tz text := 'America/Bogota';
  v_scash numeric := 0;
  v_sbank numeric := 0;
  v_scred numeric := 0;
  v_ccash numeric := 0;
  v_cbank numeric := 0;
  v_exp_cash numeric := 0;
  v_deliv numeric := round(greatest(coalesce(p_delivered_cash, 0), 0), 2);
  v_actor_name text;
  r record;
  v_sold numeric;
  v_ret numeric;
BEGIN
  SELECT * INTO d
  FROM public.route_dispatches
  WHERE id = p_dispatch_id AND company_id = v_co
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La hoja de despacho no existe';
  END IF;
  IF d.status <> 'abierto' THEN
    RAISE EXCEPTION 'Este despacho ya fue %', d.status;
  END IF;

  IF to_regclass('public.acc_settings') IS NOT NULL THEN
    SELECT coalesce(timezone, 'America/Bogota') INTO v_tz
    FROM public.acc_settings WHERE company_id = v_co LIMIT 1;
  END IF;

  SELECT
    coalesce(sum(CASE WHEN s.payment_method = 'efectivo' THEN s.total ELSE 0 END), 0),
    coalesce(sum(CASE WHEN s.payment_method IN ('transferencia', 'tarjeta') THEN s.total ELSE 0 END), 0),
    coalesce(sum(CASE WHEN s.payment_method = 'fiado' THEN s.total ELSE 0 END), 0)
  INTO v_scash, v_sbank, v_scred
  FROM public.sales s
  WHERE s.company_id = v_co
    AND s.seller_id = d.seller_id
    AND s.status <> 'anulada'
    AND (s.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date = d.dispatch_date;

  IF to_regclass('public.credit_payments') IS NOT NULL THEN
    SELECT
      coalesce(sum(CASE WHEN cp.method = 'efectivo' THEN cp.amount ELSE 0 END), 0),
      coalesce(sum(CASE WHEN cp.method IN ('transferencia', 'tarjeta') THEN cp.amount ELSE 0 END), 0)
    INTO v_ccash, v_cbank
    FROM public.credit_payments cp
    WHERE cp.company_id = v_co
      AND cp.created_by = d.seller_id
      AND cp.status = 'activo'
      AND (cp.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date = d.dispatch_date;
  END IF;

  v_exp_cash := round(d.opening_cash + v_scash + v_ccash, 2);

  FOR r IN SELECT * FROM public.route_dispatch_items WHERE dispatch_id = d.id FOR UPDATE LOOP
    SELECT coalesce(sum((x->>'quantity')::numeric), 0) INTO v_sold
    FROM public.sales s
    CROSS JOIN LATERAL jsonb_array_elements(s.items) x
    WHERE s.company_id = v_co
      AND s.seller_id = d.seller_id
      AND s.status <> 'anulada'
      AND (s.created_at AT TIME ZONE coalesce(v_tz, 'America/Bogota'))::date = d.dispatch_date
      AND (x->>'product_id')::uuid = r.product_id;

    SELECT coalesce((elem->>'qty_returned')::numeric, greatest(r.qty_loaded - v_sold, 0))
      INTO v_ret
    FROM jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) elem
    WHERE (elem->>'item_id')::uuid = r.id
    LIMIT 1;

    IF v_ret IS NULL THEN
      v_ret := greatest(r.qty_loaded - v_sold, 0);
    END IF;
    v_ret := round(greatest(v_ret, 0), 3);

    UPDATE public.route_dispatch_items
       SET qty_sold = round(v_sold, 3),
           qty_returned = v_ret,
           qty_diff = round(v_ret - greatest(r.qty_loaded - v_sold, 0), 3)
     WHERE id = r.id;
  END LOOP;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  UPDATE public.route_dispatches
     SET status = 'liquidado',
         sales_cash = round(v_scash, 2),
         sales_bank = round(v_sbank, 2),
         sales_credit = round(v_scred, 2),
         collections_cash = round(v_ccash, 2),
         collections_bank = round(v_cbank, 2),
         expected_cash = v_exp_cash,
         delivered_cash = v_deliv,
         cash_diff = round(v_deliv - v_exp_cash, 2),
         notes = coalesce(nullif(left(btrim(coalesce(p_notes, '')), 300), ''), notes),
         closed_at = now(),
         closed_by_name = v_actor_name
   WHERE id = d.id;

  RETURN jsonb_build_object(
    'ok', true,
    'expected_cash', v_exp_cash,
    'delivered_cash', v_deliv,
    'cash_diff', round(v_deliv - v_exp_cash, 2)
  );
END $function$;

REVOKE ALL ON FUNCTION public.liquidar_despacho_ruta(uuid,numeric,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liquidar_despacho_ruta(uuid,numeric,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anular_despacho_ruta(p_dispatch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  d public.route_dispatches%ROWTYPE;
BEGIN
  SELECT * INTO d
  FROM public.route_dispatches
  WHERE id = p_dispatch_id AND company_id = v_co
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El despacho no existe';
  END IF;
  IF d.status = 'anulado' THEN
    RAISE EXCEPTION 'Este despacho ya está anulado';
  END IF;

  UPDATE public.route_dispatches
     SET status = 'anulado',
         closed_at = now()
   WHERE id = d.id;
END $function$;

REVOKE ALL ON FUNCTION public.anular_despacho_ruta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_despacho_ruta(uuid) TO authenticated, service_role;


-- =============================================================================
-- 3. FOTOS DE PRODUCTOS, AJUSTE MASIVO DE PRECIOS Y CATÁLOGO DIGITAL PÚBLICO
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.company_config
  ADD COLUMN IF NOT EXISTS catalog_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS catalog_show_wholesale boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS catalog_show_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS catalog_welcome text;

-- Ajuste masivo de precios por porcentaje o margen sobre el costo
CREATE OR REPLACE FUNCTION public.actualizar_precios_masivo(
  p_category_id uuid DEFAULT NULL,
  p_mode text DEFAULT 'percent',
  p_pct numeric DEFAULT 0,
  p_apply_wholesale boolean DEFAULT true,
  p_round_mode text DEFAULT '2dec'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
  r public.products%ROWTYPE;
  v_new_price numeric;
  v_new_wh numeric;
  v_count int := 0;
BEGIN
  IF p_mode NOT IN ('percent', 'margin') THEN
    RAISE EXCEPTION 'Modo de cálculo inválido';
  END IF;
  IF p_mode = 'percent' AND (p_pct <= -99 OR p_pct > 500) THEN
    RAISE EXCEPTION 'El porcentaje de variación debe estar entre -95%% y +500%%';
  END IF;
  IF p_mode = 'margin' AND (p_pct < 0 OR p_pct > 1000) THEN
    RAISE EXCEPTION 'El margen sobre el costo debe estar entre 0%% y 1000%%';
  END IF;

  FOR r IN
    SELECT *
    FROM public.products
    WHERE company_id = v_co
      AND (p_category_id IS NULL OR category_id = p_category_id)
    FOR UPDATE
  LOOP
    IF p_mode = 'percent' THEN
      v_new_price := coalesce(r.price, 0) * (1 + p_pct / 100.0);
      v_new_wh := CASE
        WHEN p_apply_wholesale AND coalesce(r.price_wholesale, 0) > 0
          THEN r.price_wholesale * (1 + p_pct / 100.0)
        ELSE r.price_wholesale
      END;
    ELSE
      -- Recalcular con margen sobre el costo (solo cuando el producto tiene costo > 0)
      IF coalesce(r.cost, 0) <= 0 THEN
        CONTINUE;
      END IF;
      v_new_price := r.cost * (1 + p_pct / 100.0);
      v_new_wh := CASE
        WHEN p_apply_wholesale AND coalesce(r.price_wholesale, 0) > 0 AND coalesce(r.price, 0) > 0
          THEN v_new_price * (r.price_wholesale / r.price)
        ELSE r.price_wholesale
      END;
    END IF;

    -- Aplicar redondeo solicitado
    IF p_round_mode = 'int' THEN
      v_new_price := round(v_new_price, 0);
      IF v_new_wh IS NOT NULL THEN v_new_wh := round(v_new_wh, 0); END IF;
    ELSIF p_round_mode = '100' THEN
      v_new_price := round(v_new_price / 100.0, 0) * 100;
      IF v_new_wh IS NOT NULL THEN v_new_wh := round(v_new_wh / 100.0, 0) * 100; END IF;
    ELSE
      v_new_price := round(v_new_price, 2);
      IF v_new_wh IS NOT NULL THEN v_new_wh := round(v_new_wh, 2); END IF;
    END IF;

    IF v_new_price > 0 THEN
      UPDATE public.products
         SET price = v_new_price,
             price_wholesale = CASE WHEN v_new_wh IS NOT NULL AND v_new_wh > 0 THEN v_new_wh ELSE price_wholesale END
       WHERE id = r.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END $function$;

REVOKE ALL ON FUNCTION public.actualizar_precios_masivo(uuid,text,numeric,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_precios_masivo(uuid,text,numeric,boolean,text) TO authenticated, service_role;

-- Obtener el identificador de empresa del usuario autenticado (para enlace de catálogo)
CREATE OR REPLACE FUNCTION public.obtener_mi_empresa_catalogo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(NULL);
  v_cfg record;
BEGIN
  SELECT
    coalesce(cc.catalog_enabled, true) AS catalog_enabled,
    coalesce(cc.catalog_show_wholesale, true) AS catalog_show_wholesale,
    coalesce(cc.catalog_show_stock, true) AS catalog_show_stock,
    cc.catalog_welcome,
    cc.name,
    cc.phone
  INTO v_cfg
  FROM public.company_config cc
  WHERE cc.company_id = v_co
  LIMIT 1;

  RETURN jsonb_build_object(
    'company_id', v_co,
    'name', coalesce(v_cfg.name, 'Mi Empresa'),
    'phone', v_cfg.phone,
    'catalog_enabled', coalesce(v_cfg.catalog_enabled, true),
    'catalog_show_wholesale', coalesce(v_cfg.catalog_show_wholesale, true),
    'catalog_show_stock', coalesce(v_cfg.catalog_show_stock, true),
    'catalog_welcome', v_cfg.catalog_welcome
  );
END $function$;

REVOKE ALL ON FUNCTION public.obtener_mi_empresa_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_mi_empresa_catalogo() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guardar_ajustes_catalogo(
  p_enabled boolean,
  p_show_wholesale boolean,
  p_show_stock boolean,
  p_welcome text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_co uuid := public._ctx(ARRAY['admin', 'dueno']);
BEGIN
  UPDATE public.company_config
     SET catalog_enabled = coalesce(p_enabled, true),
         catalog_show_wholesale = coalesce(p_show_wholesale, true),
         catalog_show_stock = coalesce(p_show_stock, true),
         catalog_welcome = nullif(left(btrim(coalesce(p_welcome, '')), 240), '')
   WHERE company_id = v_co;

  IF NOT FOUND THEN
    INSERT INTO public.company_config (
      company_id, name, currency, catalog_enabled, catalog_show_wholesale, catalog_show_stock, catalog_welcome
    ) VALUES (
      v_co, 'Mi Empresa', 'USD',
      coalesce(p_enabled, true),
      coalesce(p_show_wholesale, true),
      coalesce(p_show_stock, true),
      nullif(left(btrim(coalesce(p_welcome, '')), 240), '')
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'company_id', v_co);
END $function$;

REVOKE ALL ON FUNCTION public.guardar_ajustes_catalogo(boolean,boolean,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_ajustes_catalogo(boolean,boolean,boolean,text) TO authenticated, service_role;

-- Consulta pública segura del Catálogo Digital (NO expone costos ni datos sensibles)
CREATE OR REPLACE FUNCTION public.obtener_catalogo_publico(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg record;
  v_prods jsonb := '[]'::jsonb;
  v_cats jsonb := '[]'::jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'Enlace de catálogo incompleto.');
  END IF;

  SELECT
    cc.name,
    cc.phone,
    cc.address,
    coalesce(cc.currency, 'USD') AS currency,
    coalesce(cc.tax_rate, 0) AS tax_rate,
    coalesce(cc.tax_mode, 'none') AS tax_mode,
    coalesce(cc.catalog_enabled, true) AS catalog_enabled,
    coalesce(cc.catalog_show_wholesale, true) AS catalog_show_wholesale,
    coalesce(cc.catalog_show_stock, true) AS catalog_show_stock,
    cc.catalog_welcome
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

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'sku', p.sku,
      'category_id', p.category_id,
      'category_name', cat.name,
      'price', p.price,
      'price_wholesale', CASE WHEN v_cfg.catalog_show_wholesale THEN p.price_wholesale ELSE NULL END,
      'wholesale_min_qty', CASE WHEN v_cfg.catalog_show_wholesale THEN p.wholesale_min_qty ELSE NULL END,
      'unit', p.unit,
      'stock', CASE WHEN v_cfg.catalog_show_stock THEN p.stock ELSE CASE WHEN p.stock > 0 THEN 1 ELSE 0 END END,
      'in_stock', (p.stock > 0),
      'image_url', p.image_url
    )
    ORDER BY (p.stock > 0) DESC, p.name ASC
  ), '[]'::jsonb)
  INTO v_prods
  FROM public.products p
  LEFT JOIN public.categories cat ON cat.id = p.category_id
  WHERE p.company_id = p_company_id
    AND p.price > 0;

  RETURN jsonb_build_object(
    'available', true,
    'company', jsonb_build_object(
      'company_id', p_company_id,
      'name', coalesce(nullif(btrim(v_cfg.name), ''), 'Catálogo Digital'),
      'phone', v_cfg.phone,
      'address', v_cfg.address,
      'currency', v_cfg.currency,
      'tax_rate', v_cfg.tax_rate,
      'tax_mode', v_cfg.tax_mode,
      'show_wholesale', v_cfg.catalog_show_wholesale,
      'show_stock', v_cfg.catalog_show_stock,
      'welcome', v_cfg.catalog_welcome
    ),
    'categories', v_cats,
    'products', v_prods
  );
END $function$;

REVOKE ALL ON FUNCTION public.obtener_catalogo_publico(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_catalogo_publico(uuid) TO anon, authenticated, service_role;

-- Recibir un pedido público del Catálogo Digital y guardarlo en Cotizaciones / Clientes
CREATE OR REPLACE FUNCTION public.crear_pedido_catalogo_publico(
  p_company_id uuid,
  p_customer_name text,
  p_phone text,
  p_document text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg record;
  v_cname text := left(btrim(coalesce(p_customer_name, '')), 120);
  v_phone text := left(btrim(coalesce(p_phone, '')), 40);
  v_doc text := nullif(left(btrim(coalesce(p_document, '')), 40), '');
  v_addr text := nullif(left(btrim(coalesce(p_address, '')), 200), '');
  v_notes text := nullif(left(btrim(coalesce(p_notes, '')), 240), '');
  v_cust_id uuid := NULL;
  v_item jsonb;
  v_pid uuid;
  v_qty numeric;
  v_prod public.products%ROWTYPE;
  v_unit_price numeric;
  v_lines jsonb := '[]'::jsonb;
  v_sum numeric := 0;
  v_sub numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_qid uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida';
  END IF;
  IF v_cname = '' THEN
    RAISE EXCEPTION 'Por favor ingresa tu nombre o razón social';
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

  -- Buscar cliente existente por documento o teléfono dentro de esa empresa
  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_cust_id
    FROM public.customers
    WHERE company_id = p_company_id AND lower(btrim(coalesce(document, ''))) = lower(v_doc)
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
      INSERT INTO public.customers (company_id, name, document, phone, address)
      VALUES (p_company_id, v_cname, v_doc, v_phone, v_addr)
      RETURNING id INTO v_cust_id;
    EXCEPTION WHEN OTHERS THEN
      -- Si la suscripción bloquea crear clientes nuevos o hay restricción, seguimos con el nombre en la cotización
      v_cust_id := NULL;
    END;
  END IF;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := round(coalesce((v_item->>'quantity')::numeric, 0), 3);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_prod
    FROM public.products
    WHERE id = v_pid AND company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos seleccionados ya no está disponible';
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para "%" (disponibles: %)', v_prod.name, v_prod.stock;
    END IF;

    v_unit_price := v_prod.price;
    IF v_cfg.catalog_show_wholesale
       AND coalesce(v_prod.price_wholesale, 0) > 0
       AND coalesce(v_prod.wholesale_min_qty, 0) > 0
       AND v_qty >= v_prod.wholesale_min_qty THEN
      v_unit_price := v_prod.price_wholesale;
    END IF;

    v_sum := v_sum + round(v_unit_price * v_qty, 2);
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_prod.id,
        'product_name', v_prod.name,
        'quantity', v_qty,
        'price', v_unit_price,
        'subtotal', round(v_unit_price * v_qty, 2)
      )
    );
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
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
    v_cname || CASE WHEN v_notes IS NOT NULL THEN ' · ' || left(v_notes, 60) ELSE '' END,
    v_lines,
    v_sub,
    CASE WHEN v_tax > 0 THEN v_cfg.tax_rate ELSE 0 END,
    v_tax,
    v_total,
    'enviada',
    (current_date + 7)
  )
  RETURNING id INTO v_qid;

  RETURN jsonb_build_object(
    'ok', true,
    'quotation_id', v_qid,
    'order_number', 'COT-' || upper(substr(v_qid::text, 1, 8)),
    'subtotal', v_sub,
    'tax_amount', v_tax,
    'total', v_total,
    'currency', v_cfg.currency,
    'company_phone', v_cfg.phone,
    'company_name', v_cfg.name
  );
END $function$;

REVOKE ALL ON FUNCTION public.crear_pedido_catalogo_publico(uuid,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_pedido_catalogo_publico(uuid,text,text,text,text,text,jsonb) TO anon, authenticated, service_role;

COMMIT;
