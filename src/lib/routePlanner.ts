/**
 * Planificador de rutas para clientes sin atender.
 * Pasos: priorizar -> repartir por zonas entre vendedores -> repartir por días -> ordenar paradas.
 * Todo corre en el teléfono, sin servicios externos ni costo.
 */

export interface PlanCustomer {
  id: string
  name: string
  lat: number
  lng: number
  /** Días desde la última venta o visita (null = nunca atendido). */
  days: number | null
  /** Valor histórico del cliente (suma de ventas). Sirve para priorizar. */
  value: number
  phone?: string | null
  address?: string | null
}

export interface PlanSeller {
  id: string
  name: string
  home?: { lat: number; lng: number } | null
}

export interface PlanOptions {
  workDays: number
  stopsPerDay: number
  speedKmh: number
  minutesPerStop: number
}

export interface PlanStop {
  customer: PlanCustomer
  seq: number
  legKm: number
  etaMin: number
  score: number
}

export interface PlanDay {
  sellerId: string
  sellerName: string
  day: number
  stops: PlanStop[]
  km: number
  minutes: number
}

export interface PlanResult {
  days: PlanDay[]
  leftOut: PlanCustomer[]
  totalKm: number
  totalStops: number
}

type Pt = { lat: number; lng: number }

export function haversineKm(a: Pt, b: Pt): number {
  const R = 6371
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Las calles no son línea recta: se corrige con un factor urbano típico. */
const DETOUR = 1.3

export function priorityScore(c: PlanCustomer): number {
  const urgency = Math.min(c.days ?? 180, 365) / 30
  const worth = Math.log10(1 + Math.max(0, c.value))
  return urgency * 2 + worth
}

function centroid(pts: Pt[]): Pt {
  if (pts.length === 0) return { lat: 0, lng: 0 }
  let la = 0
  let ln = 0
  for (const p of pts) { la += p.lat; ln += p.lng }
  return { lat: la / pts.length, lng: ln / pts.length }
}

/** k-means con tamaño máximo por grupo (reparto equilibrado). */
function balancedGroups<T extends Pt>(items: T[], k: number, maxSize: number, seeds?: Pt[]): T[][] {
  if (k <= 1) return [items.slice()]
  if (items.length === 0) return Array.from({ length: k }, () => [])
  let cents: Pt[] = []
  if (seeds && seeds.length === k) {
    cents = seeds.map(s => ({ lat: s.lat, lng: s.lng }))
  } else {
    cents.push({ lat: items[0].lat, lng: items[0].lng })
    while (cents.length < k) {
      let best = items[0]
      let bd = -1
      for (const it of items) {
        let d = Infinity
        for (const c of cents) d = Math.min(d, haversineKm(it, c))
        if (d > bd) { bd = d; best = it }
      }
      cents.push({ lat: best.lat, lng: best.lng })
    }
  }
  let groups: T[][] = []
  for (let iter = 0; iter < 12; iter++) {
    groups = Array.from({ length: k }, () => [])
    const order = items
      .map(it => {
        const ds = cents.map(c => haversineKm(it, c)).sort((a, b) => a - b)
        return { it, regret: (ds[1] ?? ds[0]) - ds[0] }
      })
      .sort((a, b) => b.regret - a.regret)
    for (const { it } of order) {
      const ranked = cents
        .map((c, i) => ({ i, d: haversineKm(it, c) }))
        .sort((a, b) => a.d - b.d)
      const slot = ranked.find(r => groups[r.i].length < maxSize) ?? ranked[0]
      groups[slot.i].push(it)
    }
    const next = groups.map((g, i) => (g.length ? centroid(g) : cents[i]))
    const moved = next.reduce((s, c, i) => s + haversineKm(c, cents[i]), 0)
    cents = next
    if (moved < 0.01) break
  }
  return groups
}

/** Ordena un tramo abierto: vecino más cercano + mejora 2-opt. */
function orderStops(items: PlanCustomer[], start: Pt | null): PlanCustomer[] {
  if (items.length <= 2) return items.slice()
  const c = centroid(items)
  let first = 0
  if (start) {
    let bd = Infinity
    items.forEach((it, i) => { const d = haversineKm(start, it); if (d < bd) { bd = d; first = i } })
  } else {
    let bd = -1
    items.forEach((it, i) => { const d = haversineKm(c, it); if (d > bd) { bd = d; first = i } })
  }
  const left = items.slice()
  const path: PlanCustomer[] = [left.splice(first, 1)[0]]
  while (left.length) {
    const last = path[path.length - 1]
    let bi = 0
    let bd = Infinity
    left.forEach((it, i) => { const d = haversineKm(last, it); if (d < bd) { bd = d; bi = i } })
    path.push(left.splice(bi, 1)[0])
  }
  const len = (p: PlanCustomer[]) => {
    let s = start ? haversineKm(start, p[0]) : 0
    for (let i = 1; i < p.length; i++) s += haversineKm(p[i - 1], p[i])
    return s
  }
  let improved = true
  let guard = 0
  while (improved && guard++ < 50) {
    improved = false
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const cand = path.slice(0, i).concat(path.slice(i, j + 1).reverse(), path.slice(j + 1))
        if (len(cand) + 1e-9 < len(path)) {
          for (let t = 0; t < path.length; t++) path[t] = cand[t]
          improved = true
        }
      }
    }
  }
  return path
}

export function planRoutes(customers: PlanCustomer[], sellers: PlanSeller[], opt: PlanOptions): PlanResult {
  const empty: PlanResult = { days: [], leftOut: customers.slice(), totalKm: 0, totalStops: 0 }
  if (sellers.length === 0 || customers.length === 0) return empty
  const perSeller = Math.max(1, opt.workDays * opt.stopsPerDay)

  const scored = customers
    .map(c => ({ c, s: priorityScore(c) }))
    .sort((a, b) => b.s - a.s)
  const capacity = sellers.length * perSeller
  const chosen = scored.slice(0, capacity)
  const leftOut = scored.slice(capacity).map(x => x.c)
  const scoreOf = new Map<string, number>(chosen.map(x => [x.c.id, x.s]))

  // 1) zonas: cada vendedor recibe una zona compacta
  const seeds = sellers.every(s => s.home) ? sellers.map(s => s.home as Pt) : undefined
  const zones = balancedGroups(chosen.map(x => x.c), sellers.length, perSeller, seeds)

  // 2) zona i -> vendedor i (con casa, cada zona nace alrededor de su vendedor)
  const assignment: PlanCustomer[][] = zones

  const days: PlanDay[] = []
  let totalKm = 0
  let totalStops = 0
  sellers.forEach((seller, si) => {
    const mine = assignment[si]
    if (mine.length === 0) return
    const nDays = Math.min(opt.workDays, Math.max(1, Math.ceil(mine.length / opt.stopsPerDay)))
    const perDay = balancedGroups(mine, nDays, opt.stopsPerDay)
    // los días con más urgencia van primero
    const dayAvg = perDay.map(g => g.reduce((s, c) => s + (scoreOf.get(c.id) ?? 0), 0) / Math.max(1, g.length))
    const dayOrder = perDay.map((g, i) => ({ g, a: dayAvg[i] })).filter(x => x.g.length > 0).sort((a, b) => b.a - a.a)
    dayOrder.forEach(({ g }, di) => {
      const ordered = orderStops(g, seller.home ?? null)
      let prev: Pt | null = seller.home ?? null
      let km = 0
      let minutes = 0
      const stops: PlanStop[] = ordered.map((c, i) => {
        const leg = prev ? haversineKm(prev, c) * DETOUR : 0
        km += leg
        minutes += (leg / Math.max(1, opt.speedKmh)) * 60 + opt.minutesPerStop
        prev = c
        return { customer: c, seq: i + 1, legKm: leg, etaMin: Math.round(minutes), score: scoreOf.get(c.id) ?? 0 }
      })
      totalKm += km
      totalStops += stops.length
      days.push({ sellerId: seller.id, sellerName: seller.name, day: di + 1, stops, km, minutes: Math.round(minutes) })
    })
  })
  return { days, leftOut, totalKm, totalStops }
}

export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const r = m % 60
  return h > 0 ? `${h} h ${r} min` : `${r} min`
}

export function mapsLink(stops: PlanStop[], home?: Pt | null): string {
  const pts = stops.map(s => `${s.customer.lat},${s.customer.lng}`)
  if (home) pts.unshift(`${home.lat},${home.lng}`)
  return 'https://www.google.com/maps/dir/' + pts.join('/')
}
