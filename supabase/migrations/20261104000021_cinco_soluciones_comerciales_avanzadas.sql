-- ============================================================================
-- MIGRACIÓN 20261104000021: CINCO SOLUCIONES COMERCIALES Y FINANCIERAS AVANZADAS
-- 1. Toma Física Ciega de Inventario (blind_inventory_sessions)
-- 2. Plan Separe / Sistema de Apartados y Anticipos (layaway_contracts)
-- 3. Cambios Rápidos «Mano a Mano» y Garantías (product_exchanges)
-- 4. Conciliación Bancaria Automática + 4x1000 / Comisiones (bank_reconciliations)
-- 5. Bitácora de Escudo de Márgenes y Precios (price_shield_batches)
-- 100% Idempotente · Aislamiento multiempresa RLS por company_id
-- ============================================================================

-- 1. TOMA FÍSICA CIEGA DE INVENTARIO
CREATE TABLE IF NOT EXISTS public.blind_inventory_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  session_code text NOT NULL,
  warehouse_id uuid,
  title text NOT NULL,
  category_filter text,
  status text NOT NULL DEFAULT 'en_conteo' CHECK (status IN ('en_conteo', 'revision', 'aplicada', 'anulada')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  counted_by_name text,
  approved_by_name text,
  total_variance_units numeric(14,2) NOT NULL DEFAULT 0,
  total_variance_cost numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_blind_inv_company_created
  ON public.blind_inventory_sessions (company_id, created_at DESC);

ALTER TABLE public.blind_inventory_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blind_inventory_sessions_company_access ON public.blind_inventory_sessions;
CREATE POLICY blind_inventory_sessions_company_access
  ON public.blind_inventory_sessions
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- 2. PLAN SEPARE / SISTEMA DE APARTADOS Y ANTICIPOS
CREATE TABLE IF NOT EXISTS public.layaway_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  contract_code text NOT NULL,
  warehouse_id uuid,
  customer_id uuid,
  customer_name text NOT NULL,
  customer_document text,
  customer_phone text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  payments jsonb NOT NULL DEFAULT '[]'::jsonb,
  reservation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'completado', 'vencido', 'anulado')),
  sale_id uuid,
  notes text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_layaway_contracts_company_status
  ON public.layaway_contracts (company_id, status, due_date);

ALTER TABLE public.layaway_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS layaway_contracts_company_access ON public.layaway_contracts;
CREATE POLICY layaway_contracts_company_access
  ON public.layaway_contracts
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- 3. CAMBIOS RÁPIDOS «MANO A MANO» Y GARANTÍAS
CREATE TABLE IF NOT EXISTS public.product_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  exchange_code text NOT NULL,
  kind text NOT NULL DEFAULT 'cambio_mano_a_mano' CHECK (kind IN ('cambio_mano_a_mano', 'garantia')),
  original_sale_id uuid,
  customer_name text NOT NULL,
  customer_phone text,
  supplier_name text,
  returned_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivered_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_difference numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'efectivo',
  warranty_status text NOT NULL DEFAULT 'resuelto' CHECK (
    warranty_status IN ('recibido_local', 'en_revision_proveedor', 'reemplazado', 'resuelto', 'rechazado')
  ),
  reason text NOT NULL DEFAULT '',
  serial_or_lot text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_exchanges_company_created
  ON public.product_exchanges (company_id, created_at DESC);

ALTER TABLE public.product_exchanges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_exchanges_company_access ON public.product_exchanges;
CREATE POLICY product_exchanges_company_access
  ON public.product_exchanges
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- 4. CONCILIACIÓN BANCARIA AUTOMÁTICA
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  recon_code text NOT NULL,
  bank_name text NOT NULL,
  account_hint text,
  period_label text,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  fee_count integer NOT NULL DEFAULT 0,
  fees_registered_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_credits numeric(14,2) NOT NULL DEFAULT 0,
  total_debits numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'cerrada')),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_company_created
  ON public.bank_reconciliations (company_id, created_at DESC);

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_reconciliations_company_access ON public.bank_reconciliations;
CREATE POLICY bank_reconciliations_company_access
  ON public.bank_reconciliations
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- 5. BITÁCORA DE ESCUDO DE PRECIOS Y MÁRGENES
CREATE TABLE IF NOT EXISTS public.price_shield_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.current_company_id(),
  batch_code text NOT NULL,
  strategy_label text NOT NULL,
  rounding_mode text NOT NULL,
  updated_count integer NOT NULL DEFAULT 0,
  avg_prev_margin numeric(8,2) NOT NULL DEFAULT 0,
  avg_new_margin numeric(8,2) NOT NULL DEFAULT 0,
  product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_shield_batches_company_created
  ON public.price_shield_batches (company_id, created_at DESC);

ALTER TABLE public.price_shield_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_shield_batches_company_access ON public.price_shield_batches;
CREATE POLICY price_shield_batches_company_access
  ON public.price_shield_batches
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());
