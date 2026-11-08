import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  useAuth,
  isCompanyManager,
  canRegisterSales,
  canManageInventory,
  canViewAccounting,
  canManageTechSupport,
} from '../lib/auth'
import {
  ShoppingCart,
  AlertTriangle,
  Receipt,
  Banknote,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Store,
  Search,
  ArrowUpRight,
  Clock,
  ShoppingBasket,
  Plus,
  Calculator,
  LifeBuoy,
  Boxes,
  Bot,
  Truck,
  ShieldAlert,
  ArrowRight,
  CalendarClock,
  FileSpreadsheet,
} from 'lucide-react'
import { useCurrency, fmtDate, fmtNum } from '../lib/currency'
import { cacheGet, cacheSet } from '../lib/offlineQueue'
import { useCopilot, visibleAlerts } from '../lib/copilot'
import {
  getOmnichannelOrders,
  getAiActionProposals,
  getBranchBalanceSuggestions,
  getAnomalyRecords,
  getComplianceItems,
} from '../lib/innovationsRepo'
import {
  InteractiveTrendChart,
  SellerPerformanceBars,
  type TrendPoint,
  type SellerBarItem,
} from '../components/PerformanceCharts'
import type { TeamPayrollMember } from '../types'

interface DashStats {
  products_count: number
  customers_count: number
  sales_count: number
  revenue_total: number
  revenue_month: number
  low_stock_count: number
  low_stock_items: { name: string; stock: number; min_stock: number }[]
}

interface MyGoal {
  month: string
  sales_total: number
  sales_count: number
  clients: number
  sales_goal: number
  visits_goal: number
}

interface SaleLite {
  id: string
  total: number
  created_at: string
  customer_name: string | null
  payment_method: string
  status: string
  channel?: string | null
}

interface LowStockProduct {
  id: string
  name: string
  sku: string | null
  stock: number
  min_stock: number
  cost: number
  price: number
  unit: string | null
}

interface CreditorRow {
  supplier_id: string
  name: string
  document: string | null
  owed: number
  overdue: number
  oldest_due: string | null
  open_purchases: number
}

interface PayablesSummary {
  total_owed: number
  total_overdue: number
  suppliers: CreditorRow[]
  available: boolean
}

interface DebtorRow {
  customer_id: string
  name: string
  document: string | null
  owed: number
  overdue: number
  oldest_due: string | null
  open_sales: number
}

interface ReceivablesSummary {
  total_owed: number
  total_overdue: number
  customers: DebtorRow[]
  available: boolean
}

type KpiId = 'sales_today' | 'low_stock' | 'payables' | 'receivables'

const EMPTY_STATS: DashStats = {
  products_count: 0,
  customers_count: 0,
  sales_count: 0,
  revenue_total: 0,
  revenue_month: 0,
  low_stock_count: 0,
  low_stock_items: [],
}

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  fiado: 'Fiado',
}

const SEVERITY_LABEL: Record<string, { text: string; cls: string }> = {
  alta: { text: 'Urgente', cls: 'text-red-700' },
  media: { text: 'Atención', cls: 'text-amber-700' },
  baja: { text: 'Sugerencia', cls: 'text-slate-600' },
  info: { text: 'Nota', cls: 'text-slate-500' },
}

function formatDueDate(d: string | null): string {
  if (!d) return 'Sin fecha'
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString()
}

export default function Dashboard({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = isCompanyManager(user?.role)
  const canSell = canRegisterSales(user?.role)
  const canInventory = canManageInventory(user?.role)
  const showGoal = !!user && !isManager && canSell

  const [activeKpi, setActiveKpi] = useState<KpiId>('sales_today')
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshingKpi, setRefreshingKpi] = useState<KpiId | 'all' | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState('')

  const [stats, setStats] = useState<DashStats>(EMPTY_STATS)
  const [windowSales, setWindowSales] = useState<SaleLite[]>([])
  const [recentFallbackSales, setRecentFallbackSales] = useState<SaleLite[]>([])
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([])
  const [payables, setPayables] = useState<PayablesSummary>({
    total_owed: 0,
    total_overdue: 0,
    suppliers: [],
    available: true,
  })
  const [receivables, setReceivables] = useState<ReceivablesSummary>({
    total_owed: 0,
    total_overdue: 0,
    customers: [],
    available: true,
  })
  const [monthExpenses, setMonthExpenses] = useState<{ total: number; count: number } | null>(null)
  const [recentExpenses, setRecentExpenses] = useState<{ amount: number; expense_date: string }[]>([])
  const [sellerBars, setSellerBars] = useState<SellerBarItem[]>([])
  const [goal, setGoal] = useState<MyGoal | null>(null)

  // Controles de gráficos interactivos de rendimiento
  const [chartTab, setChartTab] = useState<'cashflow' | 'channels' | 'sellers'>('cashflow')
  const [chartDays, setChartDays] = useState<7 | 14 | 30>(14)

  // Filtros locales del panel de detalle dinámico
  const [salesMethodFilter, setSalesMethodFilter] = useState<string>('todos')
  const [stockFilter, setStockFilter] = useState<'todos' | 'agotados' | 'bajo_minimo'>('todos')
  const [stockQuery, setStockQuery] = useState('')
  const [debtFilter, setDebtFilter] = useState<'todos' | 'vencidos' | 'al_dia'>('todos')

  const cp = useCopilot()
  const topAlerts = visibleAlerts(cp).filter(a => a.severity !== 'info').slice(0, 4)

  const innovationsSummary = useMemo(() => {
    try {
      const omni = getOmnichannelOrders().filter(o => o.stage !== 'entregado' && o.stage !== 'cancelado').length
      const ai = getAiActionProposals().filter(p => p.status === 'pendiente').length
      const branch = getBranchBalanceSuggestions().filter(b => b.status === 'sugerido').length
      const anomalies = getAnomalyRecords().filter(a => a.status === 'pendiente_revision').length
      const compliance = getComplianceItems().filter(c => c.urgency === 'proximo_vencer' || c.urgency === 'vencido').length
      return { omni, ai, branch, anomalies, compliance }
    } catch {
      return { omni: 0, ai: 0, branch: 0, anomalies: 0, compliance: 0 }
    }
  }, [windowSales, lastUpdated])

  const loadSalesAndStats = useCallback(async () => {
    const now = new Date()
    const start30d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
    const start30dIso = start30d.toISOString()
    const start30dYmd = start30d.toLocaleDateString('sv-SE')
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const nextMonthIso = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    const [stRes, winSalesRes, recSalesRes, expRes, teamRes, perfRes] = await Promise.all([
      supabase.rpc('dashboard_stats', { p_month_start: monthStart }),
      supabase
        .from('sales')
        .select('id, total, created_at, customer_name, payment_method, status, channel')
        .neq('status', 'anulada')
        .gte('created_at', start30dIso)
        .order('created_at', { ascending: false })
        .limit(800),
      supabase
        .from('sales')
        .select('id, total, created_at, customer_name, payment_method, status, channel')
        .neq('status', 'anulada')
        .order('created_at', { ascending: false })
        .limit(8),
      isManager
        ? supabase
            .from('expenses')
            .select('amount, expense_date')
            .eq('status', 'activo')
            .gte('expense_date', start30dYmd < monthYmd ? start30dYmd : monthYmd)
        : Promise.resolve({ data: null, error: null }),
      isManager ? supabase.rpc('listar_nomina_equipo') : Promise.resolve({ data: null, error: null }),
      isManager
        ? supabase.rpc('metas_progreso', { p_month: monthYmd, p_from: monthStart, p_to: nextMonthIso })
        : Promise.resolve({ data: null, error: null }),
    ])

    if (stRes.error) throw new Error(stRes.error.message)
    setStats((stRes.data as DashStats) || EMPTY_STATS)
    setWindowSales(((winSalesRes.data || []) as SaleLite[]).filter(s => s.status !== 'anulada'))
    setRecentFallbackSales(((recSalesRes.data || []) as SaleLite[]).filter(s => s.status !== 'anulada'))

    if (isManager && !expRes.error && expRes.data) {
      const list = expRes.data as { amount: number; expense_date: string }[]
      setRecentExpenses(list)
      const monthList = list.filter(x => String(x.expense_date || '') >= monthYmd)
      setMonthExpenses({
        count: monthList.length,
        total: monthList.reduce((acc, x) => acc + Number(x.amount || 0), 0),
      })
    }

    if (isManager) {
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
        for (const row of perfRes.data as Record<string, unknown>[]) {
          pMap.set(String(row.r_seller_id || ''), row)
        }
      }
      const sellersList = roster.filter(m => m.role === 'vendedor')
      const source = sellersList.length > 0 ? sellersList : roster
      setSellerBars(
        source
          .map(m => {
            const p = pMap.get(m.id)
            const salesAmt = Number(p?.r_sales_total) || 0
            const commPct = Number(m.commission_pct) || 0
            return {
              id: m.id,
              name: m.full_name || m.email,
              email: m.email,
              avatar_url: m.avatar_url,
              zone: m.zone || m.job_title || null,
              sales: salesAmt,
              goal: Number(p?.r_sales_goal) || 0,
              commission: salesAmt * (commPct / 100),
              clients: Number(p?.r_clients) || 0,
              salesCount: Number(p?.r_sales_count) || 0,
              active: m.active,
            }
          })
          .sort((a, b) => b.sales - a.sales)
      )
    }
  }, [isManager])

  const loadLowStock = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('products')
      .select('id, name, sku, stock, min_stock, cost, price, unit')
      .order('stock', { ascending: true })
    if (err || !data) return
    const critical = (data as LowStockProduct[])
      .map(p => ({
        ...p,
        stock: Number(p.stock) || 0,
        min_stock: Number(p.min_stock) || 0,
        cost: Number(p.cost) || 0,
        price: Number(p.price) || 0,
      }))
      .filter(p => p.stock <= 0 || (p.min_stock > 0 && p.stock <= p.min_stock))
      .sort((a, b) => {
        const aZero = a.stock <= 0 ? 0 : 1
        const bZero = b.stock <= 0 ? 0 : 1
        if (aZero !== bZero) return aZero - bZero
        const aRatio = a.min_stock > 0 ? a.stock / a.min_stock : 0
        const bRatio = b.min_stock > 0 ? b.stock / b.min_stock : 0
        return aRatio - bRatio
      })
    setLowStockProducts(critical)
  }, [])

  const loadPayables = useCallback(async () => {
    if (!canInventory) {
      setPayables({ total_owed: 0, total_overdue: 0, suppliers: [], available: false })
      return
    }
    const { data, error: err } = await supabase.rpc('cuentas_por_pagar')
    if (!err && data) {
      const raw = data as { total_owed?: number; total_overdue?: number; suppliers?: CreditorRow[] }
      const openSuppliers = (raw.suppliers || []).filter(s => Number(s.owed) > 0.004)
      setPayables({
        total_owed: Number(raw.total_owed) || 0,
        total_overdue: Number(raw.total_overdue) || 0,
        suppliers: openSuppliers,
        available: true,
      })
      return
    }
    // Respaldo directo sobre compras a crédito si la función aún no está instalada
    const { data: purRows, error: purErr } = await supabase
      .from('purchases')
      .select('id, supplier_id, supplier_name, total, due_date, status, payment_method')
      .eq('payment_method', 'credito')
      .eq('status', 'recibida')
    if (purErr || !purRows) {
      setPayables({ total_owed: 0, total_overdue: 0, suppliers: [], available: false })
      return
    }
    const todayYmd = new Date().toLocaleDateString('sv-SE')
    const bySup = new Map<string, CreditorRow>()
    let owed = 0
    let overdue = 0
    for (const r of purRows as {
      id: string
      supplier_id: string | null
      supplier_name: string | null
      total: number
      due_date: string | null
    }[]) {
      const amt = Number(r.total) || 0
      if (amt <= 0) continue
      const isOver = Boolean(r.due_date && r.due_date < todayYmd)
      owed += amt
      if (isOver) overdue += amt
      const key = r.supplier_id || r.supplier_name || r.id
      const cur = bySup.get(key) || {
        supplier_id: r.supplier_id || key,
        name: r.supplier_name || 'Proveedor general',
        document: null,
        owed: 0,
        overdue: 0,
        oldest_due: null,
        open_purchases: 0,
      }
      cur.owed += amt
      if (isOver) cur.overdue += amt
      cur.open_purchases += 1
      if (r.due_date && (!cur.oldest_due || r.due_date < cur.oldest_due)) cur.oldest_due = r.due_date
      bySup.set(key, cur)
    }
    setPayables({
      total_owed: owed,
      total_overdue: overdue,
      suppliers: Array.from(bySup.values()).sort((a, b) => b.overdue - a.overdue || b.owed - a.owed),
      available: true,
    })
  }, [canInventory])

  const loadReceivables = useCallback(async () => {
    if (!canSell) {
      setReceivables({ total_owed: 0, total_overdue: 0, customers: [], available: false })
      return
    }
    const { data, error: err } = await supabase.rpc('cartera_clientes')
    if (!err && data) {
      const raw = data as { total_owed?: number; total_overdue?: number; customers?: DebtorRow[] }
      const openCustomers = (raw.customers || []).filter(c => Number(c.owed) > 0.004)
      setReceivables({
        total_owed: Number(raw.total_owed) || 0,
        total_overdue: Number(raw.total_overdue) || 0,
        customers: openCustomers,
        available: true,
      })
      return
    }
    setReceivables(prev => ({ ...prev, available: false }))
  }, [canSell])

  const refreshDashboard = useCallback(
    async (scope: KpiId | 'all' = 'all') => {
      setRefreshingKpi(scope)
      setError('')
      const started = Date.now()
      try {
        if (scope === 'all') {
          await Promise.all([loadSalesAndStats(), loadLowStock(), loadPayables(), loadReceivables()])
        } else if (scope === 'sales_today') {
          await loadSalesAndStats()
        } else if (scope === 'low_stock') {
          await Promise.all([loadLowStock(), loadSalesAndStats()])
        } else if (scope === 'payables') {
          await loadPayables()
        } else if (scope === 'receivables') {
          await loadReceivables()
        }
        setLastUpdated(new Date())
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'No se pudieron actualizar las métricas')
      } finally {
        const elapsed = Date.now() - started
        const wait = Math.max(0, 220 - elapsed)
        window.setTimeout(() => {
          setRefreshingKpi(null)
          setInitialLoading(false)
        }, wait)
      }
    },
    [loadSalesAndStats, loadLowStock, loadPayables, loadReceivables]
  )

  useEffect(() => {
    void refreshDashboard('all')
  }, [refreshDashboard])

  useEffect(() => {
    if (!user || !showGoal) return
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const cached = cacheGet<MyGoal>(user.id, 'my_goal')
    if (cached && cached.month === month) setGoal(cached)
    supabase
      .rpc('metas_progreso', {
        p_month: `${month}-01`,
        p_from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        p_to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      })
      .then(({ data, error: e }: { data: unknown; error: unknown }) => {
        if (e) return
        const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[]
        const r = rows.find(x => String(x.r_seller_id) === user.id)
        const g: MyGoal = {
          month,
          sales_total: Number(r?.r_sales_total) || 0,
          sales_count: Number(r?.r_sales_count) || 0,
          clients: Number(r?.r_clients) || 0,
          sales_goal: Number(r?.r_sales_goal) || 0,
          visits_goal: Number(r?.r_visits_goal) || 0,
        }
        setGoal(g)
        cacheSet(user.id, 'my_goal', g)
      })
  }, [user, showGoal])

  // Cálculos derivados para Ventas Hoy vs Ayer
  const salesMetrics = useMemo(() => {
    const now = new Date()
    const startTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startYesterdayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()

    const todayList: SaleLite[] = []
    let todayTotal = 0
    let yesterdayTotal = 0
    const byMethod: Record<string, { total: number; count: number }> = {
      efectivo: { total: 0, count: 0 },
      transferencia: { total: 0, count: 0 },
      tarjeta: { total: 0, count: 0 },
      fiado: { total: 0, count: 0 },
    }

    for (const s of windowSales) {
      const t = new Date(s.created_at).getTime()
      const amt = Number(s.total) || 0
      if (t >= startTodayMs) {
        todayList.push(s)
        todayTotal += amt
        const m = s.payment_method || 'efectivo'
        if (!byMethod[m]) byMethod[m] = { total: 0, count: 0 }
        byMethod[m].total += amt
        byMethod[m].count += 1
      } else if (t >= startYesterdayMs && t < startTodayMs) {
        yesterdayTotal += amt
      }
    }

    const deltaPct =
      yesterdayTotal > 0 ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100) : null
    const avgTicket = todayList.length > 0 ? todayTotal / todayList.length : 0

    return {
      todayList,
      todayTotal,
      todayCount: todayList.length,
      yesterdayTotal,
      deltaPct,
      avgTicket,
      byMethod,
    }
  }, [windowSales])

  // Cálculos derivados para Stock Bajo (con respaldo a stats.low_stock_items)
  const effectiveLowStock = useMemo<LowStockProduct[]>(() => {
    if (lowStockProducts.length > 0) return lowStockProducts
    return (stats.low_stock_items || []).map((it, idx) => ({
      id: `fallback-${idx}`,
      name: it.name,
      sku: null,
      stock: Number(it.stock) || 0,
      min_stock: Number(it.min_stock) || 0,
      cost: 0,
      price: 0,
      unit: null,
    }))
  }, [lowStockProducts, stats.low_stock_items])

  const stockMetrics = useMemo(() => {
    const outOfStock = effectiveLowStock.filter(p => p.stock <= 0)
    const belowMin = effectiveLowStock.filter(p => p.stock > 0 && p.min_stock > 0 && p.stock <= p.min_stock)
    const restockCost = effectiveLowStock.reduce((acc, p) => {
      const target = Math.max(p.min_stock, 1)
      const missing = Math.max(0, target - p.stock)
      return acc + missing * (p.cost || 0)
    }, 0)
    const totalCount = Math.max(effectiveLowStock.length, stats.low_stock_count || 0)
    return {
      totalCount,
      outCount: outOfStock.length,
      belowMinCount: belowMin.length,
      restockCost,
    }
  }, [effectiveLowStock, stats.low_stock_count])

  const filteredTodaySales = useMemo(() => {
    const source = salesMetrics.todayList.length > 0 ? salesMetrics.todayList : recentFallbackSales
    if (salesMethodFilter === 'todos') return source
    return source.filter(s => s.payment_method === salesMethodFilter)
  }, [salesMetrics.todayList, recentFallbackSales, salesMethodFilter])

  const filteredStock = useMemo(() => {
    const q = stockQuery.trim().toLowerCase()
    return effectiveLowStock.filter(p => {
      if (stockFilter === 'agotados' && p.stock > 0) return false
      if (stockFilter === 'bajo_minimo' && p.stock <= 0) return false
      if (q && !p.name.toLowerCase().includes(q) && !String(p.sku || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [effectiveLowStock, stockFilter, stockQuery])

  const filteredPayables = useMemo(() => {
    return payables.suppliers.filter(s => {
      if (debtFilter === 'vencidos') return s.overdue > 0
      if (debtFilter === 'al_dia') return s.overdue <= 0
      return true
    })
  }, [payables.suppliers, debtFilter])

  const filteredReceivables = useMemo(() => {
    return receivables.customers.filter(c => {
      if (debtFilter === 'vencidos') return c.overdue > 0
      if (debtFilter === 'al_dia') return c.overdue <= 0
      return true
    })
  }, [receivables.customers, debtFilter])

  const trendSeries = useMemo(() => {
    const now = new Date()
    const cashflowPoints: TrendPoint[] = []
    const channelPoints: TrendPoint[] = []

    const salesByDay = new Map<string, { total: number; count: number; pos: number; route: number }>()
    for (const s of windowSales) {
      const d = new Date(s.created_at)
      if (Number.isNaN(d.getTime())) continue
      const ymd = d.toLocaleDateString('sv-SE')
      const cur = salesByDay.get(ymd) || { total: 0, count: 0, pos: 0, route: 0 }
      const amt = Number(s.total) || 0
      cur.total += amt
      cur.count += 1
      if (s.channel === 'ruta') cur.route += amt
      else cur.pos += amt
      salesByDay.set(ymd, cur)
    }

    const expByDay = new Map<string, number>()
    for (const e of recentExpenses) {
      const ymd = String(e.expense_date || '').slice(0, 10)
      if (!ymd) continue
      expByDay.set(ymd, (expByDay.get(ymd) || 0) + (Number(e.amount) || 0))
    }

    let rangeSalesTotal = 0
    let rangeExpTotal = 0
    let bestDayLabel = '—'
    let bestDayAmount = 0

    for (let i = chartDays - 1; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const ymd = dt.toLocaleDateString('sv-SE')
      const shortLabel = dt.toLocaleDateString('es', { day: '2-digit', month: 'short' })
      const fullLabel = fmtDate(dt, { weekday: 'short', day: 'numeric', month: 'short' })
      const daySales = salesByDay.get(ymd) || { total: 0, count: 0, pos: 0, route: 0 }
      const dayExp = expByDay.get(ymd) || 0

      rangeSalesTotal += daySales.total
      rangeExpTotal += dayExp
      if (daySales.total > bestDayAmount) {
        bestDayAmount = daySales.total
        bestDayLabel = `${shortLabel} (${money(daySales.total)})`
      }

      cashflowPoints.push({
        key: ymd,
        label: fullLabel,
        shortLabel,
        primary: Math.round(daySales.total * 100) / 100,
        secondary: isManager ? Math.round(dayExp * 100) / 100 : undefined,
        count: daySales.count,
      })

      channelPoints.push({
        key: ymd,
        label: fullLabel,
        shortLabel,
        primary: Math.round(daySales.pos * 100) / 100,
        secondary: Math.round(daySales.route * 100) / 100,
        count: daySales.count,
      })
    }

    return {
      cashflowPoints,
      channelPoints,
      rangeSalesTotal,
      rangeExpTotal,
      dailyAvg: chartDays > 0 ? rangeSalesTotal / chartDays : 0,
      bestDayLabel,
    }
  }, [windowSales, recentExpenses, chartDays, isManager, money])

  function handleCardClick(id: KpiId) {
    if (activeKpi !== id) {
      setActiveKpi(id)
      setDebtFilter('todos')
    }
    void refreshDashboard(id)
  }

  function renderGoal(g: MyGoal) {
    const now = new Date()
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const left = days - now.getDate()
    const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0)
    const bar = (v: number, t: number) => (
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${t > 0 && v >= t ? 'bg-emerald-600' : 'bg-slate-800'}`}
          style={{ width: `${Math.min(100, pct(v, t))}%` }}
        />
      </div>
    )
    const missing = Math.max(0, g.sales_goal - g.sales_total)
    const perDay = left > 0 ? missing / left : missing
    const expected = now.getDate() / days
    const ratio = g.sales_goal > 0 && expected > 0 ? g.sales_total / g.sales_goal / expected : 1
    const done = g.sales_goal > 0 && g.sales_total >= g.sales_goal
    const statusText =
      g.sales_goal <= 0
        ? null
        : done
          ? { t: 'Meta cumplida', c: 'text-emerald-700' }
          : ratio >= 0.95
            ? { t: 'En ritmo', c: 'text-emerald-700' }
            : ratio >= 0.7
              ? { t: 'Ritmo moderado', c: 'text-amber-700' }
              : { t: 'Requiere impulso', c: 'text-red-600' }
    const monthName = fmtDate(now, { month: 'long' })

    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-slate-500 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Mi meta de <span className="capitalize">{monthName}</span>
            </h2>
          </div>
          {statusText && <span className={`text-xs font-medium ${statusText.c}`}>{statusText.t}</span>}
        </div>
        <div className="mb-4">
          <div className="flex items-baseline justify-between text-sm mb-1.5">
            <span className="text-slate-500">Ventas acumuladas</span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {money(g.sales_total)}
              {g.sales_goal > 0 && <span className="font-normal text-slate-400"> / {money(g.sales_goal)}</span>}
            </span>
          </div>
          {bar(g.sales_total, g.sales_goal)}
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {g.sales_goal <= 0
              ? `${g.sales_count} venta(s) este mes · Sin meta asignada`
              : done
                ? `Meta superada (${pct(g.sales_total, g.sales_goal)}%)`
                : `${pct(g.sales_total, g.sales_goal)}% completado · Faltan ${money(missing)}${left > 0 ? ` · ${money(perDay)}/día (${left}d restantes)` : ''}`}
          </p>
        </div>
        <div>
          <div className="flex items-baseline justify-between text-sm mb-1.5">
            <span className="text-slate-500">Clientes atendidos</span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {g.clients}
              {g.visits_goal > 0 && <span className="font-normal text-slate-400"> / {g.visits_goal}</span>}
            </span>
          </div>
          {bar(g.clients, g.visits_goal)}
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {g.visits_goal <= 0
              ? 'Sin meta de visitas configurada'
              : g.clients >= g.visits_goal
                ? 'Meta de clientes cumplida'
                : `${pct(g.clients, g.visits_goal)}% · Faltan ${g.visits_goal - g.clients} cliente(s)`}
          </p>
        </div>
      </div>
    )
  }

  const kpiCards: {
    id: KpiId
    label: string
    value: string
    icon: React.ReactNode
    meta: React.ReactNode
    tone: 'normal' | 'warning' | 'critical' | 'positive'
  }[] = [
    {
      id: 'sales_today',
      label: 'Ventas hoy',
      value: money(salesMetrics.todayTotal),
      icon: <ShoppingCart className="w-4 h-4" />,
      tone: salesMetrics.todayCount > 0 ? 'positive' : 'normal',
      meta: (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate tabular-nums">
          <span>
            {salesMetrics.todayCount} {salesMetrics.todayCount === 1 ? 'venta' : 'ventas'}
          </span>
          <span aria-hidden="true">·</span>
          {salesMetrics.deltaPct !== null ? (
            <span
              className={`inline-flex items-center gap-0.5 font-medium ${
                salesMetrics.deltaPct >= 0 ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {salesMetrics.deltaPct >= 0 ? (
                <TrendingUp className="w-3 h-3 shrink-0" />
              ) : (
                <TrendingDown className="w-3 h-3 shrink-0" />
              )}
              {salesMetrics.deltaPct >= 0 ? '+' : ''}
              {salesMetrics.deltaPct}% vs. ayer
            </span>
          ) : (
            <span>Ayer: {money(salesMetrics.yesterdayTotal)}</span>
          )}
        </div>
      ),
    },
    {
      id: 'low_stock',
      label: 'Stock bajo',
      value: `${stockMetrics.totalCount} ${stockMetrics.totalCount === 1 ? 'producto' : 'productos'}`,
      icon: <AlertTriangle className="w-4 h-4" />,
      tone:
        stockMetrics.outCount > 0
          ? 'critical'
          : stockMetrics.totalCount > 0
            ? 'warning'
            : 'positive',
      meta: (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate tabular-nums">
          {stockMetrics.totalCount === 0 ? (
            <span className="text-emerald-700 font-medium">Inventario completo</span>
          ) : (
            <>
              <span className={stockMetrics.outCount > 0 ? 'text-red-600 font-medium' : ''}>
                {stockMetrics.outCount} {stockMetrics.outCount === 1 ? 'agotado' : 'agotados'}
              </span>
              <span aria-hidden="true">·</span>
              <span className={stockMetrics.belowMinCount > 0 ? 'text-amber-700 font-medium' : ''}>
                {stockMetrics.belowMinCount} bajo mínimo
              </span>
            </>
          )}
        </div>
      ),
    },
    {
      id: 'payables',
      label: 'Cuentas por pagar',
      value: canInventory ? money(payables.total_owed) : 'Restringido',
      icon: <Receipt className="w-4 h-4" />,
      tone:
        !canInventory
          ? 'normal'
          : payables.total_overdue > 0
            ? 'critical'
            : payables.total_owed > 0
              ? 'warning'
              : 'positive',
      meta: (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate tabular-nums">
          {!canInventory ? (
            <span>Solo administración</span>
          ) : payables.total_owed <= 0 ? (
            <span className="text-emerald-700 font-medium">Sin deuda con proveedores</span>
          ) : (
            <>
              <span className={payables.total_overdue > 0 ? 'text-red-600 font-medium' : 'text-slate-600'}>
                {payables.total_overdue > 0 ? `Vencido: ${money(payables.total_overdue)}` : 'Al día'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {payables.suppliers.length}{' '}
                {payables.suppliers.length === 1 ? 'proveedor' : 'proveedores'}
              </span>
            </>
          )}
        </div>
      ),
    },
    {
      id: 'receivables',
      label: 'Cartera por cobrar',
      value: money(receivables.total_owed),
      icon: <Banknote className="w-4 h-4" />,
      tone:
        receivables.total_overdue > 0
          ? 'critical'
          : receivables.total_owed > 0
            ? 'warning'
            : 'positive',
      meta: (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate tabular-nums">
          {receivables.total_owed <= 0 ? (
            <span className="text-emerald-700 font-medium">Sin saldos pendientes</span>
          ) : (
            <>
              <span className={receivables.total_overdue > 0 ? 'text-red-600 font-medium' : 'text-slate-600'}>
                {receivables.total_overdue > 0 ? `Vencido: ${money(receivables.total_overdue)}` : 'Al día'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {receivables.customers.length}{' '}
                {receivables.customers.length === 1 ? 'cliente' : 'clientes'}
              </span>
            </>
          )}
        </div>
      ),
    },
  ]

  const isGlobalSyncing = refreshingKpi === 'all'

  return (
    <div className="space-y-6">
      {/* Encabezado principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Panel de control</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-1">
            <span>Bienvenido, {user?.full_name || user?.email}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            {lastUpdated && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  Actualizado {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void refreshDashboard('all')}
            disabled={refreshingKpi !== null}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGlobalSyncing ? 'animate-spin' : ''}`} />
            Actualizar todo
          </button>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('support')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Solicitar soporte técnico o autorizar revisión de sesión"
            >
              <LifeBuoy className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">
                {canManageTechSupport(user?.role) ? 'Bandeja soporte' : 'Soporte'}
              </span>
            </button>
          )}
          {onNavigate && canViewAccounting(user?.role) && user?.role === 'contador' && (
            <button
              type="button"
              onClick={() => onNavigate('cpa')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Calculator className="w-3.5 h-3.5" />
              Despacho contable
            </button>
          )}
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('dispatch_history')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Historial de despachos por producto, cliente y tienda con reporte para imprimir"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Trazabilidad y despachos</span>
              <span className="sm:hidden">Despachos</span>
            </button>
          )}
          {onNavigate && canSell && (
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Store className="w-3.5 h-3.5" />
              Abrir mostrador
            </button>
          )}
        </div>
      </div>

      {/* Acceso contextual rápido para Contador Público o Soporte Técnico */}
      {onNavigate && user?.role === 'contador' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              Despacho del Contador Público · Cierre, Hoja de 8 Columnas y NIIF
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Concilia ventas, compras y gastos contra el Libro Diario en un clic, revisa razones financieras y firma estados con tu número CPC.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('accstate')}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
            >
              Estados financieros
            </button>
            <button
              type="button"
              onClick={() => onNavigate('cpa')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-white whitespace-nowrap shrink-0"
            >
              Abrir despacho contable
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {onNavigate && user?.role === 'tecnico' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              Centro de Soporte Técnico y Sesiones Autorizadas
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Revisa las solicitudes entrantes de usuarios que otorgaron código de autorización temporal para diagnóstico y resolución de su sesión.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('support')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-white whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            Ir a bandeja técnica
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs">
          <span>No se pudieron sincronizar algunas estadísticas: {error}</span>
          <button
            type="button"
            onClick={() => void refreshDashboard('all')}
            className="font-semibold underline whitespace-nowrap shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Ecosistema de Operaciones Inteligentes (12 Innovaciones) */}
      {onNavigate && (
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-4 sm:p-5 text-white shadow-lg border border-indigo-900/40">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-indigo-800/40 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-indigo-500/20 text-indigo-300 rounded-lg border border-indigo-500/30">
                  <Sparkles className="w-4 h-4" />
                </span>
                <h2 className="text-sm sm:text-base font-bold text-white">
                  Plataforma Inteligente de Operaciones
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Nueva Generación
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 mt-1">
                Monitoreo activo omnicanal, agentes de IA supervisados, rebalanceo predictivo y prevención de pérdidas en tiempo real.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onNavigate('omnichannel')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
              >
                <Boxes className="w-3.5 h-3.5" />
                Bandeja Omnicanal
                {innovationsSummary.omni > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 bg-white text-indigo-950 rounded-full text-[10px] font-bold">
                    {innovationsSummary.omni}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('ai_actions')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600/90 hover:bg-purple-500 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5" />
                Agente IA
                {innovationsSummary.ai > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 bg-amber-400 text-amber-950 rounded-full text-[10px] font-bold">
                    {innovationsSummary.ai}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-3.5">
            <button
              type="button"
              onClick={() => onNavigate('omnichannel')}
              className="text-left p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs text-indigo-200 mb-1">
                <span>Pedidos Activos</span>
                <Boxes className="w-3.5 h-3.5 opacity-70" />
              </div>
              <div className="text-lg font-bold text-white tabular-nums">
                {innovationsSummary.omni}
              </div>
              <p className="text-[10px] text-indigo-300/70 truncate">WhatsApp, Tienda, Ruta</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('ai_actions')}
              className="text-left p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs text-indigo-200 mb-1">
                <span>Aprobaciones IA</span>
                <Bot className="w-3.5 h-3.5 opacity-70" />
              </div>
              <div className="text-lg font-bold text-white tabular-nums">
                {innovationsSummary.ai}
              </div>
              <p className="text-[10px] text-indigo-300/70 truncate">Human-in-the-loop</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('branch_balance')}
              className="text-left p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs text-indigo-200 mb-1">
                <span>Stock Multisede</span>
                <Truck className="w-3.5 h-3.5 opacity-70" />
              </div>
              <div className="text-lg font-bold text-white tabular-nums">
                {innovationsSummary.branch}
              </div>
              <p className="text-[10px] text-indigo-300/70 truncate">Traslados sugeridos</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('anomaly_detector')}
              className="text-left p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs text-indigo-200 mb-1">
                <span>Alertas Pérdidas</span>
                <ShieldAlert className="w-3.5 h-3.5 opacity-70" />
              </div>
              <div className="text-lg font-bold text-white tabular-nums">
                {innovationsSummary.anomalies}
              </div>
              <p className="text-[10px] text-indigo-300/70 truncate">Auditoría anti-fraude</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('compliance')}
              className="text-left p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer col-span-2 sm:col-span-1"
            >
              <div className="flex items-center justify-between text-xs text-indigo-200 mb-1">
                <span>Vencimientos</span>
                <CalendarClock className="w-3.5 h-3.5 opacity-70" />
              </div>
              <div className="text-lg font-bold text-white tabular-nums">
                {innovationsSummary.compliance}
              </div>
              <p className="text-[10px] text-indigo-300/70 truncate">SOAT, DIAN, Cámaras</p>
            </button>
          </div>
        </div>
      )}

      {/* Tarjetas KPI dinámicas interactivas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-500">
            Haz clic en cualquier tarjeta para actualizar su cifra en tiempo real y ver su desglose operativo.
          </p>
        </div>

        {initialLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 animate-pulse">
                <div className="h-4 w-28 bg-slate-100 rounded" />
                <div className="h-7 w-36 bg-slate-200 rounded" />
                <div className="h-3.5 w-44 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {kpiCards.map(card => {
              const selected = activeKpi === card.id
              const syncingThis = refreshingKpi === card.id || refreshingKpi === 'all'
              const iconTone =
                card.tone === 'critical'
                  ? 'text-red-600'
                  : card.tone === 'warning'
                    ? 'text-amber-600'
                    : card.tone === 'positive'
                      ? 'text-emerald-600'
                      : 'text-slate-500'

              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => handleCardClick(card.id)}
                  aria-pressed={selected}
                  className={`group text-left rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                    selected
                      ? 'bg-white border-slate-900 ring-1 ring-slate-900 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <span className={iconTone}>{card.icon}</span>
                      {card.label}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] transition-opacity ${
                        syncingThis
                          ? 'text-slate-800 opacity-100 font-medium'
                          : selected
                            ? 'text-slate-900 opacity-100 font-medium'
                            : 'text-slate-400 opacity-75 group-hover:opacity-100'
                      }`}
                    >
                      <RefreshCw className={`w-3 h-3 ${syncingThis ? 'animate-spin' : ''}`} />
                      <span className="hidden sm:inline">{syncingThis ? 'Actualizando' : selected ? 'Seleccionado' : 'Actualizar'}</span>
                    </span>
                  </div>

                  <p className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums truncate">
                    {card.value}
                  </p>

                  <div className="mt-2">{card.meta}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Panel dinámico contextual según la tarjeta seleccionada */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {activeKpi === 'sales_today' && (
          <div>
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Ventas registradas hoy</h2>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5 tabular-nums">
                  <span>Ticket promedio hoy: {money(salesMetrics.avgTicket)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Ayer completo: {money(salesMetrics.yesterdayTotal)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Acumulado del mes: {money(stats.revenue_month)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                  {(
                    [
                      ['todos', 'Todos'],
                      ['efectivo', 'Efectivo'],
                      ['transferencia', 'Transferencia'],
                      ['tarjeta', 'Tarjeta'],
                      ['fiado', 'Fiado'],
                    ] as [string, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSalesMethodFilter(key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        salesMethodFilter === key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('sales')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Historial de ventas
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Desglose rápido por medio de cobro */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-100 bg-slate-50/50">
              {(['efectivo', 'transferencia', 'tarjeta', 'fiado'] as const).map((m, idx) => {
                const info = salesMetrics.byMethod[m] || { total: 0, count: 0 }
                const cellBorder =
                  idx === 0
                    ? 'border-b sm:border-b-0 border-r border-slate-100'
                    : idx === 1
                      ? 'border-b sm:border-b-0 sm:border-r border-slate-100'
                      : idx === 2
                        ? 'border-r border-slate-100'
                        : ''
                return (
                  <div key={m} className={`px-5 py-3 ${cellBorder}`}>
                    <p className="text-xs text-slate-500">{METHOD_LABEL[m]}</p>
                    <p className="text-sm font-semibold text-slate-900 tabular-nums mt-0.5">{money(info.total)}</p>
                    <p className="text-[11px] text-slate-400 tabular-nums">
                      {info.count} {info.count === 1 ? 'operación' : 'operaciones'}
                    </p>
                  </div>
                )
              })}
            </div>

            {salesMetrics.todayList.length === 0 && (
              <div className="px-5 py-4 bg-slate-50/40 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-xs text-slate-600">
                  Aún no se han registrado ventas hoy. Mostrando las últimas operaciones registradas como referencia.
                </p>
                {onNavigate && canSell && (
                  <button
                    type="button"
                    onClick={() => onNavigate('pos')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0 self-start sm:self-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Registrar primera venta
                  </button>
                )}
              </div>
            )}

            {filteredTodaySales.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-slate-700">Sin ventas para el filtro seleccionado</p>
                <p className="text-xs text-slate-500 mt-1">
                  Prueba cambiando el método de pago o abre el mostrador para facturar.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="py-2.5 px-5 font-medium">Cliente</th>
                      <th className="py-2.5 px-4 font-medium">Fecha y hora</th>
                      <th className="py-2.5 px-4 font-medium">Método de pago</th>
                      <th className="py-2.5 px-5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTodaySales.slice(0, 8).map(s => (
                      <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-5 font-medium text-slate-800 truncate max-w-[220px]">
                          {s.customer_name || 'Cliente general'}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {new Date(s.created_at).toLocaleDateString()} ·{' '}
                          {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">
                          {METHOD_LABEL[s.payment_method] || s.payment_method}
                        </td>
                        <td className="py-2.5 px-5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {money(s.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeKpi === 'low_stock' && (
          <div>
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Control de inventario en nivel crítico</h2>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5 tabular-nums">
                  <span>{stockMetrics.outCount} sin existencias</span>
                  <span aria-hidden="true">·</span>
                  <span>{stockMetrics.belowMinCount} en o debajo del mínimo</span>
                  {canInventory && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Costo estimado para cubrir mínimo: {money(stockMetrics.restockCost)}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={stockQuery}
                    onChange={e => setStockQuery(e.target.value)}
                    placeholder="Buscar producto o SKU..."
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
                  />
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['todos', `Todos (${effectiveLowStock.length})`],
                      ['agotados', `Agotados (${stockMetrics.outCount})`],
                      ['bajo_minimo', `Bajo mínimo (${stockMetrics.belowMinCount})`],
                    ] as ['todos' | 'agotados' | 'bajo_minimo', string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStockFilter(key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        stockFilter === key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {onNavigate && canInventory && (
                  <button
                    type="button"
                    onClick={() => onNavigate('buyplan')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <ShoppingBasket className="w-3.5 h-3.5" />
                    Sugerencia de compras
                  </button>
                )}
              </div>
            </div>

            {filteredStock.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-slate-800">
                  {effectiveLowStock.length === 0
                    ? 'Todos tus productos superan el stock mínimo configurado'
                    : 'No hay productos que coincidan con la búsqueda'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Puedes revisar niveles mínimos o registrar entradas desde el módulo de Productos.
                </p>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('products')}
                    className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Ver catálogo de productos
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="py-2.5 px-5 font-medium">Producto</th>
                      <th className="py-2.5 px-4 font-medium">Estado</th>
                      <th className="py-2.5 px-4 font-medium text-right">Stock actual</th>
                      <th className="py-2.5 px-4 font-medium text-right">Mínimo</th>
                      <th className="py-2.5 px-4 font-medium text-right">Faltante</th>
                      {canInventory && <th className="py-2.5 px-5 font-medium text-right">Reposición est.</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStock.slice(0, 10).map(p => {
                      const deficit = Math.max(0, Math.max(p.min_stock, 1) - p.stock)
                      const est = deficit * (p.cost || 0)
                      const isZero = p.stock <= 0
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-5">
                            <p className="font-medium text-slate-800 truncate max-w-[260px]">{p.name}</p>
                            {p.sku && <p className="text-[11px] text-slate-400 font-mono">{p.sku}</p>}
                          </td>
                          <td className="py-2.5 px-4 text-xs">
                            {isZero ? (
                              <span className="inline-flex items-center gap-1 font-medium text-red-600">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                Agotado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                Bajo mínimo
                              </span>
                            )}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-semibold tabular-nums whitespace-nowrap ${
                              isZero ? 'text-red-600' : 'text-slate-900'
                            }`}
                          >
                            {fmtNum(p.stock, 2)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-500 tabular-nums whitespace-nowrap">
                            {fmtNum(p.min_stock, 2)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-700 font-medium tabular-nums whitespace-nowrap">
                            {fmtNum(deficit, 2)}
                          </td>
                          {canInventory && (
                            <td className="py-2.5 px-5 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                              {p.cost > 0 ? money(est) : '—'}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filteredStock.length > 10 && onNavigate && (
                  <div className="px-5 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span className="tabular-nums">Mostrando 10 de {filteredStock.length} productos críticos</span>
                    <button
                      type="button"
                      onClick={() => onNavigate('products')}
                      className="font-medium text-slate-800 hover:underline whitespace-nowrap"
                    >
                      Ver todos en Productos →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeKpi === 'payables' && (
          <div>
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Obligaciones con proveedores (Cuentas por pagar)</h2>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5 tabular-nums">
                  <span>Total pendiente: {money(payables.total_owed)}</span>
                  <span aria-hidden="true">·</span>
                  <span className={payables.total_overdue > 0 ? 'text-red-600 font-medium' : ''}>
                    Vencido: {money(payables.total_overdue)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Al día: {money(Math.max(0, payables.total_owed - payables.total_overdue))}</span>
                </div>
              </div>

              {canInventory && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {(
                      [
                        ['todos', 'Todos'],
                        ['vencidos', 'Con mora'],
                        ['al_dia', 'Al día'],
                      ] as ['todos' | 'vencidos' | 'al_dia', string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDebtFilter(key)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          debtFilter === key
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {onNavigate && (
                    <>
                      <button
                        type="button"
                        onClick={() => onNavigate('purchases')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        Nueva compra
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate('payables')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        Gestionar pagos
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {!canInventory ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">
                La consulta de cuentas por pagar a proveedores está disponible para el dueño y el administrador.
              </div>
            ) : filteredPayables.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-slate-800">
                  {payables.suppliers.length === 0
                    ? 'No tienes facturas pendientes de pago con proveedores'
                    : 'No hay proveedores en el filtro seleccionado'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Las compras registradas a crédito aparecerán automáticamente aquí con su fecha de vencimiento.
                </p>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('purchases')}
                    className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Ir a Compras
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="py-2.5 px-5 font-medium">Proveedor</th>
                      <th className="py-2.5 px-4 font-medium text-right">Compras abiertas</th>
                      <th className="py-2.5 px-4 font-medium">Vencimiento más antiguo</th>
                      <th className="py-2.5 px-4 font-medium text-right">Vencido</th>
                      <th className="py-2.5 px-5 font-medium text-right">Saldo por pagar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPayables.slice(0, 8).map(sup => (
                      <tr
                        key={sup.supplier_id}
                        onClick={() => onNavigate?.('payables')}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                      >
                        <td className="py-2.5 px-5">
                          <p className="font-medium text-slate-800 truncate max-w-[240px]">{sup.name}</p>
                          {sup.document && <p className="text-[11px] text-slate-400 font-mono">{sup.document}</p>}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600 tabular-nums">{sup.open_purchases}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatDueDate(sup.oldest_due)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right text-xs font-medium tabular-nums whitespace-nowrap ${
                            sup.overdue > 0 ? 'text-red-600' : 'text-slate-400'
                          }`}
                        >
                          {sup.overdue > 0 ? money(sup.overdue) : '—'}
                        </td>
                        <td className="py-2.5 px-5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {money(sup.owed)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeKpi === 'receivables' && (
          <div>
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Cartera de clientes (Ventas fiadas)</h2>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5 tabular-nums">
                  <span>Total por cobrar: {money(receivables.total_owed)}</span>
                  <span aria-hidden="true">·</span>
                  <span className={receivables.total_overdue > 0 ? 'text-red-600 font-medium' : ''}>
                    Vencido: {money(receivables.total_overdue)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Al día: {money(Math.max(0, receivables.total_owed - receivables.total_overdue))}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['todos', 'Todos'],
                      ['vencidos', 'Con mora'],
                      ['al_dia', 'Al día'],
                    ] as ['todos' | 'vencidos' | 'al_dia', string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDebtFilter(key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        debtFilter === key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {onNavigate && canSell && (
                  <button
                    type="button"
                    onClick={() => onNavigate('cartera')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    Registrar abonos
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {filteredReceivables.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-slate-800">
                  {receivables.customers.length === 0
                    ? 'No hay saldos pendientes por cobrar en cartera'
                    : 'No hay clientes en el filtro seleccionado'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Las ventas a crédito (fiado) y sus abonos se controlan desde el módulo de Cartera.
                </p>
                {onNavigate && canSell && (
                  <button
                    type="button"
                    onClick={() => onNavigate('cartera')}
                    className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Abrir Cartera
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="py-2.5 px-5 font-medium">Cliente</th>
                      <th className="py-2.5 px-4 font-medium text-right">Ventas abiertas</th>
                      <th className="py-2.5 px-4 font-medium">Vencimiento más antiguo</th>
                      <th className="py-2.5 px-4 font-medium text-right">Vencido</th>
                      <th className="py-2.5 px-5 font-medium text-right">Saldo por cobrar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredReceivables.slice(0, 8).map(cust => (
                      <tr
                        key={cust.customer_id}
                        onClick={() => onNavigate?.('cartera')}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                      >
                        <td className="py-2.5 px-5">
                          <p className="font-medium text-slate-800 truncate max-w-[240px]">{cust.name}</p>
                          {cust.document && <p className="text-[11px] text-slate-400 font-mono">{cust.document}</p>}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600 tabular-nums">{cust.open_sales}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatDueDate(cust.oldest_due)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right text-xs font-medium tabular-nums whitespace-nowrap ${
                            cust.overdue > 0 ? 'text-red-600' : 'text-slate-400'
                          }`}
                        >
                          {cust.overdue > 0 ? money(cust.overdue) : '—'}
                        </td>
                        <td className="py-2.5 px-5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {money(cust.owed)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Gráficos interactivos de rendimiento y tendencias */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Gráficos de rendimiento comercial</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5 tabular-nums">
              <span>
                Acumulado ({chartDays}d): <strong className="text-slate-800">{money(trendSeries.rangeSalesTotal)}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>Promedio diario: {money(trendSeries.dailyAvg)}</span>
              <span aria-hidden="true">·</span>
              <span>Mejor día: {trendSeries.bestDayLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setChartTab('cashflow')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  chartTab === 'cashflow' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {isManager ? 'Ventas vs. Gastos' : 'Evolución diaria'}
              </button>
              <button
                type="button"
                onClick={() => setChartTab('channels')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  chartTab === 'channels' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mostrador vs. Ruta
              </button>
              {isManager && (
                <button
                  type="button"
                  onClick={() => setChartTab('sellers')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    chartTab === 'sellers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Equipo de ventas
                </button>
              )}
            </div>

            {chartTab !== 'sellers' ? (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {([7, 14, 30] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setChartDays(d)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors tabular-nums whitespace-nowrap ${
                      chartDays === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            ) : (
              onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('sellers')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  Abrir Nómina de vendedores
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )
            )}
          </div>
        </div>

        {chartTab === 'cashflow' && (
          <InteractiveTrendChart
            points={trendSeries.cashflowPoints}
            primaryLabel="Ventas"
            secondaryLabel={isManager ? 'Gastos operativos' : undefined}
            formatValue={money}
            primaryColor="#0f172a"
            secondaryColor="#f59e0b"
          />
        )}

        {chartTab === 'channels' && (
          <InteractiveTrendChart
            points={trendSeries.channelPoints}
            primaryLabel="Mostrador"
            secondaryLabel="Ruta en calle"
            formatValue={money}
            primaryColor="#0f172a"
            secondaryColor="#10b981"
          />
        )}

        {chartTab === 'sellers' && isManager && (
          <SellerPerformanceBars
            items={sellerBars}
            formatMoney={money}
            onSelect={() => onNavigate?.('sellers')}
          />
        )}
      </section>

      {/* Franja secundaria de pulso mensual del negocio */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onNavigate?.(isManager ? 'reports' : 'sales')}
          className="p-4 text-left hover:bg-slate-50/70 transition-colors border-b lg:border-b-0 border-r border-slate-200"
        >
          <p className="text-xs text-slate-500">Ingresos del mes</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">{money(stats.revenue_month)}</p>
          <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
            Histórico: {money(stats.revenue_total)}
          </p>
        </button>

        {isManager && (
          <button
            type="button"
            onClick={() => onNavigate?.('expenses')}
            className="p-4 text-left hover:bg-slate-50/70 transition-colors border-b lg:border-b-0 lg:border-r border-slate-200"
          >
            <p className="text-xs text-slate-500">Gastos operativos (mes)</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">
              {monthExpenses ? money(monthExpenses.total) : '—'}
            </p>
            <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
              {monthExpenses ? `${monthExpenses.count} ${monthExpenses.count === 1 ? 'registro activo' : 'registros activos'}` : 'Registrar egresos'}
            </p>
          </button>
        )}

        <button
          type="button"
          onClick={() => onNavigate?.('products')}
          className="p-4 text-left hover:bg-slate-50/70 transition-colors border-r border-slate-200"
        >
          <p className="text-xs text-slate-500">Catálogo de productos</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">{stats.products_count}</p>
          <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
            {stats.sales_count} {stats.sales_count === 1 ? 'venta histórica' : 'ventas históricas'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate?.('customers')}
          className="p-4 text-left hover:bg-slate-50/70 transition-colors"
        >
          <p className="text-xs text-slate-500">Clientes registrados</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">{stats.customers_count}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Directorio comercial activo</p>
        </button>
      </section>

      {/* Meta del vendedor (si aplica) y Copiloto */}
      {(showGoal && goal) || (onNavigate && cp.loaded && !cp.error) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {showGoal && goal && renderGoal(goal)}

          {onNavigate && cp.loaded && !cp.error && (
            <div className={`bg-white rounded-xl border border-slate-200 p-5 ${!(showGoal && goal) ? 'lg:col-span-2' : ''}`}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-slate-500 shrink-0" />
                  <h2 className="text-sm font-semibold text-slate-900">Avisos prioritarios del Copiloto</h2>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('copilot')}
                  className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap shrink-0"
                >
                  Ver todos
                </button>
              </div>

              {topAlerts.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 py-1">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Todo en orden: no hay alertas urgentes pendientes.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {topAlerts.map(a => {
                    const sev = SEVERITY_LABEL[a.severity] || SEVERITY_LABEL.media
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => onNavigate(a.page || 'copilot')}
                        className="w-full flex items-center justify-between gap-3 text-left py-2.5 hover:bg-slate-50/70 transition-colors"
                      >
                        <div className="min-w-0 flex items-baseline gap-2">
                          <span className={`text-xs font-semibold shrink-0 ${sev.cls}`}>{sev.text}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="text-sm text-slate-800 truncate">{a.title}</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

