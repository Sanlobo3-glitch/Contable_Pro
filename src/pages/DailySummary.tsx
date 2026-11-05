import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, RefreshCw, WifiOff, MessageCircle, Copy, Printer, TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtDate, fmtNum, formatMoney } from '../lib/currency'
import PushSettings from '../components/PushSettings'

interface Summary {
  date: string
  sales: { total: number; count: number; avg: number; prev_day: number; same_weekday_last_week: number; by_method: Record<string, number> }
  top_products: { name: string; qty: number; amount: number }[]
  cash: { ingresos: number; egresos: number }
  returns: { count: number; amount: number }
  purchases: number
  stock: { sin_stock: number; bajo_minimo: number }
  cartera: { por_cobrar: number; vencido: number; ventas_fiado: number; abonos: number } | null
  /** Cobros en otra moneda del día (puede faltar si el SQL aún no se actualizó). */
  fx?: { currency: string; count: number; received: number; equivalent: number }[]
}

const METHOD: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado' }
const PRINT_CSS = `@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; } .no-print { display: none !important; } }`

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const num = (n: number) => fmtNum(Number(n), 2)

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
    } catch { return false }
  }
}

export default function DailySummary() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = user?.role === 'dueno' || user?.role === 'admin'
  const today = ymd(new Date())
  const yesterday = ymd(new Date(Date.now() - 86400000))
  const [date, setDate] = useState(today)
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const [dayExpenses, setDayExpenses] = useState<{ count: number; total: number } | null>(null)

  async function load(d = date) {
    if (!isManager) return
    setLoading(true); setError('')
    let tz = 'America/Bogota'
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz } catch { /* usa el valor por defecto */ }
    const [rpcRes, expRes] = await Promise.all([
      supabase.rpc('resumen_diario', { p_date: d, p_tz: tz }),
      supabase.from('expenses').select('amount').eq('status', 'activo').eq('expense_date', d),
    ])
    setLoading(false)
    if (rpcRes.error) { setError(/resumen_diario|does not exist|schema cache/i.test(rpcRes.error.message || '') ? 'sin_sql' : rpcRes.error.message); return }
    setData(rpcRes.data as Summary)
    if (!expRes.error && expRes.data) {
      const list = expRes.data as { amount: number }[]
      setDayExpenses({ count: list.length, total: list.reduce((a, x) => a + Number(x.amount || 0), 0) })
    } else {
      setDayExpenses(null)
    }
  }
  useEffect(() => { void load(date) }, [date, isManager])

  const title = useMemo(() => {
    const d = new Date(date + 'T00:00:00')
    const t = fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })
    return date === today ? `Hoy · ${t}` : date === yesterday ? `Ayer · ${t}` : t
  }, [date])

  function pct(now: number, before: number) {
    if (before <= 0) return null
    return Math.round(((now - before) / before) * 100)
  }

  function text(): string {
    if (!data) return ''
    const s = data.sales
    const L: string[] = [`*Resumen del negocio · ${title}*`, '']
    L.push(`Ventas: ${money(s.total)} (${s.count} ${s.count === 1 ? 'venta' : 'ventas'}${s.count > 0 ? `, promedio ${money(s.avg)}` : ''})`)
    const p1 = pct(s.total, s.prev_day), p7 = pct(s.total, s.same_weekday_last_week)
    if (p1 !== null) L.push(`Vs. día anterior: ${p1 >= 0 ? '+' : ''}${p1} %`)
    if (p7 !== null) L.push(`Vs. mismo día de la semana pasada: ${p7 >= 0 ? '+' : ''}${p7} %`)
    const methods = Object.entries(s.by_method).filter(([, v]) => Number(v) > 0)
    if (methods.length) L.push('', ...methods.map(([k, v]) => `• ${METHOD[k] ?? k}: ${money(Number(v))}`))
    if (data.top_products.length) L.push('', 'Lo más vendido:', ...data.top_products.map(p => `• ${num(p.qty)} x ${p.name} (${money(p.amount)})`))
    if (data.fx && data.fx.length) L.push('', 'Cobrado en otra moneda:', ...data.fx.map(f => `• ${f.currency}: ${formatMoney(f.received, f.currency)} (equivale a ${money(f.equivalent)}, ${f.count} ${f.count === 1 ? 'venta' : 'ventas'})`))
    L.push('', `Caja: entró ${money(data.cash.ingresos)} · salió ${money(data.cash.egresos)}`)
    if (dayExpenses && dayExpenses.count > 0) L.push(`Gastos operativos: ${dayExpenses.count} (${money(dayExpenses.total)})`)
    if (data.returns.count > 0) L.push(`Devoluciones: ${data.returns.count} (${money(data.returns.amount)})`)
    if (data.purchases > 0) L.push(`Compras recibidas: ${money(data.purchases)}`)
    if (data.cartera && (data.cartera.por_cobrar > 0 || data.cartera.abonos > 0)) {
      L.push('', `Cartera: te deben ${money(data.cartera.por_cobrar)}${data.cartera.vencido > 0 ? ` (${money(data.cartera.vencido)} vencido)` : ''}`)
      if (data.cartera.abonos > 0) L.push(`Abonos cobrados: ${money(data.cartera.abonos)}`)
    }
    if (data.stock.sin_stock > 0 || data.stock.bajo_minimo > 0) L.push('', `Inventario: ${data.stock.sin_stock} sin stock · ${data.stock.bajo_minimo} bajo el mínimo`)
    return L.join('\n')
  }

  async function copy() {
    const ok = await copyText(text())
    setNote(ok ? 'Resumen copiado.' : 'No se pudo copiar. Usa el botón de WhatsApp.')
    window.setTimeout(() => setNote(''), 3500)
  }

  if (!isManager) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  const s = data?.sales
  const p1 = s ? pct(s.total, s.prev_day) : null
  const p7 = s ? pct(s.total, s.same_weekday_last_week) : null
  const Delta = ({ v, label }: { v: number | null; label: string }) => v === null ? null : (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${v >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
      {v >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{v >= 0 ? '+' : ''}{v} % {label}
    </span>
  )

  return (
    <div className="max-w-3xl space-y-4">
      <style>{PRINT_CSS}</style>
      <div className="no-print flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0"><CalendarDays className="w-5 h-5 text-white" /></div>
            <h1 className="text-xl font-bold text-slate-800">Resumen del día</h1>
          </div>
          <p className="text-sm text-slate-600 mt-2">Cómo te fue: ventas, caja, gastos, lo más vendido, cartera e inventario. Envíalo por WhatsApp o imprímelo.</p>
        </div>
        <button onClick={() => load()} disabled={loading || offline} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40 shrink-0">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      <div className="no-print flex gap-2 flex-wrap items-center">
        <button onClick={() => setDate(today)} className={`px-3 py-2 rounded-lg text-sm font-medium border ${date === today ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300'}`}>Hoy</button>
        <button onClick={() => setDate(yesterday)} className={`px-3 py-2 rounded-lg text-sm font-medium border ${date === yesterday ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300'}`}>Ayer</button>
        <input type="date" max={today} value={date} onChange={e => e.target.value && setDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
      </div>

      {offline && <div className="no-print flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs"><WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión: necesitas internet para ver el resumen.</div>}
      {error === 'sin_sql' && (
        <div className="no-print text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
          <p className="font-medium">Esta función aún no está activada en tu base de datos.</p>
          <p className="text-xs mt-1">Ejecuta el SQL de «Resumen diario» en Supabase (SQL Editor) y pulsa Actualizar.</p>
        </div>
      )}
      {error && error !== 'sin_sql' && <div className="no-print text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">No se pudo cargar: {error}</div>}
      {note && <div className="no-print text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">{note}</div>}
      {loading && !data && <p className="text-sm text-slate-400 text-center py-10">Calculando…</p>}

      <PushSettings />

      {data && s && !error && (
        <>
          <div className="print-area space-y-3">
            <h2 className="text-base font-bold text-slate-800 capitalize">{title}</h2>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[11px] text-slate-500">Vendiste</p>
              <p className="text-2xl font-bold text-slate-800 break-words">{money(s.total)}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.count} {s.count === 1 ? 'venta' : 'ventas'}{s.count > 0 ? ` · promedio ${money(s.avg)}` : ''}</p>
              <div className="flex gap-x-4 gap-y-1 flex-wrap mt-2"><Delta v={p1} label="vs. día anterior" /><Delta v={p7} label="vs. mismo día de la semana pasada" /></div>
              {Object.entries(s.by_method).filter(([, v]) => Number(v) > 0).length > 0 && (
                <ul className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                  {Object.entries(s.by_method).filter(([, v]) => Number(v) > 0).map(([k, v]) => (
                    <li key={k} className="flex justify-between text-sm text-slate-600"><span>{METHOD[k] ?? k}</span><span className="font-medium text-slate-800">{money(Number(v))}</span></li>
                  ))}
                </ul>
              )}
            </div>

            {data.fx && data.fx.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-2">Cobrado en otra moneda</h3>
                <ul className="divide-y divide-slate-100">
                  {data.fx.map(f => (
                    <li key={f.currency} className="py-2 flex justify-between gap-3 text-sm">
                      <span className="text-slate-700">{f.currency} · {f.count} {f.count === 1 ? 'venta' : 'ventas'}</span>
                      <span className="text-right"><span className="font-medium text-slate-800">{formatMoney(f.received, f.currency)}</span><span className="block text-[11px] text-slate-400">equivale a {money(f.equivalent)}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-400 mt-2">Lo recibido en divisa, convertido con la tasa de cada venta. Ya está incluido en los totales de arriba; puede superar la venta si diste cambio.</p>
              </div>
            )}

            {data.top_products.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-2">Lo más vendido</h3>
                <ul className="divide-y divide-slate-100">
                  {data.top_products.map((p, i) => (
                    <li key={i} className="py-2 flex justify-between gap-3 text-sm"><span className="text-slate-700 min-w-0 truncate">{num(p.qty)} × {p.name}</span><span className="font-medium text-slate-800 whitespace-nowrap">{money(p.amount)}</span></li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Entró a caja</p><p className="text-base font-bold text-emerald-700 break-words">{money(data.cash.ingresos)}</p></div>
              <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Salió de caja</p><p className="text-base font-bold text-slate-800 break-words">{money(data.cash.egresos)}</p></div>
              {dayExpenses && dayExpenses.count > 0 && <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Gastos operativos ({dayExpenses.count})</p><p className="text-base font-bold text-rose-700 break-words">{money(dayExpenses.total)}</p></div>}
              {data.returns.count > 0 && <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Devoluciones ({data.returns.count})</p><p className="text-base font-bold text-slate-800 break-words">{money(data.returns.amount)}</p></div>}
              {data.purchases > 0 && <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Compras recibidas</p><p className="text-base font-bold text-slate-800 break-words">{money(data.purchases)}</p></div>}
            </div>

            {data.cartera && (data.cartera.por_cobrar > 0 || data.cartera.abonos > 0 || data.cartera.ventas_fiado > 0) && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-1 text-sm">
                <h3 className="text-sm font-bold text-slate-700 mb-1">Cartera (fiado)</h3>
                <div className="flex justify-between text-slate-600"><span>Te deben en total</span><span className="font-medium text-slate-800">{money(data.cartera.por_cobrar)}</span></div>
                <div className="flex justify-between text-slate-600"><span>De eso, vencido</span><span className={`font-medium ${data.cartera.vencido > 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(data.cartera.vencido)}</span></div>
                {data.cartera.ventas_fiado > 0 && <div className="flex justify-between text-slate-600"><span>Fiado del día</span><span className="font-medium text-slate-800">{money(data.cartera.ventas_fiado)}</span></div>}
                {data.cartera.abonos > 0 && <div className="flex justify-between text-slate-600"><span>Abonos cobrados</span><span className="font-medium text-emerald-700">{money(data.cartera.abonos)}</span></div>}
              </div>
            )}

            {(data.stock.sin_stock > 0 || data.stock.bajo_minimo > 0) && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
                Inventario hoy: <strong>{data.stock.sin_stock}</strong> {data.stock.sin_stock === 1 ? 'producto sin stock' : 'productos sin stock'} y <strong>{data.stock.bajo_minimo}</strong> bajo el mínimo.
              </div>
            )}
          </div>

          <div className="no-print flex gap-2 flex-wrap">
            <a href={'https://wa.me/?text=' + encodeURIComponent(text())} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"><MessageCircle className="w-4 h-4" /> WhatsApp</a>
            <button onClick={copy} className="inline-flex items-center gap-1.5 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-700"><Copy className="w-4 h-4" /> Copiar</button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"><Printer className="w-4 h-4" /> Imprimir</button>
          </div>
          <p className="no-print text-[11px] text-slate-400 leading-relaxed">Las ventas anuladas no cuentan. «Entró a caja» incluye ventas en efectivo, abonos en efectivo e ingresos manuales. El día se mide con la hora de tu teléfono.</p>
        </>
      )}
    </div>
  )
}
