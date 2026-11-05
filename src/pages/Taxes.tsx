import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting } from '../lib/auth'
import { useCurrency, fmtDate, fmtDateTime } from '../lib/currency'
import { Printer, Download } from 'lucide-react'
import { CompanyHeader, ReportFooter } from '../components/ReportHeader'
import { PERIODS, PRINT_CSS, toInputValue, getRange, periodLabel, type Period } from '../lib/reportUtils'

interface SaleRow {
  id: string
  created_at: string
  customer_name: string | null
  total: number | string
  subtotal: number | string | null
  tax_rate: number | string | null
  tax_amount: number | string | null
  status: string
  payment_method: string
}
interface Calc { id: string; at: Date; customer: string; base: number; tax: number; total: number; rate: number; breakdown: boolean }
interface Group { key: string; label: string; count: number; base: number; tax: number; total: number }

const PAGE = 1000
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function addTo(m: Map<string, Group>, key: string, label: string, c: Calc) {
  const g = m.get(key) ?? { key, label, count: 0, base: 0, tax: 0, total: 0 }
  g.count += 1; g.base += c.base; g.tax += c.tax; g.total += c.total
  m.set(key, g)
}

export default function Taxes() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = canViewAccounting(user?.role)
  const [period, setPeriod] = useState<Period>('mes')
  const [refDate, setRefDate] = useState<string>(toInputValue(new Date()))
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [company, setCompany] = useState<any>(null)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [showDetail, setShowDetail] = useState(false)

  useEffect(() => {
    supabase.from('company_config').select('*').limit(1).maybeSingle().then(({ data }: { data: any }) => { if (data) setCompany(data) })
  }, [])

  useEffect(() => {
    if (!refDate || !isManager) return
    let cancelled = false
    async function load() {
      setLoading(true); setErr('')
      const { start, end } = getRange(period, new Date(refDate + 'T00:00:00'))
      const all: SaleRow[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('sales')
          .select('id,created_at,customer_name,total,subtotal,tax_rate,tax_amount,status,payment_method')
          .gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1)
        if (cancelled) return
        if (error) {
          setErr(!navigator.onLine ? 'Sin conexión: este reporte necesita internet.' : 'No se pudo cargar el reporte: ' + error.message)
          setSales([]); setLoading(false)
          return
        }
        const rows = (data || []) as SaleRow[]
        all.push(...rows)
        if (rows.length < PAGE) break
      }
      setSales(all); setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [period, refDate, isManager])

  const { start, end } = getRange(period, refDate ? new Date(refDate + 'T00:00:00') : new Date())
  const label = periodLabel(period, start, end)
  const periodTitle = PERIODS.find(p => p.id === period)?.title ?? 'Reporte'

  const { calcs, voided } = useMemo(() => {
    const out: Calc[] = []
    let v = 0
    for (const s of sales) {
      if (s.status === 'anulada') { v++; continue }
      const total = Number(s.total) || 0
      const tax = Number(s.tax_amount) || 0
      const breakdown = s.subtotal !== null && s.subtotal !== undefined
      const base = breakdown ? Number(s.subtotal) || 0 : total - tax
      out.push({ id: s.id, at: new Date(s.created_at), customer: s.customer_name || 'Cliente general', base, tax, total, rate: tax > 0 ? Number(s.tax_rate) || 0 : 0, breakdown })
    }
    return { calcs: out, voided: v }
  }, [sales])

  const tot = useMemo(() => calcs.reduce((a, c) => ({ count: a.count + 1, base: a.base + c.base, tax: a.tax + c.tax, total: a.total + c.total, noBreak: a.noBreak + (c.breakdown ? 0 : 1) }), { count: 0, base: 0, tax: 0, total: 0, noBreak: 0 }), [calcs])

  const byRate = useMemo(() => {
    const m = new Map<string, Group>()
    for (const c of calcs) addTo(m, c.tax > 0 ? `r${c.rate}` : 'r0', c.tax > 0 ? `Impuesto ${c.rate}%` : 'Sin impuesto', c)
    return Array.from(m.values()).sort((a, b) => b.tax - a.tax)
  }, [calcs])

  const byTime = useMemo(() => {
    const monthly = period === 'trimestre' || period === 'semestre' || period === 'anio' || period === 'todo'
    const m = new Map<string, Group>()
    for (const c of calcs) {
      const k = monthly ? monthKey(c.at) : dayKey(c.at)
      const lbl = monthly
        ? fmtDate(c.at, { month: 'long', year: 'numeric' })
        : fmtDate(c.at, { weekday: 'short', day: '2-digit', month: 'short' })
      addTo(m, k, lbl, c)
    }
    return { monthly, rows: Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key)) }
  }, [calcs, period])

  function downloadCsv() {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [['Fecha', 'Cliente', 'Base', 'Tasa %', 'Impuesto', 'Total'].map(esc).join(',')]
    for (const c of calcs) lines.push([fmtDateTime(c.at), c.customer, c.base, c.rate, c.tax, c.total].map(esc).join(','))
    lines.push(['TOTAL', `${tot.count} venta(s)`, tot.base, '', tot.tax, tot.total].map(esc).join(','))
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `impuestos_${refDate || 'reporte'}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!isManager) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>

  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${active ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`
  const th = 'px-3 py-2 font-medium text-xs uppercase'
  const td = 'px-3 py-2'

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Impuestos</h1>
            <p className="text-sm text-slate-500 mt-1">Base, impuesto cobrado y total de tus ventas por período</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={downloadCsv} disabled={calcs.length === 0} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40">
              <Download className="w-4 h-4" /> <span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700">
              <Printer className="w-4 h-4" /> Imprimir
            </button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto py-2">
          {PERIODS.map(p => <button key={p.id} onClick={() => setPeriod(p.id)} className={btn(period === p.id)}>{p.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Fecha de referencia</label>
            <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={showDetail} onChange={e => setShowDetail(e.target.checked)} /> Incluir detalle de ventas
          </label>
        </div>
        {err && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">{err}</div>}
      </div>

      <div className="print-area bg-white rounded-xl border border-slate-200 p-5">
        <CompanyHeader company={company} periodTitle={periodTitle} tabLabel="Impuestos" periodLabel={label} />
        <div className="print-content">
          {loading ? (
            <p className="text-sm text-slate-400 py-8 text-center">Cargando...</p>
          ) : calcs.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No hay ventas en este período.</p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border border-slate-200 rounded-lg p-3"><p className="text-[11px] text-slate-500 uppercase">Ventas</p><p className="text-lg font-bold text-slate-800">{tot.count}</p></div>
                <div className="border border-slate-200 rounded-lg p-3"><p className="text-[11px] text-slate-500 uppercase">Base (sin impuesto)</p><p className="text-lg font-bold text-slate-800">{money(tot.base)}</p></div>
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3"><p className="text-[11px] text-amber-700 uppercase">Impuesto cobrado</p><p className="text-lg font-bold text-amber-800">{money(tot.tax)}</p></div>
                <div className="border border-slate-200 rounded-lg p-3"><p className="text-[11px] text-slate-500 uppercase">Total vendido</p><p className="text-lg font-bold text-slate-800">{money(tot.total)}</p></div>
              </div>

              <div>
                <h2 className="text-sm font-bold text-slate-700 mb-2">Por tasa de impuesto</h2>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600"><tr><th className={`${th} text-left`}>Concepto</th><th className={`${th} text-right`}>Ventas</th><th className={`${th} text-right`}>Base</th><th className={`${th} text-right`}>Impuesto</th><th className={`${th} text-right`}>Total</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {byRate.map(g => (
                        <tr key={g.key}><td className={td}>{g.label}</td><td className={`${td} text-right`}>{g.count}</td><td className={`${td} text-right`}>{money(g.base)}</td><td className={`${td} text-right`}>{money(g.tax)}</td><td className={`${td} text-right`}>{money(g.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h2 className="text-sm font-bold text-slate-700 mb-2">{byTime.monthly ? 'Por mes' : 'Por día'}</h2>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600"><tr><th className={`${th} text-left`}>{byTime.monthly ? 'Mes' : 'Día'}</th><th className={`${th} text-right`}>Ventas</th><th className={`${th} text-right`}>Base</th><th className={`${th} text-right`}>Impuesto</th><th className={`${th} text-right`}>Total</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {byTime.rows.map(g => (
                        <tr key={g.key}><td className={`${td} capitalize`}>{g.label}</td><td className={`${td} text-right`}>{g.count}</td><td className={`${td} text-right`}>{money(g.base)}</td><td className={`${td} text-right`}>{money(g.tax)}</td><td className={`${td} text-right`}>{money(g.total)}</td></tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-semibold text-slate-800">
                      <tr><td className={td}>Total</td><td className={`${td} text-right`}>{tot.count}</td><td className={`${td} text-right`}>{money(tot.base)}</td><td className={`${td} text-right`}>{money(tot.tax)}</td><td className={`${td} text-right`}>{money(tot.total)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {showDetail && (
                <div>
                  <h2 className="text-sm font-bold text-slate-700 mb-2">Detalle de ventas</h2>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600"><tr><th className={`${th} text-left`}>Fecha</th><th className={`${th} text-left`}>Cliente</th><th className={`${th} text-right`}>Base</th><th className={`${th} text-right`}>Impuesto</th><th className={`${th} text-right`}>Total</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {calcs.map(c => (
                          <tr key={c.id}><td className={`${td} whitespace-nowrap`}>{fmtDate(c.at)}</td><td className={td}>{c.customer}</td><td className={`${td} text-right`}>{money(c.base)}</td><td className={`${td} text-right`}>{money(c.tax)}</td><td className={`${td} text-right`}>{money(c.total)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="text-[11px] text-slate-400 space-y-1">
                {tot.noBreak > 0 && <p>{tot.noBreak} venta(s) son anteriores a la configuración de impuestos y no tienen desglose: se cuentan completas como base, sin impuesto.</p>}
                {voided > 0 && <p>{voided} venta(s) anulada(s) no se incluyen.</p>}
                <p>No descuenta devoluciones. El impuesto es el que quedó guardado en cada venta al registrarla.</p>
              </div>
            </div>
          )}
        </div>
        <ReportFooter note="Los totales no incluyen ventas anuladas ni descuentan devoluciones." />
      </div>
    </div>
  )
}
