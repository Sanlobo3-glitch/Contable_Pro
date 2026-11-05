import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  TrendingUp,
  Package,
  ShoppingCart,
  Users,
  RefreshCw,
  ArrowUpRight,
} from 'lucide-react'
import { useCurrency } from '../lib/currency'
import {
  InteractiveTrendChart,
  SellerPerformanceBars,
  type TrendPoint,
  type SellerBarItem,
} from '../components/PerformanceCharts'
import type { TeamPayrollMember } from '../types'

interface StockStats {
  products_count: number
  low_stock_count: number
  stock_cost_value: number
  stock_retail_value: number
}

interface SaleRowLite {
  total: number
  payment_method: string
  channel?: string | null
  created_at: string
}

type HorizonMonths = 6 | 12
type FocusSection = 'revenue' | 'inventory' | 'payments' | 'sellers'

const METHOD_NAMES: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  fiado: 'Crédito / Fiado',
}

function formatMonthLabel(ym: string): { shortLabel: string; fullLabel: string } {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return { shortLabel: ym, fullLabel: ym }
  const dt = new Date(y, m - 1, 1)
  return {
    shortLabel: dt.toLocaleDateString('es', { month: 'short' }),
    fullLabel: dt.toLocaleDateString('es', { month: 'long', year: 'numeric' }),
  }
}

export default function Stats({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { fmt: money } = useCurrency()
  const [monthsCount, setMonthsCount] = useState<HorizonMonths>(6)
  const [focus, setFocus] = useState<FocusSection>('revenue')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  const [stock, setStock] = useState<StockStats>({
    products_count: 0,
    low_stock_count: 0,
    stock_cost_value: 0,
    stock_retail_value: 0,
  })
  const [monthly, setMonthly] = useState<{ month: string; total: number }[]>([])
  const [recentSales, setRecentSales] = useState<SaleRowLite[]>([])
  const [sellerItems, setSellerItems] = useState<SellerBarItem[]>([])

  const load = useCallback(async () => {
    setSyncing(true)
    setError('')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const now = new Date()
    const monthYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const nextMonthIso = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    const start30dIso = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).toISOString()

    try {
      const [stRes, msRes, salesRes, teamRes, perfRes] = await Promise.all([
        supabase.rpc('dashboard_stats'),
        supabase.rpc('monthly_sales', { p_tz: tz, p_months: monthsCount }),
        supabase
          .from('sales')
          .select('total, payment_method, channel, created_at')
          .neq('status', 'anulada')
          .gte('created_at', start30dIso)
          .limit(800),
        supabase.rpc('listar_nomina_equipo'),
        supabase.rpc('metas_progreso', { p_month: monthYmd, p_from: monthStartIso, p_to: nextMonthIso }),
      ])

      if (stRes.error) throw new Error(stRes.error.message)
      if (msRes.error) throw new Error(msRes.error.message)

      const rawSt = (stRes.data || {}) as Partial<StockStats>
      setStock({
        products_count: Number(rawSt.products_count) || 0,
        low_stock_count: Number(rawSt.low_stock_count) || 0,
        stock_cost_value: Number(rawSt.stock_cost_value) || 0,
        stock_retail_value: Number(rawSt.stock_retail_value) || 0,
      })

      setMonthly(
        ((msRes.data || []) as { month: string; total: number }[])
          .map(m => ({ month: m.month, total: Number(m.total) || 0 }))
          .sort((a, b) => a.month.localeCompare(b.month))
      )

      setRecentSales((salesRes.data || []) as SaleRowLite[])

      let roster: TeamPayrollMember[] = []
      if (!teamRes.error && Array.isArray(teamRes.data)) {
        roster = teamRes.data as TeamPayrollMember[]
      } else {
        const fb = await supabase.rpc('list_team')
        if (!fb.error && Array.isArray(fb.data)) {
          roster = (fb.data as Record<string, unknown>[]).map(r => ({
            id: String(r.id || ''),
            email: String(r.email || ''),
            full_name: (r.full_name as string | null) ?? null,
            role: ((r.role as 'vendedor' | 'dueno' | 'admin') || 'vendedor'),
            active: r.active !== false,
            base_salary: 0,
            commission_pct: 0,
          }))
        }
      }

      const pMap = new Map<string, Record<string, unknown>>()
      if (!perfRes.error && Array.isArray(perfRes.data)) {
        for (const r of perfRes.data as Record<string, unknown>[]) {
          pMap.set(String(r.r_seller_id || ''), r)
        }
      }

      const sellers = roster.filter(m => m.role === 'vendedor')
      const targetList = sellers.length > 0 ? sellers : roster
      setSellerItems(
        targetList
          .map(m => {
            const p = pMap.get(m.id)
            const salesAmt = Number(p?.r_sales_total) || 0
            return {
              id: m.id,
              name: m.full_name || m.email,
              email: m.email,
              avatar_url: m.avatar_url,
              zone: m.zone || m.job_title || null,
              sales: salesAmt,
              goal: Number(p?.r_sales_goal) || 0,
              commission: salesAmt * ((Number(m.commission_pct) || 0) / 100),
              clients: Number(p?.r_clients) || 0,
              salesCount: Number(p?.r_sales_count) || 0,
              active: m.active,
            }
          })
          .sort((a, b) => b.sales - a.sales)
      )
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las estadísticas.')
    } finally {
      setSyncing(false)
      setLoading(false)
    }
  }, [monthsCount])

  useEffect(() => {
    void load()
  }, [load])

  const monthlyTrendPoints = useMemo<TrendPoint[]>(() => {
    return monthly.map(m => {
      const lbl = formatMonthLabel(m.month)
      return {
        key: m.month,
        label: lbl.fullLabel,
        shortLabel: lbl.shortLabel,
        primary: m.total,
      }
    })
  }, [monthly])

  const kpiSummary = useMemo(() => {
    const periodRevenue = monthly.reduce((acc, m) => acc + m.total, 0)
    const monthlyAvg = monthly.length > 0 ? periodRevenue / monthly.length : 0
    const potentialMargin = Math.max(0, stock.stock_retail_value - stock.stock_cost_value)

    const sales30dTotal = recentSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0)
    const avgTicket30d = recentSales.length > 0 ? sales30dTotal / recentSales.length : 0

    const byMethod: Record<string, { total: number; count: number }> = {
      efectivo: { total: 0, count: 0 },
      transferencia: { total: 0, count: 0 },
      tarjeta: { total: 0, count: 0 },
      fiado: { total: 0, count: 0 },
    }
    for (const s of recentSales) {
      const key = s.payment_method || 'efectivo'
      if (!byMethod[key]) byMethod[key] = { total: 0, count: 0 }
      byMethod[key].total += Number(s.total) || 0
      byMethod[key].count += 1
    }

    const topSeller = sellerItems[0] || null

    return {
      periodRevenue,
      monthlyAvg,
      potentialMargin,
      sales30dTotal,
      avgTicket30d,
      byMethod,
      topSeller,
    }
  }, [monthly, stock, recentSales, sellerItems])

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Estadísticas y rendimiento
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            KPIs interactivos de facturación, rotación de inventario, medios de cobro y desempeño comercial.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {([6, 12] as HorizonMonths[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMonthsCount(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors tabular-nums ${
                  monthsCount === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m} meses
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs">
          No se pudieron cargar las estadísticas: {error}
        </div>
      )}

      {/* 4 KPIs interactivos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => {
            setFocus('revenue')
            void load()
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            focus === 'revenue' ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              Facturación ({monthsCount}m)
            </span>
            <span className="text-[11px] text-slate-400">Tendencia</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{money(kpiSummary.periodRevenue)}</p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            Promedio mensual: {money(kpiSummary.monthlyAvg)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setFocus('inventory')
            void load()
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            focus === 'inventory'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Package className="w-4 h-4 text-blue-600" />
              Inventario valorizado
            </span>
            <span className="text-[11px] text-slate-400 tabular-nums">{stock.products_count} prod.</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{money(stock.stock_cost_value)}</p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            Venta est. {money(stock.stock_retail_value)} · Margen {money(kpiSummary.potentialMargin)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setFocus('payments')
            void load()
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            focus === 'payments' ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShoppingCart className="w-4 h-4 text-slate-700" />
              Ticket promedio (30d)
            </span>
            <span className="text-[11px] text-slate-400 tabular-nums">{recentSales.length} op.</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{money(kpiSummary.avgTicket30d)}</p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            Últimos 30 días: {money(kpiSummary.sales30dTotal)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setFocus('sellers')
            void load()
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            focus === 'sellers' ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Users className="w-4 h-4 text-amber-600" />
              Líder del mes
            </span>
            <span className="text-[11px] text-slate-400">Equipo</span>
          </div>
          <p className="text-xl font-bold text-slate-900 truncate">
            {kpiSummary.topSeller ? kpiSummary.topSeller.name : 'Sin ventas aún'}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {kpiSummary.topSeller
              ? `${money(kpiSummary.topSeller.sales)} · ${kpiSummary.topSeller.salesCount} ventas`
              : 'Vincula vendedores en Nómina'}
          </p>
        </button>
      </div>

      {/* Gráfico interactivo mensual */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Evolución mensual de ventas ({monthsCount} meses)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pasa el cursor o haz clic sobre cualquier mes para inspeccionar el monto exacto facturado (excluye ventas anuladas).
            </p>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 self-start sm:self-auto whitespace-nowrap"
            >
              Abrir reportes detallados
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Cargando serie histórica...</div>
        ) : (
          <InteractiveTrendChart
            points={monthlyTrendPoints}
            primaryLabel="Ventas del mes"
            formatValue={money}
            primaryColor="#0f172a"
            height={220}
          />
        )}
      </section>

      {/* Fila inferior: Distribución por medio de pago + Ranking de vendedores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Composición por medio de cobro (30 días)</h2>
              <p className="text-xs text-slate-500 mt-0.5">Participación sobre {money(kpiSummary.sales30dTotal)}</p>
            </div>
            {stock.low_stock_count > 0 && onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('products')}
                className="text-xs font-medium text-amber-700 hover:underline whitespace-nowrap tabular-nums"
              >
                {stock.low_stock_count} con stock bajo →
              </button>
            )}
          </div>

          <div className="space-y-3">
            {Object.entries(kpiSummary.byMethod).map(([method, info]) => {
              const share =
                kpiSummary.sales30dTotal > 0 ? Math.round((info.total / kpiSummary.sales30dTotal) * 100) : 0
              return (
                <div key={method} className="space-y-1">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-medium text-slate-800">{METHOD_NAMES[method] || method}</span>
                    <span className="text-slate-600">
                      <strong className="text-slate-900">{money(info.total)}</strong> · {share}% ({info.count} op.)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-slate-900 transition-all"
                      style={{ width: `${Math.max(info.total > 0 ? 3 : 0, share)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Rendimiento de vendedores (mes actual)</h2>
              <p className="text-xs text-slate-500 mt-0.5">Avance frente a metas y comisiones estimadas</p>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('sellers')}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap"
              >
                Nómina de vendedores
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <SellerPerformanceBars
            items={sellerItems}
            formatMoney={money}
            onSelect={() => onNavigate?.('sellers')}
          />
        </section>
      </div>
    </div>
  )
}
