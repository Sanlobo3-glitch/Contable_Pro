import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, RefreshCw, WifiOff, Trash2, Plus, Settings2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency, fmtNum } from '../lib/currency'

interface Lot { id: string; product_id: string; product_name: string; lot_code: string; expiry_date: string; days_left: number; qty_remaining: number; qty_initial: number; cost: number }
interface Missing { product_id: string; name: string; stock: number; in_lots: number; missing: number }
interface Data { today: string; lots: Lot[]; sin_lote: Missing[]; descuadre: number }
interface Prod { id: string; name: string; sku: string | null; stock: number; tracks_expiry: boolean }

const num = (n: number) => fmtNum(Number(n), 2)
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString()
const SOON = 30

export default function Lots({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(user)
  const isManager = user?.role === 'dueno' || user?.role === 'admin'

  const [data, setData] = useState<Data | null>(null)
  const [products, setProducts] = useState<Prod[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState<'todos' | 'vencidos' | 'pronto'>('todos')
  const [showSetup, setShowSetup] = useState(false)
  const [q, setQ] = useState('')
  const [addFor, setAddFor] = useState<Missing | null>(null)
  const [aCode, setACode] = useState('')
  const [aDate, setADate] = useState('')
  const [aQty, setAQty] = useState('')
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  const flash = (m: string) => { setNote(m); window.setTimeout(() => setNote(''), 5000) }

  async function load() {
    if (!isManager) return
    setLoading(true); setError('')
    const [l, p] = await Promise.all([
      supabase.rpc('lotes_list'),
      supabase.from('products').select('id, name, sku, stock, tracks_expiry').order('name'),
    ])
    setLoading(false)
    if (l.error) { setError(/lotes_list|does not exist|schema cache/i.test(l.error.message || '') ? 'sin_sql' : l.error.message); return }
    setData(l.data as Data)
    if (!p.error && p.data) setProducts(p.data as Prod[])
  }
  useEffect(() => { void load() }, [isManager])

  const lots = useMemo(() => (data?.lots || []).filter(l =>
    filter === 'todos' ? true : filter === 'vencidos' ? l.days_left < 0 : l.days_left >= 0 && l.days_left <= SOON), [data, filter])

  const stats = useMemo(() => {
    const all = data?.lots || []
    const exp = all.filter(l => l.days_left < 0), soon = all.filter(l => l.days_left >= 0 && l.days_left <= SOON)
    const val = (a: Lot[]) => a.reduce((s, l) => s + Number(l.qty_remaining) * Number(l.cost), 0)
    return { exp: exp.length, expUnits: exp.reduce((s, l) => s + Number(l.qty_remaining), 0), expVal: val(exp), soon: soon.length, soonVal: val(soon), total: all.length }
  }, [data])

  async function baja(l: Lot) {
    if (readOnly) return
    const why = window.prompt(`Dar de baja ${num(l.qty_remaining)} unidad(es) de «${l.product_name}» (lote ${l.lot_code}).\n\nEl stock baja y queda en el Kardex. Motivo:`, l.days_left < 0 ? 'Vencido' : '')
    if (why === null) return
    if (!why.trim()) { alert('El motivo es obligatorio.'); return }
    const { error: err } = await supabase.rpc('dar_baja_lote', { p_lot_id: l.id, p_qty: null, p_reason: why.trim() })
    if (err) { alert('No se pudo dar de baja: ' + err.message); return }
    flash('Lote dado de baja.'); await load()
  }

  async function toggle(p: Prod) {
    if (readOnly) return
    if (p.tracks_expiry && !confirm(`¿Dejar de controlar el vencimiento de «${p.name}»? Sus lotes se cerrarán (el stock no cambia).`)) return
    const { error: err } = await supabase.rpc('set_product_expiry', { p_product: p.id, p_on: !p.tracks_expiry })
    if (err) { alert('No se pudo cambiar: ' + err.message); return }
    await load()
  }

  async function saveLot() {
    if (!addFor || readOnly) return
    const n = Number(aQty)
    if (!aDate) { alert('Indica la fecha de vencimiento.'); return }
    if (!Number.isFinite(n) || n <= 0) { alert('La cantidad debe ser mayor que cero.'); return }
    const { error: err } = await supabase.rpc('agregar_lote', { p_product: addFor.product_id, p_code: aCode, p_expiry: aDate, p_qty: n })
    if (err) { alert('No se pudo guardar: ' + err.message); return }
    setAddFor(null); setACode(''); setADate(''); setAQty('')
    flash('Lote agregado.'); await load()
  }

  async function cuadrar() {
    const { data: n, error: err } = await supabase.rpc('lotes_cuadrar')
    if (err) { alert('No se pudo cuadrar: ' + err.message); return }
    flash(`Lotes cuadrados (${n} producto(s)).`); await load()
  }

  if (!isManager) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>

  const badge = (d: number) => d < 0
    ? <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">Vencido hace {-d} d</span>
    : d <= 7 ? <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">Vence en {d} d</span>
    : d <= SOON ? <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800">Vence en {d} d</span>
    : <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">Vence en {d} d</span>

  const filtered = products.filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || (p.sku || '').toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0"><CalendarClock className="w-5 h-5 text-white" /></div>
            <h1 className="text-xl font-bold text-slate-800">Lotes y vencimientos</h1>
          </div>
          <p className="text-sm text-slate-600 mt-2">Controla qué vence y cuándo. Al vender, el sistema descuenta primero del lote que vence antes.</p>
        </div>
        <button onClick={() => load()} disabled={loading || offline} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40 shrink-0">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {offline && <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs"><WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión: necesitas internet para ver los lotes.</div>}
      {error === 'sin_sql' && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
          <p className="font-medium">Esta función aún no está activada en tu base de datos.</p>
          <p className="text-xs mt-1">Ejecuta el SQL de «Lotes y vencimientos» (partes 1 y 2) en Supabase y pulsa Actualizar.</p>
        </div>
      )}
      {error && error !== 'sin_sql' && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">No se pudo cargar: {error}</div>}
      {note && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">{note}</div>}

      {data && !error && (
        <>
          {data.descuadre > 0 && (
            <div className="flex items-start gap-2 text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{data.descuadre} producto(s) tienen más unidades en lotes que en el stock.</p>
                <p className="text-xs mt-0.5">Pasa si el stock se cambió por fuera del sistema. Cuadrar descuenta el exceso de los lotes que vencen primero.</p>
                {!readOnly && <button onClick={cuadrar} className="mt-2 bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700">Cuadrar lotes</button>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Vencidos</p><p className={`text-lg font-bold ${stats.exp > 0 ? 'text-red-600' : 'text-slate-800'}`}>{stats.exp}</p><p className="text-[10px] text-slate-400 break-words">{money(stats.expVal)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Vencen en {SOON} d</p><p className={`text-lg font-bold ${stats.soon > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{stats.soon}</p><p className="text-[10px] text-slate-400 break-words">{money(stats.soonVal)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Lotes activos</p><p className="text-lg font-bold text-slate-800">{stats.total}</p></div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {([['todos', 'Todos'], ['vencidos', 'Vencidos'], ['pronto', `Vencen pronto`]] as const).map(([k, v]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${filter === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300'}`}>{v}</button>
            ))}
          </div>

          {lots.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="font-semibold text-slate-800 mt-3">{data.lots.length === 0 ? 'Aún no hay lotes' : 'Nada en esta lista'}</p>
              <p className="text-sm text-slate-500 mt-1">{data.lots.length === 0 ? 'Activa «Controlar vencimiento» en un producto y registra su próxima compra con la fecha de vencimiento.' : 'Cambia el filtro para ver los demás lotes.'}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {lots.map(l => (
                <li key={l.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap"><p className="text-sm font-semibold text-slate-800 truncate">{l.product_name}</p>{badge(l.days_left)}</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">Lote {l.lot_code} · vence {day(l.expiry_date)} · quedan {num(l.qty_remaining)} de {num(l.qty_initial)}</p>
                  </div>
                  {!readOnly && <button onClick={() => baja(l)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg shrink-0"><Trash2 className="w-3.5 h-3.5" /> Dar de baja</button>}
                </li>
              ))}
            </ul>
          )}

          {data.sin_lote.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-700">Stock sin lote</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">Productos con vencimiento que tienen unidades sin fecha. Asígnales su lote para controlarlas.</p>
              <ul className="divide-y divide-slate-100">
                {data.sin_lote.map(m => (
                  <li key={m.product_id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-slate-700">{m.name} · <span className="text-slate-500">{num(m.missing)} sin lote</span></span>
                    {!readOnly && <button onClick={() => { setAddFor(m); setAQty(String(m.missing)) }} className="inline-flex items-center gap-1 text-xs bg-slate-800 text-white px-2.5 py-1.5 rounded-lg shrink-0"><Plus className="w-3.5 h-3.5" /> Lote</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <button onClick={() => setShowSetup(v => !v)} className="w-full flex items-center justify-between text-sm font-bold text-slate-700"><span className="inline-flex items-center gap-2"><Settings2 className="w-4 h-4" /> Productos que controlan vencimiento</span><span className="text-xs font-medium text-slate-500">{products.filter(p => p.tracks_expiry).length} activos</span></button>
            {showSetup && (
              <div className="mt-3 space-y-2">
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {filtered.map(p => (
                    <li key={p.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-slate-700">{p.name}</span>
                      <button onClick={() => toggle(p)} disabled={readOnly} className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border ${p.tracks_expiry ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300'} disabled:opacity-50`}>{p.tracks_expiry ? 'Activo' : 'Activar'}</button>
                    </li>
                  ))}
                  {filtered.length === 0 && <li className="py-4 text-center text-sm text-slate-400">Sin resultados</li>}
                </ul>
              </div>
            )}
          </div>
          {onNavigate && <button onClick={() => onNavigate('purchases')} className="text-xs text-slate-600 underline">Registrar una compra con vencimiento</button>}
        </>
      )}

      {addFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setAddFor(null)}>
          <div className="bg-white rounded-xl w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-800">Lote de «{addFor.name}»</h2>
            <p className="text-xs text-slate-500">Hay {num(addFor.missing)} unidad(es) sin lote. No cambia el stock.</p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-xs text-slate-500 mb-1">Vence</label><input type="date" value={aDate} onChange={e => setADate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" /></div>
              <div><label className="block text-xs text-slate-500 mb-1">Cantidad</label><input type="number" inputMode="decimal" min="0" step="any" value={aQty} onChange={e => setAQty(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" /></div>
            </div>
            <input value={aCode} onChange={e => setACode(e.target.value)} maxLength={40} placeholder="Código de lote (opcional)" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setAddFor(null)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium">Cancelar</button>
              <button onClick={saveLot} className="flex-1 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
