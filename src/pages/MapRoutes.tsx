import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import {
  Printer,
  Maximize2,
  MapPin,
  AlertTriangle,
  Loader2,
  Users,
  Navigation,
  BarChart3,
  Moon,
  Phone,
  Truck,
  Clock,
  Play,
  Pause,
  RotateCcw,
  Radio,
  Compass,
  Calendar,
  FastForward,
  CheckCircle2,
  Share2,
  ShieldCheck,
  Gauge,
  Activity,
} from 'lucide-react'
import {
  getFleetLiveTelemetry,
  startNativeDeviceTracking,
  stopNativeDeviceTracking,
  getRouteHistories,
  getRouteHistoryById,
  type VehicleRouteHistory,
  type LiveVehicleTelemetry,
} from '../lib/geoTrackingService'
import { getFleetVehicles } from '../lib/fleetRepo'
import type { FleetVehicle } from '../types'

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

type Tab = 'cobertura' | 'rutas' | 'dormidos' | 'flota_vivo' | 'historial'
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

  // Estados para Telemetría y Flota en Vivo (GPS)
  const [telemetries, setTelemetries] = useState<LiveVehicleTelemetry[]>(() => getFleetLiveTelemetry())
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('all')
  const [isTransmittingGps, setIsTransmittingGps] = useState(false)
  const [transmittingInfo, setTransmittingInfo] = useState<string | null>(null)
  const [simulatingMovement, setSimulatingMovement] = useState(false)

  // Estados para Historial de Rutas Recorridas
  const [histories, setHistories] = useState<VehicleRouteHistory[]>(() => getRouteHistories())
  const [historyVehicleId, setHistoryVehicleId] = useState<string>('all')
  const [historyDate, setHistoryDate] = useState<string>(toInput(new Date()))
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>(() => {
    const list = getRouteHistories()
    return list[0]?.id || ''
  })
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(2)

  // Actualizar telemetría de flota periódicamente
  useEffect(() => {
    if (tab !== 'flota_vivo') return
    const interval = setInterval(() => {
      setTelemetries(getFleetLiveTelemetry())
    }, 4000)
    return () => clearInterval(interval)
  }, [tab])

  // Simulación de movimiento de vehículos en vivo
  useEffect(() => {
    if (!simulatingMovement || tab !== 'flota_vivo') return
    const timer = setInterval(() => {
      setTelemetries(prev =>
        prev.map(t => {
          if (t.vehicle.status !== 'en_ruta' && t.vehicle.id !== 'veh-1') return t
          const dLat = (Math.random() - 0.48) * 0.001
          const dLng = (Math.random() - 0.48) * 0.001
          return {
            ...t,
            current_lat: t.current_lat + dLat,
            current_lng: t.current_lng + dLng,
            speed_kmh: Math.round(30 + Math.random() * 25),
            heading_deg: Math.round((t.heading_deg + Math.random() * 20 - 10 + 360) % 360),
            last_ping: new Date().toISOString(),
          }
        })
      )
    }, 1500)
    return () => clearInterval(timer)
  }, [simulatingMovement, tab])

  // Ruta seleccionada en el historial
  const selectedHistory = useMemo(() => {
    return histories.find(h => h.id === selectedHistoryId) || histories[0] || null
  }, [histories, selectedHistoryId])

  // Reproductor interactivo de ruta (Playback player)
  useEffect(() => {
    if (!isPlaying || !selectedHistory) return
    const totalPoints = selectedHistory.points.length
    if (totalPoints <= 1) return

    const intervalMs = Math.max(80, Math.floor(800 / playbackSpeed))
    const timer = setInterval(() => {
      setPlaybackIndex(prev => {
        if (prev >= totalPoints - 1) {
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, intervalMs)
    return () => clearInterval(timer)
  }, [isPlaying, selectedHistory, playbackSpeed])

  // Activar / Desactivar transmisión GPS nativa del navegador
  const handleToggleTransmitGps = () => {
    if (isTransmittingGps) {
      stopNativeDeviceTracking()
      setIsTransmittingGps(false)
      setTransmittingInfo(null)
    } else {
      const targetVehId = selectedVehicleId !== 'all' ? selectedVehicleId : telemetries[0]?.vehicle.id || 'veh-1'
      const ok = startNativeDeviceTracking(
        targetVehId,
        coords => {
          setIsTransmittingGps(true)
          setTransmittingInfo(`Transmitiendo GPS: ±${coords.accuracy}m · ${coords.speed} km/h · Rumbo ${coords.heading}°`)
          setTelemetries(getFleetLiveTelemetry())
        },
        err => {
          alert('Error de geolocalización: ' + err.message)
          setIsTransmittingGps(false)
          setTransmittingInfo(null)
        }
      )
      if (!ok) {
        alert('Este navegador no tiene soporte para la API de geolocalización.')
      }
    }
  }

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
    } else if (tab === 'rutas') {
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
    } else if (tab === 'flota_vivo') {
      const activeList = selectedVehicleId === 'all'
        ? telemetries
        : telemetries.filter(t => t.vehicle.id === selectedVehicleId)

      activeList.forEach(item => {
        const isOnline = item.is_online
        const isSel = selectedVehicleId === item.vehicle.id
        const icon = L.divIcon({
          className: '',
          html: `
            <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
              <div style="width:38px; height:38px; border-radius:50%; background:${isOnline ? '#059669' : '#334155'}; color:#fff; border:3px solid #fff; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.3); ${isOnline ? 'animation: pulse 2s infinite;' : ''}">
                🚚
              </div>
              <div style="position:absolute; top:-22px; background:#0f172a; color:#fff; font-size:10px; font-weight:bold; font-family:monospace; padding:1px 6px; border-radius:4px; white-space:nowrap; box-shadow:0 2px 4px rgba(0,0,0,0.2); border:1px solid ${isSel ? '#38bdf8' : 'transparent'};">
                ${item.vehicle.plate} ${item.speed_kmh > 0 ? `· ${item.speed_kmh} km/h` : ''}
              </div>
            </div>
          `,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        })

        const mk = L.marker([item.current_lat, item.current_lng], { icon })
        mk.bindPopup(`
          <div style="font-size:12px; line-height:1.4;">
            <b style="font-size:13px;">${item.vehicle.name}</b><br/>
            <b>Placa:</b> ${item.vehicle.plate} (${item.vehicle.brand_model})<br/>
            <b>Conductor:</b> ${item.vehicle.driver_name}<br/>
            <b>Velocidad actual:</b> ${item.speed_kmh} km/h<br/>
            <b>Telemetría:</b> ${isOnline ? '<span style="color:#059669; font-weight:bold;">En línea (GPS activo)</span>' : 'En reposo'}<br/>
            <small style="color:#64748b;">Último ping: ${new Date(item.last_ping).toLocaleTimeString()}</small>
          </div>
        `)
        mk.on('click', () => setSelectedVehicleId(item.vehicle.id))
        mk.addTo(layer)
        pts.push([item.current_lat, item.current_lng])
      })
    } else if (tab === 'historial') {
      if (selectedHistory && selectedHistory.points.length > 0) {
        const routeCoords: [number, number][] = selectedHistory.points.map(p => [p.lat, p.lng])
        
        // Polilínea del trayecto completo recorrido
        L.polyline(routeCoords, {
          color: '#2563eb',
          weight: 5,
          opacity: 0.85,
        }).addTo(layer)
        pts.push(...routeCoords)

        // Marcador Punto de Partida
        const startPt = routeCoords[0]
        const startIcon = L.divIcon({
          className: '',
          html: `<div style="width:30px; height:30px; border-radius:50%; background:#16a34a; color:#fff; border:2px solid #fff; display:flex; align-items:center; justify-content:center; font-size:14px; box-shadow:0 2px 5px rgba(0,0,0,0.3);">🏁</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        })
        L.marker(startPt, { icon: startIcon })
          .bindTooltip(textNode(`Inicio: ${selectedHistory.origin_name} (${selectedHistory.start_time.slice(11, 16)})`))
          .addTo(layer)

        // Marcadores de paradas registradas
        selectedHistory.stops.forEach((s, idx) => {
          const stopIcon = L.divIcon({
            className: '',
            html: `
              <div style="width:26px; height:26px; border-radius:50%; background:#d97706; color:#fff; border:2px solid #fff; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:11px; box-shadow:0 2px 4px rgba(0,0,0,0.3);">
                ${idx + 1}
              </div>
            `,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          })
          L.marker([s.lat, s.lng], { icon: stopIcon })
            .bindPopup(`
              <div style="font-size:12px; line-height:1.4;">
                <b>Parada #${idx + 1}: ${s.location_name}</b><br/>
                <b>Duración detenido:</b> ${s.duration_min} minutos<br/>
                <b>Llegada:</b> ${new Date(s.arrival_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<br/>
                <b>Salida:</b> ${new Date(s.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<br/>
                ${s.notes ? `<i>${s.notes}</i>` : ''}
              </div>
            `)
            .addTo(layer)
        })

        // Marcador del vehículo en la posición de reproducción (Playback)
        const currentPlaybackPt = selectedHistory.points[Math.min(playbackIndex, selectedHistory.points.length - 1)]
        if (currentPlaybackPt) {
          const playbackIcon = L.divIcon({
            className: '',
            html: `
              <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
                <div style="width:42px; height:42px; border-radius:50%; background:#ea580c; color:#fff; border:3px solid #fff; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 4px 10px rgba(0,0,0,0.4);">
                  🚚
                </div>
                <div style="position:absolute; top:-24px; background:#0f172a; color:#fff; font-size:10px; font-weight:bold; font-family:monospace; padding:1px 6px; border-radius:4px; white-space:nowrap;">
                  ${currentPlaybackPt.speed_kmh} km/h · ${currentPlaybackPt.timestamp.slice(11, 16)}
                </div>
              </div>
            `,
            iconSize: [42, 42],
            iconAnchor: [21, 21],
          })
          L.marker([currentPlaybackPt.lat, currentPlaybackPt.lng], { icon: playbackIcon, zIndexOffset: 3000 }).addTo(layer)
        }
      }
    }

    const key = `${tab}|${period}|${day}|${sellerId}|${reloadKey}|${customers.length}|${locs.length}|${visits.length}|${dormDays}|${dormRows.length}|${showRoute}|${routeN}|${selectedVehicleId}|${selectedHistory?.id}|${playbackIndex}|${telemetries.length}`
    if (lastFit.current !== key && pts.length) {
      map.fitBounds(pts, { padding: [35, 35], maxZoom: 16 })
      lastFit.current = key
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lReady, tab, customers, locMap, cov, bySeller, selected, sellers, showBars, barData, onlyPending, dormRows, dormDays, showRoute, dormRoute, telemetries, selectedVehicleId, selectedHistory, playbackIndex])

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
        <button onClick={() => { setTab('flota_vivo'); setSelected(null) }} className={btn(tab === 'flota_vivo')}><span className="inline-flex items-center gap-1.5"><Truck className="w-4 h-4" /> Flota en Vivo (GPS)</span></button>
        <button onClick={() => { setTab('historial'); setSelected(null) }} className={btn(tab === 'historial')}><span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> Historial de Rutas</span></button>
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
        ) : tab === 'flota_vivo' ? (
          <>
            <select
              value={selectedVehicleId}
              onChange={e => setSelectedVehicleId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white font-medium"
            >
              <option value="all">Todos los vehículos ({telemetries.length})</option>
              {telemetries.map(t => (
                <option key={t.vehicle.id} value={t.vehicle.id}>
                  {t.vehicle.plate} - {t.vehicle.brand_model} ({t.vehicle.driver_name || 'Sin conductor'})
                </option>
              ))}
            </select>

            <button
              onClick={handleToggleTransmitGps}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
                isTransmittingGps
                  ? 'bg-emerald-600 text-white animate-pulse shadow-sm'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              title="Usa la API de geolocalización HTML5 para emitir la posición real de este dispositivo"
            >
              <Radio className="w-4 h-4" />
              {isTransmittingGps ? 'Transmitiendo GPS (Activo)' : 'Modo Conductor (GPS Nativo)'}
            </button>

            <button
              onClick={() => setSimulatingMovement(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
                simulatingMovement
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Activity className="w-4 h-4" />
              {simulatingMovement ? 'Simulación en Marcha' : 'Simular Movimiento'}
            </button>
          </>
        ) : tab === 'historial' ? (
          <>
            <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1">
              <Calendar className="w-4 h-4 text-slate-500" />
              <input
                type="date"
                value={historyDate}
                onChange={e => {
                  const newD = e.target.value
                  setHistoryDate(newD)
                  const list = getRouteHistories(historyVehicleId, newD)
                  setHistories(list)
                  if (list.length > 0) {
                    setSelectedHistoryId(list[0].id)
                    setPlaybackIndex(0)
                    setIsPlaying(false)
                  }
                }}
                className="text-sm outline-none bg-transparent"
              />
            </div>

            <select
              value={historyVehicleId}
              onChange={e => {
                const newV = e.target.value
                setHistoryVehicleId(newV)
                const list = getRouteHistories(newV, historyDate)
                setHistories(list)
                if (list.length > 0) {
                  setSelectedHistoryId(list[0].id)
                  setPlaybackIndex(0)
                  setIsPlaying(false)
                }
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white font-medium"
            >
              <option value="all">Todos los vehículos con historial</option>
              {getFleetVehicles().map(v => (
                <option key={v.id} value={v.id}>
                  {v.plate} - {v.brand_model}
                </option>
              ))}
            </select>

            <select
              value={selectedHistory?.id || ''}
              onChange={e => {
                setSelectedHistoryId(e.target.value)
                setPlaybackIndex(0)
                setIsPlaying(false)
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white font-medium max-w-xs truncate"
            >
              {histories.length === 0 ? (
                <option value="">Sin rutas para este día</option>
              ) : (
                histories.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.vehicle_plate} · {h.origin_name} → {h.destination_name || 'Retorno'} ({h.total_distance_km} km)
                  </option>
                ))
              )}
            </select>
          </>
        ) : (
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        )}

        {tab !== 'dormidos' && tab !== 'flota_vivo' && tab !== 'historial' && (
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

      {transmittingInfo && (
        <div className="no-print flex items-center justify-between gap-2 text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 text-xs">
          <span className="flex items-center gap-2">
            <Radio className="w-4 h-4 animate-spin text-emerald-600" />
            <strong>{transmittingInfo}</strong>
          </span>
          <button onClick={handleToggleTransmitGps} className="underline text-emerald-900 font-semibold shrink-0">Detener</button>
        </div>
      )}

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
                : tab === 'flota_vivo'
                  ? `Monitoreo GPS en Vivo · Flota de Vehículos (${telemetries.length} unidades activas)`
                  : tab === 'historial'
                    ? `Historial de Recorridos GPS · ${selectedHistory ? selectedHistory.vehicle_plate + ' (' + selectedHistory.origin_name + ' → ' + (selectedHistory.destination_name || 'Destino') + ')' : 'Seleccione una ruta'}`
                    : `Ruta del ${new Date(day + 'T00:00:00').toLocaleDateString()}`}
            {tab !== 'dormidos' && tab !== 'flota_vivo' && tab !== 'historial' && sellerId ? ` · ${sellerName(sellerId)}` : ''}
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

        {tab === 'flota_vivo' && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase flex items-center gap-1">
                <Truck className="w-3.5 h-3.5 text-blue-500" /> Vehículos Flota
              </p>
              <p className="text-lg font-bold text-slate-800">{telemetries.length}</p>
              <p className="text-[11px] text-slate-400">En registro operativo</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" /> En Ruta / Movimiento
              </p>
              <p className="text-lg font-bold text-slate-800">
                {telemetries.filter(t => t.vehicle.status === 'en_ruta' || t.speed_kmh > 0).length}
              </p>
              <p className="text-[11px] text-slate-400">Transmitiendo telemetría</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5 text-orange-500" /> Vel. Promedio
              </p>
              <p className="text-lg font-bold text-slate-800">
                {telemetries.length
                  ? Math.round(telemetries.reduce((acc, t) => acc + t.speed_kmh, 0) / telemetries.length)
                  : 0}{' '}
                km/h
              </p>
              <p className="text-[11px] text-slate-400">Flota en movimiento</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase flex items-center gap-1">
                <Radio className="w-3.5 h-3.5 text-indigo-500" /> Enlace GPS
              </p>
              <p className="text-lg font-bold text-slate-800">
                {telemetries.filter(t => t.is_online).length} / {telemetries.length}
              </p>
              <p className="text-[11px] text-emerald-600 font-medium">100% Cobertura satelital</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Monitoreo Anti-Fraude
              </p>
              <p className="text-lg font-bold text-emerald-600">Activo</p>
              <p className="text-[11px] text-slate-400">Geocercas y desvíos</p>
            </div>
          </div>
        )}

        {tab === 'historial' && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase">Distancia Total</p>
              <p className="text-lg font-bold text-slate-800">{selectedHistory?.total_distance_km || 0} km</p>
              <p className="text-[11px] text-slate-400">Odómetro de ruta</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase">Tiempo Rodando</p>
              <p className="text-lg font-bold text-slate-800">{selectedHistory?.moving_time_min || 0} min</p>
              <p className="text-[11px] text-slate-400">En movimiento</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase">Tiempo Detenido</p>
              <p className="text-lg font-bold text-amber-600">{selectedHistory?.stopped_time_min || 0} min</p>
              <p className="text-[11px] text-slate-400">En paradas / descargas</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase">Velocidad Máx.</p>
              <p className="text-lg font-bold text-slate-800">{selectedHistory?.max_speed_kmh || 0} km/h</p>
              <p className="text-[11px] text-slate-400">Promedio: {selectedHistory?.avg_speed_kmh || 0} km/h</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase">Paradas / Puntos</p>
              <p className="text-lg font-bold text-slate-800">{selectedHistory?.stops.length || 0}</p>
              <p className="text-[11px] text-slate-400">Entregas y escalas</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-400 uppercase">Muestras GPS</p>
              <p className="text-lg font-bold text-slate-800">{selectedHistory?.points.length || 0}</p>
              <p className="text-[11px] text-slate-400">Waypoints registrados</p>
            </div>
          </div>
        )}

        <div ref={mapBox} className="relative z-0 bg-white" style={{ isolation: 'isolate' }}>
          <div className="no-print absolute right-2 top-2 z-[500]">
            <button onClick={toggleFullscreen} title="Pantalla completa" className="p-2 rounded-lg bg-white border border-slate-300 shadow hover:bg-slate-50"><Maximize2 className="w-4 h-4 text-slate-700" /></button>
          </div>
          <div ref={mapDiv} className="w-full rounded-xl border border-slate-200" style={{ height: isFs ? '100vh' : 'min(60vh, 520px)', minHeight: 320 }} />
        </div>

        {/* =========================================================================
            PANEL DE HISTORIAL DE RUTAS: REPRODUCTOR PLAYBACK Y PARADAS AUDITADAS
           ========================================================================= */}
        {tab === 'historial' && selectedHistory && (
          <div className="mt-4 space-y-4">
            {/* Reproductor Interactivo (Playback Bar) */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-orange-100 text-orange-700">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      Reproductor de Trayecto · {selectedHistory.vehicle_plate}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Conductor: {selectedHistory.driver_name} · {selectedHistory.origin_name} → {selectedHistory.destination_name || 'Destino'}
                    </p>
                  </div>
                </div>

                {/* Controles de reproducción */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPlaybackIndex(0)
                      setIsPlaying(false)
                    }}
                    title="Reiniciar al inicio"
                    className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setIsPlaying(v => !v)}
                    className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium text-sm flex items-center gap-2 hover:bg-orange-700 shadow-sm"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    {isPlaying ? 'Pausar' : 'Reproducir'}
                  </button>

                  {/* Multiplicador de velocidad */}
                  <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden text-xs">
                    {[1, 2, 5, 10].map(s => (
                      <button
                        key={s}
                        onClick={() => setPlaybackSpeed(s)}
                        className={`px-2.5 py-1.5 font-medium transition-colors ${
                          playbackSpeed === s ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Barra de progreso / Scrubber Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono">
                    {selectedHistory.points[0]?.timestamp.slice(11, 19) || 'Inicio'}
                  </span>
                  <span className="font-semibold text-slate-700">
                    Punto {playbackIndex + 1} de {selectedHistory.points.length} (
                    {Math.round(((playbackIndex + 1) / (selectedHistory.points.length || 1)) * 100)}%)
                  </span>
                  <span className="font-mono">
                    {selectedHistory.points[selectedHistory.points.length - 1]?.timestamp.slice(11, 19) || 'Fin'}
                  </span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={Math.max(0, selectedHistory.points.length - 1)}
                  value={playbackIndex}
                  onChange={e => {
                    setPlaybackIndex(Number(e.target.value))
                    setIsPlaying(false)
                  }}
                  className="w-full accent-orange-600 cursor-pointer h-2 bg-slate-100 rounded-lg"
                />
              </div>

              {/* Métricas del punto actual en reproducción */}
              {selectedHistory.points[playbackIndex] && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      Hora: <strong>{new Date(selectedHistory.points[playbackIndex].timestamp).toLocaleTimeString()}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Gauge className="w-3.5 h-3.5 text-orange-500" />
                    <span>
                      Velocidad: <strong className="text-orange-600">{selectedHistory.points[playbackIndex].speed_kmh} km/h</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Compass className="w-3.5 h-3.5 text-blue-500" />
                    <span>
                      Rumbo:{' '}
                      <strong>
                        {selectedHistory.points[playbackIndex].heading != null
                          ? `${selectedHistory.points[playbackIndex].heading}°`
                          : 'N/D'}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600 truncate">
                    <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span className="font-mono truncate">
                      {selectedHistory.points[playbackIndex].lat.toFixed(5)}, {selectedHistory.points[playbackIndex].lng.toFixed(5)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Tabla de Auditoría de Paradas y Descargas */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-600" />
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Registro de Paradas y Tiempos de Permanencia ({selectedHistory.stops.length})
                  </h4>
                </div>
                <span className="text-xs text-slate-500">
                  Total detenido: <strong>{selectedHistory.stopped_time_min} min</strong>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-100 uppercase">
                    <tr>
                      <th className="px-4 py-2.5">#</th>
                      <th className="px-4 py-2.5">Punto / Establecimiento</th>
                      <th className="px-4 py-2.5">Tipo</th>
                      <th className="px-4 py-2.5">Llegada</th>
                      <th className="px-4 py-2.5">Salida</th>
                      <th className="px-4 py-2.5 text-center">Permanencia</th>
                      <th className="px-4 py-2.5">Notas / Novedades</th>
                      <th className="px-4 py-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {selectedHistory.stops.map((s, idx) => (
                      <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-2.5 font-bold">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-white text-[11px]">
                            {idx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {s.location_name}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                              s.kind === 'entrega'
                                ? 'bg-emerald-100 text-emerald-800'
                                : s.kind === 'bodega'
                                ? 'bg-blue-100 text-blue-800'
                                : s.kind === 'combustible'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {s.kind.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono">
                          {new Date(s.arrival_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 font-mono">
                          {new Date(s.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 text-center font-bold text-amber-700">
                          {s.duration_min} min
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 italic">
                          {s.notes || 'Sin observaciones'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => focusPoint(s.lat, s.lng)}
                            className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-[11px] font-medium transition-colors"
                          >
                            Ver en Mapa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            PANEL DE FLOTA EN VIVO: TARJETAS DE TELEMETRÍA Y ESTADO DE TRANSMISIÓN
           ========================================================================= */}
        {tab === 'flota_vivo' && (
          <div className="mt-4 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-slate-700" />
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Telemetría Satelital de Unidades en Servicio ({telemetries.length})
                  </h3>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    Frecuencia de refresco: <strong>4 segundos</strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                {telemetries
                  .filter(t => selectedVehicleId === 'all' || t.vehicle.id === selectedVehicleId)
                  .map(t => {
                    const isMoving = t.speed_kmh > 0
                    return (
                      <div
                        key={t.vehicle.id}
                        className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-400 transition-shadow shadow-sm flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-base font-black text-slate-900 tracking-wider">
                                  {t.vehicle.plate}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    isMoving
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {isMoving ? 'En movimiento' : 'Detenido'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600">
                                {t.vehicle.brand_model} · {t.vehicle.name}
                              </p>
                            </div>

                            <div className="text-right">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                {t.vehicle.capacity_kg} kg
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1.5 my-3 text-xs text-slate-600">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Conductor:</span>
                              <span className="font-medium text-slate-800">
                                {t.vehicle.driver_name || 'Sin asignar'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Teléfono:</span>
                              <span className="font-mono">
                                {t.vehicle.driver_phone || 'N/D'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Sede asignada:</span>
                              <span className="font-medium text-slate-800">
                                {t.vehicle.warehouse_name || 'General'}
                              </span>
                            </div>
                          </div>

                          {/* Medidores de telemetría */}
                          <div className="grid grid-cols-3 gap-2 py-2 px-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                            <div className="text-center">
                              <span className="text-[10px] text-slate-400 uppercase block">Velocidad</span>
                              <span className="font-bold text-slate-800 text-sm">
                                {t.speed_kmh} <span className="text-[10px] text-slate-500 font-normal">km/h</span>
                              </span>
                            </div>
                            <div className="text-center">
                              <span className="text-[10px] text-slate-400 uppercase block">Batería</span>
                              <span className="font-bold text-slate-800 text-sm">
                                {t.battery_pct}%
                              </span>
                            </div>
                            <div className="text-center">
                              <span className="text-[10px] text-slate-400 uppercase block">Precisión</span>
                              <span className="font-bold text-slate-800 text-sm">
                                ±{t.accuracy_m}m
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">
                            Ping: {new Date(t.last_ping).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <button
                            onClick={() => focusPoint(t.current_lat, t.current_lng)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <MapPin className="w-3.5 h-3.5" /> Centrar en mapa
                          </button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        )}

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
