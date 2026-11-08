/** Cálculos del Centro de Mando. Funciones puras: sin pantalla ni base de datos. */

export interface SaleRow {
  id: string
  total: number
  status: string
  created_at: string
  payment_method: string | null
  customer_name: string | null
  discount_amount?: number | null
}

export interface LocalAlert { id: string; severity: 'alta' | 'media' | 'info'; title: string; detail: string }

export interface Metrics {
  todayTotal: number
  todayCount: number
  yTotal: number
  ySameHour: number
  cumToday: number[]
  cumTypical: number[]
  pace: number | null
  projection: number | null
  ticketToday: number
  ticket30: number
  mtd: number
  prevMtd: number
  daily14: number[]
  mix: { label: string; value: number }[]
  heat: number[][]
  alerts: LocalAlert[]
}

const DAY = 86400000

export function startOfDay(d: Date): Date {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

const num = (v: unknown) => Number(v) || 0
const cum = (a: number[]) => { let s = 0; return a.map(v => (s += v)) }

function hourly(rows: SaleRow[], t0: number): number[] {
  const out: number[] = Array.from({ length: 24 }, () => 0)
  for (const s of rows) {
    const t = Date.parse(s.created_at)
    if (t >= t0 && t < t0 + DAY) out[new Date(t).getHours()] += num(s.total)
  }
  return out
}

function sumBetween(rows: SaleRow[], from: number, to: number): number {
  let s = 0
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    if (t >= from && t < to) s += num(r.total)
  }
  return s
}

function methodLabel(m: string | null): string {
  const k = (m || 'otro').toLowerCase()
  const map: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito', crédito: 'Crédito', fiado: 'Crédito' }
  return map[k] ?? k.charAt(0).toUpperCase() + k.slice(1)
}

export function computeMetrics(sales: SaleRow[], now: Date): Metrics {
  const t0 = startOfDay(now).getTime()
  const nowH = now.getHours()
  const live = sales.filter(s => s.status !== 'anulada')
  const todayRows = live.filter(s => Date.parse(s.created_at) >= t0)

  // Curva de hoy contra la curva habitual del mismo día de la semana (últimas 4 semanas)
  const cumToday = cum(hourly(live, t0))
  const weeks: number[][] = []
  for (let k = 1; k <= 4; k++) {
    const h = hourly(live, t0 - 7 * k * DAY)
    if (h.some(v => v > 0)) weeks.push(h)
  }
  const typicalHourly: number[] = Array.from({ length: 24 }, (_, i) =>
    weeks.length ? weeks.reduce((s, w) => s + w[i], 0) / weeks.length : 0)
  const cumTypical = cum(typicalHourly)
  const typNow = cumTypical[nowH] ?? 0
  const typDay = cumTypical[23] ?? 0
  const todayTotal = cumToday[23]
  const pace = typNow > 0 ? todayTotal / typNow : null
  const projection = typNow > 0 && typDay > 0 ? todayTotal * (typDay / typNow) : null

  const yHour = hourly(live, t0 - DAY)
  const yTotal = yHour.reduce((a, b) => a + b, 0)
  const ySameHour = yHour.slice(0, nowH + 1).reduce((a, b) => a + b, 0)

  const ticketToday = todayRows.length ? todayTotal / todayRows.length : 0
  const l30 = live.filter(s => Date.parse(s.created_at) >= t0 - 30 * DAY)
  const ticket30 = l30.length ? l30.reduce((a, s) => a + num(s.total), 0) / l30.length : 0

  // Mes contra mes anterior (hasta el mismo día)
  const y = now.getFullYear()
  const m = now.getMonth()
  const first = new Date(y, m, 1).getTime()
  const prevFirst = new Date(y, m - 1, 1).getTime()
  const prevDays = new Date(y, m, 0).getDate()
  const prevEnd = new Date(y, m - 1, Math.min(now.getDate(), prevDays) + 1).getTime()
  const mtd = sumBetween(live, first, now.getTime() + 1)
  const prevMtd = sumBetween(live, prevFirst, prevEnd)

  const daily14: number[] = []
  for (let i = 13; i >= 0; i--) daily14.push(sumBetween(live, t0 - i * DAY, t0 - i * DAY + DAY))

  const mixMap = new Map<string, number>()
  for (const s of live) {
    if (Date.parse(s.created_at) < first) continue
    const k = methodLabel(s.payment_method)
    mixMap.set(k, (mixMap.get(k) ?? 0) + num(s.total))
  }
  const mix = Array.from(mixMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

  const heat: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const s of live) {
    const t = Date.parse(s.created_at)
    if (t < t0 - 56 * DAY) continue
    const d = new Date(t)
    heat[(d.getDay() + 6) % 7][d.getHours()] += 1
  }

  // Alertas de control calculadas con las ventas de hoy
  const alerts: LocalAlert[] = []
  const cancelled = sales.filter(s => s.status === 'anulada' && Date.parse(s.created_at) >= t0)
  const allToday = todayRows.length + cancelled.length
  if (cancelled.length >= 3 || (allToday >= 5 && cancelled.length / allToday >= 0.2)) {
    const amt = cancelled.reduce((a, s) => a + num(s.total), 0)
    alerts.push({ id: 'anuladas', severity: 'alta', title: `${cancelled.length} ventas anuladas hoy`, detail: `Suman ${amt.toFixed(2)}. Revisa quién las anuló y por qué.` })
  }
  const heavy = todayRows.filter(s => {
    const d = num(s.discount_amount)
    return d > 0 && d / (num(s.total) + d) > 0.3
  })
  if (heavy.length > 0) {
    alerts.push({ id: 'descuentos', severity: 'media', title: `${heavy.length} venta(s) con descuento mayor a 30%`, detail: 'Descuentos altos pueden indicar fuga de margen.' })
  }
  if (ticket30 > 0) {
    const big = todayRows.filter(s => num(s.total) > ticket30 * 4)
    if (big.length > 0) alerts.push({ id: 'ticket', severity: 'info', title: `${big.length} venta(s) de monto inusualmente alto`, detail: `Más de 4 veces el ticket promedio (${ticket30.toFixed(2)}).` })
  }
  const odd = todayRows.filter(s => { const h = new Date(s.created_at).getHours(); return h < 6 || h >= 22 })
  if (odd.length > 0) alerts.push({ id: 'horario', severity: 'media', title: `${odd.length} venta(s) fuera de horario`, detail: 'Registradas entre las 22:00 y las 06:00.' })
  if (pace !== null && nowH >= 11 && pace < 0.6) {
    alerts.push({ id: 'ritmo', severity: 'alta', title: 'Ventas por debajo del ritmo habitual', detail: `Llevas ${Math.round(pace * 100)}% de lo que suele venderse a esta hora.` })
  } else if (pace !== null && nowH >= 11 && pace >= 1.15) {
    alerts.push({ id: 'ritmo', severity: 'info', title: 'Ventas por encima del ritmo habitual', detail: `Llevas ${Math.round(pace * 100)}% de lo normal a esta hora.` })
  }

  return {
    todayTotal, todayCount: todayRows.length, yTotal, ySameHour, cumToday, cumTypical, pace, projection,
    ticketToday, ticket30, mtd, prevMtd, daily14, mix, heat, alerts,
  }
}

export function pctDelta(now: number, before: number): number | null {
  if (before <= 0) return null
  return ((now - before) / before) * 100
}

export type Light = 'verde' | 'ambar' | 'rojo' | 'gris'

/** Semáforo simple y explicable (no es una nota mágica). */
export function lightPace(pace: number | null): Light {
  if (pace === null) return 'gris'
  return pace >= 0.9 ? 'verde' : pace >= 0.6 ? 'ambar' : 'rojo'
}
export function lightOverdue(owed: number, overdue: number): Light {
  if (owed <= 0) return 'verde'
  const r = overdue / owed
  return r <= 0.1 ? 'verde' : r <= 0.3 ? 'ambar' : 'rojo'
}
export function lightStock(low: number): Light {
  return low === 0 ? 'verde' : low <= 5 ? 'ambar' : 'rojo'
}
export function lightGoals(avgPct: number | null): Light {
  if (avgPct === null) return 'gris'
  return avgPct >= 0.9 ? 'verde' : avgPct >= 0.6 ? 'ambar' : 'rojo'
}
export function lightControl(alerts: number): Light {
  return alerts === 0 ? 'verde' : alerts <= 2 ? 'ambar' : 'rojo'
}
