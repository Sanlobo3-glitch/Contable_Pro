import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Printer, Download } from 'lucide-react'
import ReportBody from '../components/ReportBody'
import { CompanyHeader, ReportFooter } from '../components/ReportHeader'
import { downloadCsv } from '../lib/csv'
import { PERIODS, TABS, PRINT_CSS, toInputValue, getRange, periodLabel, isAnulled, num, sum, movementLabel, signedAmount, type Period, type Tab } from '../lib/reportUtils'

export default function Reports() {
  const [period, setPeriod] = useState<Period>('mes')
  const [tab, setTab] = useState<Tab>('resumen')
  const [refDate, setRefDate] = useState<string>(toInputValue(new Date()))
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState<any>(null)
  const [sales, setSales] = useState<any[]>([])
  const [purchases, setPurchases] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [cash, setCash] = useState<any[]>([])
  const [devolutions, setDevolutions] = useState<any[]>([])
  const [purchaseDevolutions, setPurchaseDevolutions] = useState<any[]>([])
  const [kardex, setKardex] = useState<any[]>([])

  useEffect(() => {
    supabase.from('company_config').select('*').limit(1).maybeSingle().then(({ data }: { data: any }) => {
      if (data) setCompany(data)
    })
  }, [])

  useEffect(() => {
    if (!refDate) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { start, end } = getRange(period, new Date(refDate + 'T00:00:00'))
      const s = start.toISOString()
      const e = end.toISOString()
      const sDate = toInputValue(start)
      const eDate = toInputValue(end)
      const q = (table: string) =>
        supabase.from(table).select('*').gte('created_at', s).lt('created_at', e).order('created_at', { ascending: true })
      const qExp = supabase.from('expenses').select('*').gte('expense_date', sDate).lt('expense_date', eDate).order('expense_date', { ascending: true })
      const [sa, pu, ex, ca, de, pde, ka] = await Promise.all([
        q('sales'),
        q('purchases'),
        qExp,
        q('cash_entries'),
        q('devolutions'),
        q('purchase_devolutions'),
        q('kardex'),
      ])
      if (cancelled) return
      setSales(sa.data || [])
      setPurchases(pu.data || [])
      setExpenses(ex.error ? [] : (ex.data || []))
      setCash(ca.data || [])
      setDevolutions(de.data || [])
      setPurchaseDevolutions(pde.error ? [] : (pde.data || []))
      setKardex(ka.data || [])
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [period, refDate])

  const { start, end } = getRange(period, refDate ? new Date(refDate + 'T00:00:00') : new Date())
  const label = periodLabel(period, start, end)
  const periodTitle = PERIODS.find(p => p.id === period)?.title ?? 'Reporte'
  const tabLabel = TABS.find(t => t.id === tab)?.label ?? ''

  function exportExcel() {
    const filePrefix = `reporte_${tab}_${refDate}`
    if (tab === 'ventas') {
      downloadCsv(
        `${filePrefix}.csv`,
        ['Fecha', 'Cliente', 'Canal', 'Método de pago', 'Total', 'Estado'],
        sales.map(s => [
          s.created_at ? new Date(s.created_at).toLocaleString() : '',
          s.customer_name || 'Cliente general',
          s.channel || 'ruta',
          s.payment_method || '',
          num(s.total),
          s.status || '',
        ])
      )
      return
    }
    if (tab === 'compras') {
      downloadCsv(
        `${filePrefix}.csv`,
        ['Fecha', 'Proveedor', 'Condición de pago', 'Vencimiento', 'Total', 'Estado'],
        purchases.map(p => [
          p.created_at ? new Date(p.created_at).toLocaleString() : '',
          p.supplier_name || 'Proveedor general',
          p.payment_method || 'efectivo',
          p.due_date || '',
          num(p.total),
          p.status || '',
        ])
      )
      return
    }
    if (tab === 'gastos') {
      downloadCsv(
        `${filePrefix}.csv`,
        ['Fecha comprobante', 'Categoría', 'Concepto', 'Beneficiario', 'Referencia', 'Método de pago', 'Monto', 'Estado'],
        expenses.map(g => [
          g.expense_date || (g.created_at ? new Date(g.created_at).toLocaleDateString() : ''),
          g.category_name || '',
          g.description || '',
          g.beneficiary || '',
          g.reference || '',
          g.method || '',
          num(g.amount),
          g.status || '',
        ])
      )
      return
    }
    if (tab === 'caja') {
      let running = 0
      downloadCsv(
        `${filePrefix}.csv`,
        ['Fecha', 'Tipo', 'Descripción', 'Origen', 'Monto con signo', 'Saldo acumulado'],
        cash.map(c => {
          const signed = signedAmount(c.type, c.amount)
          running = Math.round((running + signed) * 100) / 100
          return [
            c.created_at ? new Date(c.created_at).toLocaleString() : '',
            movementLabel(c.type),
            c.description || '',
            c.reference_type || 'manual',
            signed,
            running,
          ]
        })
      )
      return
    }
    if (tab === 'devoluciones') {
      const rowsCust = devolutions.map(d => [
        'Cliente (Venta)',
        d.created_at ? new Date(d.created_at).toLocaleString() : '',
        d.sale_id ? `VTA-${String(d.sale_id).slice(0, 8).toUpperCase()}` : '',
        d.product_name || '',
        num(d.quantity),
        num(d.amount),
        d.refund_method || 'efectivo',
        d.reason || '',
        'activa',
      ])
      const rowsSup = purchaseDevolutions.map(d => [
        'Proveedor (Compra)',
        d.created_at ? new Date(d.created_at).toLocaleString() : '',
        d.purchase_id ? `CMP-${String(d.purchase_id).slice(0, 8).toUpperCase()}` : '',
        d.product_name || '',
        num(d.quantity),
        num(d.amount),
        d.refund_method || '',
        d.reason || '',
        d.status || 'activa',
      ])
      downloadCsv(
        `${filePrefix}.csv`,
        ['Origen', 'Fecha', 'Documento', 'Producto', 'Cantidad', 'Monto', 'Reembolso / Reintegro', 'Motivo', 'Estado'],
        [...rowsCust, ...rowsSup]
      )
      return
    }
    if (tab === 'kardex') {
      downloadCsv(
        `${filePrefix}.csv`,
        ['Fecha', 'Producto', 'Movimiento', 'Cantidad', 'Saldo final', 'Referencia'],
        kardex.map(k => [
          k.created_at ? new Date(k.created_at).toLocaleString() : '',
          k.product_name || '',
          k.type || '',
          num(k.quantity),
          num(k.balance),
          k.reference_type || '',
        ])
      )
      return
    }
    // Resumen ejecutivo
    const vAct = sales.filter(s => !isAnulled(s?.status))
    const cAct = purchases.filter(p => !isAnulled(p?.status))
    const gAct = expenses.filter(g => !isAnulled(g?.status))
    const dpAct = purchaseDevolutions.filter(d => !isAnulled(d?.status))
    const totV = sum(vAct, s => num(s.total))
    const totC = sum(cAct, p => num(p.total))
    const totG = sum(gAct, g => num(g.amount))
    const totD = sum(devolutions, d => num(d.amount))
    const totDP = sum(dpAct, d => num(d.amount))
    const entCaja = sum(cash.filter(c => signedAmount(c.type, c.amount) > 0), c => signedAmount(c.type, c.amount))
    const salCaja = sum(cash.filter(c => signedAmount(c.type, c.amount) < 0), c => Math.abs(signedAmount(c.type, c.amount)))

    downloadCsv(
      `${filePrefix}.csv`,
      ['Indicador', 'Período', 'Valor'],
      [
        ['Ventas netas activas', label, totV],
        ['Cantidad de ventas activas', label, vAct.length],
        ['Compras recibidas activas', label, totC],
        ['Devoluciones a proveedores activas', label, totDP],
        ['Gastos operativos activos', label, totG],
        ['Devoluciones de clientes (ventas)', label, totD],
        ['Flujo comercial neto (Ventas - Compras netas - Devoluciones - Gastos)', label, Math.round((totV - (totC - totDP) - totD - totG) * 100) / 100],
        ['Entradas de caja', label, entCaja],
        ['Salidas de caja', label, salCaja],
        ['Saldo neto de caja en el período', label, Math.round((entCaja - salCaja) * 100) / 100],
      ]
    )
  }

  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${active ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Reportes</h1>
            <p className="text-sm text-slate-500 mt-1">Elige el módulo y el período para imprimir o descargar en Excel</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={exportExcel}
              disabled={loading}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> Descargar Excel
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700"
            >
              <Printer className="w-4 h-4" /> Imprimir
            </button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={btn(tab === t.id)}>{t.label}</button>)}
        </div>
        <div className="flex gap-2 overflow-x-auto py-2">
          {PERIODS.map(p => <button key={p.id} onClick={() => setPeriod(p.id)} className={btn(period === p.id)}>{p.label}</button>)}
        </div>
        <div className="flex items-center gap-2 pb-4">
          <label className="text-xs text-slate-500">Fecha de referencia</label>
          <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        </div>
      </div>

      <div className="print-area bg-white rounded-xl border border-slate-200 p-5">
        <CompanyHeader
          company={company}
          periodTitle={periodTitle}
          tabLabel={tabLabel}
          periodLabel={label}
        />
        <div className="print-content">
          <ReportBody tab={tab} loading={loading} sales={sales} purchases={purchases} expenses={expenses} cash={cash} devolutions={devolutions} purchaseDevolutions={purchaseDevolutions} kardex={kardex} />
        </div>
        <ReportFooter />
      </div>
    </div>
  )
}
