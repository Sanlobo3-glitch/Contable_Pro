import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isCompanyManager, canViewAccounting } from '../lib/auth'
import { useCurrency, fmtDate } from '../lib/currency'
import { useCopilot, visibleAlerts } from '../lib/copilot'
import { SEV } from '../components/CopilotCards'
import { Sparkline, HourlyCompare, HBars, Donut, Heat } from '../components/MiniCharts'
import {
  computeMetrics,
  pctDelta,
  lightPace,
  lightOverdue,
  lightStock,
  lightGoals,
  lightControl,
  type SaleRow,
  type Light,
} from '../lib/commandMetrics'
import type {
  Branch,
  Warehouse,
  WarehouseStockRow,
  InventoryTransfer,
} from '../types'
import {
  Radio,
  Maximize2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  MapPin,
  Wallet,
  AlertTriangle,
  Building2,
  BookOpen,
  ArrowUpRight,
  Truck,
  CalendarClock,
  CheckCircle2,
  Layers,
} from 'lucide-react'

type CommandTab = 'pulso' | 'finanzas' | 'estructura'

interface FeedItem {
  id: string
  at: string
  kind: 'venta' | 'visita' | 'caja' | 'alerta'
  text: string
}
interface VisitRow {
  id: string
  seller_name: string | null
  flag: string
  created_at: string
}
interface CashRow {
  type: string
  amount: number
}
interface GoalRow {
  id: string
  sales_total: number
  sales_goal: number
}
interface Member {
  id: string
  full_name: string | null
  email: string
}
interface Debtor {
  name: string
  owed: number
  overdue: number
  oldest_due: string | null
}
interface Portfolio {
  total_owed: number
  total_overdue: number
  customers: Debtor[]
}
interface SupplierCreditor {
  supplier_name: string
  owed: number
  overdue: number
  next_due: string | null
}
interface PayablesPortfolio {
  total_owed: number
  total_overdue: number
  suppliers: SupplierCreditor[]
}
interface LowItem {
  name: string
  stock: number
  min_stock: number
}
interface ProductValuationRow {
  id: string
  name: string
  price: number
  cost: number
  stock: number
  min_stock: number
}
interface ExpenseLite {
  amount: number
  category_name: string | null
  status: string | null
}
interface PayrollLite {
  net_paid: number
  status: string | null
}
interface AccountingSnapshot {
  configured: boolean
  active: boolean
  startDate: string | null
  postedCount: number
  draftCount: number
  lastClosedLabel: string | null
}
interface DispatchLite {
  id: string
  dispatch_date: string
  seller_name: string
  vehicle_label: string | null
  status: string
  sales_cash: number
  sales_bank: number
  sales_credit: number
}
interface ExpiringLotLite {
  id: string
  lot_number: string
  expiry_date: string
  quantity: number
  product_name: string
  daysLeft: number
}

const DAY = 86400000
const COLORS = ['#0f172a', '#059669', '#2563eb', '#d97706', '#7c3aed', '#dc2626']
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const LIGHT: Record<Light, { dot: string; text: string; label: string }> = {
  verde: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Óptimo' },
  ambar: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Atención' },
  rojo: { dot: 'bg-red-500', text: 'text-red-700', label: 'Crítico' },
  gris: { dot: 'bg-slate-300', text: 'text-slate-500', label: 'Sin datos' },
}

const WAREHOUSE_TYPE_LABEL: Record<string, string> = {
  principal: 'Principal',
  general: 'General',
  materia_prima: 'Materia prima',
  en_proceso: 'En proceso',
  producto_terminado: 'Prod. terminado',
  transito: 'En tránsito',
  devoluciones: 'Devoluciones',
  averias: 'Averías',
}

async function fetchSales(sinceIso: string): Promise<SaleRow[]> {
  let cols = 'id,total,status,created_at,payment_method,customer_name,discount_amount'
  const out: SaleRow[] = []
  for (let from = 0; out.length < 20000; from += 1000) {
    let res = await supabase
      .from('sales')
      .select(cols)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (res.error && /discount_amount/.test(res.error.message)) {
      cols = 'id,total,status,created_at,payment_method,customer_name'
      res = await supabase
        .from('sales')
        .select(cols)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .range(from, from + 999)
    }
    if (res.error) throw new Error(res.error.message)
    const rows = (res.data || []) as unknown as SaleRow[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

function Delta({ v, suffix }: { v: number | null; suffix: string }) {
  if (v === null) return <span className="text-xs text-slate-400">sin referencia previa</span>
  const up = v >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {up ? '+' : ''}
      {v.toFixed(0)}% {suffix}
    </span>
  )
}

function Card({
  title,
  subtitle,
  children,
  right,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export default function CommandCenter({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const cp = useCopilot()

  const canAccess = isCompanyManager(user?.role) || canViewAccounting(user?.role)
  const [tab, setTab] = useState<CommandTab>('pulso')

  const [sales, setSales] = useState<SaleRow[]>([])
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [cash, setCash] = useState<CashRow[]>([])
  const [allCashBalance, setAllCashBalance] = useState<number>(0)
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [low, setLow] = useState<LowItem[]>([])
  const [port, setPort] = useState<Portfolio | null>(null)
  const [payables, setPayables] = useState<PayablesPortfolio>({ total_owed: 0, total_overdue: 0, suppliers: [] })
  const [products, setProducts] = useState<ProductValuationRow[]>([])
  const [monthExpenses, setMonthExpenses] = useState<ExpenseLite[]>([])
  const [monthPayroll, setMonthPayroll] = useState<PayrollLite[]>([])
  const [accSnap, setAccSnap] = useState<AccountingSnapshot>({
    configured: false,
    active: false,
    startDate: null,
    postedCount: 0,
    draftCount: 0,
    lastClosedLabel: null,
  })
  const [branches, setBranches] = useState<Branch[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [whStock, setWhStock] = useState<WarehouseStockRow[]>([])
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([])
  const [dispatches, setDispatches] = useState<DispatchLite[]>([])
  const [expiringLots, setExpiringLots] = useState<ExpiringLotLite[]>([])

  const [feed, setFeed] = useState<FeedItem[]>([])
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(new Date())
  const [tv, setTv] = useState(false)

  const moneyRef = useRef(money)
  moneyRef.current = money

  const pushFeed = useCallback((kind: FeedItem['kind'], text: string) => {
    setFeed(f => [{ id: Math.random().toString(36).slice(2), at: new Date().toISOString(), kind, text }, ...f].slice(0, 30))
  }, [])

  const load = useCallback(async () => {
    setError('')
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    const monthStart = new Date(t0.getFullYear(), t0.getMonth(), 1)
    const nextMonthStart = new Date(t0.getFullYear(), t0.getMonth() + 1, 1)
    const monthIsoDate = monthStart.toLocaleDateString('sv-SE')
    const monthPrefix = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, '0')}`

    try {
      const sinceSales = new Date(t0.getTime() - 70 * DAY).toISOString()
      const [
        s,
        v,
        cToday,
        cAll,
        st,
        tm,
        gl,
        pf,
        cxpRpc,
        prodsRes,
        expRes,
        payRes,
        accSetRes,
        accEntRes,
        accCloseRes,
        brRes,
        whRes,
        wsRes,
        trRes,
        dispRes,
        lotsRes,
      ] = await Promise.all([
        fetchSales(sinceSales),
        supabase.from('visits').select('id,seller_name,flag,created_at').gte('created_at', t0.toISOString()).order('created_at', { ascending: false }).limit(500),
        supabase.from('cash_entries').select('type,amount').gte('created_at', t0.toISOString()),
        supabase.from('cash_entries').select('type,amount').limit(5000),
        supabase.rpc('dashboard_stats', { p_month_start: monthStart.toISOString() }),
        supabase.rpc('list_team'),
        supabase.rpc('metas_progreso', { p_month: `${monthPrefix}-01`, p_from: monthStart.toISOString(), p_to: nextMonthStart.toISOString() }),
        supabase.rpc('cartera_clientes'),
        supabase.rpc('cuentas_por_pagar'),
        supabase.from('products').select('id,name,price,cost,stock,min_stock').limit(5000),
        supabase.from('expenses').select('amount,category_name,status').gte('expense_date', monthIsoDate),
        supabase.from('payroll_payments').select('net_paid,status').gte('payment_date', monthIsoDate),
        supabase.from('acc_settings').select('active,start_date,map').maybeSingle(),
        supabase.from('acc_entries').select('status').gte('entry_date', monthIsoDate).limit(2000),
        supabase.from('acc_closings').select('year,month,status').eq('status', 'cerrado').order('year', { ascending: false }).order('month', { ascending: false }).limit(1),
        supabase.from('branches').select('*').order('is_main', { ascending: false }).order('name'),
        supabase.from('warehouses').select('*').order('name'),
        supabase.from('warehouse_stock').select('company_id,warehouse_id,product_id,quantity,reserved_quantity,updated_at'),
        supabase.from('inventory_transfers').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('route_dispatches').select('id,dispatch_date,seller_name,vehicle_label,status,sales_cash,sales_bank,sales_credit').eq('status', 'abierto').order('created_at', { ascending: false }).limit(20),
        supabase.from('product_lots').select('id,lot_code,expiry_date,qty_remaining,products(name)').gt('qty_remaining', 0).not('expiry_date', 'is', null).order('expiry_date', { ascending: true }).limit(40),
      ])

      setSales(s)
      setVisits((v.data || []) as VisitRow[])
      setCash((cToday.data || []) as CashRow[])

      const allEntries = ((cAll.data || []) as CashRow[])
      const netAllCash = allEntries.reduce(
        (acc, row) => acc + (row.type === 'ingreso' ? Number(row.amount) || 0 : -(Number(row.amount) || 0)),
        0
      )
      setAllCashBalance(netAllCash)

      setLow(((st.data as any)?.low_stock_items || []) as LowItem[])
      setTeam((tm.data || []) as Member[])
      setGoals(
        ((gl.data || []) as any[]).map(r => ({
          id: String(r.r_seller_id),
          sales_total: Number(r.r_sales_total) || 0,
          sales_goal: Number(r.r_sales_goal) || 0,
        }))
      )
      setPort(pf.error ? null : (pf.data as Portfolio))

      // Cuentas por pagar con respaldo automático si el RPC no existe aún
      if (!cxpRpc.error && cxpRpc.data) {
        const d = cxpRpc.data as any
        setPayables({
          total_owed: Number(d.total_owed) || 0,
          total_overdue: Number(d.total_overdue) || 0,
          suppliers: ((d.suppliers || []) as any[]).map(sp => ({
            supplier_name: String(sp.supplier_name || sp.name || 'Proveedor'),
            owed: Number(sp.owed) || 0,
            overdue: Number(sp.overdue) || 0,
            next_due: sp.next_due || sp.oldest_due || null,
          })),
        })
      } else {
        const purFallback = await supabase
          .from('purchases')
          .select('supplier_name,total,paid_amount,due_date,payment_method,status')
          .eq('payment_method', 'credito')
        if (!purFallback.error && purFallback.data) {
          let totOwed = 0
          let totOver = 0
          const bySup = new Map<string, SupplierCreditor>()
          const todayIso = t0.toLocaleDateString('sv-SE')
          for (const pr of purFallback.data as any[]) {
            if (pr.status === 'anulada') continue
            const bal = Math.max(0, (Number(pr.total) || 0) - (Number(pr.paid_amount) || 0))
            if (bal <= 0.005) continue
            const isOv = Boolean(pr.due_date && String(pr.due_date) < todayIso)
            totOwed += bal
            if (isOv) totOver += bal
            const key = String(pr.supplier_name || 'Proveedor')
            const cur = bySup.get(key) || { supplier_name: key, owed: 0, overdue: 0, next_due: pr.due_date || null }
            cur.owed += bal
            if (isOv) cur.overdue += bal
            bySup.set(key, cur)
          }
          setPayables({
            total_owed: totOwed,
            total_overdue: totOver,
            suppliers: Array.from(bySup.values()).sort((a, b) => b.owed - a.owed),
          })
        }
      }

      setProducts(
        ((prodsRes.data || []) as any[]).map(p => ({
          id: String(p.id),
          name: String(p.name || 'Producto'),
          price: Number(p.price) || 0,
          cost: Number(p.cost) || 0,
          stock: Number(p.stock) || 0,
          min_stock: Number(p.min_stock) || 0,
        }))
      )

      setMonthExpenses(expRes.error ? [] : ((expRes.data || []) as ExpenseLite[]))
      setMonthPayroll(payRes.error ? [] : ((payRes.data || []) as PayrollLite[]))

      const accSet = accSetRes.error ? null : (accSetRes.data as any)
      const accEnt = accEntRes.error ? [] : ((accEntRes.data || []) as { status: string }[])
      const lastCl = !accCloseRes.error && accCloseRes.data && (accCloseRes.data as any[])[0]
        ? `${MONTHS_ES[((accCloseRes.data as any[])[0].month || 1) - 1]} ${(accCloseRes.data as any[])[0].year}`
        : null

      setAccSnap({
        configured: Boolean(accSet && accSet.map && Object.keys(accSet.map).length > 0),
        active: Boolean(accSet?.active),
        startDate: accSet?.start_date || null,
        postedCount: accEnt.filter(e => e.status === 'contabilizado').length,
        draftCount: accEnt.filter(e => e.status === 'borrador').length,
        lastClosedLabel: lastCl,
      })

      setBranches(brRes.error ? [] : ((brRes.data || []) as Branch[]))
      setWarehouses(whRes.error ? [] : ((whRes.data || []) as Warehouse[]))
      setWhStock(wsRes.error ? [] : ((wsRes.data || []) as WarehouseStockRow[]))
      setTransfers(trRes.error ? [] : ((trRes.data || []) as InventoryTransfer[]))
      setDispatches(dispRes.error ? [] : ((dispRes.data || []) as DispatchLite[]))

      if (!lotsRes.error && lotsRes.data) {
        const soon: ExpiringLotLite[] = []
        for (const l of lotsRes.data as any[]) {
          if (!l.expiry_date) continue
          const daysLeft = Math.ceil((new Date(`${String(l.expiry_date).slice(0, 10)}T00:00:00`).getTime() - t0.getTime()) / DAY)
          if (daysLeft <= 45) {
            soon.push({
              id: String(l.id),
              lot_number: String(l.lot_code || 'S/L'),
              expiry_date: String(l.expiry_date).slice(0, 10),
              quantity: Number(l.qty_remaining) || 0,
              product_name: String(l.products?.name || 'Producto'),
              daysLeft,
            })
          }
        }
        setExpiringLots(soon)
      } else {
        setExpiringLots([])
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el Centro de Control Empresarial')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canAccess) void load()
  }, [canAccess, load])

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!canAccess) return
    const t = window.setInterval(() => void load(), 5 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [canAccess, load])

  // Tiempo real: ventas, visitas y caja llegan sin recargar
  useEffect(() => {
    if (!canAccess) return
    const ch = supabase
      .channel('centro-mando')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, (p: any) => {
        const r = p.new as SaleRow
        if (!r || !r.id) return
        setSales(prev => {
          const i = prev.findIndex(x => x.id === r.id)
          if (i >= 0) {
            const c = prev.slice()
            c[i] = { ...prev[i], ...r }
            return c
          }
          return [...prev, r]
        })
        if (p.eventType === 'INSERT') {
          pushFeed('venta', `Venta de ${moneyRef.current(Number(r.total) || 0)} · ${r.customer_name || 'Cliente general'}`)
        } else if (r.status === 'anulada') {
          pushFeed('alerta', `Venta anulada por ${moneyRef.current(Number(r.total) || 0)}`)
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visits' }, (p: any) => {
        const r = p.new as VisitRow
        setVisits(prev => [r, ...prev])
        pushFeed(
          r.flag && r.flag !== 'ok' ? 'alerta' : 'visita',
          `${r.seller_name || 'Un vendedor'} registró una visita${r.flag && r.flag !== 'ok' ? ' con alerta de ubicación' : ''}`
        )
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cash_entries' }, (p: any) => {
        const r = p.new as CashRow
        setCash(prev => [...prev, r])
        pushFeed('caja', `${r.type === 'ingreso' ? 'Ingreso' : 'Egreso'} de caja por ${moneyRef.current(Number(r.amount) || 0)}`)
      })
      .subscribe((status: string) => setLive(status === 'SUBSCRIBED'))
    return () => {
      supabase.removeChannel(ch)
    }
  }, [canAccess, pushFeed])

  const m = useMemo(() => computeMetrics(sales, now), [sales, now])
  const cashIn = cash.filter(c => c.type === 'ingreso').reduce((a, c) => a + (Number(c.amount) || 0), 0)
  const cashOut = cash.filter(c => c.type === 'egreso').reduce((a, c) => a + (Number(c.amount) || 0), 0)
  const flagged = visits.filter(v => v.flag && v.flag !== 'ok')
  const nameOf = (id: string) => {
    const t = team.find(x => x.id === id)
    return t?.full_name || t?.email || 'Vendedor'
  }
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const board = goals
    .filter(g => g.sales_total > 0 || g.sales_goal > 0)
    .map(g => ({ ...g, projected: (g.sales_total / Math.max(1, now.getDate())) * daysInMonth }))
    .sort((a, b) => b.sales_total - a.sales_total)
  const withGoal = board.filter(b => b.sales_goal > 0)
  const goalAvg = withGoal.length ? withGoal.reduce((a, b) => a + b.projected / b.sales_goal, 0) / withGoal.length : null

  const owed = Number(port?.total_owed) || 0
  const overdue = Number(port?.total_overdue) || 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const aging = [0, 0, 0, 0]
  for (const d of port?.customers || []) {
    if (!(Number(d.overdue) > 0) || !d.oldest_due) continue
    const days = Math.floor((today.getTime() - new Date(d.oldest_due + (d.oldest_due.length <= 10 ? 'T00:00:00' : '')).getTime()) / DAY)
    aging[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3] += Number(d.overdue)
  }
  const topDebt = (port?.customers || []).filter(d => Number(d.overdue) > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 4)
  const copAlerts = visibleAlerts(cp).filter(a => a.severity !== 'info').slice(0, 4)
  const controlCount = m.alerts.filter(a => a.severity !== 'info').length + flagged.length

  // Consolidación financiera y de capital de trabajo (Vista CFO)
  const financeMetrics = useMemo(() => {
    let invCostValue = 0
    let invRetailValue = 0
    let weightedPriceSum = 0
    let weightedCostSum = 0

    const productCostById = new Map<string, number>()
    for (const p of products) {
      productCostById.set(p.id, p.cost)
      const positiveStock = Math.max(0, p.stock)
      invCostValue += positiveStock * p.cost
      invRetailValue += positiveStock * p.price
      if (p.price > 0 && p.cost > 0) {
        const weight = Math.max(1, positiveStock)
        weightedPriceSum += p.price * weight
        weightedCostSum += p.cost * weight
      }
    }

    const avgCostRatio = weightedPriceSum > 0 ? Math.min(0.92, Math.max(0.15, weightedCostSum / weightedPriceSum)) : 0.65
    const revenueMtd = m.mtd
    const estimatedCogs = revenueMtd * avgCostRatio
    const grossProfit = revenueMtd - estimatedCogs
    const grossMarginPct = revenueMtd > 0 ? (grossProfit / revenueMtd) * 100 : 0

    const activeExpenses = monthExpenses
      .filter(e => e.status !== 'anulado')
      .reduce((acc, e) => acc + (Number(e.amount) || 0), 0)

    const activePayroll = monthPayroll
      .filter(p => p.status !== 'anulado')
      .reduce((acc, p) => acc + (Number(p.net_paid) || 0), 0)

    const operatingIncome = grossProfit - activeExpenses - activePayroll
    const operatingMarginPct = revenueMtd > 0 ? (operatingIncome / revenueMtd) * 100 : 0

    const cxpOwed = payables.total_owed
    const cxpOverdue = payables.total_overdue
    const netReceivablePayable = owed - cxpOwed
    const workingCapital = allCashBalance + invCostValue + owed - cxpOwed

    // Gastos agrupados por categoría
    const expMap = new Map<string, number>()
    for (const e of monthExpenses) {
      if (e.status === 'anulado') continue
      const k = e.category_name || 'Gastos generales'
      expMap.set(k, (expMap.get(k) || 0) + (Number(e.amount) || 0))
    }
    const topExpenseCategories = Array.from(expMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    return {
      invCostValue,
      invRetailValue,
      avgCostRatio,
      revenueMtd,
      estimatedCogs,
      grossProfit,
      grossMarginPct,
      activeExpenses,
      activePayroll,
      operatingIncome,
      operatingMarginPct,
      cxpOwed,
      cxpOverdue,
      netReceivablePayable,
      workingCapital,
      topExpenseCategories,
      productCostById,
    }
  }, [products, m.mtd, monthExpenses, monthPayroll, payables, owed, allCashBalance])

  // Consolidación de estructura multibodega y logística (Vista COO)
  const structureMetrics = useMemo(() => {
    const branchById = new Map(branches.map(b => [b.id, b]))
    const whSummary = warehouses.map(w => {
      const rows = whStock.filter(r => r.warehouse_id === w.id)
      let units = 0
      let reserved = 0
      let costVal = 0
      let skuCount = 0

      for (const r of rows) {
        const q = Number(r.quantity) || 0
        const res = Number(r.reserved_quantity) || 0
        if (q > 0) skuCount += 1
        units += q
        reserved += res
        const unitCost = financeMetrics.productCostById.get(r.product_id) || 0
        costVal += Math.max(0, q) * unitCost
      }

      const branch = w.branch_id ? branchById.get(w.branch_id) : undefined
      return {
        warehouse: w,
        branchName: branch ? branch.name : 'Sede general',
        skuCount,
        units,
        reserved,
        available: Math.max(0, units - reserved),
        costVal,
      }
    })

    const totalWhUnits = whSummary.reduce((a, b) => a + b.units, 0)
    const totalWhReserved = whSummary.reduce((a, b) => a + b.reserved, 0)
    const activeTransfers = transfers.filter(t => t.status === 'in_transit' || t.status === 'draft')

    return {
      whSummary,
      totalWhUnits,
      totalWhReserved,
      activeTransfers,
    }
  }, [branches, warehouses, whStock, transfers, financeMetrics.productCostById])

  const lights: { label: string; light: Light; note: string }[] = [
    {
      label: 'Ventas',
      light: lightPace(m.pace),
      note: m.pace === null ? 'Aún sin referencia horaria' : `${Math.round(m.pace * 100)}% del ritmo habitual`,
    },
    {
      label: 'Cobranza',
      light: lightOverdue(owed, overdue),
      note: owed > 0 ? `${Math.round((overdue / owed) * 100)}% de cartera vencida` : 'Sin cartera abierta',
    },
    {
      label: 'Inventario',
      light: lightStock(low.length),
      note: `${low.length} SKU(s) bajo stock mínimo`,
    },
    {
      label: 'Equipo',
      light: lightGoals(goalAvg),
      note: goalAvg === null ? 'Sin metas definidas' : `Proyección ${Math.round(goalAvg * 100)}% de meta`,
    },
    {
      label: 'Control',
      light: lightControl(controlCount),
      note: `${controlCount} novedad(es) operativas`,
    },
  ]

  function goFull() {
    setTv(t => !t)
    const el: any = document.documentElement
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {})
    else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {})
  }

  if (!canAccess) {
    return (
      <p className="text-sm text-slate-500">
        El Centro de Control Empresarial está reservado para dirección, gerencia, administración y contabilidad.
      </p>
    )
  }

  const whNameById = (id: string) => warehouses.find(w => w.id === id)?.name || 'Bodega'

  return (
    <div className={tv ? 'text-[108%]' : ''}>
      {/* Cabecera ejecutiva */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Centro de Control Empresarial y Financiero</h1>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={`inline-flex items-center gap-1 font-medium ${live ? 'text-emerald-600' : 'text-slate-400'}`}>
              <Radio className="w-3.5 h-3.5" />
              {live ? 'Tiempo real conectado' : 'Sincronización periódica'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
              <span className="tabular-nums">{fmtDate(now, { hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector segmentado de vistas ejecutivas */}
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200 overflow-x-auto max-w-full">
            {(
              [
                ['pulso', 'Pulso en vivo'],
                ['finanzas', 'Posición financiera'],
                ['estructura', 'Estructura y sedes'],
              ] as [CommandTab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shrink-0"
            aria-label="Actualizar datos"
            title="Actualizar datos"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={goFull}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shrink-0"
            aria-label="Pantalla completa"
            title="Modo sala de juntas"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg mb-4">{error}</p>
      )}
      {loading && <p className="text-sm text-slate-400 mb-4">Consolidando indicadores operativos y financieros…</p>}

      {/* =====================================================================
          VISTA 1: PULSO OPERATIVO EN VIVO
         ===================================================================== */}
      {tab === 'pulso' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 mb-4">
            {lights.map(l => (
              <div key={l.label} className="bg-white rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">{l.label}</span>
                  <span className={`text-[11px] font-semibold ${LIGHT[l.light].text}`}>{LIGHT[l.light].label}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 tabular-nums">{l.note}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Ventas de hoy</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{money(m.todayTotal)}</p>
              <div className="mt-1">
                <Delta v={pctDelta(m.todayTotal, m.ySameHour)} suffix="vs ayer a esta hora" />
              </div>
              {m.projection !== null && (
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  Cierre proyectado: <strong className="text-slate-800">{money(m.projection)}</strong>
                </p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Operaciones y ticket hoy</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{m.todayCount}</p>
              <p className="text-xs text-slate-500 tabular-nums mt-0.5">Ticket promedio: {money(m.ticketToday)}</p>
              <div className="mt-1">
                {m.todayCount > 0 ? (
                  <Delta v={pctDelta(m.ticketToday, m.ticket30)} suffix="vs prom. 30 días" />
                ) : (
                  <span className="text-xs text-slate-400">sin facturación hoy</span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Facturación acumulada (mes)</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{money(m.mtd)}</p>
              <div className="mt-1">
                <Delta v={pctDelta(m.mtd, m.prevMtd)} suffix="vs mes anterior" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5 text-slate-400" /> Flujo neto de caja hoy
              </p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${cashIn - cashOut >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {money(cashIn - cashOut)}
              </p>
              <p className="text-xs text-slate-500 tabular-nums mt-1">
                {money(cashIn)} ingresa · {money(cashOut)} egresa
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            <div className="lg:col-span-2">
              <Card
                title="Curva horaria de facturación"
                right={<span className="text-[11px] text-slate-400">línea continua: hoy · punteada: ritmo habitual</span>}
              >
                <HourlyCompare today={m.cumToday} typical={m.cumTypical} nowHour={now.getHours()} />
              </Card>
            </div>

            <Card title="Alertas de atención inmediata">
              <div className="space-y-2">
                {m.alerts.map(a => (
                  <div key={a.id} className={`rounded-lg border p-2.5 ${SEV[a.severity].box}`}>
                    <p className="text-xs font-semibold text-slate-800">{a.title}</p>
                    <p className="text-[11px] text-slate-600">{a.detail}</p>
                  </div>
                ))}
                {flagged.length > 0 && (
                  <div className={`rounded-lg border p-2.5 ${SEV.alta.box}`}>
                    <p className="text-xs font-semibold text-slate-800 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      {flagged.length} visita(s) fuera de geocerca hoy
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate?.('map')}
                      className="text-[11px] text-slate-700 underline mt-0.5"
                    >
                      Auditar en Mapa y rutas
                    </button>
                  </div>
                )}
                {copAlerts.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => a.page && onNavigate?.(a.page)}
                    className={`w-full text-left rounded-lg border p-2.5 ${SEV[a.severity].box}`}
                  >
                    <p className="text-xs font-semibold text-slate-800">{a.title}</p>
                    {a.detail && <p className="text-[11px] text-slate-600">{a.detail}</p>}
                  </button>
                ))}
                {m.alerts.length === 0 && flagged.length === 0 && copAlerts.length === 0 && (
                  <p className="text-xs text-slate-400 py-2">Sin anomalías operativas activas en este momento.</p>
                )}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            <Card title="Tendencia diaria · últimos 14 días">
              <Sparkline values={m.daily14} color="#0f172a" height={70} />
              <p className="text-[11px] text-slate-500 mt-1.5 tabular-nums">
                Promedio diario: <strong className="text-slate-800">{money(m.daily14.reduce((a, b) => a + b, 0) / 14)}</strong>
              </p>
            </Card>

            <Card title="Mezcla de medios de cobro · mes">
              <div className="flex items-center gap-4">
                <Donut parts={m.mix.map((p, i) => ({ ...p, color: COLORS[i % COLORS.length] }))} />
                <div className="space-y-1.5 text-xs min-w-0 flex-1">
                  {m.mix.slice(0, 5).map((p, i) => (
                    <div key={p.label} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-slate-600 truncate">{p.label}</span>
                      </span>
                      <span className="font-semibold text-slate-800 tabular-nums shrink-0">{money(p.value)}</span>
                    </div>
                  ))}
                  {m.mix.length === 0 && <span className="text-slate-400">Sin cobros este mes</span>}
                </div>
              </div>
            </Card>

            <Card title="Mapa de calor horario · 8 semanas">
              <Heat matrix={m.heat} />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            <Card
              title="Cumplimiento comercial · mes"
              right={
                <button type="button" onClick={() => onNavigate?.('goals')} className="text-[11px] text-slate-600 hover:text-slate-900 underline">
                  Metas
                </button>
              }
            >
              {board.length === 0 ? (
                <p className="text-xs text-slate-400">Sin ventas asignadas por vendedor este mes.</p>
              ) : (
                <HBars
                  format={money}
                  items={board.slice(0, 6).map((b, i) => ({
                    label: `${nameOf(b.id)}${b.sales_goal > 0 ? ` · ${Math.round((b.sales_total / b.sales_goal) * 100)}%` : ''}`,
                    value: b.sales_total,
                    of: b.sales_goal > 0 ? b.sales_goal : undefined,
                    color: COLORS[i % COLORS.length],
                  }))}
                />
              )}
            </Card>

            <Card
              title="Cartera por cobrar"
              right={
                <button type="button" onClick={() => onNavigate?.('cartera')} className="text-[11px] text-slate-600 hover:text-slate-900 underline">
                  Cartera
                </button>
              }
            >
              {port === null ? (
                <p className="text-xs text-slate-400">Cartera no disponible.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm tabular-nums">
                    <span className="text-slate-500">Total por cobrar</span>
                    <strong className="text-slate-900">{money(owed)}</strong>
                  </div>
                  <div className="flex justify-between text-sm tabular-nums">
                    <span className="text-slate-500">Monto vencido</span>
                    <strong className="text-red-600">{money(overdue)}</strong>
                  </div>
                  <HBars
                    format={money}
                    items={[
                      { label: '1-30 días', value: aging[0], color: '#d97706' },
                      { label: '31-60 días', value: aging[1], color: '#ea580c' },
                      { label: '61-90 días', value: aging[2], color: '#dc2626' },
                      { label: 'Más de 90 días', value: aging[3], color: '#7f1d1d' },
                    ]}
                  />
                  {topDebt.map(d => (
                    <div key={d.name} className="flex justify-between text-xs text-slate-600 tabular-nums">
                      <span className="truncate pr-2">{d.name}</span>
                      <span className="font-medium text-slate-800">{money(d.overdue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Reposición prioritaria"
              right={
                <button type="button" onClick={() => onNavigate?.('buyplan')} className="text-[11px] text-slate-600 hover:text-slate-900 underline">
                  Plan de compras
                </button>
              }
            >
              {low.length === 0 ? (
                <p className="text-xs text-slate-400">Todos los productos superan su stock mínimo.</p>
              ) : (
                <div className="space-y-1.5">
                  {low.slice(0, 7).map(p => (
                    <div key={p.name} className="flex justify-between text-xs tabular-nums">
                      <span className="text-slate-700 truncate pr-2">{p.name}</span>
                      <span className={`font-semibold shrink-0 ${p.stock <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {p.stock} / mín {p.min_stock}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card title="Bitácora de actividad en tiempo real">
            {feed.length === 0 ? (
              <p className="text-xs text-slate-400">
                Las nuevas ventas, visitas geolocalizadas y movimientos de caja aparecerán aquí automáticamente.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {feed.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400 w-12 shrink-0 tabular-nums">
                      {fmtDate(f.at, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {f.kind === 'venta' ? (
                      <ShoppingCart className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : f.kind === 'visita' ? (
                      <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    ) : f.kind === 'caja' ? (
                      <Wallet className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    )}
                    <span className="text-slate-700">{f.text}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* =====================================================================
          VISTA 2: POSICIÓN FINANCIERA Y FLUJO (CFO VIEW)
         ===================================================================== */}
      {tab === 'finanzas' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Capital de trabajo operativo</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${financeMetrics.workingCapital >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {money(financeMetrics.workingCapital)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Caja + Inventario a costo + CxC − CxP
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Posición neta de crédito (CxC − CxP)</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${financeMetrics.netReceivablePayable >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {money(financeMetrics.netReceivablePayable)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Cobrar {money(owed)} · Pagar {money(financeMetrics.cxpOwed)}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Resultado operativo est. (mes)</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${financeMetrics.operatingIncome >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {money(financeMetrics.operatingIncome)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Margen operativo: <strong className="text-slate-800">{financeMetrics.operatingMarginPct.toFixed(1)}%</strong>
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Inventario valorizado a costo</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                {money(financeMetrics.invCostValue)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                PVP potencial: {money(financeMetrics.invRetailValue)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Cascada P&L Gerencial del Mes */}
            <div className="lg:col-span-2">
              <Card
                title="Cascada de resultados operativos · mes en curso"
                subtitle="Consolidación gerencial en tiempo real (ventas netas, costo promedio ponderado, gastos y nómina)."
                right={
                  <button
                    type="button"
                    onClick={() => onNavigate?.('profit')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap"
                  >
                    Rentabilidad detallada <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                }
              >
                <div className="divide-y divide-slate-100 text-sm">
                  {[
                    {
                      label: 'Ingresos por ventas activas (mes)',
                      note: `${sales.filter(s => s.status !== 'anulada' && new Date(s.created_at).getMonth() === now.getMonth() && new Date(s.created_at).getFullYear() === now.getFullYear()).length} operaciones`,
                      amount: financeMetrics.revenueMtd,
                      sign: '+',
                      tone: 'text-slate-900 font-semibold',
                    },
                    {
                      label: 'Costo estimado de mercancía vendida',
                      note: ` Costo medio ponderado (${(financeMetrics.avgCostRatio * 100).toFixed(1)}%)`,
                      amount: -financeMetrics.estimatedCogs,
                      sign: '−',
                      tone: 'text-slate-600',
                    },
                    {
                      label: 'Utilidad bruta comercial',
                      note: `Margen bruto ${financeMetrics.grossMarginPct.toFixed(1)}%`,
                      amount: financeMetrics.grossProfit,
                      sign: '=',
                      tone: 'text-slate-900 font-bold bg-slate-50/80',
                    },
                    {
                      label: 'Gastos operativos registrados',
                      note: 'Egresos administrativos, servicios y logística',
                      amount: -financeMetrics.activeExpenses,
                      sign: '−',
                      tone: 'text-slate-600',
                      actionPage: 'expenses',
                    },
                    {
                      label: 'Nómina y comisiones liquidadas',
                      note: 'Pagos salariales confirmados del mes',
                      amount: -financeMetrics.activePayroll,
                      sign: '−',
                      tone: 'text-slate-600',
                      actionPage: 'sellers',
                    },
                    {
                      label: 'Resultado operativo neto estimado',
                      note: `Margen neto ${financeMetrics.operatingMarginPct.toFixed(1)}% sobre ventas`,
                      amount: financeMetrics.operatingIncome,
                      sign: '=',
                      tone: financeMetrics.operatingIncome >= 0 ? 'text-emerald-700 font-bold bg-emerald-50/40' : 'text-red-700 font-bold bg-red-50/40',
                    },
                  ].map(row => (
                    <div key={row.label} className={`py-2.5 px-2 flex items-center justify-between gap-3 ${row.tone}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-400 w-4 shrink-0">{row.sign}</span>
                          <span className="truncate">{row.label}</span>
                          {row.actionPage && (
                            <button
                              type="button"
                              onClick={() => onNavigate?.(row.actionPage!)}
                              className="text-[11px] font-normal text-slate-500 hover:text-slate-900 underline shrink-0"
                            >
                              ver
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] font-normal text-slate-500 pl-6">{row.note}</p>
                      </div>
                      <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                        {money(row.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Estado Contable y Libros */}
            <Card
              title="Gobierno contable y libros"
              subtitle="Sincronización entre operación diaria y partida doble."
              right={<BookOpen className="w-4 h-4 text-slate-400 shrink-0" />}
            >
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-600">Contabilidad automática</span>
                    <span className={`font-semibold ${accSnap.active ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {accSnap.active ? 'Activa' : accSnap.configured ? 'Pausada' : 'Pendiente de configurar'}
                    </span>
                  </div>
                  {accSnap.startDate && (
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      Inicio contable: {accSnap.startDate}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg border border-slate-200 p-2.5">
                    <p className="text-[11px] text-slate-500">Asientos del mes</p>
                    <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{accSnap.postedCount}</p>
                    <p className="text-[10px] text-emerald-700">contabilizados</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2.5">
                    <p className="text-[11px] text-slate-500">En borrador</p>
                    <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{accSnap.draftCount}</p>
                    <p className="text-[10px] text-slate-500">por revisar</p>
                  </div>
                </div>

                <div className="text-xs text-slate-600 flex items-center justify-between py-1.5 border-t border-slate-100">
                  <span>Último cierre mensual:</span>
                  <strong className="text-slate-900 capitalize">{accSnap.lastClosedLabel || 'Sin cierres aún'}</strong>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('treasury')}
                    className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                  >
                    Tesorería 30/60/90d
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('costcenters')}
                    className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                  >
                    Centros de costo
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('accstate')}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
                  >
                    Estados financieros
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('accounting')}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
                  >
                    Libro diario y mayor
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('accsetup')}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
                  >
                    Conciliar cuentas
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('accclose')}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
                  >
                    Cierre de libros
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* CxC vs CxP + Estructura de Gastos */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card
              title="Exigibilidad: Clientes por cobrar"
              right={
                <button type="button" onClick={() => onNavigate?.('cartera')} className="text-xs text-slate-600 hover:text-slate-900 underline">
                  Gestionar cobros
                </button>
              }
            >
              <div className="space-y-2.5">
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-slate-500">Saldo total cartera</span>
                  <strong className="text-slate-900">{money(owed)}</strong>
                </div>
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-slate-500">Cartera vencida</span>
                  <strong className={overdue > 0 ? 'text-red-600' : 'text-emerald-700'}>{money(overdue)}</strong>
                </div>
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  {(port?.customers || []).slice(0, 4).map(c => (
                    <div key={c.name} className="flex justify-between text-xs tabular-nums">
                      <span className="text-slate-700 truncate pr-2">{c.name}</span>
                      <span className="font-medium text-slate-900 shrink-0">{money(c.owed)}</span>
                    </div>
                  ))}
                  {(port?.customers || []).length === 0 && (
                    <p className="text-xs text-slate-400">Sin cuentas por cobrar abiertas.</p>
                  )}
                </div>
              </div>
            </Card>

            <Card
              title="Obligaciones: Proveedores por pagar"
              right={
                <button type="button" onClick={() => onNavigate?.('payables')} className="text-xs text-slate-600 hover:text-slate-900 underline">
                  Programar pagos
                </button>
              }
            >
              <div className="space-y-2.5">
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-slate-500">Deuda con proveedores</span>
                  <strong className="text-slate-900">{money(financeMetrics.cxpOwed)}</strong>
                </div>
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-slate-500">Facturas vencidas</span>
                  <strong className={financeMetrics.cxpOverdue > 0 ? 'text-red-600' : 'text-emerald-700'}>
                    {money(financeMetrics.cxpOverdue)}
                  </strong>
                </div>
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  {payables.suppliers.slice(0, 4).map(sp => (
                    <div key={sp.supplier_name} className="flex justify-between text-xs tabular-nums">
                      <span className="text-slate-700 truncate pr-2">{sp.supplier_name}</span>
                      <span className="font-medium text-slate-900 shrink-0">{money(sp.owed)}</span>
                    </div>
                  ))}
                  {payables.suppliers.length === 0 && (
                    <p className="text-xs text-slate-400">Sin cuentas por pagar pendientes.</p>
                  )}
                </div>
              </div>
            </Card>

            <Card
              title="Principales rubros de gasto · mes"
              right={
                <button type="button" onClick={() => onNavigate?.('expenses')} className="text-xs text-slate-600 hover:text-slate-900 underline">
                  Ver gastos
                </button>
              }
            >
              {financeMetrics.topExpenseCategories.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">No se han registrado gastos operativos este mes.</p>
              ) : (
                <HBars
                  format={money}
                  items={financeMetrics.topExpenseCategories.map((c, i) => ({
                    label: c.label,
                    value: c.value,
                    color: COLORS[i % COLORS.length],
                  }))}
                />
              )}
            </Card>
          </div>
        </div>
      )}

      {/* =====================================================================
          VISTA 3: ESTRUCTURA, SEDES Y LOGÍSTICA (COO VIEW)
         ===================================================================== */}
      {tab === 'estructura' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-400" /> Sucursales registradas
              </p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                {branches.filter(b => b.active).length}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {warehouses.filter(w => w.active).length} bodega(s) operativas
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" /> Unidades en bodegas
              </p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                {structureMetrics.totalWhUnits.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Reservadas: <strong className="text-slate-700">{structureMetrics.totalWhReserved.toLocaleString()}</strong>
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-slate-400" /> Traslados y rutas activas
              </p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                {structureMetrics.activeTransfers.length + dispatches.length}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {structureMetrics.activeTransfers.length} traslado(s) · {dispatches.length} ruta(s) en calle
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-slate-400" /> Lotes por vencer (≤ 45d)
              </p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${expiringLots.length > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                {expiringLots.length}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Control FEFO de perecederos
              </p>
            </div>
          </div>

          {/* Consolidado por Sucursal y Bodega */}
          <Card
            title="Distribución patrimonial y operativa por sede / bodega"
            subtitle="Existencias físicas, reservas comprometidas y valoración a costo por centro logístico."
            right={
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate?.('purchaseorders')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Órdenes de compra <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate?.('warehouses')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Abrir Sedes y multibodega <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            }
          >
            {structureMetrics.whSummary.length === 0 ? (
              <div className="py-6 text-center space-y-2">
                <p className="text-sm font-medium text-slate-700">Aún no se han inicializado sucursales o bodegas</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Desde el módulo «Sedes y multibodega» puedes estructurar tu casa matriz, sucursales comerciales, bodegas de tránsito y almacenes de devoluciones.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.('warehouses')}
                  className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Configurar estructura multibodega
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2.5 pr-3 font-medium">Bodega / Código</th>
                      <th className="py-2.5 px-3 font-medium">Sucursal</th>
                      <th className="py-2.5 px-3 font-medium">Tipo</th>
                      <th className="py-2.5 px-3 font-medium text-right">SKUs</th>
                      <th className="py-2.5 px-3 font-medium text-right">Físico</th>
                      <th className="py-2.5 px-3 font-medium text-right">Reservado</th>
                      <th className="py-2.5 px-3 font-medium text-right">Disponible</th>
                      <th className="py-2.5 pl-3 font-medium text-right">Valor a costo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {structureMetrics.whSummary.map(row => (
                      <tr key={row.warehouse.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-slate-900">
                            {row.warehouse.name}
                            {row.warehouse.warehouse_type === 'principal' && (
                              <span className="ml-1.5 text-[10px] font-medium text-emerald-700">· Principal</span>
                            )}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">{row.warehouse.code || '—'}</p>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{row.branchName}</td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {WAREHOUSE_TYPE_LABEL[row.warehouse.warehouse_type] || row.warehouse.warehouse_type}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">{row.skuCount}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">{row.units}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">{row.reserved}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {row.available}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {money(row.costVal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card
              title="Traslados internos activos"
              right={
                <button type="button" onClick={() => onNavigate?.('warehouses')} className="text-xs text-slate-600 hover:text-slate-900 underline">
                  Ver traslados
                </button>
              }
            >
              {structureMetrics.activeTransfers.length === 0 ? (
                <p className="text-xs text-slate-400 flex items-center gap-1.5 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  Sin mercadería pendiente de recepción entre sedes.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {structureMetrics.activeTransfers.slice(0, 5).map(t => (
                    <div key={t.id} className="flex items-start justify-between gap-2 text-xs border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-mono font-semibold text-slate-900">
                          TRF-{t.id.slice(0, 6).toUpperCase()}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {whNameById(t.source_warehouse_id)} → {whNameById(t.destination_warehouse_id)}
                        </p>
                      </div>
                      <span className="text-[11px] font-medium text-amber-700 shrink-0">
                        {t.status === 'in_transit' ? 'En tránsito' : 'Borrador'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Despachos de ruta abiertos"
              right={
                <button type="button" onClick={() => onNavigate?.('dispatch')} className="text-xs text-slate-600 hover:text-slate-900 underline">
                  Despachos
                </button>
              }
            >
              {dispatches.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">No hay vehículos o vendedores con carga pendiente de liquidar.</p>
              ) : (
                <div className="space-y-2.5">
                  {dispatches.slice(0, 5).map(d => {
                    const soldSum = (Number(d.sales_cash) || 0) + (Number(d.sales_bank) || 0) + (Number(d.sales_credit) || 0)
                    return (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{d.seller_name}</p>
                          <p className="text-[11px] text-slate-500 tabular-nums">
                            {d.dispatch_date}{d.vehicle_label ? ` · ${d.vehicle_label}` : ''}
                          </p>
                        </div>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                          {money(soldSum)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card
              title="Vencimientos próximos (FEFO)"
              right={
                <button type="button" onClick={() => onNavigate?.('lots')} className="text-xs text-slate-600 hover:text-slate-900 underline">
                  Lotes
                </button>
              }
            >
              {expiringLots.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">Sin lotes próximos a caducar en los siguientes 45 días.</p>
              ) : (
                <div className="space-y-2">
                  {expiringLots.slice(0, 5).map(l => (
                    <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{l.product_name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          Lote {l.lot_number} · {l.quantity} u.
                        </p>
                      </div>
                      <span className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 ${l.daysLeft <= 15 ? 'text-red-600' : 'text-amber-700'}`}>
                        {l.daysLeft <= 0 ? 'Vencido' : `${l.daysLeft}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
