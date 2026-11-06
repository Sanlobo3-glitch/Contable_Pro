-- ============================================================================
-- MIGRACIÓN CONTABLE_PRO: PARTIDA DOBLE, INMUTABILIDAD Y PUC NIIF
-- ============================================================================

-- 1. Tabla accounts (Catálogo de cuentas jerárquico NIIF)
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Gasto', 'Costo')),
  nature text NOT NULL CHECK (nature IN ('Débito', 'Crédito')),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 5),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_accounts_company_code UNIQUE (company_id, code)
);

-- Si no hay company_id, garantizar unicidad por código global
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_global_code ON public.accounts (code) WHERE company_id IS NULL;

-- 2. Tabla journal_entries (Cabecera de Asientos Contables)
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,
  entry_number text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  concept text NOT NULL,
  status text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'posteado', 'cerrado', 'anulado')),
  source_module text NOT NULL DEFAULT 'manual',
  source_id text NULL,
  created_by text NULL,
  created_by_name text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON public.journal_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON public.journal_entries (status);

-- 3. Tabla journal_lines (Líneas / Apuntes Contables)
CREATE TABLE IF NOT EXISTS public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  debit numeric(18, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_journal_lines_debit_or_credit CHECK (debit > 0 OR credit > 0)
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.journal_lines (account_id);

-- ============================================================================
-- TRIGGER: VALIDACIÓN ESTRICTA DE PARTIDA DOBLE AL POSTEAR
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_validate_journal_entry_balance()
RETURNS trigger AS $$
DECLARE
  v_total_debit numeric(18, 2) := 0;
  v_total_credit numeric(18, 2) := 0;
  v_diff numeric(18, 2) := 0;
  v_line_count integer := 0;
BEGIN
  -- La partida doble se valida estrictamente cuando el asiento pasa a estado 'posteado' o 'cerrado'
  IF NEW.status IN ('posteado', 'cerrado') THEN
    SELECT 
      COALESCE(SUM(debit), 0), 
      COALESCE(SUM(credit), 0), 
      COUNT(*)
    INTO v_total_debit, v_total_credit, v_line_count
    FROM public.journal_lines
    WHERE entry_id = NEW.id;

    IF v_line_count < 2 THEN
      RAISE EXCEPTION 'Error de Partida Doble: El asiento % requiere al menos dos líneas contables para poder ser posteado. Líneas actuales: %',
        NEW.entry_number, v_line_count;
    END IF;

    v_diff := ROUND(v_total_debit - v_total_credit, 2);

    IF v_diff <> 0 THEN
      RAISE EXCEPTION 'Error de Partida Doble: El asiento contable % está descuadrado. Débitos = %, Créditos = %, Diferencia = %. La suma de débitos menos créditos debe ser exactamente igual a 0.',
        NEW.entry_number, v_total_debit, v_total_credit, v_diff;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_journal_entry_balance ON public.journal_entries;
CREATE TRIGGER trg_validate_journal_entry_balance
BEFORE INSERT OR UPDATE ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_journal_entry_balance();

-- ============================================================================
-- TRIGGER: INMUTABILIDAD ESTRICTA PARA ASIENTOS POSTEADOS O CERRADOS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_enforce_journal_immutability()
RETURNS trigger AS $$
BEGIN
  -- Si el asiento ya estaba posteado o cerrado, no se permite modificarlo ni borrarlo
  IF OLD.status IN ('posteado', 'cerrado') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Inmutabilidad Contable: Está prohibido eliminar el asiento % porque ya ha sido posteado o cerrado en los libros oficiales. Debe emitirse un asiento de reversión o anulación.',
        OLD.entry_number;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Solo se permite pasar de posteado a anulado si no se alteran las cifras
      IF NEW.status = 'anulado' AND OLD.status = 'posteado' THEN
        -- Permitir anulación con marca de auditoría
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'Inmutabilidad Contable: El asiento % está en estado % y no puede ser modificado. Para corregir operaciones, cree una nota o asiento de ajuste.',
          OLD.entry_number, OLD.status;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_journal_immutability ON public.journal_entries;
CREATE TRIGGER trg_enforce_journal_immutability
BEFORE UPDATE OR DELETE ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.fn_enforce_journal_immutability();

-- Bloquear manipulación directa de líneas en asientos ya posteados
CREATE OR REPLACE FUNCTION public.fn_enforce_journal_line_immutability()
RETURNS trigger AS $$
DECLARE
  v_parent_status text;
  v_parent_number text;
  v_entry_id uuid;
BEGIN
  v_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;

  SELECT status, entry_number INTO v_parent_status, v_parent_number
  FROM public.journal_entries
  WHERE id = v_entry_id;

  IF v_parent_status IN ('posteado', 'cerrado') THEN
    RAISE EXCEPTION 'Inmutabilidad Contable: No se pueden agregar, editar ni eliminar líneas del asiento % porque se encuentra en estado %.',
      v_parent_number, v_parent_status;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_journal_line_immutability ON public.journal_lines;
CREATE TRIGGER trg_enforce_journal_line_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.fn_enforce_journal_line_immutability();

-- ============================================================================
-- SEMILLA DEL CATÁLOGO DE CUENTAS (PUC COLOMBIANO BASADO EN NIIF)
-- ============================================================================
INSERT INTO public.accounts (code, name, type, nature, level) VALUES
('1', 'ACTIVO', 'Activo', 'Débito', 1),
('11', 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', 'Activo', 'Débito', 2),
('1105', 'Caja', 'Activo', 'Débito', 3),
('110505', 'Caja General', 'Activo', 'Débito', 4),
('1110', 'Bancos', 'Activo', 'Débito', 3),
('111005', 'Moneda Nacional', 'Activo', 'Débito', 4),
('13', 'CUENTAS POR COBRAR COMERCIALES Y OTRAS', 'Activo', 'Débito', 2),
('1305', 'Clientes', 'Activo', 'Débito', 3),
('130505', 'Clientes Nacionales', 'Activo', 'Débito', 4),
('2', 'PASIVO', 'Pasivo', 'Crédito', 1),
('21', 'OBLIGACIONES FINANCIERAS', 'Pasivo', 'Crédito', 2),
('2105', 'Bancos Nacionales', 'Pasivo', 'Crédito', 3),
('210505', 'Sobregiros', 'Pasivo', 'Crédito', 4),
('23', 'CUENTAS POR PAGAR', 'Pasivo', 'Crédito', 2),
('2335', 'Costos y Gastos por Pagar', 'Pasivo', 'Crédito', 3),
('233550', 'Servicios Públicos', 'Pasivo', 'Crédito', 4),
('24', 'IMPUESTOS, GRAVÁMENES Y TASAS', 'Pasivo', 'Crédito', 2),
('2408', 'Impuesto sobre las Ventas por Pagar (IVA)', 'Pasivo', 'Crédito', 3),
('240805', 'IVA Generado (Ventas)', 'Pasivo', 'Crédito', 4),
('240810', 'IVA Descontable (Compras)', 'Pasivo', 'Crédito', 4),
('3', 'PATRIMONIO', 'Patrimonio', 'Crédito', 1),
('31', 'CAPITAL SOCIAL', 'Patrimonio', 'Crédito', 2),
('3105', 'Capital Suscrito y Pagado', 'Patrimonio', 'Crédito', 3),
('310505', 'Capital Autorizado', 'Patrimonio', 'Crédito', 4),
('4', 'INGRESOS', 'Ingreso', 'Crédito', 1),
('41', 'INGRESOS OPERACIONALES', 'Ingreso', 'Crédito', 2),
('4135', 'Comercio al por Mayor y al por Menor', 'Ingreso', 'Crédito', 3),
('413505', 'Venta de Mercancías', 'Ingreso', 'Crédito', 4),
('5', 'GASTOS', 'Gasto', 'Débito', 1),
('51', 'GASTOS OPERACIONALES DE ADMINISTRACIÓN', 'Gasto', 'Débito', 2),
('5135', 'Servicios', 'Gasto', 'Débito', 3),
('513505', 'Energía Eléctrica', 'Gasto', 'Débito', 4),
('6', 'COSTOS DE VENTAS', 'Costo', 'Débito', 1),
('61', 'COSTO DE VENTAS Y PRESTACIÓN DE SERVICIOS', 'Costo', 'Débito', 2),
('6135', 'Comercio al por Mayor y al por Menor', 'Costo', 'Débito', 3),
('613505', 'Costo de Mercancías Vendidas', 'Costo', 'Débito', 4)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  nature = EXCLUDED.nature,
  level = EXCLUDED.level;
