/* Impuestos de ventas y cotizaciones.
   - none: sin impuesto (el total es la suma de las líneas).
   - incluido: los precios YA traen el impuesto; el total no cambia y se muestra el desglose.
   - adicional: el impuesto se suma a los precios; total = subtotal + impuesto.
   El servidor repite este mismo cálculo al registrar la venta (la cifra que vale es la del servidor). */

export type TaxMode = 'none' | 'incluido' | 'adicional'

/** Campos de impuesto que guardan las ventas y cotizaciones. */
export interface TaxFields { subtotal?: number | null; tax_rate?: number | null; tax_amount?: number | null }

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function taxModeOf(cfg: unknown): TaxMode {
  const m = (cfg as { tax_mode?: string } | null | undefined)?.tax_mode
  return m === 'incluido' || m === 'adicional' ? m : 'none'
}

export function taxRateOf(cfg: unknown): number {
  const r = Number((cfg as { tax_rate?: number } | null | undefined)?.tax_rate)
  return r > 0 ? Math.min(r, 100) : 0
}

export function calcTax(sum: number, mode: TaxMode, rate: number): { subtotal: number; rate: number; tax: number; total: number } {
  if (mode === 'none' || !(rate > 0)) return { subtotal: round2(sum), rate: 0, tax: 0, total: round2(sum) }
  if (mode === 'adicional') {
    const tax = round2((sum * rate) / 100)
    return { subtotal: round2(sum), rate, tax, total: round2(sum + tax) }
  }
  const tax = round2(sum - sum / (1 + rate / 100))
  return { subtotal: round2(sum - tax), rate, tax, total: round2(sum) }
}

/** Campos opcionales del comprobante (Subtotal / Impuesto) a partir de una venta o cotización guardada. */
export function taxDocFields(t: TaxFields | null | undefined): { subtotal?: number; taxRate?: number; taxAmount?: number } {
  const amount = Number(t?.tax_amount)
  if (!(amount > 0)) return {}
  return { subtotal: Number(t?.subtotal) || undefined, taxRate: Number(t?.tax_rate) || undefined, taxAmount: amount }
}
