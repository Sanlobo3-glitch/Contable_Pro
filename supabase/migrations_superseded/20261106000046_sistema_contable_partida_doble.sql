-- ============================================================
-- CONTABLE PRO · MIGRACIÓN 000046
-- FASE 1: NÚCLEO CONTABLE PROFESIONAL Y PARTIDA DOBLE
-- 
-- 1. Tabla 'accounts': Plan de cuentas jerárquico (Naturaleza Débito / Crédito)
-- 2. Tabla 'journal_entries': Cabecera de asientos contables (Inmutabilidad)
-- 3. Tabla 'journal_lines': Líneas de detalle (Cuentas, Débitos y Créditos)
-- 4. Trigger de Validación Estricta de PARTIDA DOBLE (SUM(débito) = SUM(crédito))
-- 5. Trigger de INMUTABILIDAD para asientos 'posteado' y 'cerrado'
-- 6. Función Transaccional Atómica para Asientos Contables
-- 7. Políticas de Seguridad RLS (Row Level Security Multiempresa)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. EXTENSIONES Y REQUISITOS
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 2. TABLA: accounts (Catálogo / Plan Único de Cuentas Jerárquico)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  account_type text NOT NULL CHECK (account_type IN (
    'activo',
    'pasivo',
    'patrimonio',
    'ingreso',
    'costo',
    'gasto',
    'orden'
  )),
  nature text NOT NULL CHECK (nature IN ('debito', 'credito')),
  level integer NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 10),
  is_postable boolean NOT NULL DEFAULT true, -- Solo cuentas auxiliares/último nivel reciben imputación
  active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_accounts_company_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounts_company_code ON public.accounts(company_id, code);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON public.accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type_nature ON public.accounts(company_id, account_type, nature);

-- ------------------------------------------------------------
-- 3. TABLA: journal_entries (Cabecera de Asientos Contables)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entry_number text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  concept text NOT NULL,
  status text NOT NULL DEFAULT 'borrador' CHECK (status IN (
    'borrador',
    'posteado',
    'cerrado',
    'anulado'
  )),
  source_module text NOT NULL DEFAULT 'manual' CHECK (source_module IN (
    'manual',
    'ventas',
    'compras',
    'caja_bancos',
    'nomina',
    'ajuste',
    'cierre'
  )),
  source_id uuid, -- Referencia opcional a sale_id, purchase_id, etc.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_journal_entries_company_number UNIQUE (company_id, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date ON public.journal_entries(company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_status ON public.journal_entries(company_id, status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON public.journal_entries(source_module, source_id);

-- ------------------------------------------------------------
-- 4. TABLA: journal_lines (Líneas de Detalle Contable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  line_number integer NOT NULL DEFAULT 1,
  description text,
  debit numeric(18, 4) NOT NULL DEFAULT 0.0000 CHECK (debit >= 0),
  credit numeric(18, 4) NOT NULL DEFAULT 0.0000 CHECK (credit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_journal_lines_positive CHECK (debit > 0 OR credit > 0),
  CONSTRAINT chk_journal_lines_not_both CHECK (NOT (debit > 0 AND credit > 0))
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_company_account ON public.journal_lines(company_id, account_id);

-- ------------------------------------------------------------
-- 5. TRIGGER DE INMUTABILIDAD: journal_entries y journal_lines
-- ------------------------------------------------------------

-- Bloqueo de cabecera si el asiento ya está 'posteado' o 'cerrado'
CREATE OR REPLACE FUNCTION public.fn_enforce_journal_entry_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si se intenta eliminar un asiento posteado o cerrado:
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status IN ('posteado', 'cerrado') THEN
      RAISE EXCEPTION 'Violación de Inmutabilidad Contable: El asiento contable N° % se encuentra en estado "%" y no puede ser eliminado.',
        OLD.entry_number, OLD.status
        USING ERRCODE = '23505';
    END IF;
    RETURN OLD;
  END IF;

  -- Si se intenta actualizar:
  IF (TG_OP = 'UPDATE') THEN
    -- Si el asiento ya estaba cerrado, nada puede cambiarse
    IF OLD.status = 'cerrado' THEN
      RAISE EXCEPTION 'Violación de Inmutabilidad Contable: El asiento contable N° % está CERRADO y es estrictamente de solo lectura.',
        OLD.entry_number
        USING ERRCODE = '23505';
    END IF;

    -- Si el asiento ya estaba posteado:
    IF OLD.status = 'posteado' THEN
      -- Única transición válida permitida: pasar de 'posteado' a 'cerrado' durante el cierre contable
      IF NEW.status = 'cerrado' THEN
        -- Verificar que no se alteren los datos sustanciales del asiento
        IF NEW.entry_number <> OLD.entry_number OR
           NEW.entry_date <> OLD.entry_date OR
           NEW.concept <> OLD.concept OR
           NEW.company_id <> OLD.company_id THEN
          RAISE EXCEPTION 'Violación de Inmutabilidad Contable: No se pueden alterar los campos del asiento N° % durante el cierre.',
            OLD.entry_number
            USING ERRCODE = '23505';
        END IF;
        NEW.updated_at := now();
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'Violación de Inmutabilidad Contable: El asiento contable N° % ya fue POSTEADO. Para corregirlo debe generarse un contraasiento o ajuste.',
          OLD.entry_number
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Si pasa de 'borrador' a 'posteado', registrar auditoría
    IF OLD.status = 'borrador' AND NEW.status = 'posteado' THEN
      NEW.posted_at := coalesce(NEW.posted_at, now());
      NEW.posted_by := coalesce(NEW.posted_by, auth.uid());
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entries_immutability ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_immutability
BEFORE UPDATE OR DELETE ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.fn_enforce_journal_entry_immutability();

-- Bloqueo de líneas asociadas a asientos posteados o cerrados
CREATE OR REPLACE FUNCTION public.fn_enforce_journal_lines_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_status text;
  v_entry_number text;
  v_entry_id uuid;
BEGIN
  v_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;

  SELECT status, entry_number
  INTO v_entry_status, v_entry_number
  FROM public.journal_entries
  WHERE id = v_entry_id;

  IF v_entry_status IN ('posteado', 'cerrado') THEN
    RAISE EXCEPTION 'Violación de Inmutabilidad Contable: Las líneas del asiento contable N° % no pueden ser modificadas, insertadas ni eliminadas porque el asiento está en estado "%".',
      v_entry_number, v_entry_status
      USING ERRCODE = '23505';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_immutability ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.fn_enforce_journal_lines_immutability();

-- ------------------------------------------------------------
-- 6. VALIDACIÓN ESTRICTA DE PARTIDA DOBLE (TRIGGER + REGLA DE BALANCE)
-- ------------------------------------------------------------

-- Validación que la cuenta sea imputable (is_postable = true)
CREATE OR REPLACE FUNCTION public.fn_validate_journal_line_account()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_postable boolean;
  v_account_name text;
  v_account_code text;
BEGIN
  SELECT is_postable, name, code
  INTO v_is_postable, v_account_name, v_account_code
  FROM public.accounts
  WHERE id = NEW.account_id;

  IF v_is_postable IS NOT TRUE THEN
    RAISE EXCEPTION 'Regla Contable: La cuenta % - % es de nivel mayor (no imputable). Solo se permite registrar movimientos en cuentas auxiliares.',
      v_account_code, v_account_name
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_postable_account ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_postable_account
BEFORE INSERT OR UPDATE OF account_id ON public.journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_journal_line_account();

-- Función que calcula el balance de un asiento específico
CREATE OR REPLACE FUNCTION public.fn_assert_journal_entry_balanced(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_debit numeric(18, 4);
  v_total_credit numeric(18, 4);
  v_line_count integer;
  v_entry_number text;
  v_diff numeric(18, 4);
BEGIN
  SELECT
    entry_number,
    coalesce(sum(l.debit), 0.0000),
    coalesce(sum(l.credit), 0.0000),
    count(l.id)
  INTO
    v_entry_number,
    v_total_debit,
    v_total_credit,
    v_line_count
  FROM public.journal_entries e
  LEFT JOIN public.journal_lines l ON l.entry_id = e.id
  WHERE e.id = p_entry_id
  GROUP BY e.id, e.entry_number;

  IF v_entry_number IS NULL THEN
    RETURN;
  END IF;

  -- 1. Un asiento debe tener al menos 2 movimientos (un débito y un crédito)
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Error de Partida Doble en Asiento %: Requiere al menos dos líneas de movimiento (posee %).',
      v_entry_number, v_line_count
      USING ERRCODE = '23514';
  END IF;

  -- 2. El total debitado debe ser positivo
  IF v_total_debit <= 0 OR v_total_credit <= 0 THEN
    RAISE EXCEPTION 'Error de Partida Doble en Asiento %: El asiento no puede tener totales en cero (Débito: %, Crédito: %).',
      v_entry_number, v_total_debit, v_total_credit
      USING ERRCODE = '23514';
  END IF;

  -- 3. Débito menos Crédito debe ser exactamente CERO
  v_diff := round(v_total_debit - v_total_credit, 4);
  IF abs(v_diff) > 0.00001 THEN
    RAISE EXCEPTION 'Error de Partida Doble en Asiento %: Débitos (%) y Créditos (%) no balancean. Descuadre neto: %.',
      v_entry_number, v_total_debit, v_total_credit, v_diff
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Trigger DEFERRED para validar la partida doble al cierre de la transacción
CREATE OR REPLACE FUNCTION public.fn_trigger_check_double_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid;
  v_status text;
BEGIN
  v_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;

  -- Consultar estado del asiento: solo los asientos 'posteado' o 'cerrado' exigen balance estricto
  -- Los borradores pueden guardarse temporalmente descuadrados si el usuario está preparando el borrador
  SELECT status INTO v_status FROM public.journal_entries WHERE id = v_entry_id;

  IF v_status IN ('posteado', 'cerrado') THEN
    PERFORM public.fn_assert_journal_entry_balanced(v_entry_id);
  END IF;

  RETURN NULL;
END;
$$;

-- Trigger sobre journal_lines (DEFERRABLE para permitir insertar múltiples líneas en una sola transacción)
DROP TRIGGER IF EXISTS trg_check_double_entry_on_lines ON public.journal_lines;
CREATE CONSTRAINT TRIGGER trg_check_double_entry_on_lines
AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_trigger_check_double_entry();

-- Trigger sobre journal_entries cuando cambia a 'posteado'
CREATE OR REPLACE FUNCTION public.fn_trigger_check_double_entry_on_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('posteado', 'cerrado') AND (OLD.status IS NULL OR OLD.status = 'borrador') THEN
    PERFORM public.fn_assert_journal_entry_balanced(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_double_entry_on_posting ON public.journal_entries;
CREATE TRIGGER trg_check_double_entry_on_posting
BEFORE UPDATE OF status ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.fn_trigger_check_double_entry_on_posting();

-- ------------------------------------------------------------
-- 7. FUNCIÓN TRANSACCIONAL ATÓMICA PARA CREAR O POSTEAR ASIENTOS
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_journal_entry_atomic(
  p_company_id uuid,
  p_entry_date date,
  p_concept text,
  p_status text,
  p_lines jsonb, -- Array de { account_id, debit, credit, description }
  p_source_module text DEFAULT 'manual',
  p_source_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_next_num integer;
  v_line jsonb;
  v_line_number integer := 1;
  v_total_debit numeric(18, 4) := 0.0000;
  v_total_credit numeric(18, 4) := 0.0000;
  v_debit numeric(18, 4);
  v_credit numeric(18, 4);
  v_account_id uuid;
  v_line_desc text;
BEGIN
  -- Validar permisos de empresa
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Parámetro inválido: Se requiere company_id' USING ERRCODE = '23502';
  END IF;

  IF p_status NOT IN ('borrador', 'posteado') THEN
    RAISE EXCEPTION 'Estado inicial inválido: Solo se permite "borrador" o "posteado"' USING ERRCODE = '23514';
  END IF;

  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'El asiento contable requiere al menos 2 líneas de movimiento' USING ERRCODE = '23514';
  END IF;

  -- Generar número correlativo consecutivo por empresa (ej. ASI-00001)
  SELECT coalesce(max(nullif(regexp_replace(entry_number, '\D', '', 'g'), '')::integer), 0) + 1
  INTO v_next_num
  FROM public.journal_entries
  WHERE company_id = p_company_id;

  v_entry_number := 'ASI-' || lpad(v_next_num::text, 5, '0');
  v_entry_id := gen_random_uuid();

  -- 1. Insertar cabecera
  INSERT INTO public.journal_entries (
    id,
    company_id,
    entry_number,
    entry_date,
    concept,
    status,
    source_module,
    source_id,
    created_by,
    posted_by,
    posted_at
  ) VALUES (
    v_entry_id,
    p_company_id,
    v_entry_number,
    p_entry_date,
    trim(p_concept),
    p_status,
    coalesce(p_source_module, 'manual'),
    p_source_id,
    auth.uid(),
    CASE WHEN p_status = 'posteado' THEN auth.uid() ELSE NULL END,
    CASE WHEN p_status = 'posteado' THEN now() ELSE NULL END
  );

  -- 2. Insertar cada línea
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := round(coalesce((v_line->>'debit')::numeric, 0.0000), 4);
    v_credit := round(coalesce((v_line->>'credit')::numeric, 0.0000), 4);
    v_line_desc := nullif(trim(v_line->>'description'), '');

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Los importes de débito y crédito deben ser positivos o cero' USING ERRCODE = '23514';
    END IF;

    IF v_debit = 0 AND v_credit = 0 THEN
      CONTINUE; -- Ignorar líneas vacías
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;

    INSERT INTO public.journal_lines (
      company_id,
      entry_id,
      account_id,
      line_number,
      description,
      debit,
      credit
    ) VALUES (
      p_company_id,
      v_entry_id,
      v_account_id,
      v_line_number,
      coalesce(v_line_desc, trim(p_concept)),
      v_debit,
      v_credit
    );

    v_line_number := v_line_number + 1;
  END LOOP;

  -- 3. Si se solicita 'posteado', validar partida doble inmediatamente
  IF p_status = 'posteado' THEN
    IF abs(round(v_total_debit - v_total_credit, 4)) > 0.00001 THEN
      RAISE EXCEPTION 'Partida Doble Descuadrada: La suma de débitos (%) difiere de los créditos (%). Descuadre: %',
        v_total_debit, v_total_credit, (v_total_debit - v_total_credit)
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'entry_number', v_entry_number,
    'status', p_status,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'lines_count', v_line_number - 1
  );
END;
$$;

-- ------------------------------------------------------------
-- 8. ROW LEVEL SECURITY (RLS) MULTIEMPRESA ESTRICTO
-- ------------------------------------------------------------
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

-- Políticas para accounts
DROP POLICY IF EXISTS "accounts_tenant_isolation" ON public.accounts;
CREATE POLICY "accounts_tenant_isolation" ON public.accounts
FOR ALL TO authenticated
USING (
  company_id = public.current_company_id()
  OR (public.is_platform_admin() AND company_id = public.current_company_id())
)
WITH CHECK (
  company_id = public.current_company_id()
);

-- Políticas para journal_entries
DROP POLICY IF EXISTS "journal_entries_tenant_isolation" ON public.journal_entries;
CREATE POLICY "journal_entries_tenant_isolation" ON public.journal_entries
FOR ALL TO authenticated
USING (
  company_id = public.current_company_id()
  OR (public.is_platform_admin() AND company_id = public.current_company_id())
)
WITH CHECK (
  company_id = public.current_company_id()
);

-- Políticas para journal_lines
DROP POLICY IF EXISTS "journal_lines_tenant_isolation" ON public.journal_lines;
CREATE POLICY "journal_lines_tenant_isolation" ON public.journal_lines
FOR ALL TO authenticated
USING (
  company_id = public.current_company_id()
  OR (public.is_platform_admin() AND company_id = public.current_company_id())
)
WITH CHECK (
  company_id = public.current_company_id()
);

-- Revocar permisos a rol anónimo
REVOKE ALL ON public.accounts FROM anon;
REVOKE ALL ON public.journal_entries FROM anon;
REVOKE ALL ON public.journal_lines FROM anon;
REVOKE ALL ON FUNCTION public.fn_create_journal_entry_atomic FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_lines TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_journal_entry_atomic TO authenticated;

COMMIT;
