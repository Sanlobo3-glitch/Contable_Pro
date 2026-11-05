import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { Printer, Maximize2, MapPin, AlertTriangle, Loader2, Users, Navigation, BarChart3, Moon, Phone } from 'lucide-react'

/* ----------------------------- Tipos y constantes ---------------------------- */

interface Visit {
  id: string
  seller_id: string
  seller_name: string | null
  customer_id: string | null
  sale_id: string | null
  kind: 'venta' | 'visita'
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  gps_status: string
  at_establishment: boolean | null
  note: string | null
  distance_to_customer_m: number | null
  flag: 'ok' | 'fuera_de_sitio' | 'sin_gps' | 'inconsistente'
  created_at: string
}
interface Cust { id: string; name: string; address: string | null; phone: string | null }
interface Loc { customer_id: string; lat: number; lng: number }
interface SaleLite { id: string; total: number; status: string }
interface DormSrc { visits: { customer_id: string | null; created_at: string; seller_name: string | null }[]; sales: { customer_id: string | null; created_at: string; status: string }[] }
interface DormRow { c: Cust; ls: string | null; lv: { at: string; seller: string | null } | null; days: number | null }
interface CovInfo { venta: boolean; presencial: boolean; visita: boolean; last: Visit; total: number; count: number; ventas: number }
type Status = 'venta' | 'remoto' | 'visita' | 'sin'
type BarMetric = 'monto' | 'pedidos'

type Tab = 'cobertura' | 'rutas' | 'dormidos'
type Period = 'hoy' | '7d' | 'mes' | 'todo'
type Selected = { kind: 'customer' | 'visit'; id: string } | null

const PERIODS: { id: Period; label: string }[] = [
  { id: 'hoy', label: 'Hoy' }, { id: '7d', label: '7 días' }, { id: 'mes', label: 'Este mes' }, { id: 'todo', label: 'Todo' },
]
const SELLER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777']
const STATUS_COLOR: Record<Status, string> = { venta: '#16a34a', remoto: '#2563eb', visita: '#d97706', sin: '#dc2626' }
const STATUS_LABEL: Record<Status, string> = { venta: 'Venta presencial', remoto: 'Venta no presencial (llamada u otra)', visita: 'Visitado sin compra', sin: 'Sin atender' }
const FLAG_TEXT: Record<string, string> = {
  ok: 'Normal',
  fuera_de_sitio: 'Fuera del establecimiento',
  sin_gps: 'Sin GPS',
  inconsistente: 'Dijo estar en el sitio pero estaba lejos',
}

const flagLabel = (f: string): string => FLAG_TEXT[f] ?? f

const PRINT_CSS = `
@media print {
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body * { visibility: hidden !important; }
  .map-print, .map-print * { visibility: visible !important; }
  .map-print { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}
`

/* --------------------------------- Utilidades -------------------------------- */

const pad = (n: number) => String(n).padStart(2, '0')
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmtTime = (s: string) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtDateTime = (s: string) => new Date(s).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

function startOfPeriod(p: Period): Date | null {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (p === 'hoy') return d
  if (p === '7d') { d.setDate(d.getDate() - 6); return d }
  if (p === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const rad = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
const fmtKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < 20; page++) {
    const { data, error } = await build(page * 1000, page * 1000 + 999)
    if (error) throw new Error(error.message)
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

// Leaflet (OpenStreetMap) se carga bajo demanda desde un CDN, sin instalar nada.
const LEAFLET_VERSION = '1.9.4'
let leafletPromise: Promise<any> | null = null
function loadLeaflet(): Promise<any> {
  const w = window as any
  if (w.L) return Promise.resolve(w.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`
    document.head.appendChild(css)
    const s = document.createElement('script')
    s.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`
    s.onload = () => resolve((window as any).L)
    s.onerror = () => { leafletPromise = null; reject(new Error('No se pudo cargar el mapa. Revisa tu conexión.')) }
    document.head.appendChild(s)
  })
  return leafletPromise
}

function textNode(text: string): HTMLElement {
  const el = document.createElement('span')
  el.textContent = text
  return el
}

/* ---------------------------------- Página ----------------------------------- */

export default function MapRoutes() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = user?.role === 'dueno' || user?.role === 'admin'

  const [tab, setTab] = useState<Tab>('cobertura')
  const [period, setPeriod] = useState<Period>('7d')
  const [day, setDay] = useState(toInput(new Date()))
  const [sellerId, setSellerId] = useState('')
  const [customers, setCustomers] = useState<Cust[]>([])
  const [locs, setLocs] = useState<Loc[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [sales, setSales] = useState<SaleLite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mapError, setMapError] = useState('')
  const [lReady, setLReady] = useState(false)
  const [selected, setSelected] = useState<Selected>(null)
  const [placing, setPlacing] = useState<string | null>(null)
  const [isFs, setIsFs] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [showBars, setShowBars] = useState(false)
  const [barMetric, setBarMetric] = useState<BarMetric>('monto')
  const [onlyPending, setOnlyPending] = useState(false)
  const [dormDays, setDormDays] = useState(30)
  const [dormSrc, setDormSrc] = useState<DormSrc | null>(null)
  const [showRoute, setShowRoute] = useState(false)
  const [routeN, setRouteN] = useState(10)

  const mapDiv = useRef<HTMLDivElement>(null)
  const mapBox = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)
  const focusRef = useRef<any>(null)
  const placingRef = useRef<string | null>(null)
  const savePlacementRef = useRef<(lat: number, lng: number) => void>(() => {})
  const lastFit = useRef('')

  /* ------------------------------- Carga de datos ------------------------------ */

  useEffect(() => {
    if (!isManager) return
    let alive = true
    ;(async () => {
      try {
        const [c, l] = await Promise.all([
          fetchAll<Cust>((a, b) => supabase.from('customers').select('id,name,address,phone').order('name').range(a, b)),
          fetchAll<Loc>((a, b) => supabase.from('customer_locations').select('customer_id,lat,lng').order('customer_id').range(a, b)),
        ])
        if (alive) { setCustomers(c); setLocs(l) }
      } catch (e: any) { if (alive) setError(e.message || 'Error al cargar clientes') }
    })()
    return () => { alive = false }
  }, [isManager, reloadKey])

  const range = useMemo(() => {
    if (tab === 'rutas') {
      const s = new Date(day + 'T00:00:00')
      const e = new Date(s); e.setDate(e.getDate() + 1)
      return { from: s.toISOString(), to: e.toISOString() }
    }
    const s = startOfPeriod(period)
    return { from: s ? s.toISOString() : null, to: null as string | null }
  }, [tab, period, day])

  useEffect(() => {
    if (!isManager) return
    let alive = true
    setLoading(true); setError('')
    ;(async () => {
      try {
        const v = await fetchAll<Visit>((a, b) => {
          let q = supabase.from('visits').select('*').order('created_at', { ascending: true }).range(a, b)
          if (range.from) q = q.gte('created_at', range.from)
          if (range.to) q = q.lt('created_at', range.to)
          return q
        })
        const s = await fetchAll<SaleLite>((a, b) => {
          let q = supabase.from('sales').select('id,total,status').order('created_at', { ascending: true }).range(a, b)
          if (range.from) q = q.gte('created_at', range.from)
          if (range.to) q = q.lt('created_at', range.to)
          return q
        })
        if (alive) { setVisits(v); setSales(s) }
      } catch (e: any) { if (alive) setError(e.message || 'Error al cargar visitas') }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [isManager, range, reloadKey])

  useEffect(() => {
    if (!isManager || tab !== 'dormidos') return
    let alive = true
    ;(async () => {
      try {
        const [v, sa] = await Promise.all([
          fetchAll<{ customer_id: string | null; created_at: string; seller_name: string | null }>((a, b) => supabase.from('visits').select('customer_id,created_at,seller_name').order('created_at', { ascending: true }).range(a, b)),
          fetchAll<{ customer_id: string | null; created_at: string; status: string }>((a, b) => supabase.from('sales').select('customer_id,created_at,status').order('created_at', { ascending: true }).range(a, b)),
        ])
        if (alive) setDormSrc({ visits: v, sales: sa })
      } catch (e: any) { if (alive) setError(e.message || 'Error al cargar el historial') }
    })()
    return () => { alive = false }
  }, [isManager, tab, reloadKey])

  /* ---------------------------------- Mapa ------------------------------------ */

  useEffect(() => {
    if (!isManager) return
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled || !mapDiv.current || mapRef.current) return
      const map = L.map(mapDiv.current).setView([4.65, -74.1], 5)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap',
      }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      map.on('click', (ev: any) => { if (placingRef.current) savePlacementRef.current(ev.latlng.lat, ev.latlng.lng) })
      mapRef.current = map
      setLReady(true)
    }).catch(e => { if (!cancelled) setMapError(e.message) })
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; setLReady(false) }
    }
  }, [isManager])

  useEffect(() => {
    const onFs = () => {
      setIsFs(!!document.fullscreenElement)
      setTimeout(() => mapRef.current?.invalidateSize(), 150)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else mapBox.current?.requestFullscreen?.()
  }

  /* --------------------------------- Derivados -------------------------------- */

  const locMap = useMemo(() => new Map(locs.map(l => [l.customer_id, l])), [locs])
  const custMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers])
  const saleMap = useMemo(() => new Map(sales.map(s => [s.id, s])), [sales])

  const sellers = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of visits) if (!m.has(v.seller_id)) m.set(v.seller_id, v.seller_name || 'Vendedor')
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
  }, [visits])
  const sellerColor = (id: string) => SELLER_COLORS[Math.max(0, sellers.findIndex(s => s.id === id)) % SELLER_COLORS.length]
  const sellerName = (id: string) => sellers.find(s => s.id === id)?.name || 'Vendedor'

  const filtered = useMemo(() => visits.filter(v => !sellerId || v.seller_id === sellerId), [visits, sellerId])

  const cov = useMemo(() => {
    const m = new Map<string, CovInfo>()
    for (const v of filtered) {
      if (!v.customer_id) continue
      const sale = v.sale_id ? saleMap.get(v.sale_id) : undefined
      const validSale = v.kind === 'venta' && !(sale && sale.status === 'anulada')
      const cur = m.get(v.customer_id) ?? { venta: false, presencial: false, visita: false, last: v, total: 0, count: 0, ventas: 0 }
      if (validSale) {
        cur.venta = true; cur.ventas++
        if (v.at_establishment === true) cur.presencial = true
      } else cur.visita = true
      if (v.created_at > cur.last.created_at) cur.last = v
      if (sale && sale.status !== 'anulada') cur.total += Number(sale.total)
      cur.count++
      m.set(v.customer_id, cur)
    }
    return m
  }, [filtered, saleMap])

  const custStatus = (id: string): Status => {
    const c = cov.get(id)
    if (!c) return 'sin'
    if (c.presencial) return 'venta'
    if (c.venta) return 'remoto'
    return 'visita'
  }

  const located = customers.filter(c => locMap.has(c.id))
  const unlocated = customers.filter(c => !locMap.has(c.id))
  const nVenta = located.filter(c => custStatus(c.id) === 'venta').length
  const nRemoto = located.filter(c => custStatus(c.id) === 'remoto').length
  const nVisita = located.filter(c => custStatus(c.id) === 'visita').length
  const nSin = located.length - nVenta - nRemoto - nVisita
  const visitedAll = customers.filter(c => cov.has(c.id)).length
  const coveragePct = customers.length ? Math.round((visitedAll * 100) / customers.length) : 0

  const barData = useMemo(() => {
    const rows: { id: string; name: string; value: number; total: number; ventas: number; pct: number; h: number }[] = []
    customers.forEach(c => {
      const info = cov.get(c.id)
      if (!info || info.ventas === 0 || !locMap.has(c.id)) return
      rows.push({ id: c.id, name: c.name, value: barMetric === 'monto' ? info.total : info.ventas, total: info.total, ventas: info.ventas, pct: 0, h: 0 })
    })
    const sum = rows.reduce((a, r) => a + r.value, 0)
    const max = rows.reduce((a, r) => Math.max(a, r.value), 0)
    rows.forEach(r => {
      r.pct = sum > 0 ? (r.value * 100) / sum : 0
      r.h = max > 0 ? 24 + (r.value / max) * 120 : 24
    })
    rows.sort((a, b) => b.value - a.value)
    return rows
  }, [customers, cov, locMap, barMetric])

  const dormRows = useMemo((): DormRow[] => {
    if (!dormSrc) return []
    const lastSale = new Map<string, string>()
    const lastVisit = new Map<string, { at: string; seller: string | null }>()
    for (const x of dormSrc.sales) {
      if (!x.customer_id || x.status === 'anulada') continue
      const cur = lastSale.get(x.customer_id)
      if (!cur || x.created_at > cur) lastSale.set(x.customer_id, x.created_at)
    }
    for (const x of dormSrc.visits) {
      if (!x.customer_id) continue
      const cur = lastVisit.get(x.customer_id)
      if (!cur || x.created_at > cur.at) lastVisit.set(x.customer_id, { at: x.created_at, seller: x.seller_name })
    }
    const now = Date.now()
    const rows = customers.map(c => {
      const ls = lastSale.get(c.id) ?? null
      const lv = lastVisit.get(c.id) ?? null
      const lastAny = ls && lv ? (ls > lv.at ? ls : lv.at) : ls ?? lv?.at ?? null
      const days = lastAny ? Math.floor((now - new Date(lastAny).getTime()) / 86400000) : null
      return { c, ls, lv, days }
    })
    return rows
      .filter(r => r.days === null || r.days >= dormDays)
      .sort((a, b) => (a.days === null ? 1e9 : a.days) < (b.days === null ? 1e9 : b.days) ? 1 : -1)
  }, [dormSrc, customers, dormDays])

  // Ruta sugerida: empieza en el cliente más atrasado con ubicación y sigue siempre al más cercano.
  const dormRoute = useMemo(() => {
    const cand = dormRows.filter(r => locMap.has(r.c.id)).slice(0, routeN)
    const order: DormRow[] = []
    let dist = 0
    if (cand.length === 0) return { order, dist, legs: [] as number[] }
    const left = cand.slice()
    order.push(left.shift() as DormRow)
    const legs: number[] = []
    while (left.length) {
      const last = locMap.get(order[order.length - 1].c.id) as Loc
      let bi = 0, bd = Infinity
      left.forEach((r, i) => {
        const l = locMap.get(r.c.id) as Loc
        const d = haversine([last.lat, last.lng], [l.lat, l.lng])
        if (d < bd) { bd = d; bi = i }
      })
      dist += bd; legs.push(bd)
      order.push(left.splice(bi, 1)[0])
    }
    return { order, dist, legs }
  }, [dormRows, locMap, routeN])

  const alerts = useMemo(
    () => filtered.filter(v => v.flag !== 'ok').sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [filtered],
  )

  const bySeller = useMemo(() => {
    const m = new Map<string, Visit[]>()
    for (const v of filtered) { const list = m.get(v.seller_id) ?? []; list.push(v); m.set(v.seller_id, list) }
    return m
  }, [filtered])

  const routeStats = useMemo(() => {
    const entries: [string, Visit[]][] = []
    bySeller.forEach((list: Visit[], sid: string) => { entries.push([sid, list]) })
    return entries.map(([sid, list]: [string, Visit[]]) => {
      const pts = list.filter(v => v.lat != null && v.lng != null).map(v => [v.lat as number, v.lng as number] as [number, number])
      let dist = 0
      for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i])
      let total = 0
      for (const v of list) {
        const s = v.sale_id ? saleMap.get(v.sale_id) : undefined
        if (s && s.status !== 'anulada') total += Number(s.total)
      }
      return { sid, list, dist, total, first: list[0]?.created_at, last: list[list.length - 1]?.created_at }
    })
  }, [bySeller, saleMap])

  /* --------------------------------- Dibujo ----------------------------------- */

  useEffect(() => {
    const L = (window as any).L
    const map = mapRef.current
    const layer = layerRef.current
    if (!lReady || !L || !map || !layer) return
    layer.clearLayers()
    const pts: [number, number][] = []

    if (tab === 'cobertura') {
      for (const c of customers) {
        const loc = locMap.get(c.id)
        if (!loc) continue
        const st = custStatus(c.id)
        const isSel = selected?.kind === 'customer' && selected.id === c.id
        const dim = onlyPending && st !== 'sin'
        if (st === 'sin') {
          L.circleMarker([loc.lat, loc.lng], { radius: 17, color: STATUS_COLOR.sin, weight: 1, dashArray: '3 3', fillColor: STATUS_COLOR.sin, fillOpacity: 0.15, interactive: false }).addTo(layer)
        }
        const m = L.circleMarker([loc.lat, loc.lng], {
          radius: isSel ? 13 : dim ? 5 : st === 'sin' ? 11 : 9,
          color: '#ffffff', weight: 2, fillColor: STATUS_COLOR[st], fillOpacity: dim ? 0.3 : 0.95,
        })
        m.bindTooltip(textNode(c.name + ' · ' + STATUS_LABEL[st]))
        m.on('click', () => setSelected({ kind: 'customer', id: c.id }))
        m.addTo(layer)
        pts.push([loc.lat, loc.lng])
      }
      if (showBars) {
        barData.forEach(r => {
          const loc = locMap.get(r.id)
          if (!loc) return
          const w = 22, d = 10, lab = 18
          const totalH = r.h + d + lab
          const hue = Math.max(0, 140 - Math.round(r.pct * 3))
          const face = `hsl(${hue},70%,45%)`, side = `hsl(${hue},70%,32%)`, top = `hsl(${hue},70%,62%)`
          const icon = L.divIcon({
            className: '',
            html: `<div style="position:relative;width:${w + d}px;height:${totalH}px">`
              + `<div style="position:absolute;left:0;bottom:0;width:${w}px;height:${r.h}px;background:${face}"></div>`
              + `<div style="position:absolute;left:${w}px;bottom:0;width:${d}px;height:${r.h}px;background:${side};transform:skewY(-45deg);transform-origin:left bottom"></div>`
              + `<div style="position:absolute;left:0;bottom:${r.h}px;width:${w}px;height:${d}px;background:${top};transform:skewX(-45deg);transform-origin:left bottom"></div>`
              + `<div style="position:absolute;left:50%;bottom:${r.h + d + 2}px;transform:translateX(-50%);background:#fff;border:1px solid #334155;border-radius:4px;padding:0 3px;font:bold 11px Arial;color:#0f172a;white-space:nowrap">${r.pct.toFixed(r.pct >= 10 ? 0 : 1)}%</div>`
              + `</div>`,
            iconSize: [w + d, totalH], iconAnchor: [w / 2, totalH],
          })
          const mk = L.marker([loc.lat, loc.lng], { icon })
          mk.bindTooltip(textNode(`${r.name} · ${r.pct.toFixed(1)}% · ${money(r.total)} · ${r.ventas} pedido(s)`))
          mk.on('click', () => setSelected({ kind: 'customer', id: r.id }))
          mk.addTo(layer)
        })
      }
    } else if (tab === 'dormidos') {
      const dormMap = new Map<string, DormRow>()
      dormRows.forEach(r => { dormMap.set(r.c.id, r) })
      for (const c of customers) {
        const loc = locMap.get(c.id)
        if (!loc) continue
        const r = dormMap.get(c.id)
        const isSel = selected?.kind === 'customer' && selected.id === c.id
        if (!r) {
          L.circleMarker([loc.lat, loc.lng], { radius: 4, color: '#ffffff', weight: 1, fillColor: '#94a3b8', fillOpacity: 0.8, interactive: false }).addTo(layer)
          continue
        }
        const color = r.days === null ? '#7c3aed' : r.days >= dormDays * 2 ? '#dc2626' : '#d97706'
        const m = L.circleMarker([loc.lat, loc.lng], { radius: isSel ? 14 : 10, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 0.95 })
        m.bindTooltip(textNode(c.name + ' · ' + (r.days === null ? 'nunca atendido' : `${r.days} días sin atender`)))
        m.on('click', () => setSelected({ kind: 'customer', id: c.id }))
        m.addTo(layer)
        pts.push([loc.lat, loc.lng])
      }
      if (showRoute && dormRoute.order.length) {
        const line: [number, number][] = []
        dormRoute.order.forEach((r, i) => {
          const l = locMap.get(r.c.id)
          if (!l) return
          line.push([l.lat, l.lng])
          const icon = L.divIcon({
            className: '',
            html: `<div style="width:26px;height:26px;border-radius:50%;background:#111827;color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font:bold 12px Arial;box-shadow:0 1px 3px rgba(0,0,0,.4)">${i + 1}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13],
          })
          const mk = L.marker([l.lat, l.lng], { icon })
          mk.bindTooltip(textNode(`${i + 1}. ${r.c.name}`))
          mk.addTo(layer)
        })
        if (line.length > 1) L.polyline(line, { color: '#111827', weight: 3, opacity: 0.85, dashArray: '6 6' }).addTo(layer)
      }
    } else {
      bySeller.forEach((list: Visit[], sid: string) => {
        const color = sellerColor(sid)
        const line: [number, number][] = []
        list.forEach((v: Visit, i: number) => {
          if (v.lat == null || v.lng == null) return
          line.push([v.lat, v.lng])
          const sel = selected?.kind === 'visit' && selected.id === v.id
          const icon = L.divIcon({
            className: '',
            html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;border:2px solid ${sel ? '#111827' : '#fff'};display:flex;align-items:center;justify-content:center;font:bold 12px Arial;box-shadow:0 1px 3px rgba(0,0,0,.4)">${i + 1}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13],
          })
          const mk = L.marker([v.lat, v.lng], { icon })
          mk.on('click', () => setSelected({ kind: 'visit', id: v.id }))
          mk.addTo(layer)
        })
        if (line.length > 1) L.polyline(line, { color, weight: 3, opacity: 0.8 }).addTo(layer)
        pts.push(...line)
      })
    }

    const key = `${tab}|${period}|${day}|${sellerId}|${reloadKey}|${customers.length}|${locs.length}|${visits.length}|${dormDays}|${dormRows.length}|${showRoute}|${routeN}`
    if (lastFit.current !== key && pts.length) {
      map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 })
      lastFit.current = key
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lReady, tab, customers, locMap, cov, bySeller, selected, sellers, showBars, barData, onlyPending, dormRows, dormDays, showRoute, dormRoute])

  useEffect(() => { setTimeout(() => mapRef.current?.invalidateSize(), 100) }, [tab, isFs])

  function focusPoint(lat: number, lng: number) {
    const L = (window as any).L
    const map = mapRef.current
    if (!L || !map) return
    if (focusRef.current) { focusRef.current.remove(); focusRef.current = null }
    focusRef.current = L.circleMarker([lat, lng], { radius: 16, color: '#f59e0b', weight: 3, fillOpacity: 0.1 }).addTo(map)
    map.setView([lat, lng], Math.max(map.getZoom(), 16))
  }

  /* ----------------------------- Corregir ubicación ---------------------------- */

  function startPlacing(id: string) {
    placingRef.current = id
    setPlacing(id)
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function stopPlacing() { placingRef.current = null; setPlacing(null) }

  savePlacementRef.current = async (lat: number, lng: number) => {
    const id = placingRef.current
    if (!id) return
    const name = custMap.get(id)?.name ?? 'el cliente'
    if (!confirm(`¿Guardar esta ubicación para ${name}?`)) return
    const { error: err } = await supabase.from('customer_locations').upsert(
      { customer_id: id, lat, lng, source: 'manual', set_at: new Date().toISOString() },
      { onConflict: 'customer_id' },
    )
    if (err) { alert('No se pudo guardar: ' + err.message); return }
    stopPlacing()
    setReloadKey(k => k + 1)
  }

  /* --------------------------------- Interfaz --------------------------------- */

  if (!isManager) {
    return <p className="text-sm text-slate-500">Esta sección es solo para el dueño o el administrador.</p>
  }

  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${active ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`

  const selCustomer = selected?.kind === 'customer' ? custMap.get(selected.id) : undefined
  const selVisit = selected?.kind === 'visit' ? visits.find(v => v.id === selected.id) : undefined

  return (
    <div>
      <style>{PRINT_CSS}</style>

      <div className="no-print mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Mapa y rutas</h1>
          <p className="text-sm text-slate-500 mt-1">Clientes atendidos y rutas reales de tus vendedores</p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 shrink-0">
          <Printer className="w-4 h-4" /> Imprimir
        </button>
      </div>

      <div className="no-print flex gap-2 mb-3 overflow-x-auto">
        <button onClick={() => { setTab('cobertura'); setSelected(null) }} className={btn(tab === 'cobertura')}><span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" /> Cobertura</span></button>
        <button onClick={() => { setTab('rutas'); setSelected(null) }} className={btn(tab === 'rutas')}><span className="inline-flex items-center gap-1.5"><Navigation className="w-4 h-4" /> Rutas</span></button>
        <button onClick={() => { setTab('dormidos'); setSelected(null) }} className={btn(tab === 'dormidos')}><span className="inline-flex items-center gap-1.5"><Moon className="w-4 h-4" /> Dormidos</span></button>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
        {tab === 'cobertura' ? (
          <div className="flex gap-2 overflow-x-auto">
            {PERIODS.map(p => <button key={p.id} onClick={() => setPeriod(p.id)} className={btn(period === p.id)}>{p.label}</button>)}
          </div>
        ) : tab === 'dormidos' ? (
          <select value={dormDays} onChange={e => setDormDays(Number(e.target.value))} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white">
            <option value={7}>Sin atender hace 7+ días</option>
            <option value={15}>Sin atender hace 15+ días</option>
            <option value={30}>Sin atender hace 30+ días</option>
            <option value={60}>Sin atender hace 60+ días</option>
            <option value={90}>Sin atender hace 90+ días</option>
          </select>
        ) : (
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        )}
        {tab !== 'dormidos' && (
          <select value={sellerId} onChange={e => setSellerId(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white">
            <option value="">Todos los vendedores</option>
            {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {tab === 'dormidos' && (
          <>
            <button onClick={() => setShowRoute(v => !v)} className={btn(showRoute)}>
              <span className="inline-flex items-center gap-1.5"><Navigation className="w-4 h-4" /> Ruta sugerida</span>
            </button>
            {showRoute && (
              <select value={routeN} onChange={e => setRouteN(Number(e.target.value))} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white">
                <option value={5}>5 paradas</option>
                <option value={8}>8 paradas</option>
                <option value={10}>10 paradas</option>
                <option value={15}>15 paradas</option>
              </select>
            )}
          </>
        )}
        {tab === 'cobertura' && (
          <>
            <button onClick={() => setOnlyPending(v => !v)} className={btn(onlyPending)}>
              <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Resaltar sin atender</span>
            </button>
            <button onClick={() => setShowBars(v => !v)} className={btn(showBars)}>
              <span className="inline-flex items-center gap-1.5"><BarChart3 className="w-4 h-4" /> % de ventas</span>
            </button>
            {showBars && (
              <select value={barMetric} onChange={e => setBarMetric(e.target.value as BarMetric)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white">
                <option value="monto">Por monto vendido</option>
                <option value="pedidos">Por frecuencia (pedidos)</option>
              </select>
            )}
          </>
        )}
        {loading && <span className="flex items-center gap-1 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</span>}
      </div>

      {error && <div className="no-print text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">{error}</div>}
      {mapError && <div className="no-print text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">{mapError}</div>}

      {placing && (
        <div className="no-print flex items-center justify-between gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs">
          <span>Toca el mapa donde está <strong>{custMap.get(placing)?.name}</strong> para fijar su ubicación.</span>
          <button onClick={stopPlacing} className="font-medium underline shrink-0">Cancelar</button>
        </div>
      )}

      <div className="map-print">
        <div className="mb-3">
          <p className="text-sm font-bold text-slate-800">
            {tab === 'cobertura'
              ? `Cobertura de clientes · ${PERIODS.find(p => p.id === period)?.label}`
              : tab === 'dormidos'
                ? `Clientes dormidos · sin atender hace ${dormDays}+ días`
                : `Ruta del ${new Date(day + 'T00:00:00').toLocaleDateString()}`}
            {tab !== 'dormidos' && sellerId ? ` · ${sellerName(sellerId)}` : ''}
          </p>
        </div>

        {tab === 'cobertura' && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase">Cobertura</p><p className="text-lg font-bold text-slate-800">{coveragePct}%</p><p className="text-[11px] text-slate-400">{visitedAll} de {customers.length} clientes</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_COLOR.venta }} /> Presencial</p><p className="text-lg font-bold text-slate-800">{nVenta}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_COLOR.remoto }} /> No presencial</p><p className="text-lg font-bold text-slate-800">{nRemoto}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_COLOR.visita }} /> Sin compra</p><p className="text-lg font-bold text-slate-800">{nVisita}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_COLOR.sin }} /> Sin atender</p><p className="text-lg font-bold text-slate-800">{nSin}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase">Sin ubicación</p><p className="text-lg font-bold text-slate-800">{unlocated.length}</p></div>
          </div>
        )}

        {tab === 'dormidos' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase">Dormidos</p><p className="text-lg font-bold text-slate-800">{dormRows.length}</p><p className="text-[11px] text-slate-400">de {customers.length} clientes</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#d97706' }} /> Recientes</p><p className="text-lg font-bold text-slate-800">{dormRows.filter(r => r.days !== null && r.days < dormDays * 2).length}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#dc2626' }} /> Muy atrasados</p><p className="text-lg font-bold text-slate-800">{dormRows.filter(r => r.days !== null && r.days >= dormDays * 2).length}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400 uppercase flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#7c3aed' }} /> Nunca atendidos</p><p className="text-lg font-bold text-slate-800">{dormRows.filter(r => r.days === null).length}</p></div>
          </div>
        )}

        <div ref={mapBox} className="relative z-0 bg-white" style={{ isolation: 'isolate' }}>
          <div className="no-print absolute right-2 top-2 z-[500]">
            <button onClick={toggleFullscreen} title="Pantalla completa" className="p-2 rounded-lg bg-white border border-slate-300 shadow hover:bg-slate-50"><Maximize2 className="w-4 h-4 text-slate-700" /></button>
          </div>
          <div ref={mapDiv} className="w-full rounded-xl border border-slate-200" style={{ height: isFs ? '100vh' : 'min(60vh, 520px)', minHeight: 320 }} />
        </div>

        {tab === 'dormidos' && showRoute && dormRoute.order.length > 0 && (
          <div className="mt-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-600 uppercase flex items-center justify-between gap-2">
              <span>Ruta sugerida · {dormRoute.order.length} paradas · ≈ {fmtKm(dormRoute.dist)}</span>
              <a
                className="no-print normal-case font-medium text-slate-700 underline shrink-0"
                target="_blank" rel="noopener noreferrer"
                href={'https://www.google.com/maps/dir/' + dormRoute.order.map(r => { const l = locMap.get(r.c.id) as Loc; return `${l.lat},${l.lng}` }).join('/')}
              >Abrir en Google Maps</a>
            </div>
            <div className="divide-y divide-slate-100">
              {dormRoute.order.map((r, i) => (
                <div key={r.c.id} className="px-4 py-2 flex items-start gap-3">
                  <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold shrink-0">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-800 truncate">{r.c.name}</span>
                    <span className="block text-xs text-slate-400 truncate">
                      {r.days === null ? 'Nunca atendido' : `Hace ${r.days} días`}
                      {r.c.address ? ` · ${r.c.address}` : ''}
                      {i > 0 ? ` · a ${fmtKm(dormRoute.legs[i - 1])} de la parada anterior` : ' · punto de partida'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="px-4 py-2 text-[11px] text-slate-400">Se toman los clientes más atrasados que tienen ubicación y se ordenan por cercanía. Las distancias son en línea recta, no por calles.</p>
          </div>
        )}

        {tab === 'dormidos' && (
          <div className="mt-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-600 uppercase">Lista para reasignar ({dormRows.length})</div>
            <div className="divide-y divide-slate-100">
              {!dormSrc && <p className="px-4 py-6 text-center text-sm text-slate-400">Cargando…</p>}
              {dormRows.slice(0, 100).map(r => {
                const loc = locMap.get(r.c.id)
                const tel = (r.c.phone || '').replace(/[^\d+]/g, '')
                return (
                  <div key={r.c.id} className="px-4 py-2 flex items-start justify-between gap-3">
                    <button
                      onClick={() => { setSelected({ kind: 'customer', id: r.c.id }); if (loc) focusPoint(loc.lat, loc.lng) }}
                      className="min-w-0 text-left flex-1"
                    >
                      <span className="block text-sm text-slate-800 truncate">{r.c.name}</span>
                      <span className="block text-xs text-slate-400">
                        {r.days === null ? 'Nunca atendido' : `Hace ${r.days} días`}
                        {r.ls ? ` · última venta ${new Date(r.ls).toLocaleDateString()}` : ''}
                        {r.lv ? ` · última visita ${new Date(r.lv.at).toLocaleDateString()}${r.lv.seller ? ' (' + r.lv.seller + ')' : ''}` : ''}
                      </span>
                      <span className="block text-xs text-slate-400 truncate">{[r.c.address, r.c.phone].filter(Boolean).join(' · ') || 'Sin dirección'}{loc ? '' : ' · sin ubicación'}</span>
                    </button>
                    {tel && <a href={`tel:${tel}`} className="no-print shrink-0 flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded"><Phone className="w-3 h-3" /> Llamar</a>}
                  </div>
                )
              })}
              {dormSrc && dormRows.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Todos tus clientes fueron atendidos en este plazo 🎉</p>}
              {dormRows.length > 100 && <p className="px-4 py-2 text-xs text-slate-400">Se muestran los 100 más atrasados.</p>}
            </div>
          </div>
        )}

        {tab === 'rutas' && (
          <div className="mt-4 space-y-4">
            {routeStats.length === 0 && !loading && <p className="text-sm text-slate-400 text-center py-6">No hay visitas registradas ese día</p>}
            {routeStats.map(r => (
              <div key={r.sid} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: sellerColor(r.sid) }} />
                    <p className="font-medium text-slate-800">{sellerName(r.sid)}</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {r.list.length} visitas · {fmtKm(r.dist)} aprox. · {r.first ? fmtTime(r.first) : ''}–{r.last ? fmtTime(r.last) : ''} · vendió {money(r.total)}
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {r.list.map((v: Visit, i: number) => {
                    const sale = v.sale_id ? saleMap.get(v.sale_id) : undefined
                    return (
                      <button
                        key={v.id}
                        onClick={() => { setSelected({ kind: 'visit', id: v.id }); if (v.lat != null && v.lng != null) focusPoint(v.lat, v.lng) }}
                        className="w-full text-left px-4 py-2 flex items-start gap-3 hover:bg-slate-50"
                      >
                        <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold shrink-0" style={{ background: sellerColor(r.sid) }}>{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-slate-800 truncate">{v.customer_id ? custMap.get(v.customer_id)?.name ?? 'Cliente' : 'Cliente general'}</span>
                          <span className="block text-xs text-slate-400">
                            {fmtTime(v.created_at)} · {v.kind === 'venta' ? 'Venta' : 'Visita sin venta'}
                            {sale ? ` · ${money(sale.total)}${sale.status === 'anulada' ? ' (anulada)' : ''}` : ''}
                            {v.flag !== 'ok' ? ` · ${flagLabel(v.flag)}` : ''}
                          </span>
                          {v.note && <span className="block text-xs text-slate-500 italic">“{v.note}”</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {tab === 'cobertura' && showBars && (
        <div className="no-print mt-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-600 uppercase">
            Ranking de establecimientos · {barMetric === 'monto' ? 'por monto vendido' : 'por frecuencia de pedidos'}
          </div>
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {barData.slice(0, 15).map((r, i) => (
              <button key={r.id} onClick={() => { setSelected({ kind: 'customer', id: r.id }); const l = locMap.get(r.id); if (l) focusPoint(l.lat, l.lng) }} className="w-full text-left px-4 py-2 hover:bg-slate-50">
                <span className="flex items-center justify-between gap-2 text-sm text-slate-800">
                  <span className="truncate">{i + 1}. {r.name}</span>
                  <span className="font-bold shrink-0">{r.pct.toFixed(1)}%</span>
                </span>
                <span className="block h-1.5 bg-slate-100 rounded mt-1"><span className="block h-1.5 rounded bg-slate-700" style={{ width: `${Math.max(2, r.pct)}%` }} /></span>
                <span className="block text-xs text-slate-400 mt-1">{money(r.total)} · {r.ventas} pedido(s)</span>
              </button>
            ))}
            {barData.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Aún no hay ventas con ubicación en este período</p>}
          </div>
        </div>
      )}

      {tab !== 'dormidos' && (selCustomer || selVisit) && (
        <div className="no-print mt-4 bg-white rounded-xl border border-slate-200 p-4">
          {selCustomer && (() => {
            const st = custStatus(selCustomer.id)
            const info = cov.get(selCustomer.id)
            return (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-800">{selCustomer.name}</p>
                    <p className="text-xs text-slate-500">{[selCustomer.address, selCustomer.phone].filter(Boolean).join(' · ') || 'Sin dirección'}</p>
                  </div>
                  <span className="text-xs font-medium px-2 py-1 rounded text-white whitespace-nowrap" style={{ background: STATUS_COLOR[st] }}>{STATUS_LABEL[st]}</span>
                </div>
                {info && (
                  <p className="text-xs text-slate-500 mt-2">
                    {info.count} visita(s) · última {fmtDateTime(info.last.created_at)} por {info.last.seller_name || 'vendedor'} · vendido {money(info.total)}
                    {info.last.note ? ` · “${info.last.note}”` : ''}
                  </p>
                )}
                <button onClick={() => startPlacing(selCustomer.id)} className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded">
                  <MapPin className="w-3.5 h-3.5" /> Corregir ubicación en el mapa
                </button>
              </div>
            )
          })()}
          {selVisit && (
            <div>
              <p className="font-bold text-slate-800">{selVisit.customer_id ? custMap.get(selVisit.customer_id)?.name ?? 'Cliente' : 'Cliente general'}</p>
              <p className="text-xs text-slate-500">
                {fmtDateTime(selVisit.created_at)} · {selVisit.seller_name || 'Vendedor'} · {selVisit.kind === 'venta' ? 'Venta' : 'Visita sin venta'}
                {selVisit.accuracy_m != null ? ` · precisión ±${Math.round(selVisit.accuracy_m)} m` : ''}
              </p>
              <p className="text-xs mt-1 text-slate-500">
                {selVisit.at_establishment === true ? 'Dijo estar en el establecimiento' : selVisit.at_establishment === false ? 'Dijo NO estar en el establecimiento' : 'Sin respuesta (sin GPS)'}
                {selVisit.distance_to_customer_m != null ? ` · a ${fmtKm(selVisit.distance_to_customer_m)} de la ubicación del cliente` : ''}
              </p>
              {selVisit.flag !== 'ok' && <p className="text-xs mt-1 text-amber-700">Revisión: {flagLabel(selVisit.flag)}</p>}
              {selVisit.note && <p className="text-xs mt-1 text-slate-600 italic">“{selVisit.note}”</p>}
            </div>
          )}
        </div>
      )}

      {tab === 'cobertura' && (
        <div className="no-print grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-600 uppercase flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Visitas para revisar ({alerts.length})</div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {alerts.map((v: Visit) => (
                <button
                  key={v.id}
                  onClick={() => { setSelected({ kind: 'visit', id: v.id }); if (v.lat != null && v.lng != null) focusPoint(v.lat, v.lng) }}
                  className="w-full text-left px-4 py-2 hover:bg-slate-50"
                >
                  <span className="block text-sm text-slate-800 truncate">{v.customer_id ? custMap.get(v.customer_id)?.name ?? 'Cliente' : 'Cliente general'}</span>
                  <span className="block text-xs text-slate-400">{fmtDateTime(v.created_at)} · {v.seller_name || 'Vendedor'} · {flagLabel(v.flag)}</span>
                  {v.note && <span className="block text-xs text-slate-500 italic">“{v.note}”</span>}
                </button>
              ))}
              {alerts.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Sin visitas para revisar</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-600 uppercase">Clientes sin ubicación ({unlocated.length})</div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {unlocated.map(c => (
                <div key={c.id} className="px-4 py-2 flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-800 truncate">{c.name}</span>
                    {c.address && <span className="block text-xs text-slate-400 truncate">{c.address}</span>}
                  </span>
                  <button onClick={() => startPlacing(c.id)} className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded whitespace-nowrap">Ubicar en el mapa</button>
                </div>
              ))}
              {unlocated.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Todos los clientes tienen ubicación</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
