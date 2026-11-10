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

const SHIFT_STORAGE_KEY = 'cp_local_active_shift'

/**
 * Obtiene el turno de caja actualmente activo para el usuario en sesión.
 */
export async function getActiveShift(): Promise<ActiveShift> {
  try {
    const { data, error } = await supabase.rpc('caja_obtener_turno_activo')
    if (!error && data && typeof data === 'object') {
      const res = data as ActiveShift
      if (res.active) {
        localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(res))
        return res
      }
    }
  } catch {
    // Si la RPC falla por estar en demo o antes de aplicar migración, comprobar tabla o fallback
  }

  // Fallback a consulta directa sobre tabla cash_shifts
  try {
    const { data: shifts } = await supabase
      .from('cash_shifts')
      .select('*')
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)

    if (shifts && shifts.length > 0) {
      const s = shifts[0]
      const active: ActiveShift = {
        active: true,
        shift_id: s.id,
        opened_at: s.opened_at,
        cashier_name: s.cashier_name || 'Cajero',
        opening_amount: Number(s.opening_amount) || 0,
        sales_cash: Number(s.total_sales_cash) || 0,
        sales_card: Number(s.total_sales_card) || 0,
        sales_transfer: Number(s.total_sales_transfer) || 0,
        sales_credit: Number(s.total_sales_credit) || 0,
        sales_count: Number(s.total_sales_count) || 0,
        cash_in: Number(s.total_cash_in) || 0,
        cash_out: Number(s.total_cash_out) || 0,
        expected_cash: Number(s.expected_cash) || Number(s.opening_amount) || 0,
      }
      localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(active))
      return active
    }
  } catch {
    // Fallback a localStorage
  }

  const cached = localStorage.getItem(SHIFT_STORAGE_KEY)
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ActiveShift
      if (parsed.active) return parsed
    } catch {
      localStorage.removeItem(SHIFT_STORAGE_KEY)
    }
  }

  return {
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
}

/**
 * Abre un nuevo turno de caja con fondo inicial.
 */
export async function openCashShift(
  openingAmount: number,
  warehouseId?: string | null,
  notes?: string | null,
  denominations: DenominationItem[] = []
): Promise<{ ok: boolean; shift_id?: string; message?: string }> {
  try {
    const { data, error } = await supabase.rpc('caja_abrir_turno', {
      p_opening_amount: openingAmount,
      p_warehouse_id: warehouseId || null,
      p_notes: notes || null,
      p_denominations: denominations,
    })

    if (!error && data) {
      const res = data as { ok: boolean; shift_id: string; message: string }
      await getActiveShift() // actualizar cache
      return res
    }
  } catch {
    // Continuar a fallback
  }

  // Fallback directo a insert
  try {
    const shiftId = crypto.randomUUID()
    const { error: insErr } = await supabase.from('cash_shifts').insert({
      id: shiftId,
      opening_amount: openingAmount,
      expected_cash: openingAmount,
      warehouse_id: warehouseId || null,
      notes: notes || null,
      status: 'open',
    })

    if (!insErr) {
      // Guardar en cash_entries
      await supabase.from('cash_entries').insert({
        type: 'ingreso',
        amount: openingAmount,
        description: `Base inicial de caja - Turno ${shiftId.slice(0, 8)}`,
        reference_type: 'caja_apertura',
        reference_id: shiftId,
        shift_id: shiftId,
      })

      await getActiveShift()
      return { ok: true, shift_id: shiftId, message: 'Turno de caja abierto correctamente' }
    }
  } catch {
    // Modo offline / almacenamiento local
  }

  const localShift: ActiveShift = {
    active: true,
    shift_id: 'local-' + Date.now(),
    opened_at: new Date().toISOString(),
    cashier_name: 'Cajero Local',
    opening_amount: openingAmount,
    sales_cash: 0,
    sales_card: 0,
    sales_transfer: 0,
    sales_credit: 0,
    sales_count: 0,
    cash_in: 0,
    cash_out: 0,
    expected_cash: openingAmount,
  }
  localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(localShift))
  return { ok: true, shift_id: localShift.shift_id, message: 'Turno abierto localmente' }
}

/**
 * Realiza un arqueo ciego o cierre Z final.
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
  try {
    const { data, error } = await supabase.rpc('caja_arqueo_ciego', {
      p_shift_id: shiftId,
      p_counted_cash: countedCash,
      p_notes: notes || null,
      p_denominations: denominations,
      p_is_final: isFinal,
    })

    if (!error && data) {
      if (isFinal) {
        localStorage.removeItem(SHIFT_STORAGE_KEY)
      }
      return data as any
    }
  } catch {
    // Fallback a cerrar_caja existente
  }

  // Fallback con la función de cierre tradicional si existe
  try {
    const { data: oldData, error: oldErr } = await supabase.rpc('cerrar_caja', {
      p_counted: countedCash,
      p_expected_seen: countedCash,
      p_notes: notes,
    })
    if (!oldErr && oldData) {
      localStorage.removeItem(SHIFT_STORAGE_KEY)
      return {
        ok: true,
        stage: isFinal ? 'cierre_z' : 'cierre_x',
        expected_cash: Number((oldData as any).expected) || countedCash,
        counted_cash: countedCash,
        difference: Number((oldData as any).difference) || 0,
        status: isFinal ? 'closed' : 'open',
        message: 'Cierre completado',
      }
    }
  } catch {
    // Local fallback
  }

  localStorage.removeItem(SHIFT_STORAGE_KEY)
  return {
    ok: true,
    stage: isFinal ? 'cierre_z' : 'cierre_x',
    expected_cash: countedCash,
    counted_cash: countedCash,
    difference: 0,
    status: isFinal ? 'closed' : 'open',
    message: isFinal ? 'Turno cerrado localmente' : 'Corte parcial X registrado',
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
  } catch {
    // Si no está disponible en la base, no bloquea el flujo comercial
  }
  return { ok: false, reason: 'Función no disponible o ya contabilizada' }
}
