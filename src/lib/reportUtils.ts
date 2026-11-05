/**
 * Utilidades compartidas del modulo de Reportes.
 *
 * Aqui viven: los periodos y tabs disponibles, el calculo de rangos de fechas,
 * el formato de numeros/montos/dates y los normalizadores de los registros
 * que llegan de Supabase (items, estados, movimientos de caja y kardex).
 */

import { formatMoney as formatMoneyCore } from './currency'

/* -------------------------------------------------------------------------- */
/*                                  Tipos                                     */
/* -------------------------------------------------------------------------- */

export type Period =
  | 'dia'
  | 'semana'
  | 'mes'
  | 'trimestre'
  | 'semestre'
  | 'anio'
  | 'todo'

export type Tab =
  | 'resumen'
  | 'ventas'
  | 'compras'
  | 'gastos'
  | 'caja'
  | 'devoluciones'
  | 'kardex'

export type PeriodOption = {
  id: Period
  label: string
  title: string
}

export type TabOption = {
  id: Tab
  label: string
}

export type DateRange = {
  start: Date
  end: Date
}

/** Fila de producto normalizada dentro de `sales.items` / `purchases.items`. */
export type ItemRow = {
  name: string
  quantity: number
  price: number
  total: number
}

/* -------------------------------------------------------------------------- */
/*                             Periodos y tabs                                */
/* -------------------------------------------------------------------------- */

export const PERIODS: PeriodOption[] = [
  { id: 'dia', label: 'Día', title: 'Reporte diario' },
  { id: 'semana', label: 'Semana', title: 'Reporte semanal' },
  { id: 'mes', label: 'Mes', title: 'Reporte mensual' },
  { id: 'trimestre', label: 'Trimestre', title: 'Reporte trimestral' },
  { id: 'semestre', label: 'Semestre', title: 'Reporte semestral' },
  { id: 'anio', label: 'Año', title: 'Reporte anual' },
  { id: 'todo', label: 'Todo', title: 'Reporte histórico' },
]

export const TABS: TabOption[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'compras', label: 'Compras' },
  { id: 'gastos', label: 'Gastos' },
  { id: 'caja', label: 'Caja' },
  { id: 'devoluciones', label: 'Devoluciones' },
  { id: 'kardex', label: 'Kardex' },
]

/**
 * CSS aplicado solo al imprimir (se inyecta desde el componente de pagina).
 *
 * Truco clave: `.print-area` se convierte en `display: table` durante la
 * impresion. Su primera fila pasa a ser `table-header-group` (se repite en
 * CADA pagina) y la ultima `table-footer-group` (se repite al pie de cada
 * pagina). Asi la cabecera con los datos de la empresa aparece en todas las
 * hojas de un reporte largo, no solo en la primera.
 */
export const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }

  .print-area {
    display: table;
    width: 100%;
    table-layout: fixed;
    border: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }

  /* Cabecera con los datos de la empresa: se repite en cada pagina. */
  .print-area > .print-header,
  .print-area > :first-child { display: table-header-group; }

  /* Contenido del reporte. */
  .print-area > .print-content,
  .print-area > :nth-child(2) { display: table-row-group; }

  /* Pie del reporte: se repite al final de cada pagina. */
  .print-area > .print-footer,
  .print-area > :last-child { display: table-footer-group; }

  body { background: #fff !important; }

  /* Encabezados de columna se repiten; los totales solo al final. */
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  tr, .page-break { page-break-inside: avoid; }
  .page-break { page-break-after: always; break-after: page; }
  h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
  @page { margin: 12mm; size: landscape; }
}
`

/* -------------------------------------------------------------------------- */
/*                                  Fechas                                    */
/* -------------------------------------------------------------------------- */

/** Idioma del dispositivo (undefined = el del navegador). */
const LOCALE: string | undefined =
  typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined

/** Convierte un Date a `YYYY-MM-DD` en hora local (formato de <input type="date">). */
export function toInputValue(date: Date): string {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Parsea fechas que llegan de Supabase sin desfase de zona horaria.
 * Los strings `YYYY-MM-DD` se interpretan como fecha local (no UTC).
 */
export function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = String(value).trim()
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (soloFecha) {
    const d = new Date(
      Number(soloFecha[1]),
      Number(soloFecha[2]) - 1,
      Number(soloFecha[3]),
    )
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Rango [start, end) del periodo respecto a la fecha de referencia.
 * `end` es exclusivo: se usa con `.gte('created_at', start).lt('created_at', end)`.
 */
export function getRange(period: Period, refDate: Date): DateRange {
  const base = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? new Date(refDate.getTime()) : new Date()
  base.setHours(0, 0, 0, 0)

  const startOfDay = (d: Date) => {
    const x = new Date(d.getTime())
    x.setHours(0, 0, 0, 0)
    return x
  }
  const addDays = (d: Date, n: number) => {
    const x = startOfDay(d)
    x.setDate(x.getDate() + n)
    return x
  }

  switch (period) {
    case 'dia': {
      return { start: startOfDay(base), end: addDays(base, 1) }
    }
    case 'semana': {
      // Ultimos 7 dias (incluyendo la fecha de referencia).
      return { start: addDays(base, -6), end: addDays(base, 1) }
    }
    case 'mes': {
      return {
        start: new Date(base.getFullYear(), base.getMonth(), 1),
        end: new Date(base.getFullYear(), base.getMonth() + 1, 1),
      }
    }
    case 'trimestre': {
      const q = Math.floor(base.getMonth() / 3) * 3
      return {
        start: new Date(base.getFullYear(), q, 1),
        end: new Date(base.getFullYear(), q + 3, 1),
      }
    }
    case 'semestre': {
      const s = base.getMonth() < 6 ? 0 : 6
      return {
        start: new Date(base.getFullYear(), s, 1),
        end: new Date(base.getFullYear(), s + 6, 1),
      }
    }
    case 'anio': {
      return {
        start: new Date(base.getFullYear(), 0, 1),
        end: new Date(base.getFullYear() + 1, 0, 1),
      }
    }
    case 'todo':
    default: {
      // Ventana amplia: incluye todo el historico guardado en la base.
      return {
        start: new Date(2000, 0, 1),
        end: new Date(2100, 0, 1),
      }
    }
  }
}

/** Texto legible del periodo, p.ej. `01 – 31 oct 2026`. */
export function periodLabel(period: Period, start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' })
  if (period === 'todo') return 'Todo el histórico'
  if (period === 'anio') return String(start.getFullYear())
  if (period === 'dia') return fmt(start)
  // `end` es exclusivo: se retrocede 1 ms para mostrar el ultimo dia incluido.
  const ultimo = new Date(end.getTime() - 1)
  return `${fmt(start)} – ${fmt(ultimo)}`
}

/** Fecha legible según el idioma del dispositivo. */
export function formatDate(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/* -------------------------------------------------------------------------- */
/*                            Numeros y montos                                */
/* -------------------------------------------------------------------------- */

/**
 * Convierte cualquier valor a numero. Acepta strings con formato local
 * (`1.234,56` o `1,234.56`) y descarta lo que no sea numerico.
 */
export function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value == null) return 0
  const raw = String(value).trim()
  if (!raw) return 0
  const limpio = raw.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : 0
}

/** Formatea un monto con la moneda de la empresa (código ISO). */
export function formatMoney(value: unknown, currency = 'USD'): string {
  return formatMoneyCore(num(value), currency)
}

/** Suma los valores de una lista. */
export function sum<T>(list: T[] | null | undefined, pick: (item: T) => number): number {
  if (!Array.isArray(list)) return 0
  return list.reduce((acc, item) => {
    const v = pick(item)
    return acc + (Number.isFinite(v) ? v : 0)
  }, 0)
}

/* -------------------------------------------------------------------------- */
/*                        Normalizadores de registros                        */
/* -------------------------------------------------------------------------- */

/** Quita acentos y pasa a minusculas para comparar textos. */
function clave(valor: unknown): string {
  return String(valor ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/**
 * Normaliza `items` (de ventas y compras) a una lista de filas.
 * Acepta: array de objetos, string JSON, objeto con `.items` o un numero.
 */
export function normalizeItems(raw: unknown): ItemRow[] {
  if (raw == null) return []

  let data: unknown = raw
  if (typeof data === 'string') {
    const trimmed = data.trim()
    if (!trimmed) return []
    try {
      data = JSON.parse(trimmed)
    } catch {
      const n = num(trimmed)
      return [{ name: 'Detalle', quantity: 1, price: n, total: n }]
    }
  }

  if (typeof data === 'number') {
    return [{ name: 'Detalle', quantity: data, price: 0, total: 0 }]
  }

  let lista: unknown[] = []
  if (Array.isArray(data)) {
    lista = data
  } else if (data && typeof data === 'object') {
    const inner = (data as Record<string, unknown>).items
    lista = Array.isArray(inner) ? inner : []
  }

  return lista.map((item) => {
    const it = (item ?? {}) as Record<string, unknown>
    const name = String(it.name ?? it.product_name ?? it.description ?? it.producto ?? it.nombre ?? 'Producto')
    const quantity = num(it.quantity ?? it.qty ?? it.cantidad ?? it.cant ?? 0)
    const price = num(it.price ?? it.unit_price ?? it.precio ?? it.cost ?? it.valor ?? 0)
    const total = num(it.total ?? it.subtotal ?? it.amount ?? it.importe ?? 0) || quantity * price
    return { name, quantity, price, total }
  })
}

/** `true` si el registro esta anulado (no debe sumar en los totales). */
export function isAnulled(status: unknown): boolean {
  const s = clave(status)
  if (!s) return false
  return ['anul', 'anulad', 'cancel', 'void', 'descript'].some((k) => s.includes(k))
}

/**
 * Monto con signo para movimientos de caja / kardex.
 * Las salidas se restan, las entradas suman.
 */
export function signedAmount(type: unknown, amount: unknown): number {
  const valor = num(amount)
  const t = clave(type)
  const esSalida = ['salida', 'egreso', 'expense', 'debit', 'retir', 'pago', 'gasto'].some((k) => t.includes(k))
  const esEntrada = ['entrada', 'ingreso', 'income', 'credit', 'cobro'].some((k) => t.includes(k))
  if (esSalida && valor > 0) return -valor
  if (esEntrada && valor < 0) return Math.abs(valor)
  return valor
}

/** Etiqueta legible del tipo de movimiento de caja. */
export function movementLabel(type: unknown): string {
  const t = clave(type)
  if (!t) return 'Movimiento'
  if (['salida', 'egreso', 'expense', 'debit', 'retir', 'pago', 'gasto'].some((k) => t.includes(k))) {
    return 'Salida'
  }
  if (['entrada', 'ingreso', 'income', 'credit', 'cobro'].some((k) => t.includes(k))) {
    return 'Entrada'
  }
  return String(type)
}
