import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, RefreshCw, Users, Package, MessageCircle, AlertTriangle, Info, TrendingDown, Activity } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtNum } from '../lib/currency'

type Tab = 'clientes' | 'productos'

interface CRow {
  customer_id: string; name: string; phone: string | null
  segment: 'nuevo' | 'recurrente' | 'recuperable' | 'ocasional' | 'inactivo'
  risk: 'alto' | 'medio' | 'bajo' | 'ninguno'
  confidence: 'alta' | 'media' | 'baja' | 'insuficiente'
  orders: number; last_purchase: string; days_since: number
  usual_interval_days: number | null
  spend_recent_90: number; spend_prev_90: number; spend_change_pct: number | null
  avg_ticket: number; monthly_avg: number; reasons: string[]
}
interface CRes {
  window_days: number; method: string
  summary: { total: number; by_segment: Record<string, number>; by_risk: Record<string, number>; monthly_at_risk: number }
  rows: CRow[]
}
interface PRow {
  product_id: string; name: string; sku: string | null; category_id: string | null
  status: 'agotado' | 'riesgo' | 'bajo_minimo' | 'exceso' | 'sin_rotacion' | 'sin_historial' | 'ok'
  confidence: 'alta' | 'media' | 'baja' | 'insuficiente'
  observed: { stock: number; min_stock: number; units_7d: number; units_28d: number; units_84d: number; returned_84d: number; active_weeks_of_12: number; weekly_series: number[]; stock_value_at_cost: number }
  estimated: { rate_per_day: number; days_left: number | null; demand_next_30d: number; shortfall_next_30d: number }
  trend: { label: 'creciente' | 'decreciente' | 'estable' | 'sin_datos'; change_pct_4w: number | null }
  anomaly: 'alza' | 'baja' | null
  suggestion: { qty: number; supplier: string | null } | null
  notes: string[]
}
interface PRes {
  cover_days: number; method: string
  summary: { total: number; by_status: Record<string, number>; growing: number; declining: number; anomalies: number; immobilized_value: number }
  rows: PRow[]
}

const num = (n: number | null | undefined) => fmtNum(Number(n ?? 0), 1)

const SEG: Record<string, { label: string; cls: string }> = {
  recurrente: { label: 'Recurrente', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  recuperable: { label: 'Recuperable', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  nuevo: { label: 'Nuevo', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  ocasional: { label: 'Ocasional', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  inactivo: { label: 'Inactivo', cls: 'bg-red-50 text-red-700 border-red-200' },
}
const RISK: Record<string, { label: string; cls: string }> = {
  alto: { label: 'Riesgo alto', cls: 'bg-red-50 text-red-700 border-red-200' },
  medio: { label: 'Riesgo medio', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  bajo: { label: 'Riesgo bajo', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  ninguno: { label: 'Sin riesgo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}
const STATUS: Record<string, { label: string; cls: string }> = {
  agotado: { label: 'Agotado', cls: 'bg-red-50 text-red-700 border-red-200' },
  riesgo: { label: 'Se agota pronto', cls: 'bg-red-50 text-red-700 border-red-200' },
  bajo_minimo: { label: 'Bajo el mínimo', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  exceso: { label: 'Exceso', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  sin_rotacion: { label: 'Sin rotación', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  sin_historial: { label: 'Sin historial', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  ok: { label: 'Normal', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}
const CONF: Record<string, string> = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja', insuficiente: 'Datos insuficientes' }

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>{children}</span>
}

function Spark({ series }: { series: number[] }) {
  const max = Math.max(1, ...series)
  return (
    <div className="flex items-end gap-0.5 h-8" aria-label="Ventas por semana, de la más antigua a la actual">
      {series.map((v, i) => (
        <div key={i} className="w-1.5 rounded-sm bg-emerald-500/70" style={{ height: `${Math.max(v > 0 ? 8 : 3, (Math.max(v, 0) / max) * 100)}%`, opacity: v > 0 ? 1 : 0.3 }} />
      ))}
    </div>
  )
}

export default function Predictions({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = user?.role === 'dueno' || user?.role === 'admin'
  const [tab, setTab] = useState<Tab>('clientes')
  const [cust, setCust] = useState<CRes | null>(null)
  const [prod, setProd] = useState<PRes | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([])
  const [seller, setSeller] = useState('')
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [cat, setCat] = useState('')
  const [fSeg, setFSeg] = useState('riesgo')
  const [fStatus, setFStatus] = useState('atencion')
  const [open, setOpen] = useState<string | null>(null)

  async function loadCust() {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.rpc('pred_customers', { p_days: 365, p_seller: seller || null })
    setLoading(false)
    if (err) { setError(/pred_customers|does not exist|schema cache/i.test(err.message || '') ? 'sin_sql' : err.message); return }
    setCust(data as CRes)
  }
  async function loadProd() {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.rpc('pred_products', { p_category: cat || null, p_cover_days: 15 })
    setLoading(false)
    if (err) { setError(/pred_products|does not exist|schema cache/i.test(err.message || '') ? 'sin_sql' : err.message); return }
    setProd(data as PRes)
  }

  useEffect(() => {
    if (!isManager) return
    void (async () => {
      const [p, c] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email'),
        supabase.from('categories').select('id, name').order('name'),
      ])
      if (!p.error && p.data) setSellers((p.data as { id: string; full_name: string | null; email: string }[]).map(x => ({ id: x.id, name: x.full_name || x.email })))
      if (!c.error && c.data) setCats(c.data as { id: string; name: string }[])
    })()
  }, [isManager])

  useEffect(() => { if (isManager && tab === 'clientes') void loadCust() }, [isManager, tab, seller])
  useEffect(() => { if (isManager && tab === 'productos') void loadProd() }, [isManager, tab, cat])

  const custRows = useMemo(() => {
    const rows = cust?.rows ?? []
    if (fSeg === 'riesgo') return rows.filter(r => r.risk === 'alto' || r.risk === 'medio')
    if (fSeg === 'todos') return rows
    return rows.filter(r => r.segment === fSeg)
  }, [cust, fSeg])

  const prodRows = useMemo(() => {
    const rows = prod?.rows ?? []
    if (fStatus === 'todos') return rows
    if (fStatus === 'atencion') return rows.filter(r => ['agotado', 'riesgo', 'bajo_minimo'].includes(r.status))
    if (fStatus === 'exceso') return rows.filter(r => r.status === 'exceso' || r.status === 'sin_rotacion')
    if (fStatus === 'alzas') return rows.filter(r => r.anomaly === 'alza' || r.trend.label === 'creciente')
    if (fStatus === 'bajas') return rows.filter(r => r.anomaly === 'baja' || r.trend.label === 'decreciente')
    return rows
  }, [prod, fStatus])

  function whatsapp(r: CRow) {
    const tel = (r.phone || '').replace(/\D/g, '')
    const txt = `Hola ${r.name}, hace tiempo no te vemos por acá y queremos saber cómo estás. Tenemos novedades que te pueden interesar. ¡Aquí te esperamos!`
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(txt)}`, '_blank', 'noopener')
  }

  if (!isManager) {
    return <div className="p-6 text-sm text-slate-500">Las predicciones están disponibles para el dueño y el administrador.</div>
  }

  const chipBtn = (active: boolean) => `px-3 py-1.5 rounded-full text-xs border whitespace-nowrap ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-600" /> Predicciones</h1>
        <button onClick={() => (tab === 'clientes' ? loadCust() : loadProd())} disabled={loading}
          className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50" aria-label="Actualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">Estimaciones a partir de tu historial de ventas. Orientan, no son una garantía.</p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button onClick={() => setTab('clientes')} className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm border ${tab === 'clientes' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}><Users className="w-4 h-4" /> Clientes</button>
        <button onClick={() => setTab('productos')} className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm border ${tab === 'productos' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}><Package className="w-4 h-4" /> Productos</button>
      </div>

      {error === 'sin_sql' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-3">
          Falta instalar el motor de predicción en la base de datos. Ejecuta el archivo <b>20261028_prediccion_comercial.sql</b> en Supabase.
        </div>
      )}
      {error && error !== 'sin_sql' && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-3">{error}</div>}

      {tab === 'clientes' && cust && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Clientes</p><p className="font-bold text-slate-800">{cust.summary.total}</p></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">En riesgo</p><p className="font-bold text-red-600">{(cust.summary.by_risk.alto || 0) + (cust.summary.by_risk.medio || 0)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Compra mensual en riesgo</p><p className="font-bold text-slate-800 text-sm">{money(cust.summary.monthly_at_risk)}</p></div>
          </div>
          {sellers.length > 1 && (
            <select value={seller} onChange={e => setSeller(e.target.value)} className="w-full mb-2 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Todos los vendedores</option>
              {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {[['riesgo', 'En riesgo'], ['recuperable', 'Recuperables'], ['inactivo', 'Inactivos'], ['nuevo', 'Nuevos'], ['recurrente', 'Recurrentes'], ['todos', 'Todos']].map(([k, l]) =>
              <button key={k} onClick={() => setFSeg(k)} className={chipBtn(fSeg === k)}>{l}</button>)}
          </div>
          {custRows.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No hay clientes en este grupo.</p>}
          <div className="space-y-2">
            {custRows.map(r => (
              <div key={r.customer_id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.orders} {r.orders === 1 ? 'compra' : 'compras'} · última hace {r.days_since} d · {money(r.monthly_avg)}/mes</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Chip cls={SEG[r.segment].cls}>{SEG[r.segment].label}</Chip>
                    {r.risk !== 'ninguno' && <Chip cls={RISK[r.risk].cls}>{RISK[r.risk].label}</Chip>}
                  </div>
                </div>
                {r.reasons.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {r.reasons.map((t, i) => <li key={i} className="text-xs text-slate-600 flex gap-1.5"><AlertTriangle className="w-3 h-3 mt-0.5 text-amber-500 shrink-0" />{t}</li>)}
                  </ul>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{CONF[r.confidence]}</span>
                  {r.phone && r.segment !== 'recurrente' && (
                    <button onClick={() => whatsapp(r)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-green-600 text-white"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 flex gap-1.5"><Info className="w-3 h-3 mt-0.5 shrink-0" />{cust.method}</p>
        </>
      )}

      {tab === 'productos' && prod && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Por agotarse</p><p className="font-bold text-red-600">{(prod.summary.by_status.agotado || 0) + (prod.summary.by_status.riesgo || 0)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Con alza anormal</p><p className="font-bold text-slate-800">{prod.summary.anomalies}</p></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Capital inmovilizado</p><p className="font-bold text-slate-800 text-sm">{money(prod.summary.immobilized_value)}</p></div>
          </div>
          {cats.length > 0 && (
            <select value={cat} onChange={e => setCat(e.target.value)} className="w-full mb-2 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Todas las categorías</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {[['atencion', 'Requieren atención'], ['exceso', 'Exceso / sin rotación'], ['alzas', 'En alza'], ['bajas', 'En baja'], ['todos', 'Todos']].map(([k, l]) =>
              <button key={k} onClick={() => setFStatus(k)} className={chipBtn(fStatus === k)}>{l}</button>)}
          </div>
          {prodRows.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No hay productos en este grupo.</p>}
          <div className="space-y-2">
            {prodRows.map(r => (
              <div key={r.product_id} className="rounded-lg border border-slate-200 bg-white p-3">
                <button className="w-full text-left" onClick={() => setOpen(open === r.product_id ? null : r.product_id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{r.name}</p>
                      <p className="text-xs text-slate-500">
                        Stock {num(r.observed.stock)} · vende {num(r.estimated.rate_per_day)}/día
                        {r.estimated.days_left !== null && <> · alcanza ~{num(r.estimated.days_left)} d</>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Chip cls={STATUS[r.status].cls}>{STATUS[r.status].label}</Chip>
                      {r.trend.label === 'creciente' && <span className="text-[11px] text-emerald-700 flex items-center gap-0.5"><TrendingUp className="w-3 h-3" />+{num(r.trend.change_pct_4w)} %</span>}
                      {r.trend.label === 'decreciente' && <span className="text-[11px] text-red-600 flex items-center gap-0.5"><TrendingDown className="w-3 h-3" />{num(r.trend.change_pct_4w)} %</span>}
                    </div>
                  </div>
                </button>
                {r.anomaly && (
                  <p className="mt-1.5 text-xs text-amber-700 flex gap-1.5"><Activity className="w-3 h-3 mt-0.5 shrink-0" />
                    {r.anomaly === 'alza' ? 'Esta semana se vendió mucho más de lo habitual' : 'Esta semana se vendió mucho menos de lo habitual'}</p>
                )}
                {r.suggestion && (
                  <p className="mt-1.5 text-xs text-slate-600">Pedido sugerido: <b>{num(r.suggestion.qty)}</b> uds{r.suggestion.supplier ? ` · ${r.suggestion.supplier}` : ''}</p>
                )}
                {open === r.product_id && (
                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-2">
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Ventas por semana (12 semanas, la última a la derecha)</p>
                      <Spark series={r.observed.weekly_series} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <p className="text-slate-500">Observado (registros)</p><p className="text-slate-500">Estimado (proyección)</p>
                      <p>7 días: {num(r.observed.units_7d)} uds</p><p>Demanda 30 d: {num(r.estimated.demand_next_30d)} uds</p>
                      <p>28 días: {num(r.observed.units_28d)} uds</p><p>Faltarían: {num(r.estimated.shortfall_next_30d)} uds</p>
                      <p>Valor en stock: {money(r.observed.stock_value_at_cost)}</p><p>{CONF[r.confidence]}</p>
                    </div>
                    {r.notes.map((t, i) => <p key={i} className="text-[11px] text-slate-500 flex gap-1.5"><Info className="w-3 h-3 mt-0.5 shrink-0" />{t}</p>)}
                    {r.suggestion && onNavigate && (
                      <button onClick={() => onNavigate('buyplan')} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-white">Ir a Sugerencia de compras</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 flex gap-1.5"><Info className="w-3 h-3 mt-0.5 shrink-0" />{prod.method}</p>
        </>
      )}

      {loading && !cust && !prod && <p className="text-sm text-slate-500 py-8 text-center">Calculando…</p>}
    </div>
  )
}
