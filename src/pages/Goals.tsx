import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtDate } from '../lib/currency'
import { Target, ChevronLeft, ChevronRight, Pencil, X, Copy } from 'lucide-react'

interface Row { id: string; sales_total: number; sales_count: number; clients: number; sales_goal: number; visits_goal: number }
interface Member { id: string; full_name: string | null; email: string; role: string; active: boolean }
interface Status { label: string; chip: string; bar: string }

const pad = (n: number) => String(n).padStart(2, '0')
const monthStr = (y: number, m: number) => `${y}-${pad(m + 1)}-01`
const empty = (id: string): Row => ({ id, sales_total: 0, sales_count: 0, clients: 0, sales_goal: 0, visits_goal: 0 })

function Bar({ pct, bar }: { pct: number; bar: string }) {
  return (
    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

export default function Goals() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = user?.role === 'dueno' || user?.role === 'admin'
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [rows, setRows] = useState<Row[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState<{ id: string; name: string; sales: string; visits: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function fetchMonth(y: number, m: number): Promise<{ rows: Row[]; error: string }> {
    const from = new Date(y, m, 1), to = new Date(y, m + 1, 1)
    const { data, error } = await supabase.rpc('metas_progreso', { p_month: monthStr(y, m), p_from: from.toISOString(), p_to: to.toISOString() })
    if (error) return { rows: [], error: error.message }
    const list = ((data || []) as any[]).map((r: any): Row => ({
      id: String(r.r_seller_id),
      sales_total: Number(r.r_sales_total) || 0,
      sales_count: Number(r.r_sales_count) || 0,
      clients: Number(r.r_clients) || 0,
      sales_goal: Number(r.r_sales_goal) || 0,
      visits_goal: Number(r.r_visits_goal) || 0,
    }))
    return { rows: list, error: '' }
  }

  async function load() {
    setLoading(true); setErr('')
    const r = await fetchMonth(ym.y, ym.m)
    if (r.error) {
      setRows([]); setLoading(false)
      setErr(!navigator.onLine ? 'Sin conexión: las metas necesitan internet.' : 'No se pudieron cargar las metas: ' + r.error)
      return
    }
    setRows(r.rows)
    if (isManager) {
      const t = await supabase.rpc('list_team')
      setTeam((t.data as Member[]) || [])
    }
    setLoading(false)
  }
  useEffect(() => { if (user) load() }, [ym.y, ym.m, user?.id])
  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(''), 6000)
    return () => window.clearTimeout(t)
  }, [msg])

  const isCurrent = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const isFuture = ym.y > now.getFullYear() || (ym.y === now.getFullYear() && ym.m > now.getMonth())
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const dayNow = isCurrent ? now.getDate() : isFuture ? 0 : daysInMonth
  const label = fmtDate(new Date(ym.y, ym.m, 1), { month: 'long', year: 'numeric' })

  function move(delta: number) {
    const d = new Date(ym.y, ym.m + delta, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }

  const nameOf = (id: string): string => {
    const m = team.find(t => t.id === id)
    if (m) return m.full_name || m.email
    if (user && id === user.id) return user.full_name || user.email
    return 'Vendedor'
  }

  const list = useMemo(() => {
    const byId = new Map<string, Row>(rows.map(r => [r.id, r] as [string, Row]))
    const out: Row[] = []
    const seen = new Set<string>()
    for (const m of team) {
      if ((m.role === 'vendedor' && m.active) || byId.has(m.id)) { seen.add(m.id); out.push(byId.get(m.id) ?? empty(m.id)) }
    }
    for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push(r) }
    if (!isManager && user && !seen.has(user.id)) out.push(empty(user.id))
    const score = (r: Row) => (r.sales_goal > 0 ? r.sales_total / r.sales_goal : -1)
    return out.sort((a, b) => (score(b) - score(a)) || (b.sales_total - a.sales_total))
  }, [rows, team, isManager, user?.id])

  const tot = useMemo(() => list.reduce((a, r) => ({
    sales: a.sales + r.sales_total, goal: a.goal + r.sales_goal, clients: a.clients + r.clients, cgoal: a.cgoal + r.visits_goal,
  }), { sales: 0, goal: 0, clients: 0, cgoal: 0 }), [list])

  function statusOf(value: number, goal: number): Status {
    if (goal <= 0) return { label: 'Sin meta', chip: 'bg-slate-100 text-slate-500', bar: 'bg-slate-300' }
    const pct = value / goal
    if (pct >= 1) return { label: 'Meta cumplida', chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' }
    if (isFuture) return { label: 'Por empezar', chip: 'bg-slate-100 text-slate-500', bar: 'bg-slate-300' }
    if (!isCurrent) return { label: 'No alcanzó', chip: 'bg-red-100 text-red-700', bar: 'bg-red-500' }
    const expected = dayNow / daysInMonth
    const ratio = expected > 0 ? pct / expected : 1
    if (ratio >= 0.95) return { label: 'En ritmo', chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' }
    if (ratio >= 0.7) return { label: 'Un poco atrasado', chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' }
    return { label: 'Atrasado', chip: 'bg-red-100 text-red-700', bar: 'bg-red-500' }
  }

  function startEdit(r: Row) {
    setEdit({ id: r.id, name: nameOf(r.id), sales: r.sales_goal ? String(r.sales_goal) : '', visits: r.visits_goal ? String(r.visits_goal) : '' })
  }
  async function saveGoal() {
    if (!edit || saving) return
    const s = Number(edit.sales || 0), v = Math.round(Number(edit.visits || 0))
    if (!(s >= 0) || !(v >= 0)) { alert('Escribe valores válidos (0 o más).'); return }
    setSaving(true)
    const { error } = await supabase.rpc('guardar_meta', { p_seller: edit.id, p_month: monthStr(ym.y, ym.m), p_sales: s, p_visits: v })
    setSaving(false)
    if (error) { alert('No se pudo guardar la meta: ' + error.message); return }
    setEdit(null); setMsg('Meta guardada.'); load()
  }
  async function copyPrev() {
    if (!isManager) return
    if (!confirm('¿Copiar las metas del mes anterior a los vendedores que aún no tienen meta este mes?')) return
    const prev = new Date(ym.y, ym.m - 1, 1)
    const r = await fetchMonth(prev.getFullYear(), prev.getMonth())
    if (r.error) { alert('No se pudieron leer las metas del mes anterior: ' + r.error); return }
    let n = 0
    for (const p of r.rows) {
      if (p.sales_goal <= 0 && p.visits_goal <= 0) continue
      const cur = rows.find(x => x.id === p.id)
      if (cur && (cur.sales_goal > 0 || cur.visits_goal > 0)) continue
      const { error } = await supabase.rpc('guardar_meta', { p_seller: p.id, p_month: monthStr(ym.y, ym.m), p_sales: p.sales_goal, p_visits: p.visits_goal })
      if (error) { alert('No se pudo copiar una meta: ' + error.message); break }
      n++
    }
    setMsg(n > 0 ? `Se copiaron ${n} meta(s) del mes anterior.` : 'No había metas para copiar.')
    load()
  }

  const pct = (v: number, g: number) => (g > 0 ? Math.round((v / g) * 100) : 0)

  function card(r: Row) {
    const ss = statusOf(r.sales_total, r.sales_goal)
    const cs = statusOf(r.clients, r.visits_goal)
    const proj = isCurrent && r.sales_goal > 0 && dayNow > 0 ? (r.sales_total / dayNow) * daysInMonth : 0
    return (
      <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate">{nameOf(r.id)}</p>
            <span className={`inline-block mt-1 text-[11px] font-medium px-2 py-0.5 rounded ${ss.chip}`}>{ss.label}</span>
          </div>
          {isManager && (
            <button onClick={() => startEdit(r)} className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded shrink-0">
              <Pencil className="w-3 h-3" /> Meta
            </button>
          )}
        </div>

        <div className="mb-3">
          <div className="flex items-baseline justify-between text-sm mb-1">
            <span className="text-slate-500">Ventas</span>
            <span className="font-semibold text-slate-800">{money(r.sales_total)}{r.sales_goal > 0 && <span className="font-normal text-slate-400"> / {money(r.sales_goal)}</span>}</span>
          </div>
          <Bar pct={pct(r.sales_total, r.sales_goal)} bar={ss.bar} />
          <div className="flex justify-between text-[11px] text-slate-400 mt-1">
            <span>{r.sales_count} venta(s)</span>
            <span>{r.sales_goal > 0 ? `${pct(r.sales_total, r.sales_goal)}%` : 'Sin meta de ventas'}{proj > 0 ? ` · proyección ${money(proj)}` : ''}</span>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-sm mb-1">
            <span className="text-slate-500">Clientes atendidos</span>
            <span className="font-semibold text-slate-800">{r.clients}{r.visits_goal > 0 && <span className="font-normal text-slate-400"> / {r.visits_goal}</span>}</span>
          </div>
          <Bar pct={pct(r.clients, r.visits_goal)} bar={cs.bar} />
          <p className="text-[11px] text-slate-400 mt-1 text-right">{r.visits_goal > 0 ? `${pct(r.clients, r.visits_goal)}%` : 'Sin meta de clientes'}</p>
        </div>
      </div>
    )
  }

  const totSales = statusOf(tot.sales, tot.goal)

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Target className="w-5 h-5" /> Metas</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => move(-1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Mes anterior"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-medium text-slate-700 capitalize min-w-[8.5rem] text-center">{label}</span>
          <button onClick={() => move(1)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Mes siguiente"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {msg && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">{msg}</div>}
      {err && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">{err}</div>}

      {isManager && !err && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-bold text-slate-500 uppercase">Equipo</p>
            <button onClick={copyPrev} className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded">
              <Copy className="w-3 h-3" /> Copiar metas del mes anterior
            </button>
          </div>
          <div className="flex items-baseline justify-between text-sm mb-1">
            <span className="text-slate-500">Ventas totales</span>
            <span className="font-semibold text-slate-800">{money(tot.sales)}{tot.goal > 0 && <span className="font-normal text-slate-400"> / {money(tot.goal)}</span>}</span>
          </div>
          <Bar pct={pct(tot.sales, tot.goal)} bar={totSales.bar} />
          <div className="flex justify-between text-[11px] text-slate-400 mt-1">
            <span>{tot.clients} cliente(s) atendido(s){tot.cgoal > 0 ? ` de ${tot.cgoal}` : ''}</span>
            <span>{tot.goal > 0 ? `${pct(tot.sales, tot.goal)}% · ${totSales.label}` : 'Define metas con el botón "Meta" de cada vendedor'}</span>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Cargando...</p>
      ) : !err && list.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">No hay vendedores para mostrar.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map(card)}</div>
      )}

      <p className="text-[11px] text-slate-400 mt-4">
        Las ventas cuentan desde que se activó este módulo en cada venta (las anteriores se asignan si tenían ubicación registrada). Ventas anuladas no suman. "Clientes atendidos" cuenta clientes distintos con venta o visita en el mes.
      </p>

      {edit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!saving) setEdit(null) }}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">Meta de {edit.name}</h2>
              <button onClick={() => setEdit(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-4 capitalize">{label}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Meta de ventas (monto)</label>
                <input type="number" inputMode="decimal" min="0" value={edit.sales} onChange={e => setEdit({ ...edit, sales: e.target.value })} placeholder="Ej: 5000000" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Meta de clientes atendidos</label>
                <input type="number" inputMode="numeric" min="0" value={edit.visits} onChange={e => setEdit({ ...edit, visits: e.target.value })} placeholder="Ej: 60" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <p className="text-[11px] text-slate-400">Déjalo en 0 o vacío para quitar la meta.</p>
              <button onClick={saveGoal} disabled={saving} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar meta'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
