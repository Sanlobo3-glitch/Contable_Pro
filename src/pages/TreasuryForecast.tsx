import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isCompanyManager, canViewAccounting, isReadOnly } from '../lib/auth'
import { useWarehouse } from '../lib/warehouseContext'
import { useCurrency } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import { esc, printHtml } from '../lib/documents'
import SqlActivationModal from '../components/SqlActivationModal'
import type { FinancialBudget, FinancialBudgetKind } from '../types'
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  X,
  Download,
  ArrowUpRight,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Copy,
  Printer,
  Database,
} from 'lucide-react'

type ViewTab = 'cashflow' | 'budget'
type Scenario = 'conservador' | 'base' | 'optimista'

interface CashHorizonRow {
  key: string
  label: string
  daysLabel: string
  opening: number
  cxcIn: number
  projectedCashSales: number
  cxpOut: number
  poCommitmentsOut: number
  fixedOut: number
  netChange: number
  ending: number
}

interface ScheduledEvent {
  id: string
  dueDate: string
  daysDiff: number
  direction: 'in' | 'out'
  source: 'Cartera CxC' | 'Proveedor CxP' | 'Orden de Compra'
  party: string
  reference: string
  amount: number
  navPage: string
}

const KIND_LABELS: Record<FinancialBudgetKind, string> = {
  ingreso_ventas: 'Meta de ingresos por ventas',
  costo_compras: 'Techo de compras y abastecimiento',
  gasto_operativo: 'Gasto operativo por categoría',
  nomina: 'Presupuesto de nómina y comisiones',
}

const SCENARIO_FACTORS: Record<Scenario, { salesFactor: number; cxcFactor: number; label: string }> = {
  conservador: { salesFactor: 0.8, cxcFactor: 0.75, label: 'Conservador (80% ventas / 75% recaudo)' },
  base: { salesFactor: 1.0, cxcFactor: 0.9, label: 'Escenario base (ritmo 30d / 90% recaudo)' },
  optimista: { salesFactor: 1.15, cxcFactor: 1.0, label: 'Optimista (+15% ventas / 100% recaudo)' },
}

const DAY_MS = 86400000

function currentMonthValue(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function localBudgetKey(companyId: string | null | undefined, monthVal: string): string {
  return `invpro_budgets_fallback_${companyId || 'local'}_${monthVal}`
}

export default function TreasuryForecast({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const { branches } = useWarehouse()

  const canAccess = isCompanyManager(user?.role) || canViewAccounting(user?.role)
  const readOnly = isReadOnly(user)

  const [tab, setTab] = useState<ViewTab>('cashflow')
  const [scenario, setScenario] = useState<Scenario>('base')
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const [branchFilter, setBranchFilter] = useState<string>('all')

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sqlBudgetsReady, setSqlBudgetsReady] = useState(true)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Datos base para tesorería y ejecución presupuestaria
  const [openingLiquidity, setOpeningLiquidity] = useState(0)
  const [dailyCashSalesAvg, setDailyCashSalesAvg] = useState(0)
  const [dailyFixedBurnAvg, setDailyFixedBurnAvg] = useState(0)
  const [events, setEvents] = useState<ScheduledEvent[]>([])

  // Ejecución real del mes seleccionado
  const [actualSalesMonth, setActualSalesMonth] = useState(0)
  const [actualPurchasesMonth, setActualPurchasesMonth] = useState(0)
  const [actualPayrollMonth, setActualPayrollMonth] = useState(0)
  const [actualExpensesByCat, setActualExpensesByCat] = useState<Record<string, number>>({})
  const [expenseCategoryNames, setExpenseCategoryNames] = useState<string[]>([])

  // Presupuestos del mes seleccionado
  const [budgets, setBudgets] = useState<FinancialBudget[]>([])

  // Modal de creación / edición de partida presupuestaria
  const [modalOpen, setModalOpen] = useState(false)
  const [cloneModalOpen, setCloneModalOpen] = useState(false)
  const [cloneVariationPct, setCloneVariationPct] = useState('5')
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<FinancialBudget | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [form, setForm] = useState<{
    kind: FinancialBudgetKind
    category_name: string
    branch_id: string
    budget_amount: string
    notes: string
  }>({
    kind: 'gasto_operativo',
    category_name: '',
    branch_id: '',
    budget_amount: '',
    notes: '',
  })

  const load = useCallback(async () => {
    if (!canAccess) {
      setLoading(false)
      return
    }
    setLoading(true)
    setFeedback(null)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayIso = today.toLocaleDateString('sv-SE')
    const since30Iso = new Date(today.getTime() - 30 * DAY_MS).toISOString()

    const [selYear, selMonth] = monthFilter.split('-').map(Number)
    const monthStart = new Date(selYear, (selMonth || 1) - 1, 1)
    const monthEnd = new Date(selYear, selMonth || 1, 1)
    const monthStartDate = `${monthFilter}-01`
    const monthEndDate = new Date(monthEnd.getTime() - DAY_MS).toLocaleDateString('sv-SE')

    try {
      const [
        cashAllRes,
        sales30Res,
        salesPendingRes,
        purCreditRes,
        poOpenRes,
        exp30Res,
        pay30Res,
        salesMonthRes,
        purMonthRes,
        expMonthRes,
        payMonthRes,
        expCatsRes,
        budgetsRes,
      ] = await Promise.all([
        supabase.from('cash_entries').select('type,amount').limit(5000),
        supabase.from('sales').select('total,payment_method,status,created_at,branch_id,warehouse_id').gte('created_at', since30Iso),
        supabase.from('sales').select('id,customer_name,total,paid_amount,due_date,payment_method,status,created_at').eq('payment_method', 'fiado'),
        supabase.from('purchases').select('id,supplier_name,total,paid_amount,due_date,payment_method,status,created_at').eq('payment_method', 'credito'),
        supabase.from('purchase_orders').select('id,po_number,supplier_name,total,status,payment_terms,credit_days,expected_date').in('status', ['approved', 'sent', 'partial']),
        supabase.from('expenses').select('amount,status,expense_date').gte('expense_date', new Date(today.getTime() - 30 * DAY_MS).toLocaleDateString('sv-SE')),
        supabase.from('payroll_payments').select('net_paid,status,payment_date').gte('payment_date', new Date(today.getTime() - 30 * DAY_MS).toLocaleDateString('sv-SE')),
        supabase.from('sales').select('total,status,branch_id,warehouse_id,created_at').gte('created_at', monthStart.toISOString()).lt('created_at', monthEnd.toISOString()),
        supabase.from('purchases').select('total,status,branch_id,created_at').gte('created_at', monthStart.toISOString()).lt('created_at', monthEnd.toISOString()),
        supabase.from('expenses').select('amount,category_name,status,branch_id,expense_date').gte('expense_date', monthStartDate).lte('expense_date', monthEndDate),
        supabase.from('payroll_payments').select('net_paid,status,payment_date').gte('payment_date', monthStartDate).lte('payment_date', monthEndDate),
        supabase.from('expense_categories').select('name').eq('active', true).order('name'),
        supabase.from('financial_budgets').select('*').eq('period_month', monthStartDate).order('kind'),
      ])

      // 1. Liquidez inicial disponible en Caja
      const cashEntries = (cashAllRes.data || []) as { type: string; amount: number }[]
      const netCash = cashEntries.reduce(
        (acc, r) => acc + (r.type === 'ingreso' ? Number(r.amount) || 0 : -(Number(r.amount) || 0)),
        0
      )
      setOpeningLiquidity(netCash)

      // 2. Velocidad diaria de ventas de contado (30d) y egresos fijos (gastos + nómina 30d)
      const sales30 = ((sales30Res.data || []) as any[]).filter(s => s.status !== 'anulada' && s.payment_method !== 'fiado')
      const sumCashSales30 = sales30.reduce((acc, s) => acc + (Number(s.total) || 0), 0)
      setDailyCashSalesAvg(sumCashSales30 / 30)

      const exp30Sum = ((exp30Res.data || []) as any[])
        .filter(e => e.status !== 'anulado')
        .reduce((acc, e) => acc + (Number(e.amount) || 0), 0)
      const pay30Sum = ((pay30Res.data || []) as any[])
        .filter(p => p.status !== 'anulado')
        .reduce((acc, p) => acc + (Number(p.net_paid) || 0), 0)
      setDailyFixedBurnAvg((exp30Sum + pay30Sum) / 30)

      // 3. Eventos programados de Cartera (CxC), Proveedores (CxP) y Órdenes de Compra (OC)
      const nextEvents: ScheduledEvent[] = []

      for (const s of (salesPendingRes.data || []) as any[]) {
        if (s.status === 'anulada') continue
        const bal = Math.max(0, (Number(s.total) || 0) - (Number(s.paid_amount) || 0))
        if (bal <= 0.01) continue
        const due = s.due_date ? String(s.due_date).slice(0, 10) : todayIso
        const diff = Math.round((new Date(`${due}T00:00:00`).getTime() - today.getTime()) / DAY_MS)
        nextEvents.push({
          id: `cxc-${s.id}`,
          dueDate: due,
          daysDiff: diff,
          direction: 'in',
          source: 'Cartera CxC',
          party: String(s.customer_name || 'Cliente crédito'),
          reference: `FAC-${String(s.id).slice(0, 6).toUpperCase()}`,
          amount: bal,
          navPage: 'cartera',
        })
      }

      for (const p of (purCreditRes.data || []) as any[]) {
        if (p.status === 'anulada') continue
        const bal = Math.max(0, (Number(p.total) || 0) - (Number(p.paid_amount) || 0))
        if (bal <= 0.01) continue
        const due = p.due_date ? String(p.due_date).slice(0, 10) : todayIso
        const diff = Math.round((new Date(`${due}T00:00:00`).getTime() - today.getTime()) / DAY_MS)
        nextEvents.push({
          id: `cxp-${p.id}`,
          dueDate: due,
          daysDiff: diff,
          direction: 'out',
          source: 'Proveedor CxP',
          party: String(p.supplier_name || 'Proveedor'),
          reference: `CMP-${String(p.id).slice(0, 6).toUpperCase()}`,
          amount: bal,
          navPage: 'payables',
        })
      }

      if (!poOpenRes.error && Array.isArray(poOpenRes.data)) {
        for (const po of poOpenRes.data as any[]) {
          const amt = Number(po.total) || 0
          if (amt <= 0) continue
          const baseExp = po.expected_date ? new Date(`${String(po.expected_date).slice(0, 10)}T00:00:00`) : new Date(today.getTime() + 7 * DAY_MS)
          const cashOutDate = new Date(
            baseExp.getTime() + (po.payment_terms === 'credito' ? (Number(po.credit_days) || 30) * DAY_MS : 0)
          )
          const due = cashOutDate.toLocaleDateString('sv-SE')
          const diff = Math.round((cashOutDate.getTime() - today.getTime()) / DAY_MS)
          nextEvents.push({
            id: `po-${po.id}`,
            dueDate: due,
            daysDiff: diff,
            direction: 'out',
            source: 'Orden de Compra',
            party: String(po.supplier_name || 'Proveedor'),
            reference: String(po.po_number || 'OC'),
            amount: amt,
            navPage: 'purchaseorders',
          })
        }
      }

      nextEvents.sort((a, b) => a.daysDiff - b.daysDiff)
      setEvents(nextEvents)

      // 4. Ejecución real del mes seleccionado (filtrada por sucursal si aplica)
      const matchBranch = (rowBranchId?: string | null) =>
        branchFilter === 'all' ? true : (rowBranchId || null) === branchFilter

      const mSales = ((salesMonthRes.data || []) as any[])
        .filter(s => s.status !== 'anulada' && matchBranch(s.branch_id))
        .reduce((acc, s) => acc + (Number(s.total) || 0), 0)
      setActualSalesMonth(mSales)

      const mPurchases = ((purMonthRes.data || []) as any[])
        .filter(p => p.status !== 'anulada' && matchBranch(p.branch_id))
        .reduce((acc, p) => acc + (Number(p.total) || 0), 0)
      setActualPurchasesMonth(mPurchases)

      const expCatTotals: Record<string, number> = {}
      for (const e of (expMonthRes.data || []) as any[]) {
        if (e.status === 'anulado' || !matchBranch(e.branch_id)) continue
        const cat = String(e.category_name || 'Otros gastos')
        expCatTotals[cat] = (expCatTotals[cat] || 0) + (Number(e.amount) || 0)
      }
      setActualExpensesByCat(expCatTotals)

      const mPayroll =
        branchFilter === 'all'
          ? ((payMonthRes.data || []) as any[])
              .filter(p => p.status !== 'anulado')
              .reduce((acc, p) => acc + (Number(p.net_paid) || 0), 0)
          : 0
      setActualPayrollMonth(mPayroll)

      setExpenseCategoryNames(
        ((expCatsRes.data || []) as { name: string }[]).map(c => c.name)
      )

      // 5. Presupuestos del mes (SQL o respaldo local si aún no se ejecuta migración 000013)
      if (budgetsRes.error && /financial_budgets|does not exist|42P01|schema cache/i.test(budgetsRes.error.message || '')) {
        setSqlBudgetsReady(false)
        try {
          const raw = localStorage.getItem(localBudgetKey(user?.company_id, monthFilter))
          setBudgets(raw ? (JSON.parse(raw) as FinancialBudget[]) : [])
        } catch {
          setBudgets([])
        }
      } else {
        setSqlBudgetsReady(true)
        setBudgets((budgetsRes.data || []) as FinancialBudget[])
      }
    } catch (e: any) {
      setFeedback({ ok: false, text: e?.message || 'Error al calcular proyecciones de tesorería' })
    }

    setLoading(false)
  }, [canAccess, monthFilter, branchFilter, user?.company_id])

  useEffect(() => {
    void load()
  }, [load])

  // Proyección escalonada 30 / 60 / 90 días
  const horizons: CashHorizonRow[] = useMemo(() => {
    const f = SCENARIO_FACTORS[scenario]
    const windows: { key: string; label: string; daysLabel: string; minDay: number; maxDay: number; spanDays: number }[] = [
      { key: 'w7', label: 'Corto plazo inmediato', daysLabel: 'Hoy + 7 días', minDay: -9999, maxDay: 7, spanDays: 7 },
      { key: 'w15', label: 'Quincena operativa', daysLabel: 'Días 8 a 15', minDay: 8, maxDay: 15, spanDays: 8 },
      { key: 'w30', label: 'Cierre de 30 días', daysLabel: 'Días 16 a 30', minDay: 16, maxDay: 30, spanDays: 15 },
      { key: 'w60', label: 'Horizonte 60 días', daysLabel: 'Días 31 a 60', minDay: 31, maxDay: 60, spanDays: 30 },
      { key: 'w90', label: 'Horizonte 90 días', daysLabel: 'Días 61 a 90', minDay: 61, maxDay: 90, spanDays: 30 },
    ]

    let running = openingLiquidity
    return windows.map(w => {
      const opening = running
      const inWindow = events.filter(ev => ev.daysDiff >= w.minDay && ev.daysDiff <= w.maxDay)

      const cxcRaw = inWindow
        .filter(ev => ev.direction === 'in')
        .reduce((a, b) => a + b.amount, 0)
      const cxcIn = cxcRaw * f.cxcFactor

      const projectedCashSales = dailyCashSalesAvg * w.spanDays * f.salesFactor

      const cxpOut = inWindow
        .filter(ev => ev.direction === 'out' && ev.source === 'Proveedor CxP')
        .reduce((a, b) => a + b.amount, 0)

      const poCommitmentsOut = inWindow
        .filter(ev => ev.direction === 'out' && ev.source === 'Orden de Compra')
        .reduce((a, b) => a + b.amount, 0)

      const fixedOut = dailyFixedBurnAvg * w.spanDays

      const netChange = cxcIn + projectedCashSales - cxpOut - poCommitmentsOut - fixedOut
      const ending = opening + netChange
      running = ending

      return {
        key: w.key,
        label: w.label,
        daysLabel: w.daysLabel,
        opening,
        cxcIn,
        projectedCashSales,
        cxpOut,
        poCommitmentsOut,
        fixedOut,
        netChange,
        ending,
      }
    })
  }, [openingLiquidity, events, dailyCashSalesAvg, dailyFixedBurnAvg, scenario])

  const end30 = horizons[2]?.ending ?? openingLiquidity
  const end60 = horizons[3]?.ending ?? end30
  const end90 = horizons[4]?.ending ?? end60
  const totalScheduledIn30 = events
    .filter(e => e.direction === 'in' && e.daysDiff <= 30)
    .reduce((a, b) => a + b.amount, 0)
  const totalScheduledOut30 = events
    .filter(e => e.direction === 'out' && e.daysDiff <= 30)
    .reduce((a, b) => a + b.amount, 0)

  // Filas consolidadas de Presupuesto vs Ejecución Real
  const budgetRows = useMemo(() => {
    const filtered = budgets.filter(b =>
      branchFilter === 'all' ? true : b.branch_id === branchFilter
    )

    return filtered.map(b => {
      let actual = 0
      if (b.kind === 'ingreso_ventas') {
        actual = actualSalesMonth
      } else if (b.kind === 'costo_compras') {
        actual = actualPurchasesMonth
      } else if (b.kind === 'nomina') {
        actual = actualPayrollMonth + (actualExpensesByCat['Nómina y comisiones'] || 0)
      } else {
        actual = actualExpensesByCat[b.category_name] || 0
      }

      const pct = b.budget_amount > 0 ? (actual / b.budget_amount) * 100 : 0
      const variance = actual - b.budget_amount
      const isRevenue = b.kind === 'ingreso_ventas'
      const healthy = isRevenue ? pct >= 90 : pct <= 90
      const warning = isRevenue ? pct >= 65 && pct < 90 : pct > 90 && pct <= 100

      return {
        budget: b,
        actual,
        pct,
        variance,
        isRevenue,
        healthy,
        warning,
      }
    })
  }, [budgets, branchFilter, actualSalesMonth, actualPurchasesMonth, actualPayrollMonth, actualExpensesByCat])

  const budgetSummary = useMemo(() => {
    const revTarget = budgetRows.filter(r => r.isRevenue).reduce((a, r) => a + r.budget.budget_amount, 0)
    const revActual = budgetRows.filter(r => r.isRevenue).reduce((a, r) => a + r.actual, 0)
    const outTarget = budgetRows.filter(r => !r.isRevenue).reduce((a, r) => a + r.budget.budget_amount, 0)
    const outActual = budgetRows.filter(r => !r.isRevenue).reduce((a, r) => a + r.actual, 0)
    return { revTarget, revActual, outTarget, outActual }
  }, [budgetRows])

  function openNewBudget() {
    setEditingBudget(null)
    setForm({
      kind: 'gasto_operativo',
      category_name: expenseCategoryNames[0] || 'Servicios públicos',
      branch_id: branchFilter !== 'all' ? branchFilter : '',
      budget_amount: '',
      notes: '',
    })
    setModalOpen(true)
  }

  function openEditBudget(b: FinancialBudget) {
    setEditingBudget(b)
    setForm({
      kind: b.kind,
      category_name: b.category_name,
      branch_id: b.branch_id || '',
      budget_amount: String(b.budget_amount),
      notes: b.notes || '',
    })
    setModalOpen(true)
  }

  async function saveBudgetLine(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || busy) return
    const amt = Number(form.budget_amount)
    if (!form.category_name.trim() || !Number.isFinite(amt) || amt < 0) {
      setFeedback({ ok: false, text: 'Indica un rubro y un monto presupuestado válido.' })
      return
    }

    setBusy(true)
    const periodDate = `${monthFilter}-01`

    if (sqlBudgetsReady) {
      const { error } = await supabase.rpc('upsert_financial_budget', {
        p_id: editingBudget?.id || null,
        p_period_month: periodDate,
        p_branch_id: form.branch_id || null,
        p_kind: form.kind,
        p_category_name: form.category_name.trim(),
        p_budget_amount: amt,
        p_notes: form.notes.trim() || null,
      })
      setBusy(false)
      if (error) {
        setFeedback({ ok: false, text: error.message })
        return
      }
    } else {
      const key = localBudgetKey(user?.company_id, monthFilter)
      const nextList = [...budgets]
      if (editingBudget) {
        const idx = nextList.findIndex(x => x.id === editingBudget.id)
        if (idx >= 0) {
          nextList[idx] = {
            ...editingBudget,
            branch_id: form.branch_id || null,
            kind: form.kind,
            category_name: form.category_name.trim(),
            budget_amount: amt,
            notes: form.notes.trim() || null,
          }
        }
      } else {
        nextList.unshift({
          id: Math.random().toString(36).slice(2),
          period_month: periodDate,
          branch_id: form.branch_id || null,
          kind: form.kind,
          category_name: form.category_name.trim(),
          budget_amount: amt,
          notes: form.notes.trim() || null,
          created_at: new Date().toISOString(),
        })
      }
      localStorage.setItem(key, JSON.stringify(nextList))
      setBudgets(nextList)
      setBusy(false)
    }

    setModalOpen(false)
    setFeedback({ ok: true, text: 'Partida presupuestaria guardada.' })
    if (sqlBudgetsReady) await load()
  }

  async function confirmDeleteBudget(id: string) {
    if (readOnly || busy) return
    setBusy(true)
    if (sqlBudgetsReady) {
      await supabase.rpc('delete_financial_budget', { p_id: id })
      await load()
    } else {
      const nextList = budgets.filter(b => b.id !== id)
      localStorage.setItem(localBudgetKey(user?.company_id, monthFilter), JSON.stringify(nextList))
      setBudgets(nextList)
    }
    setDeleteTargetId(null)
    setBusy(false)
  }

  async function autoSeedBudgetsFromHistory() {
    if (readOnly || busy) return
    setBusy(true)
    const suggested: Omit<FinancialBudget, 'id' | 'created_at'>[] = [
      {
        period_month: `${monthFilter}-01`,
        branch_id: branchFilter !== 'all' ? branchFilter : null,
        kind: 'ingreso_ventas',
        category_name: 'Facturación comercial consolidada',
        budget_amount: Math.max(500, Math.round((dailyCashSalesAvg * 30 * 1.15) / 10) * 10),
        notes: 'Sugerido (+15% sobre ritmo reciente)',
      },
      {
        period_month: `${monthFilter}-01`,
        branch_id: branchFilter !== 'all' ? branchFilter : null,
        kind: 'costo_compras',
        category_name: 'Reposición de inventario y compras',
        budget_amount: Math.max(250, Math.round((Math.max(actualPurchasesMonth, dailyCashSalesAvg * 18)) / 10) * 10),
        notes: 'Techo sugerido de compras',
      },
      ...Object.entries(actualExpensesByCat).slice(0, 4).map(([cat, val]) => ({
        period_month: `${monthFilter}-01`,
        branch_id: branchFilter !== 'all' ? branchFilter : null,
        kind: 'gasto_operativo' as const,
        category_name: cat,
        budget_amount: Math.max(25, Math.round((val * 1.05) / 5) * 5),
        notes: 'Basado en ejecución operativa',
      })),
    ]

    if (sqlBudgetsReady) {
      for (const s of suggested) {
        await supabase.rpc('upsert_financial_budget', {
          p_id: null,
          p_period_month: s.period_month,
          p_branch_id: s.branch_id,
          p_kind: s.kind,
          p_category_name: s.category_name,
          p_budget_amount: s.budget_amount,
          p_notes: s.notes,
        })
      }
      await load()
    } else {
      const seeded = suggested.map(s => ({
        ...s,
        id: Math.random().toString(36).slice(2),
        created_at: new Date().toISOString(),
      }))
      const merged = [...seeded, ...budgets]
      localStorage.setItem(localBudgetKey(user?.company_id, monthFilter), JSON.stringify(merged))
      setBudgets(merged)
    }

    setBusy(false)
    setFeedback({ ok: true, text: 'Presupuesto base generado a partir del comportamiento operativo.' })
  }

  function previousMonthOf(ym: string): string {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, (m || 1) - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  async function handleClonePreviousMonth(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || busy) return
    const srcYm = previousMonthOf(monthFilter)
    const pct = parseFloat(cloneVariationPct) || 0
    setBusy(true)

    if (sqlBudgetsReady) {
      const { data, error } = await supabase.rpc('clonar_presupuesto_mes', {
        p_source_month: `${srcYm}-01`,
        p_target_month: `${monthFilter}-01`,
        p_variation_pct: pct,
        p_overwrite: false,
      })
      setBusy(false)
      if (error) {
        if (/clonar_presupuesto_mes|does not exist|schema cache/i.test(error.message || '')) {
          setCloneModalOpen(false)
          setSqlModalOpen(true)
          return
        }
        setFeedback({ ok: false, text: error.message })
        return
      }
      const copied = Number((data as { copied?: number } | null)?.copied ?? 0)
      setCloneModalOpen(false)
      await load()
      setFeedback({
        ok: true,
        text:
          copied > 0
            ? `Se clonaron ${copied} partida(s) desde ${srcYm} (${pct >= 0 ? '+' : ''}${pct}%).`
            : `No había partidas nuevas por copiar desde ${srcYm}.`,
      })
      return
    }

    try {
      const rawSrc = localStorage.getItem(localBudgetKey(user?.company_id, srcYm))
      const srcRows: FinancialBudget[] = rawSrc ? JSON.parse(rawSrc) : []
      const factor = Math.max(0, 1 + pct / 100)
      const cloned: FinancialBudget[] = srcRows.map(r => ({
        ...r,
        id: Math.random().toString(36).slice(2),
        period_month: `${monthFilter}-01`,
        budget_amount: Math.round(r.budget_amount * factor * 100) / 100,
        notes: `Clonado de ${srcYm} (${pct >= 0 ? '+' : ''}${pct}%)`,
        created_at: new Date().toISOString(),
      }))
      const merged = [...cloned, ...budgets]
      localStorage.setItem(localBudgetKey(user?.company_id, monthFilter), JSON.stringify(merged))
      setBudgets(merged)
      setCloneModalOpen(false)
      setFeedback({
        ok: true,
        text: cloned.length > 0 ? `Se clonaron ${cloned.length} partida(s) locales desde ${srcYm}.` : `Sin partidas guardadas en ${srcYm}.`,
      })
    } finally {
      setBusy(false)
    }
  }

  function exportBudgetCsv() {
    if (budgetRows.length === 0) return
    downloadCsv(
      `presupuesto_maestro_${monthFilter}.csv`,
      ['Rubro', 'Tipo', 'Alcance', 'Presupuesto', 'Ejecutado Real', 'Desviación', '% Ejecución'],
      budgetRows.map(({ budget: b, actual, variance, pct }) => [
        b.category_name,
        KIND_LABELS[b.kind],
        branchName(b.branch_id),
        b.budget_amount.toFixed(2),
        actual.toFixed(2),
        variance.toFixed(2),
        `${Math.round(pct)}%`,
      ])
    )
  }

  function printBudgetPdf() {
    if (budgetRows.length === 0) return
    const rowsHtml = budgetRows
      .map(
        ({ budget: b, actual, variance, pct }) => `<tr>
          <td><strong>${esc(b.category_name)}</strong><div class="muted">${esc(KIND_LABELS[b.kind])}</div></td>
          <td>${esc(branchName(b.branch_id))}</td>
          <td class="r">${esc(money(b.budget_amount))}</td>
          <td class="r">${esc(money(actual))}</td>
          <td class="r">${variance >= 0 ? '+' : ''}${esc(money(variance))}</td>
          <td class="r">${Math.round(pct)}%</td>
        </tr>`
      )
      .join('')
    printHtml(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Presupuesto Maestro ${esc(monthFilter)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:24px;font-size:12px}
        .head{display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:16px}
        h1{margin:0;font-size:18px}
        .muted{color:#64748b;font-size:11px}
        .kpis{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
        .kpi{border:1px solid #cbd5e1;border-radius:8px;padding:10px}
        table{width:100%;border-collapse:collapse}
        th{background:#f1f5f9;text-align:left;padding:8px;font-size:11px;text-transform:uppercase}
        td{padding:8px;border-bottom:1px solid #e2e8f0}
        .r,th.r{text-align:right;font-variant-numeric:tabular-nums}
      </style></head><body>
      <div class="head">
        <div><h1>Presupuesto Maestro vs. Ejecución Real</h1><div class="muted">${esc(user?.company_name || 'Empresa')} · Periodo ${esc(monthFilter)}</div></div>
        <div class="muted" style="text-align:right">Emitido: ${esc(new Date().toLocaleDateString())}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="muted">Meta de ingresos vs. Facturado</div><strong>${esc(money(budgetSummary.revActual))} / ${esc(money(budgetSummary.revTarget))}</strong></div>
        <div class="kpi"><div class="muted">Techos de compras, gastos y nómina</div><strong>${esc(money(budgetSummary.outActual))} / ${esc(money(budgetSummary.outTarget))}</strong></div>
      </div>
      <table><thead><tr><th>Partida / Rubro</th><th>Alcance</th><th class="r">Presupuesto</th><th class="r">Ejecutado</th><th class="r">Desviación</th><th class="r">%</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      </body></html>`)
  }

  function exportCashflowCsv() {
    downloadCsv(
      `flujo_tesoreria_90d_${scenario}.csv`,
      ['Ventana', 'Saldo inicial', 'Cobros CxC est.', 'Ventas contado est.', 'Pagos CxP', 'Órdenes Compra', 'Gastos/Nómina est.', 'Flujo neto', 'Saldo final'],
      horizons.map(h => [
        `${h.label} (${h.daysLabel})`,
        h.opening.toFixed(2),
        h.cxcIn.toFixed(2),
        h.projectedCashSales.toFixed(2),
        h.cxpOut.toFixed(2),
        h.poCommitmentsOut.toFixed(2),
        h.fixedOut.toFixed(2),
        h.netChange.toFixed(2),
        h.ending.toFixed(2),
      ])
    )
  }

  if (!canAccess) {
    return <p className="text-sm text-slate-500">Acceso reservado para dirección, gerencia y contabilidad.</p>
  }

  const branchName = (id: string | null) =>
    id ? branches.find(b => b.id === id)?.name || 'Sucursal' : 'Consolidado corporativo'

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-slate-700'

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tesorería, Liquidez y Presupuesto Maestro</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Proyección de flujo de caja a 30/60/90 días cruzando CxC, CxP, órdenes de compra y control presupuestario.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
            <button
              type="button"
              onClick={() => setTab('cashflow')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                tab === 'cashflow' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Flujo proyectado 30/60/90d
            </button>
            <button
              type="button"
              onClick={() => setTab('budget')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                tab === 'budget' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Presupuesto vs. Real
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSqlModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            title="Ver o copiar el script SQL para Supabase"
          >
            <Database className="w-3.5 h-3.5 text-slate-600" /> SQL Supabase
          </button>

          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            title="Recalcular proyecciones"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`px-3.5 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-between ${
            feedback.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {loading && <p className="text-sm text-slate-400">Calculando modelo de liquidez y partidas presupuestarias…</p>}

      {/* =====================================================================
          TAB 1: FLUJO DE CAJA PROYECTADO 30 / 60 / 90 DÍAS
         ===================================================================== */}
      {tab === 'cashflow' && (
        <div className="space-y-4">
          {/* KPIs de liquidez */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-slate-400" /> Caja neta inicial hoy
              </p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${openingLiquidity >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {money(openingLiquidity)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Cobros 30d: +{money(totalScheduledIn30)} · Pagos 30d: −{money(totalScheduledOut30)}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Liquidez proyectada · 30 días</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${end30 >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {money(end30)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {end30 >= 0 ? 'Cobertura operativa positiva' : 'Alerta: déficit proyectado a 30d'}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Liquidez proyectada · 60 días</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${end60 >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {money(end60)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Ritmo contado: {money(dailyCashSalesAvg)}/día
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Liquidez proyectada · 90 días</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${end90 >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {money(end90)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Egreso operativo prom.: {money(dailyFixedBurnAvg)}/día
              </p>
            </div>
          </div>

          {/* Controles de escenario + Matriz 30/60/90 */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Matriz de tesorería proyectada por tramos</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Combina vencimientos contractuales reales (CxC, CxP y Órdenes de Compra) con la velocidad operativa diaria.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={scenario}
                  onChange={e => setScenario(e.target.value as Scenario)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-800 bg-white"
                >
                  {(Object.keys(SCENARIO_FACTORS) as Scenario[]).map(k => (
                    <option key={k} value={k}>
                      {SCENARIO_FACTORS[k].label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={exportCashflowCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> Exportar CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 text-left">
                    <th className="py-2.5 px-4 font-medium">Horizonte</th>
                    <th className="py-2.5 px-3 font-medium text-right">Saldo inicial</th>
                    <th className="py-2.5 px-3 font-medium text-right">+ Recaudo CxC</th>
                    <th className="py-2.5 px-3 font-medium text-right">+ Ventas contado</th>
                    <th className="py-2.5 px-3 font-medium text-right">− Facturas CxP</th>
                    <th className="py-2.5 px-3 font-medium text-right">− Órdenes Compra</th>
                    <th className="py-2.5 px-3 font-medium text-right">− Gastos y nómina</th>
                    <th className="py-2.5 px-4 font-medium text-right">Saldo proyectado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {horizons.map(h => (
                    <tr key={h.key} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900">{h.label}</p>
                        <p className="text-[11px] text-slate-400">{h.daysLabel}</p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">{money(h.opening)}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">+{money(h.cxcIn)}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">+{money(h.projectedCashSales)}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">−{money(h.cxpOut)}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">−{money(h.poCommitmentsOut)}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">−{money(h.fixedOut)}</td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-bold ${
                          h.ending >= 0 ? 'text-slate-900' : 'text-red-600'
                        }`}
                      >
                        {money(h.ending)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Calendario cronológico de vencimientos contractuales */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Agenda cronológica de cobros y obligaciones</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Facturas fiadas de clientes, cuentas por pagar a proveedores y órdenes de compra comprometidas.
                </p>
              </div>
              <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
            </div>

            {events.length === 0 ? (
              <p className="text-xs text-slate-400 py-4">
                No existen cobros a crédito ni obligaciones con fecha de vencimiento pendiente.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {events.slice(0, 25).map(ev => {
                  const overdue = ev.daysDiff < 0
                  return (
                    <div key={ev.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3 min-w-0">
                        {ev.direction === 'in' ? (
                          <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-amber-700 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {ev.party}{' '}
                            <span className="font-mono font-normal text-slate-400">· {ev.reference}</span>
                          </p>
                          <p className="text-[11px] text-slate-500 tabular-nums">
                            {ev.source} · Vence {ev.dueDate}{' '}
                            <span className={overdue ? 'text-red-600 font-semibold' : 'text-slate-400'}>
                              ({overdue ? `vencido hace ${Math.abs(ev.daysDiff)}d` : ev.daysDiff === 0 ? 'vence hoy' : `en ${ev.daysDiff}d`})
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            ev.direction === 'in' ? 'text-emerald-700' : 'text-slate-900'
                          }`}
                        >
                          {ev.direction === 'in' ? '+' : '−'}
                          {money(ev.amount)}
                        </span>
                        {onNavigate && (
                          <button
                            type="button"
                            onClick={() => onNavigate(ev.navPage)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                            title="Abrir módulo origen"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: PRESUPUESTO MAESTRO VS EJECUCIÓN REAL
         ===================================================================== */}
      {tab === 'budget' && (
        <div className="space-y-4">
          {!sqlBudgetsReady && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Modo local de presupuestos activo en este navegador</p>
                  <p className="text-amber-800 mt-0.5">
                    La ejecución real se calcula en vivo desde Supabase. Para sincronizar las tablas del Presupuesto Maestro e imágenes en la nube, copia y ejecuta el script SQL consolidado.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSqlModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Database className="w-3.5 h-3.5" /> Copiar SQL ahora
              </button>
            </div>
          )}

          {/* Barra de periodo, centro de costo y acciones */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Mes presupuestario</label>
                <input
                  type="month"
                  value={monthFilter}
                  onChange={e => setMonthFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-800 tabular-nums"
                />
              </div>

              {branches.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Alcance / Sede</label>
                  <select
                    value={branchFilter}
                    onChange={e => setBranchFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-800 bg-white"
                  >
                    <option value="all">Consolidado todas las sedes</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.code ? `${b.code} · ` : ''}{b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {budgetRows.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={printBudgetPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Printer className="w-3.5 h-3.5" /> PDF
                  </button>
                  <button
                    type="button"
                    onClick={exportBudgetCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                </>
              )}

              {!readOnly && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCloneModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" /> Clonar mes anterior
                  </button>
                  {budgetRows.length === 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void autoSeedBudgetsFromHistory()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Sugerir desde histórico
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openNewBudget}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Nueva partida
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Resumen de metas de ingresos vs techos de egresos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Cumplimiento meta de ingresos</span>
                <span className="font-mono tabular-nums">
                  {budgetSummary.revTarget > 0
                    ? `${Math.round((budgetSummary.revActual / budgetSummary.revTarget) * 100)}%`
                    : 'Sin meta'}
                </span>
              </div>
              <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                {money(budgetSummary.revActual)}{' '}
                <span className="text-xs font-normal text-slate-400">
                  de {money(budgetSummary.revTarget)}
                </span>
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Consumo de techos de compras, gastos y nómina</span>
                <span className="font-mono tabular-nums">
                  {budgetSummary.outTarget > 0
                    ? `${Math.round((budgetSummary.outActual / budgetSummary.outTarget) * 100)}%`
                    : 'Sin techo'}
                </span>
              </div>
              <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                {money(budgetSummary.outActual)}{' '}
                <span className="text-xs font-normal text-slate-400">
                  de {money(budgetSummary.outTarget)}
                </span>
              </p>
            </div>
          </div>

          {/* Tabla de control presupuestario */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {budgetRows.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-slate-800">Sin partidas presupuestarias para {monthFilter}</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Define metas mensuales de facturación y límites por rubro de gasto para monitorear desviaciones en tiempo real.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Partida / Rubro</th>
                      <th className="py-2.5 px-3 font-medium">Alcance</th>
                      <th className="py-2.5 px-3 font-medium text-right">Presupuesto</th>
                      <th className="py-2.5 px-3 font-medium text-right">Ejecutado real</th>
                      <th className="py-2.5 px-3 font-medium text-right">Desviación</th>
                      <th className="py-2.5 px-4 font-medium w-44">% Ejecución</th>
                      {!readOnly && <th className="py-2.5 px-4 font-medium text-right">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {budgetRows.map(({ budget: b, actual, pct, variance, isRevenue, healthy, warning }) => {
                      const barColor = healthy
                        ? 'bg-emerald-600'
                        : warning
                          ? 'bg-amber-500'
                          : 'bg-red-600'
                      return (
                        <tr key={b.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">{b.category_name}</p>
                            <p className="text-[11px] text-slate-500">
                              {KIND_LABELS[b.kind]}
                              {b.notes ? ` · ${b.notes}` : ''}
                            </p>
                          </td>
                          <td className="py-3 px-3 text-slate-600">{branchName(b.branch_id)}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                            {money(b.budget_amount)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {money(actual)}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono tabular-nums font-medium ${
                              isRevenue
                                ? variance >= 0
                                  ? 'text-emerald-700'
                                  : 'text-amber-700'
                                : variance <= 0
                                  ? 'text-emerald-700'
                                  : 'text-red-600'
                            }`}
                          >
                            {variance >= 0 ? '+' : ''}
                            {money(variance)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                                <div
                                  className={`h-full ${barColor}`}
                                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                                />
                              </div>
                              <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-700 w-11 text-right">
                                {Math.round(pct)}%
                              </span>
                            </div>
                          </td>
                          {!readOnly && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openEditBudget(b)}
                                className="p-1.5 text-slate-500 hover:text-slate-900"
                                title="Editar partida"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {deleteTargetId === b.id ? (
                                <button
                                  type="button"
                                  onClick={() => void confirmDeleteBudget(b.id)}
                                  className="px-2 py-1 rounded bg-red-600 text-white text-[11px] font-semibold ml-1"
                                >
                                  Confirmar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTargetId(b.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600"
                                  title="Eliminar partida"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Crear o editar partida presupuestaria */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                {editingBudget ? 'Editar partida presupuestaria' : 'Nueva partida presupuestaria'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={saveBudgetLine} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de partida</label>
                <select
                  value={form.kind}
                  onChange={e => {
                    const nextKind = e.target.value as FinancialBudgetKind
                    const defaultCat =
                      nextKind === 'ingreso_ventas'
                        ? 'Facturación comercial consolidada'
                        : nextKind === 'costo_compras'
                          ? 'Reposición de inventario y compras'
                          : nextKind === 'nomina'
                            ? 'Nómina fija y comisiones comerciales'
                            : expenseCategoryNames[0] || 'Servicios públicos'
                    setForm(f => ({ ...f, kind: nextKind, category_name: defaultCat }))
                  }}
                  className={inputCls}
                >
                  {(Object.keys(KIND_LABELS) as FinancialBudgetKind[]).map(k => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {form.kind === 'gasto_operativo' ? 'Categoría de gasto (debe coincidir con Gastos)' : 'Concepto'}
                </label>
                {form.kind === 'gasto_operativo' && expenseCategoryNames.length > 0 ? (
                  <select
                    value={form.category_name}
                    onChange={e => setForm(f => ({ ...f, category_name: e.target.value }))}
                    className={inputCls}
                  >
                    {expenseCategoryNames.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    value={form.category_name}
                    onChange={e => setForm(f => ({ ...f, category_name: e.target.value }))}
                    className={inputCls}
                  />
                )}
              </div>

              {branches.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sucursal / Centro de costo</label>
                  <select
                    value={form.branch_id}
                    onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Consolidado corporativo (todas las sedes)</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.code ? `${b.code} · ` : ''}{b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Monto mensual objetivo</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.budget_amount}
                  onChange={e => setForm(f => ({ ...f, budget_amount: e.target.value }))}
                  placeholder="0.00"
                  className={`${inputCls} tabular-nums`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas (opcional)</label>
                <input
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Ej. Límite aprobado por gerencia"
                  className={inputCls}
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {busy ? 'Guardando…' : 'Guardar partida'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal: Clonar presupuesto del mes anterior */}
      {cloneModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setCloneModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Clonar presupuesto mensual</h2>
              <button
                type="button"
                onClick={() => setCloneModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleClonePreviousMonth} className="p-5 space-y-3.5">
              <p className="text-xs text-slate-600 leading-relaxed">
                Copia todas las partidas de <strong>{previousMonthOf(monthFilter)}</strong> hacia{' '}
                <strong>{monthFilter}</strong> respetando sucursales y rubros que aún no existan en el mes destino.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Ajuste porcentual de crecimiento / inflación (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={cloneVariationPct}
                  onChange={e => setCloneVariationPct(e.target.value)}
                  placeholder="Ej: 5 o 0"
                  className={`${inputCls} tabular-nums`}
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCloneModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy ? 'Clonando…' : 'Clonar partidas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <SqlActivationModal
        open={sqlModalOpen}
        onClose={() => setSqlModalOpen(false)}
        initialBundle="consolidated"
      />
    </div>
  )
}
