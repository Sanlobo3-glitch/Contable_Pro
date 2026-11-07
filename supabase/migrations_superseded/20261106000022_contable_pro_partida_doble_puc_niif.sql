-- ============================================================================
-- MIGRACIÓN CONTABLE_PRO: FASE 1 - DISEÑO DE BASE DE DATOS E INMUTABILIDAD
-- Script Oficial según Especificación de Partida Doble y Catálogo PUC NIIF
-- ============================================================================

-- 1. LIMPIEZA DE ENTORNO POR SEGURIDAD
DROP TRIGGER IF EXISTS trg_verify_journal_entry_posting ON journal_entries;
DROP TRIGGER IF EXISTS trg_enforce_journal_immutability ON journal_entries;
DROP FUNCTION IF EXISTS verify_journal_entry_posting();
DROP FUNCTION IF EXISTS enforce_journal_immutability();
DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS accounts;

-- 2. CREACIÓN DE LA TABLA DE CUENTAS (CATÁLOGO / PUC)
CREATE TABLE accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    type VARCHAR(50) NOT NULL, -- Activo, Pasivo, Patrimonio, Ingreso, Gasto, Costo
    nature VARCHAR(20) NOT NULL, -- Débito, Crédito
    level INT NOT NULL, -- 1, 2, 3, 4
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. CREACIÓN DE LA CABECERA DE ASIENTOS CONTABLES
CREATE TABLE journal_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_number SERIAL UNIQUE, -- Numeración automática consecutiva
    concept TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT (Borrador), POSTED (Aprobado/Asentado), CLOSED (Cerrado), VOID (Anulado)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. CREACIÓN DEL DETALLE DE ASIENTOS CONTABLES (REQUERÍA EXISTIR PRIMERO)
CREATE TABLE journal_lines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE NOT NULL,
    account_id UUID REFERENCES accounts(id) NOT NULL,
    debit NUMERIC(15,2) DEFAULT 0.00 NOT NULL CHECK (debit >= 0),
    credit NUMERIC(15,2) DEFAULT 0.00 NOT NULL CHECK (credit >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Restricción para evitar que una línea tenga débito y crédito a la vez
    CONSTRAINT chk_debit_credit CHECK (NOT (debit > 0 AND credit > 0))
);

-- 5. FUNCIÓN DEL TRIGGER CORREGIDA (EFECTÚA LA VALIDACIÓN CUANDO SE PASA A 'POSTED')
CREATE OR REPLACE FUNCTION verify_journal_entry_posting()
RETURNS TRIGGER AS $$
DECLARE
    v_sum_debit NUMERIC(15,2);
    v_sum_credit NUMERIC(15,2);
BEGIN
    -- Solo validamos la partida doble cuando el asiento pasa a estar 'POSTED' o 'POSTEADO'
    IF NEW.status IN ('POSTED', 'posteado', 'CLOSED', 'cerrado') THEN
        SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
        INTO v_sum_debit, v_sum_credit
        FROM journal_lines
        WHERE entry_id = NEW.id;

        -- Validación estricta de la ecuación contable (Partida Doble)
        IF (v_sum_debit - v_sum_credit) != 0 OR (v_sum_debit = 0 AND v_sum_credit = 0) THEN
            RAISE EXCEPTION 'No se puede asentar el asiento #%. Desbalance Contable: Suma Débito (%), Suma Crédito (%). El balance neto debe ser cero.', 
                NEW.entry_number, v_sum_debit, v_sum_credit;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. ASIGNACIÓN DEL TRIGGER A LA CABECERA
CREATE TRIGGER trg_verify_journal_entry_posting
BEFORE UPDATE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION verify_journal_entry_posting();

-- 7. TRIGGER ADICIONAL DE INMUTABILIDAD CONTABLE (REQUISITO 3 DE FASE 1)
-- Bloquea que los asientos en estado 'POSTED' o 'CLOSED' puedan ser editados o eliminados
CREATE OR REPLACE FUNCTION enforce_journal_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'posteado', 'CLOSED', 'cerrado') THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Inmutabilidad Contable: No se puede eliminar el asiento #% porque ya ha sido asentado (POSTED) en los libros oficiales.', OLD.entry_number;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            -- Solo se permite si no se alteran montos o si pasa a VOID/Anulado
            IF NEW.status IN ('VOID', 'anulado') AND OLD.status IN ('POSTED', 'posteado') THEN
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Inmutabilidad Contable: El asiento #% ya está asentado (POSTED) y no puede ser modificado. Para correcciones debe emitirse una nota o asiento de ajuste.', OLD.entry_number;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_journal_immutability ON journal_entries;
CREATE TRIGGER trg_enforce_journal_immutability
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION enforce_journal_immutability();

-- 8. SEMILLA INICIAL DEL CATÁLOGO DE CUENTAS (PUC NIIF COLOMBIANO)
INSERT INTO accounts (code, name, type, nature, level) VALUES
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
ON CONFLICT (code) DO NOTHING;
