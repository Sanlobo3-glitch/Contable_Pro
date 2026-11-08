import { useEffect, useMemo, useState } from 'react'
import { PieChart, RefreshCw, Download, Info, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtNum } from '../lib/currency'

interface Row {
  product_id: string; name: string; sku: string | null
  units: number; returned_units: number
  revenue: number; cost: number; profit: number
  margin_pct: number | null; unit_profit: number | null
  share_of_profit_pct: number; abc: 'A' | 'B' | 'C'
  prev_profit: number; profit_change_pct: number | null
  flags: ('sin_costo' | 'perdida' | 'margen_bajo')[]
}
interface Res {
  from: string; to: string; days: number; method: string
  summary: { products: number; revenue: number; cost: number; profit: number; prev_profit: number; margin_pct: number | null
    profit_change_pct: number | null; losing: number; low_margin: number; no_cost: number; class_a: number }
  rows: Row[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const num = (n: number | null | undefined) => fmtNum(Number(n ?? 0), 1)
const ABC_CLS: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-blue-50 text-blue-700 border-blue-200',
  C: 'bg-slate-100 text-slate-600 border-slate-200',
}

type Range = '7' | '30' | '90' | 'mes' | 'custom'
type Filter = 'todos' | 'A' | 'perdida' | 'margen_bajo' | 'sin_costo'
type Sort = 'profit' | 'margin' | 'units'

export default function Profitability() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = user?.role === 'dueno' || user?.role === 'admin'
  const today = new Date()
  const [range, setRange] = useState<Range>('30')
  const [from, setFrom] = useState(ymd(addDays(today, -29)))
  const [to, setTo] = useState(ymd(today))
  const [seller, setSeller] = useState('')
  const [cat, setCat] = useState('')
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([])
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<Res | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [opExpenses, setOpExpenses] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('todos')
  const [sort, setSort] = useState<Sort>('profit')

  function pick(r: Range) {
    setRange(r)
    const t = new Date()
    if (r === '7') { setFrom(ymd(addDays(t, -6))); setTo(ymd(t)) }
    if (r === '30') { setFrom(ymd(addDays(t, -29))); setTo(ymd(t)) }
    if (r === '90') { setFrom(ymd(addDays(t, -89))); setTo(ymd(t)) }
    if (r === 'mes') { setFrom(ymd(new Date(t.getFullYear(), t.getMonth(), 1))); setTo(ymd(t)) }
  }

  async function load() {
    if (!isManager) return
    setLoading(true); setError('')
    let tz = 'America/Bogota'
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz } catch { /* usa el valor por defecto */ }
    const [rpcRes, expRes] = await Promise.all([
      supabase.rpc('rentabilidad_productos', {
        p_from: from, p_to: to, p_category: cat || null, p_seller: seller || null, p_tz: tz,
      }),
      !seller && !cat
        ? supabase.from('expenses').select('amount').eq('status', 'activo').gte('expense_date', from).lte('expense_date', to)
        : Promise.resolve({ data: null, error: null }),
    ])
    setLoading(false)
    if (rpcRes.error) { setError(/rentabilidad_productos|does not exist|schema cache/i.test(rpcRes.error.message || '') ? 'sin_sql' : rpcRes.error.message); return }
    setData(rpcRes.data as Res)
    if (!seller && !cat && !expRes.error && expRes.data) {
      setOpExpenses((expRes.data as { amount: number }[]).reduce((acc, x) => acc + Number(x.amount || 0), 0))
    } else {
      setOpExpenses(null)
    }
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

  useEffect(() => { void load() }, [isManager, from, to, seller, cat])

  const rows = useMemo(() => {
    let r = data?.rows ?? []
    if (filter === 'A') r = r.filter(x => x.abc === 'A')
    else if (filter !== 'todos') r = r.filter(x => x.flags.includes(filter))
    const key = (x: Row) => sort === 'profit' ? x.profit : sort === 'margin' ? (x.margin_pct ?? -1e9) : x.units
    return [...r].sort((a, b) => key(b) - key(a))
  }, [data, filter, sort])

  function exportCsv() {
    if (!data) return
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Producto', 'SKU', 'Unidades', 'Devueltas', 'Ingreso', 'Costo', 'Utilidad', 'Margen %', 'Utilidad por unidad', 'Clase', 'Utilidad periodo anterior', 'Variación %']
    const lines = [head.map(esc).join(';')].concat(data.rows.map(r =>
      [r.name, r.sku, r.units, r.returned_units, r.revenue, r.cost, r.profit, r.margin_pct, r.unit_profit, r.abc, r.prev_profit, r.profit_change_pct].map(esc).join(';')))
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `rentabilidad_${data.from}_${data.to}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!isManager) return <div className="p-6 text-sm text-slate-500">La rentabilidad está disponible para el dueño y el administrador.</div>

  const chip = (active: boolean) => `px-3 py-1.5 rounded-full text-xs border whitespace-nowrap ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`
  const s = data?.summary
  const maxProfit = Math.max(1, ...(data?.rows ?? []).map(r => Math.abs(r.profit)))

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><PieChart className="w-5 h-5 text-emerald-600" /> Rentabilidad</h1>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={!data || data.rows.length === 0} className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40" aria-label="Descargar CSV"><Download className="w-4 h-4" /></button>
          <button onClick={() => void load()} disabled={loading} className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50" aria-label="Actualizar"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-3">Cuánto gana cada producto, después de descuentos, impuestos y devoluciones.</p>

      {error === 'sin_sql' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-3">
          Falta instalar el reporte en la base de datos. Ejecuta el archivo <b>20261028_rentabilidad_productos.sql</b> en Supabase.
        </div>
      )}
      {error && error !== 'sin_sql' && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-3">{error}</div>}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {([['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['mes', 'Este mes'], ['custom', 'Elegir fechas']] as [Range, string][]).map(([k, l]) =>
          <button key={k} onClick={() => pick(k)} className={chip(range === k)}>{l}</button>)}
      </div>
      {range === 'custom' && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-xs text-slate-500">Desde<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white" /></label>
          <label className="text-xs text-slate-500">Hasta<input type="date" value={to} min={from} max={ymd(today)} onChange={e => e.target.value && setTo(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white" /></label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <select value={seller} onChange={e => setSeller(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white">
          <option value="">Todos los vendedores</option>
          {sellers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={cat} onChange={e => setCat(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white">
          <option value="">Todas las categorías</option>
          {cats.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>

      {data && s && (
        <>
          <p className="text-[11px] text-slate-400 mb-2">Del {data.from} al {data.to} ({data.days} {data.days === 1 ? 'día' : 'días'}) · comparado con los {data.days} días anteriores</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[11px] text-slate-500">Ingreso (sin impuesto)</p><p className="font-bold text-slate-800">{money(s.revenue)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[11px] text-slate-500">Costo de lo vendido</p><p className="font-bold text-slate-800">{money(s.cost)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] text-slate-500">Utilidad estimada</p>
              <p className={`font-bold ${s.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(s.profit)}</p>
              {s.profit_change_pct !== null && (
                <p className={`text-[11px] flex items-center gap-0.5 ${s.profit_change_pct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {s.profit_change_pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{s.profit_change_pct >= 0 ? '+' : ''}{num(s.profit_change_pct)} % vs. periodo anterior
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[11px] text-slate-500">Margen</p><p className="font-bold text-slate-800">{s.margin_pct === null ? '—' : `${num(s.margin_pct)} %`}</p></div>
          </div>
          {opExpenses !== null && !seller && !cat && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-[11px] text-slate-500">Gastos operativos del periodo</p>
                <p className="font-bold text-rose-700">{money(opExpenses)}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Utilidad neta después de gastos</p>
                <p className={`font-bold ${(s.profit - opExpenses) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {money(s.profit - opExpenses)}
                </p>
              </div>
            </div>
          )}
          {(s.losing > 0 || s.low_margin > 0 || s.no_cost > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-3 space-y-1">
              {s.losing > 0 && <p className="text-xs text-amber-800 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{s.losing} {s.losing === 1 ? 'producto se vende' : 'productos se venden'} por debajo de su costo.</p>}
              {s.low_margin > 0 && <p className="text-xs text-amber-800 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{s.low_margin} con margen menor al 10 %.</p>}
              {s.no_cost > 0 && <p className="text-xs text-amber-800 flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{s.no_cost} sin costo registrado: su utilidad no es confiable hasta que lo completes en Productos.</p>}
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto pb-2">
            {([['todos', 'Todos'], ['A', `Clase A (${s.class_a})`], ['perdida', 'En pérdida'], ['margen_bajo', 'Margen bajo'], ['sin_costo', 'Sin costo']] as [Filter, string][]).map(([k, l]) =>
              <button key={k} onClick={() => setFilter(k)} className={chip(filter === k)}>{l}</button>)}
          </div>
          <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
            Ordenar por
            {([['profit', 'Utilidad'], ['margin', 'Margen'], ['units', 'Unidades']] as [Sort, string][]).map(([k, l]) =>
              <button key={k} onClick={() => setSort(k)} className={`underline-offset-2 ${sort === k ? 'font-bold text-slate-800 underline' : ''}`}>{l}</button>)}
          </div>

          {rows.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No hay productos en este grupo para el periodo elegido.</p>}
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.product_id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{r.name}</p>
                    <p className="text-xs text-slate-500">{num(r.units)} uds{r.returned_units > 0 ? ` (${num(r.returned_units)} devueltas)` : ''} · ingreso {money(r.revenue)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold ${r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(r.profit)}</p>
                    <p className="text-[11px] text-slate-500">{r.margin_pct === null ? '—' : `${num(r.margin_pct)} % margen`}</p>
                  </div>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${r.profit < 0 ? 'bg-red-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, Math.abs(r.profit) / maxProfit * 100)}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${ABC_CLS[r.abc]}`}>Clase {r.abc}{r.share_of_profit_pct > 0 ? ` · ${num(r.share_of_profit_pct)} % de la utilidad` : ''}</span>
                  {r.flags.includes('perdida') && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200">Bajo el costo</span>}
                  {r.flags.includes('margen_bajo') && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Margen bajo</span>}
                  {r.flags.includes('sin_costo') && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">Sin costo</span>}
                  {r.profit_change_pct !== null && (
                    <span className={`text-[11px] flex items-center gap-0.5 ml-auto ${r.profit_change_pct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {r.profit_change_pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{r.profit_change_pct >= 0 ? '+' : ''}{num(r.profit_change_pct)} %
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 flex gap-1.5"><Info className="w-3 h-3 mt-0.5 shrink-0" />{data.method}</p>
        </>
      )}
      {loading && !data && <p className="text-sm text-slate-500 py-8 text-center">Calculando…</p>}
    </div>
  )
}
