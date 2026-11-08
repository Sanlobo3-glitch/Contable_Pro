import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { getPosition } from '../lib/geo'
import { loadLeaflet } from '../lib/leaflet'
import { planRoutes, fmtMinutes, mapsLink, type PlanCustomer, type PlanSeller, type PlanResult } from '../lib/routePlanner'
import MyRoute from './MyRoute'
import InviteSellers from '../components/InviteSellers'
import { UserAvatar } from '../components/AvatarCapture'
import { Route as RouteIcon, Save, Share2, Loader2, Trash2, Navigation, Crosshair, Users, Check } from 'lucide-react'
import { fmtDate } from '../lib/currency'

interface Cust { id: string; name: string; address: string | null; phone: string | null }
interface Member {
  id: string
  full_name: string | null
  email: string
  role: string
  active: boolean
  avatar_url?: string | null
  zone?: string | null
}
interface SavedPlan { id: string; seller_id: string; plan_date: string; label: string | null; total_km: number; route_stops: { status: string }[] }

const DAY = 86400000
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777']
const todayStr = () => new Date().toLocaleDateString('sv-SE')

async function fetchAll<T>(build: (a: number, b: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

function dateForDay(startStr: string, day: number): string {
  const d = new Date(startStr + 'T00:00:00')
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  for (let i = 1; i < day; i++) { d.setDate(d.getDate() + 1); while (d.getDay() === 0) d.setDate(d.getDate() + 1) }
  return d.toLocaleDateString('sv-SE')
}
const niceDate = (s: string) => fmtDate(s + 'T00:00:00', { weekday: 'short', day: 'numeric', month: 'short' })

export default function RoutePlanner({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const isManager = user?.role === 'dueno' || user?.role === 'admin'
  if (!isManager) return <MyRoute onNavigate={onNavigate} />
  return <Planner readOnly={isReadOnly(user)} onNavigate={onNavigate} />
}

function Num({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
      />
    </label>
  )
}

function Planner({ readOnly, onNavigate }: { readOnly: boolean; onNavigate?: (page: string) => void }) {
  const [team, setTeam] = useState<Member[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [custs, setCusts] = useState<Cust[]>([])
  const [locs, setLocs] = useState<Map<string, { lat: number; lng: number }>>(new Map())
  const [stats, setStats] = useState<Map<string, { last: string | null; value: number }>>(new Map())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<SavedPlan[]>([])
  const [dormDays, setDormDays] = useState(30)
  const [stopsPerDay, setStopsPerDay] = useState(10)
  const [workDays, setWorkDays] = useState(3)
  const [speed, setSpeed] = useState(25)
  const [minStop, setMinStop] = useState(12)
  const [startDate, setStartDate] = useState(todayStr())
  const [home, setHome] = useState<{ lat: number; lng: number } | null>(null)
  const [result, setResult] = useState<PlanResult | null>(null)
  const [viewDay, setViewDay] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)

  const loadTeamMembers = useCallback(async () => {
    const rich = await supabase.rpc('listar_nomina_equipo')
    let raw: Member[] = []
    if (!rich.error && Array.isArray(rich.data)) {
      raw = rich.data as Member[]
    } else {
      const fallback = await supabase.rpc('list_team')
      raw = (fallback.data || []) as Member[]
    }
    const members = raw.filter(m => m.active && (m.role === 'vendedor' || m.role === 'dueno' || m.role === 'admin'))
    setTeam(members)
    setPicked(prev => {
      const next: Record<string, boolean> = {}
      const sellersOnly = members.filter(m => m.role === 'vendedor')
      for (const m of members) {
        if (m.id in prev) next[m.id] = prev[m.id]
        else next[m.id] = sellersOnly.length > 0 ? m.role === 'vendedor' : false
      }
      return next
    })
  }, [])

  async function loadSaved() {
    const from = new Date(Date.now() - 7 * DAY).toLocaleDateString('sv-SE')
    const r = await supabase
      .from('route_plans')
      .select('id,seller_id,plan_date,label,total_km,route_stops(status)')
      .gte('plan_date', from)
      .order('plan_date', { ascending: false })
      .limit(60)
    if (!r.error) setSaved((r.data || []) as unknown as SavedPlan[])
  }

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [cu, lo, vi, sa, pe] = await Promise.all([
          fetchAll<Cust>((a, b) => supabase.from('customers').select('id,name,address,phone').order('name').order('id').range(a, b)),
          fetchAll<{ customer_id: string; lat: number; lng: number }>((a, b) => supabase.from('customer_locations').select('customer_id,lat,lng').order('customer_id').range(a, b)),
          fetchAll<{ customer_id: string | null; created_at: string }>((a, b) => supabase.from('visits').select('customer_id,created_at').order('created_at').order('id').range(a, b)),
          fetchAll<{ customer_id: string | null; created_at: string; total: number; status: string }>((a, b) => supabase.from('sales').select('customer_id,created_at,total,status').order('created_at').order('id').range(a, b)),
          supabase.from('route_stops').select('customer_id, route_plans!inner(plan_date)').eq('status', 'pendiente').gte('route_plans.plan_date', todayStr()),
          loadTeamMembers(),
        ])
        if (!alive) return
        const st = new Map<string, { last: string | null; value: number }>()
        const bump = (id: string, at: string, v: number) => {
          const cur = st.get(id) ?? { last: null, value: 0 }
          st.set(id, { last: !cur.last || at > cur.last ? at : cur.last, value: cur.value + v })
        }
        for (const v of vi) if (v.customer_id) bump(v.customer_id, v.created_at, 0)
        for (const s of sa) if (s.customer_id && s.status !== 'anulada') bump(s.customer_id, s.created_at, Number(s.total) || 0)
        setCusts(cu)
        setLocs(new Map(lo.map(l => [l.customer_id, { lat: Number(l.lat), lng: Number(l.lng) }])))
        setStats(st)
        setPending(new Set(((pe.data || []) as any[]).map(r => String(r.customer_id))))
      } catch (e: any) {
        if (alive) setError(e?.message || 'No se pudieron cargar los datos')
      }
      if (alive) setLoading(false)
      loadSaved()
    }
    load()
    return () => { alive = false }
  }, [loadTeamMembers])

  const candidates = useMemo<PlanCustomer[]>(() => {
    const now = Date.now()
    const out: PlanCustomer[] = []
    for (const c of custs) {
      const l = locs.get(c.id)
      if (!l || pending.has(c.id)) continue
      const s = stats.get(c.id)
      const days = s?.last ? Math.floor((now - Date.parse(s.last)) / DAY) : null
      if (days !== null && days < dormDays) continue
      out.push({ id: c.id, name: c.name, lat: l.lat, lng: l.lng, days, value: s?.value ?? 0, phone: c.phone, address: c.address })
    }
    return out
  }, [custs, locs, stats, pending, dormDays])

  const sellerName = (id: string) => { const m = team.find(t => t.id === id); return m?.full_name || m?.email || 'Vendedor' }
  const chosen = team.filter(t => picked[t.id])
  const sellerCount = team.filter(t => t.role === 'vendedor').length
  const noLoc = custs.filter(c => !locs.has(c.id)).length

  function generate() {
    setMsg(''); setError('')
    const sellers: PlanSeller[] = chosen.map(m => ({ id: m.id, name: m.full_name || m.email, home }))
    if (sellers.length === 0) {
      setError('Selecciona al menos una persona arriba para asignarle la ruta (o vincula primero a tu vendedor abajo).')
      return
    }
    const r = planRoutes(candidates, sellers, { workDays, stopsPerDay, speedKmh: speed, minutesPerStop: minStop })
    setResult(r); setViewDay(1)
    if (r.days.length === 0) setError('No hay clientes sin atender con ubicación guardada para planificar.')
  }

  async function usePosition() {
    const g = await getPosition()
    if (g.status === 'ok' && g.lat != null && g.lng != null) setHome({ lat: g.lat, lng: g.lng })
    else setError('No se pudo obtener tu ubicación. Revisa el permiso del navegador.')
  }

  async function save() {
    if (!result || result.days.length === 0) return
    setSaving(true); setMsg(''); setError('')
    const payload = result.days.map(d => ({
      seller_id: d.sellerId, plan_date: dateForDay(startDate, d.day), label: `Ruta ${d.day}`, km: Number(d.km.toFixed(2)),
      stops: d.stops.map(s => ({ customer_id: s.customer.id, seq: s.seq, km: Number(s.legKm.toFixed(2)) })),
    }))
    const { data, error: err } = await supabase.rpc('guardar_plan_rutas', { p_days: payload })
    setSaving(false)
    if (err || !(data as any)?.success) {
      setError(/guardar_plan_rutas|schema cache|does not exist/i.test(err?.message || '') ? 'Falta instalar el SQL de rutas en Supabase.' : (err?.message || 'No se pudo guardar'))
      return
    }
    setMsg(`Plan guardado: ${(data as any).stops} paradas asignadas. Cada vendedor las ve en «Mi ruta».`)
    setResult(null); loadSaved()
    const ids = new Set(pending); payload.forEach(p => p.stops.forEach(s => ids.add(s.customer_id))); setPending(ids)
  }

  async function removePlan(id: string) {
    const { error: err } = await supabase.rpc('eliminar_plan_rutas', { p_plan: id })
    setConfirmDeleteId(null)
    if (err) setError(err.message); else loadSaved()
  }

  function whatsappPlanHref(d: PlanResult['days'][number]) {
    const lines = [`Ruta ${d.day} · ${niceDate(dateForDay(startDate, d.day))}`, `${d.sellerName} · ${d.stops.length} paradas · ${d.km.toFixed(1)} km`, '']
    d.stops.forEach(s => lines.push(`${s.seq}. ${s.customer.name}${s.customer.address ? ' — ' + s.customer.address : ''}`))
    lines.push('', mapsLink(d.stops, home))
    return 'https://wa.me/?text=' + encodeURIComponent(lines.join('\n'))
  }

  useEffect(() => {
    if (!result || result.days.length === 0 || !mapEl.current) return
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled || !mapEl.current) return
      if (mapRef.current && mapRef.current.getContainer() !== mapEl.current) { mapRef.current.remove(); mapRef.current = null }
      if (!mapRef.current) {
        mapRef.current = L.map(mapEl.current)
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapRef.current)
        layerRef.current = L.layerGroup().addTo(mapRef.current)
      }
      layerRef.current.clearLayers()
      const bounds: [number, number][] = []
      result.days.filter(d => d.day === viewDay).forEach(d => {
        const color = COLORS[Math.max(0, chosen.findIndex(c => c.id === d.sellerId)) % COLORS.length]
        const pts: [number, number][] = d.stops.map(s => [s.customer.lat, s.customer.lng])
        if (home) pts.unshift([home.lat, home.lng])
        L.polyline(pts, { color, weight: 3, opacity: 0.8 }).addTo(layerRef.current)
        d.stops.forEach(s => {
          const icon = L.divIcon({ className: '', iconSize: [22, 22], html: `<div style="background:${color};color:#fff;width:22px;height:22px;border-radius:50%;font:700 11px/22px sans-serif;text-align:center;border:2px solid #fff">${s.seq}</div>` })
          const tip = document.createElement('div')
          tip.textContent = `${s.seq}. ${s.customer.name}`
          L.marker([s.customer.lat, s.customer.lng], { icon }).bindTooltip(tip).addTo(layerRef.current)
          bounds.push([s.customer.lat, s.customer.lng])
        })
      })
      if (bounds.length) mapRef.current.fitBounds(bounds, { padding: [24, 24] })
      mapRef.current.invalidateSize()
    }).catch(() => {})
    return () => { cancelled = true }
  }, [result, viewDay, chosen, home])

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }, [])

  const dayList = result ? Array.from(new Set(result.days.map(d => d.day))).sort((a, b) => a - b) : []
  const btn = (a: boolean) => `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${a ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <RouteIcon className="w-5 h-5" /> Planificar rutas
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Reparte los clientes sin atender entre tus vendedores por zonas y con el menor recorrido.
          </p>
        </div>
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('sellers')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Users className="w-4 h-4" />
            Nómina de vendedores ({sellerCount})
          </button>
        )}
      </div>

      {loading && (
        <p className="text-sm text-slate-400 mb-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando clientes y equipo…
        </p>
      )}
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg mb-3">{error}</p>}
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg mb-3">{msg}</p>}

      <InviteSellers
        defaultOpen={!loading && sellerCount === 0}
        onTeamChanged={loadTeamMembers}
        onOpenPayroll={onNavigate ? () => onNavigate('sellers') : undefined}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 space-y-4">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-slate-700">
              Selecciona quiénes salen a ruta ({chosen.length} {chosen.length === 1 ? 'seleccionado' : 'seleccionados'})
            </p>
            {sellerCount === 0 && !loading && (
              <span className="text-xs text-amber-700">
                Aún no tienes usuarios con rol Vendedor en esta empresa; vincula o invita uno arriba.
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {team.map((m, i) => {
              const isPicked = Boolean(picked[m.id])
              const roleText = m.role === 'vendedor' ? 'Vendedor' : m.role === 'dueno' ? 'Dueño' : 'Admin'
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPicked(p => ({ ...p, [m.id]: !p[m.id] }))}
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                    isPicked
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <UserAvatar src={m.avatar_url} name={m.full_name} email={m.email} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{m.full_name || m.email}</p>
                    <p className={`text-[11px] truncate ${isPicked ? 'text-slate-300' : 'text-slate-400'}`}>
                      {roleText}{m.zone ? ` · ${m.zone}` : ''}
                    </p>
                  </div>
                  <span
                    className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                    style={{ backgroundColor: isPicked ? COLORS[i % COLORS.length] : '#f1f5f9' }}
                  >
                    {isPicked && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                </button>
              )
            })}
            {team.length === 0 && !loading && (
              <p className="text-xs text-slate-400 col-span-full">No hay miembros activos para asignar.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Num label="Sin atender desde (días)" value={dormDays} onChange={setDormDays} min={1} max={365} />
          <Num label="Paradas por día" value={stopsPerDay} onChange={setStopsPerDay} min={1} max={40} />
          <Num label="Días a planificar" value={workDays} onChange={setWorkDays} min={1} max={14} />
          <Num label="Velocidad promedio (km/h)" value={speed} onChange={setSpeed} min={5} max={80} />
          <Num label="Minutos por parada" value={minStop} onChange={setMinStop} min={1} max={90} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-slate-500">Primer día</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value || todayStr())}
              className="mt-1 block px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
            />
          </label>
          <button
            type="button"
            onClick={usePosition}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Crosshair className="w-4 h-4" />
            {home ? 'Punto de partida fijado' : 'Usar mi ubicación como salida'}
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            Generar plan
          </button>
        </div>

        <p className="text-xs text-slate-500 tabular-nums">
          {candidates.length} cliente(s) por atender con ubicación · {pending.size} ya planificados · {noLoc} sin ubicación guardada{noLoc > 0 ? ' (no entran al plan)' : ''}
        </p>
        {noLoc > 0 && candidates.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
            Un cliente entra al plan cuando tiene ubicación. Se guarda en su primera visita o venta con GPS, o desde «Mapa y rutas» con «Corregir ubicación».
          </p>
        )}
      </div>

      {result && result.days.length > 0 && (
        <div className="space-y-3 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Paradas</p><p className="text-xl font-bold text-slate-900 tabular-nums">{result.totalStops}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Recorrido total</p><p className="text-xl font-bold text-slate-900 tabular-nums">{result.totalKm.toFixed(0)} km</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Rutas</p><p className="text-xl font-bold text-slate-900 tabular-nums">{result.days.length}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Quedan para después</p><p className="text-xl font-bold text-slate-900 tabular-nums">{result.leftOut.length}</p></div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {dayList.map(d => (
              <button key={d} type="button" onClick={() => setViewDay(d)} className={btn(viewDay === d)}>
                Día {d} · {niceDate(dateForDay(startDate, d))}
              </button>
            ))}
            <button
              type="button"
              onClick={save}
              disabled={saving || readOnly}
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Guardando…' : 'Guardar y asignar'}
            </button>
          </div>
          <div ref={mapEl} className="h-72 rounded-xl border border-slate-200 bg-slate-100" />
          {result.days.filter(d => d.day === viewDay).map(d => (
            <div key={d.sellerId + d.day} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">{d.sellerName}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{d.stops.length} paradas · {d.km.toFixed(1)} km · {fmtMinutes(d.minutes)}</p>
                </div>
                <div className="flex gap-2">
                  <a href={mapsLink(d.stops, home)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"><Navigation className="w-3.5 h-3.5" /> Google Maps</a>
                  <a href={whatsappPlanHref(d)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"><Share2 className="w-3.5 h-3.5" /> WhatsApp</a>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {d.stops.map(s => (
                  <div key={s.customer.id} className="py-1.5 flex items-center gap-3 text-xs">
                    <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center shrink-0 tabular-nums">{s.seq}</span>
                    <span className="flex-1 min-w-0"><span className="text-slate-800 font-medium">{s.customer.name}</span><span className="text-slate-400"> · {s.customer.days === null ? 'nunca atendido' : `hace ${s.customer.days} días`}</span></span>
                    <span className="text-slate-400 shrink-0 tabular-nums">{s.legKm.toFixed(1)} km · {fmtMinutes(s.etaMin)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-bold text-slate-800 mb-3">Planes guardados (últimos 7 días y próximos)</h2>
        {saved.length === 0 ? (
          <p className="text-xs text-slate-400">Todavía no hay planes guardados.</p>
        ) : (
          <div className="space-y-2">
            {saved.map(p => {
              const total = p.route_stops?.length ?? 0
              const done = (p.route_stops || []).filter(s => s.status !== 'pendiente').length
              return (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  <span className="text-xs text-slate-500 w-24 shrink-0 tabular-nums">{niceDate(p.plan_date)}</span>
                  <span className="flex-1 min-w-0 truncate text-slate-800">{sellerName(p.seller_id)}</span>
                  <span className="text-xs text-slate-500 shrink-0 tabular-nums">{done}/{total} · {Number(p.total_km).toFixed(0)} km</span>
                  <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden shrink-0">
                    <div className="h-full bg-emerald-600" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                  </div>
                  {confirmDeleteId === p.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => removePlan(p.id)} className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium">Borrar</button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 rounded border border-slate-200 text-xs text-slate-600">No</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(p.id)} className="text-slate-400 hover:text-red-600" aria-label="Eliminar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
