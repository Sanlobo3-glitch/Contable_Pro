
import { supabase } from '../lib/supabase'

export interface DenominationItem {
  denomination: number
  kind: 'billete' | 'moneda'
  quantity: number
  subtotal: number
}

export const COLOMBIAN_DENOMINATIONS: Omit<DenominationItem, 'quantity' | 'subtotal'>[] = [
  { denomination: 100000, kind: 'billete' },
  { denomination: 50000, kind: 'billete' },
  { denomination: 20000, kind: 'billete' },
  { denomination: 10000, kind: 'billete' },
  { denomination: 5000, kind: 'billete' },
  { denomination: 2000, kind: 'billete' },
  { denomination: 1000, kind: 'moneda' },
  { denomination: 500, kind: 'moneda' },
  { denomination: 200, kind: 'moneda' },
  { denomination: 100, kind: 'moneda' },
  { denomination: 50, kind: 'moneda' },
]

export interface ActiveShift {
  active: boolean
  shift_id?: string
  opened_at?: string
  cashier_name?: string
  opening_amount: number
  sales_cash: number
  sales_card: number
  sales_transfer: number
  sales_credit: number
  sales_count: number
  cash_in: number
  cash_out: number
  expected_cash: number
}

export interface ShiftRecord {
  id: string
  opened_at: string
  closed_at: string | null
  cashier_name: string | null
  opening_amount: number
  expected_cash: number
  counted_cash: number | null
  cash_difference: number | null
  total_sales_cash: number
  total_sales_card: number
  total_sales_transfer: number
  total_sales_credit: number
  total_sales_count: number
  total_cash_in: number
  total_cash_out: number
  status: 'open' | 'closed'
  closing_type: 'cierre_x' | 'cierre_z' | null
  notes: string | null
}

/**
 * Consulta el turno activo exclusivamente mediante la RPC autorizada.
 * No usa localStorage ni consultas directas como fuente alternativa de verdad.
 */
export async function getActiveShift(): Promise<ActiveShift> {
  const empty: ActiveShift = {
    active: false,
    opening_amount: 0,
    sales_cash: 0,
    sales_card: 0,
    sales_transfer: 0,
    sales_credit: 0,
    sales_count: 0,
    cash_in: 0,
    cash_out: 0,
    expected_cash: 0,
  }

  try {
    const { data, error } = await supabase.rpc('caja_obtener_turno_activo')
    if (error) throw error
    if (!data || typeof data !== 'object') return empty

    const result = data as ActiveShift
    return result.active === true && result.shift_id ? result : empty
  } catch (error) {
    console.error('[cashShiftService] No se pudo confirmar el turno activo:', error)
    return empty
  }
}

/**
 * Abre un turno únicamente mediante la RPC transaccional de Supabase.
 * Nunca crea turnos directos ni turnos locales que aparenten estar abiertos.
 */
export async function openCashShift(
  openingAmount: number,
  warehouseId?: string | null,
  notes?: string | null,
  denominations: DenominationItem[] = []
): Promise<{ ok: boolean; shift_id?: string; message?: string }> {
  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    return { ok: false, message: 'El monto de apertura no es válido.' }
  }

  try {
    const { data, error } = await supabase.rpc('caja_abrir_turno', {
      p_opening_amount: openingAmount,
      p_warehouse_id: warehouseId || null,
      p_notes: notes || null,
      p_denominations: denominations,
    })

    if (error) throw error

    const result = data as { ok?: boolean; shift_id?: string; message?: string } | null
    if (result?.ok !== true || !result.shift_id) {
      return {
        ok: false,
        message: result?.message || 'La base de datos no confirmó la apertura del turno.',
      }
    }

    return {
      ok: true,
      shift_id: result.shift_id,
      message: result.message || 'Turno de caja abierto correctamente.',
    }
  } catch (error) {
    console.error('[cashShiftService] Error al abrir turno:', error)
    return {
      ok: false,
      message: error instanceof Error
        ? error.message
        : 'No se pudo confirmar la apertura en el servidor.',
    }
  }
}

/**
 * Realiza un arqueo ciego o cierre Z exclusivamente mediante la RPC oficial.
 * Un error de red nunca se transforma en un cierre exitoso local.
 */
export async function submitBlindArqueo(
  shiftId: string,
  countedCash: number,
  notes: string = '',
  denominations: DenominationItem[] = [],
  isFinal: boolean = true
): Promise<{
  ok: boolean
  stage: string
  expected_cash: number
  counted_cash: number
  difference: number
  status: string
  message: string
}> {
  const failure = (message: string) => ({
    ok: false,
    stage: isFinal ? 'cierre_z' : 'cierre_x',
    expected_cash: 0,
    counted_cash: countedCash,
    difference: 0,
    status: 'error',
    message,
  })

  if (!shiftId || shiftId === 'active' || shiftId.startsWith('local-')) {
    return failure('El turno no tiene un identificador confirmado por el servidor. Actualiza la caja.')
  }

  if (!Number.isFinite(countedCash) || countedCash < 0) {
    return failure('El efectivo contado no es válido.')
  }

  try {
    const { data, error } = await supabase.rpc('caja_arqueo_ciego', {
      p_shift_id: shiftId,
      p_counted_cash: countedCash,
      p_notes: notes || null,
      p_denominations: denominations,
      p_is_final: isFinal,
    })

    if (error) throw error

    const result = data as {
      ok?: boolean
      stage?: string
      expected_cash?: number
      counted_cash?: number
      difference?: number
      status?: string
      message?: string
    } | null

    if (result?.ok !== true) {
      return failure(result?.message || 'La base de datos no confirmó el arqueo.')
    }

    return {
      ok: true,
      stage: result.stage || (isFinal ? 'cierre_z' : 'cierre_x'),
      expected_cash: Number(result.expected_cash) || 0,
      counted_cash: Number(result.counted_cash) || countedCash,
      difference: Number(result.difference) || 0,
      status: result.status || (isFinal ? 'closed' : 'open'),
      message: result.message || 'Arqueo registrado correctamente.',
    }
  } catch (error) {
    console.error('[cashShiftService] Error al registrar arqueo:', error)
    return failure(
      error instanceof Error
        ? error.message
        : 'No se pudo confirmar el arqueo en el servidor.'
    )
  }
}

/**
 * Contabiliza automáticamente una venta en el libro diario acc_entries y acc_lines.
 */
export async function autoContabilizarVenta(saleId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await supabase.rpc('contabilizar_venta_automatica', {
      p_sale_id: saleId,
    })
    if (!error && data) {
      return data as { ok: boolean; reason?: string }
    }
    if (error) {
      console.error('[cashShiftService] Error al contabilizar venta:', error)
      return { ok: false, reason: error.message }
    }
  } catch (error) {
    console.error('[cashShiftService] No se pudo solicitar la contabilización:', error)
  }

  return { ok: false, reason: 'Función no disponible o venta aún no contabilizada' }
}
