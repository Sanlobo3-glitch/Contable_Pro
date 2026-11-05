import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isCompanyManager, canViewAccounting, isReadOnly } from '../lib/auth'
import { useWarehouse } from '../lib/warehouseContext'
import { useCurrency } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import { HBars } from '../components/MiniCharts'
import {
  Building2,
  Printer,
  Download,
  RefreshCw,
  CheckCircle2,
  ArrowUpRight,
  AlertTriangle,
} from 'lucide-react'

type PeriodKey = 'month' | 'prev_month' | 'quarter' | 'year'

interface CostCenterColumn {
  id: string
  code: string
  name: string
  grossSales: number
  discountsAndReturns: number
  netRevenue: number
  cogs: number
  grossProfit: number
  grossMarginPct: number
  operatingExpenses: number
  contribution: number
  contributionPct: number
  purchasesVolume: number
  salesCount: number
}

interface UnassignedItem {
  table: 'expenses' | 'purchases'
  id: string
  date: string
  title: string
  subtitle: string
  amount: number
}

const PRINT_CSS = `@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; } .no-print { display: none !important; } }`

function getPeriodBounds(period: PeriodKey): { fromIso: string; toIso: string; fromDate: string; toDate: string; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  if (period === 'prev_month') {
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 1)
    return {
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      fromDate: start.toLocaleDateString('sv-SE'),
      toDate: new Date(end.getTime() - 86400000).toLocaleDateString('sv-SE'),
      label: 'Mes anterior',
    }
  }
  if (period === 'quarter') {
    const qStartMonth = Math.floor(m / 3) * 3
    const start = new Date(y, qStartMonth, 1)
    const end = new Date(y, m + 1, 1)
    return {
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      fromDate: start.toLocaleDateString('sv-SE'),
      toDate: now.toLocaleDateString('sv-SE'),
      label: 'Trimestre en curso',
    }
  }
  if (period === 'year') {
    const start = new Date(y, 0, 1)
    const end = new Date(y, m + 1, 1)
    return {
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      fromDate: `${y}-01-01`,
      toDate: now.toLocaleDateString('sv-SE'),
      label: `Acumulado ${y}`,
    }
  }

  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 1)
  return {
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
    fromDate: start.toLocaleDateString('sv-SE'),
    toDate: now.toLocaleDateString('sv-SE'),
    label: 'Mes en curso',
  }
}

export default function CostCenters({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const { branches, warehouses } = useWarehouse()

  const canAccess = isCompanyManager(user?.role) || canViewAccounting(user?.role)
  const readOnly = isReadOnly(user)

  const [period, setPeriod] = useState<PeriodKey>('month')
  const [loading, setLoading] = useState(true)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [sqlBranchAttrReady, setSqlBranchAttrReady] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [salesRows, setSalesRows] = useState<any[]>([])
  const [devRows, setDevRows] = useState<any[]>([])
  const [expRows, setExpRows] = useState<any[]>([])
  const [purRows, setPurRows] = useState<any[]>([])
  const [productCostMap, setProductCostMap] = useState<Map<string, { cost: number; price: number }>>(new Map())

  const bounds = useMemo(() => getPeriodBounds(period), [period])

  const load = useCallback(async () => {
    if (!canAccess) {
      setLoading(false)
      return
    }
    setLoading(true)
    setMsg(null)

    try {
      const [prodsRes, sRes, dRes, eRes, pRes] = await Promise.all([
        supabase.from('products').select('id,price,cost').limit(5000),
        supabase.from('sales').select('*').gte('created_at', bounds.fromIso).lt('created_at', bounds.toIso).limit(5000),
        supabase.from('devolutions').select('sale_id,amount,created_at').gte('created_at', bounds.fromIso).lt('created_at', bounds.toIso),
        supabase.from('expenses').select('*').gte('expense_date', bounds.fromDate).lte('expense_date', bounds.toDate),
        supabase.from('purchases').select('*').gte('created_at', bounds.fromIso).lt('created_at', bounds.toIso),
      ])

      const pMap = new Map<string, { cost: number; price: number }>()
      for (const p of (prodsRes.data || []) as any[]) {
        pMap.set(String(p.id), { cost: Number(p.cost) || 0, price: Number(p.price) || 0 })
      }
      setProductCostMap(pMap)
      setSalesRows((sRes.data || []) as any[])
      setDevRows((dRes.data || []) as any[])
      setExpRows((eRes.data || []) as any[])
      setPurRows((pRes.data || []) as any[])
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al consolidar centros de costo' })
    }

    setLoading(false)
  }, [canAccess, bounds])

  useEffect(() => {
    void load()
  }, [load])

  // Mapa rápido warehouse_id -> branch_id
  const whToBranch = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of warehouses) {
      if (w.branch_id) m.set(w.id, w.branch_id)
    }
    return m
  }, [warehouses])

  const mainBranchId = useMemo(
    () => branches.find(b => b.is_main)?.id || branches[0]?.id || null,
    [branches]
  )

  // Cálculo del Estado de Resultados por Sucursal / Unidad de Negocio
  const { columns, consolidated, unassignedItems } = useMemo(() => {
    const activeBranches = branches.filter(b => b.active)
    const colIds = [...activeBranches.map(b => b.id), '__unassigned__']

    const initBucket = (id: string, code: string, name: string): CostCenterColumn => ({
      id,
      code,
      name,
      grossSales: 0,
      discountsAndReturns: 0,
      netRevenue: 0,
      cogs: 0,
      grossProfit: 0,
      grossMarginPct: 0,
      operatingExpenses: 0,
      contribution: 0,
      contributionPct: 0,
      purchasesVolume: 0,
      salesCount: 0,
    })

    const bucketMap = new Map<string, CostCenterColumn>()
    for (const b of activeBranches) {
      bucketMap.set(b.id, initBucket(b.id, b.code || 'SEDE', b.name))
    }
    bucketMap.set('__unassigned__', initBucket('__unassigned__', 'CORP', 'Corporativo / Sin sede'))

    // Costo medio ponderado de respaldo cuando una venta no trae desglose de items en la consulta
    let sumC = 0
    let sumP = 0
    productCostMap.forEach(v => {
      if (v.price > 0 && v.cost > 0) {
        sumC += v.cost
        sumP += v.price
      }
    })
    const fallbackCostRatio = sumP > 0 ? sumC / sumP : 0.65

    const saleBranchById = new Map<string, string>()

    for (const s of salesRows) {
      if (s.status === 'anulada') continue
      const resolvedBranch =
        s.branch_id ||
        (s.warehouse_id ? whToBranch.get(s.warehouse_id) : null) ||
        (activeBranches.length === 1 ? mainBranchId : null) ||
        '__unassigned__'

      const targetKey = bucketMap.has(resolvedBranch) ? resolvedBranch : '__unassigned__'
      saleBranchById.set(String(s.id), targetKey)

      const col = bucketMap.get(targetKey)!
      const disc = Number(s.discount_amount) || 0
      const net = Number(s.total) || 0
      col.grossSales += net + disc
      col.discountsAndReturns += disc
      col.salesCount += 1

      if (Array.isArray(s.items) && s.items.length > 0) {
        let saleCogs = 0
        for (const it of s.items) {
          const prodInfo = productCostMap.get(String(it.product_id))
          const unitCost = prodInfo ? prodInfo.cost : (Number(it.price) || 0) * fallbackCostRatio
          saleCogs += (Number(it.quantity) || 0) * unitCost
        }
        col.cogs += saleCogs
      } else {
        col.cogs += net * fallbackCostRatio
      }
    }

    for (const dv of devRows) {
      const targetKey = saleBranchById.get(String(dv.sale_id)) || '__unassigned__'
      const col = bucketMap.get(targetKey)
      if (col) col.discountsAndReturns += Number(dv.amount) || 0
    }

    const pendingAssign: UnassignedItem[] = []

    for (const e of expRows) {
      if (e.status === 'anulado') continue
      const bKey = e.branch_id && bucketMap.has(e.branch_id) ? e.branch_id : '__unassigned__'
      bucketMap.get(bKey)!.operatingExpenses += Number(e.amount) || 0
      if (bKey === '__unassigned__' && activeBranches.length > 0) {
        pendingAssign.push({
          table: 'expenses',
          id: String(e.id),
          date: String(e.expense_date || '').slice(0, 10),
          title: String(e.description || e.category_name || 'Gasto operativo'),
          subtitle: `Gasto · ${e.category_name || 'General'}`,
          amount: Number(e.amount) || 0,
        })
      }
    }

    for (const p of purRows) {
      if (p.status === 'anulada') continue
      const resolvedPurBranch =
        p.branch_id || (p.warehouse_id ? whToBranch.get(p.warehouse_id) : null) || '__unassigned__'
      const bKey = bucketMap.has(resolvedPurBranch) ? resolvedPurBranch : '__unassigned__'
      bucketMap.get(bKey)!.purchasesVolume += Number(p.total) || 0
      if (bKey === '__unassigned__' && activeBranches.length > 0) {
        pendingAssign.push({
          table: 'purchases',
          id: String(p.id),
          date: String(p.created_at || '').slice(0, 10),
          title: `Compra · ${p.supplier_name || 'Proveedor general'}`,
          subtitle: `CMP-${String(p.id).slice(0, 6).toUpperCase()}`,
          amount: Number(p.total) || 0,
        })
      }
    }

    const computedCols: CostCenterColumn[] = []
    for (const id of colIds) {
      const c = bucketMap.get(id)!
      if (
        id === '__unassigned__' &&
        c.grossSales === 0 &&
        c.operatingExpenses === 0 &&
        c.purchasesVolume === 0 &&
        activeBranches.length > 0
      ) {
        continue
      }
      c.netRevenue = Math.max(0, c.grossSales - c.discountsAndReturns)
      c.grossProfit = c.netRevenue - c.cogs
      c.grossMarginPct = c.netRevenue > 0 ? (c.grossProfit / c.netRevenue) * 100 : 0
      c.contribution = c.grossProfit - c.operatingExpenses
      c.contributionPct = c.netRevenue > 0 ? (c.contribution / c.netRevenue) * 100 : 0
      computedCols.push(c)
    }

    const totalCol = initBucket('__total__', 'TOTAL', 'Consolidado Empresa')
    for (const c of computedCols) {
      totalCol.grossSales += c.grossSales
      totalCol.discountsAndReturns += c.discountsAndReturns
      totalCol.netRevenue += c.netRevenue
      totalCol.cogs += c.cogs
      totalCol.grossProfit += c.grossProfit
      totalCol.operatingExpenses += c.operatingExpenses
      totalCol.contribution += c.contribution
      totalCol.purchasesVolume += c.purchasesVolume
      totalCol.salesCount += c.salesCount
    }
    totalCol.grossMarginPct = totalCol.netRevenue > 0 ? (totalCol.grossProfit / totalCol.netRevenue) * 100 : 0
    totalCol.contributionPct = totalCol.netRevenue > 0 ? (totalCol.contribution / totalCol.netRevenue) * 100 : 0

    return {
      columns: computedCols,
      consolidated: totalCol,
      unassignedItems: pendingAssign.slice(0, 12),
    }
  }, [branches, salesRows, devRows, expRows, purRows, productCostMap, whToBranch, mainBranchId])

  async function assignToBranch(item: UnassignedItem, branchId: string) {
    if (!branchId || readOnly) return
    setAssigningId(item.id)
    const { error } = await supabase.rpc('asignar_centro_costo_operacion', {
      p_table: item.table,
      p_id: item.id,
      p_branch_id: branchId,
    })
    setAssigningId(null)

    if (error) {
      if (/asignar_centro_costo_operacion|does not exist|schema cache/i.test(error.message || '')) {
        setSqlBranchAttrReady(false)
        setMsg({
          ok: false,
          text: 'Ejecuta en Supabase la migración 20261103000013_tesoreria_centros_costo_ordenes_compra.sql para habilitar la imputación directa por sucursal.',
        })
        return
      }
      setMsg({ ok: false, text: error.message })
      return
    }

    setMsg({ ok: true, text: 'Operación imputada al centro de costo seleccionado.' })
    await load()
  }

  function exportCsv() {
    const headers = ['Rubro Estado de Resultados', ...columns.map(c => c.name), 'Consolidado Total']
    const line = (label: string, getter: (c: CostCenterColumn) => string | number) => [
      label,
      ...columns.map(c => getter(c)),
      getter(consolidated),
    ]
    downloadCsv(`estado_resultados_centros_costo_${period}.csv`, headers, [
      line('Ventas brutas', c => c.grossSales.toFixed(2)),
      line('Descuentos y devoluciones', c => (-c.discountsAndReturns).toFixed(2)),
      line('Ingresos operativos netos', c => c.netRevenue.toFixed(2)),
      line('Costo de mercancía vendida', c => (-c.cogs).toFixed(2)),
      line('Utilidad bruta', c => c.grossProfit.toFixed(2)),
      line('Margen bruto %', c => `${c.grossMarginPct.toFixed(1)}%`),
      line('Gastos operativos directos', c => (-c.operatingExpenses).toFixed(2)),
      line('Contribución neta de sede', c => c.contribution.toFixed(2)),
      line('Margen de contribución %', c => `${c.contributionPct.toFixed(1)}%`),
    ])
  }

  if (!canAccess) {
    return <p className="text-sm text-slate-500">No tienes permiso para consultar Centros de Costo.</p>
  }

  const COLORS = ['#0f172a', '#059669', '#2563eb', '#d97706', '#7c3aed']

  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>

      {/* Cabecera */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Centros de Costo y Resultados por Sede</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Estado de resultados comparativo por sucursal/unidad de negocio ({bounds.label}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
            {(
              [
                ['month', 'Este mes'],
                ['prev_month', 'Mes anterior'],
                ['quarter', 'Trimestre'],
                ['year', 'Año'],
              ] as [PeriodKey, string][]
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPeriod(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  period === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" /> Imprimir
          </button>

          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            title="Actualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {msg && (
        <p
          className={`no-print text-xs px-3.5 py-2.5 rounded-lg border ${
            msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {msg.text}
        </p>
      )}

      {branches.length === 0 && !loading && (
        <div className="no-print bg-white rounded-xl border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Building2 className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-slate-900">Estructura tus sucursales o unidades de negocio</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Crea tus sedes en «Sedes y multibodega» para desglosar automáticamente ingresos, costos y gastos por cada unidad operativa.
              </p>
            </div>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('warehouses')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Configurar sedes <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Matriz P&L Comparativa por Centro de Costo */}
      <div className="print-area bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Estado de Resultados Analítico por Centro de Costo ({bounds.label})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Periodo: {bounds.fromDate} al {bounds.toDate}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                <th className="py-3 px-4 text-left font-semibold min-w-[210px]">Concepto</th>
                {columns.map(col => (
                  <th key={col.id} className="py-3 px-3 text-right font-semibold min-w-[140px]">
                    <div className="text-slate-900 truncate">{col.name}</div>
                    <div className="font-mono text-[10px] font-normal text-slate-400">{col.code}</div>
                  </th>
                ))}
                <th className="py-3 px-4 text-right font-bold text-slate-900 bg-slate-100/70 min-w-[150px]">
                  Consolidado Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-2.5 px-4 text-slate-700">+ Ventas brutas</td>
                {columns.map(c => (
                  <td key={c.id} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                    {money(c.grossSales)}
                  </td>
                ))}
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 bg-slate-50/60">
                  {money(consolidated.grossSales)}
                </td>
              </tr>

              <tr>
                <td className="py-2.5 px-4 text-slate-500">− Descuentos y devoluciones</td>
                {columns.map(c => (
                  <td key={c.id} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                    −{money(c.discountsAndReturns)}
                  </td>
                ))}
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 bg-slate-50/60">
                  −{money(consolidated.discountsAndReturns)}
                </td>
              </tr>

              <tr className="bg-slate-50/50 font-semibold">
                <td className="py-2.5 px-4 text-slate-900">= Ingresos operativos netos</td>
                {columns.map(c => (
                  <td key={c.id} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                    {money(c.netRevenue)}
                  </td>
                ))}
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 bg-slate-100/70">
                  {money(consolidated.netRevenue)}
                </td>
              </tr>

              <tr>
                <td className="py-2.5 px-4 text-slate-600">− Costo de mercancía vendida (CMV)</td>
                {columns.map(c => (
                  <td key={c.id} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                    −{money(c.cogs)}
                  </td>
                ))}
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 bg-slate-50/60">
                  −{money(consolidated.cogs)}
                </td>
              </tr>

              <tr className="font-semibold">
                <td className="py-2.5 px-4 text-slate-900">= Utilidad bruta comercial</td>
                {columns.map(c => (
                  <td key={c.id} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                    <div>{money(c.grossProfit)}</div>
                    <div className="text-[10px] font-normal text-slate-400">{c.grossMarginPct.toFixed(1)}%</div>
                  </td>
                ))}
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 bg-slate-100/70">
                  <div>{money(consolidated.grossProfit)}</div>
                  <div className="text-[10px] font-normal text-slate-500">{consolidated.grossMarginPct.toFixed(1)}%</div>
                </td>
              </tr>

              <tr>
                <td className="py-2.5 px-4 text-slate-600">− Gastos operativos imputados</td>
                {columns.map(c => (
                  <td key={c.id} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                    −{money(c.operatingExpenses)}
                  </td>
                ))}
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 bg-slate-50/60">
                  −{money(consolidated.operatingExpenses)}
                </td>
              </tr>

              <tr className="border-t-2 border-slate-300 font-bold">
                <td className="py-3 px-4 text-slate-900">= Contribución operativa neta</td>
                {columns.map(c => (
                  <td
                    key={c.id}
                    className={`py-3 px-3 text-right font-mono tabular-nums ${
                      c.contribution >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    <div>{money(c.contribution)}</div>
                    <div className="text-[10px] font-normal text-slate-500">{c.contributionPct.toFixed(1)}%</div>
                  </td>
                ))}
                <td
                  className={`py-3 px-4 text-right font-mono tabular-nums bg-slate-100/80 ${
                    consolidated.contribution >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  <div>{money(consolidated.contribution)}</div>
                  <div className="text-[10px] font-normal text-slate-600">{consolidated.contributionPct.toFixed(1)}%</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparativa gráfica + Imputación rápida de gastos/compras sin sede */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Aporte de ingresos netos por unidad de negocio</h3>
          <p className="text-xs text-slate-500 mb-3">Participación relativa de cada sucursal sobre la facturación total.</p>
          {columns.length === 0 ? (
            <p className="text-xs text-slate-400">Sin operaciones en el periodo.</p>
          ) : (
            <HBars
              format={money}
              items={columns.map((c, i) => ({
                label: `${c.name} (${c.salesCount} op.)`,
                value: c.netRevenue,
                of: consolidated.netRevenue > 0 ? consolidated.netRevenue : undefined,
                color: COLORS[i % COLORS.length],
              }))}
            />
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Imputación rápida de partidas corporativas</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Asigna gastos o compras generales a una sucursal específica en 1 clic.
              </p>
            </div>
            {!sqlBranchAttrReady && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
          </div>

          {branches.length === 0 ? (
            <p className="text-xs text-slate-400">Registra al menos una sucursal para habilitar la imputación directa.</p>
          ) : unassignedItems.length === 0 ? (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5 py-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Todos los gastos y compras del periodo cuentan con centro de costo asignado.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {unassignedItems.map(item => (
                <div key={`${item.table}-${item.id}`} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {item.subtitle} · {item.date} · <strong className="text-slate-800">{money(item.amount)}</strong>
                    </p>
                  </div>

                  {!readOnly && (
                    <select
                      disabled={assigningId === item.id}
                      defaultValue=""
                      onChange={e => {
                        if (e.target.value) void assignToBranch(item, e.target.value)
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-700 shrink-0 max-w-[175px]"
                    >
                      <option value="">Asignar a sede…</option>
                      {branches.filter(b => b.active).map(b => (
                        <option key={b.id} value={b.id}>
                          {b.code ? `${b.code} · ` : ''}{b.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
