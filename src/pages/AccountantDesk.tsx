import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  Award,
  BookOpen,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileBarChart,
  FileSpreadsheet,
  Lock,
  Percent,
  Printer,
  RefreshCw,
  Scale,
  Search,
  Settings,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting } from '../lib/auth'
import { useCurrency, fmtDate, fmtNum } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import {
  CPA_AUDIT_CHECKLIST_ITEMS,
  loadCpaWorkingPaper,
  saveCpaWorkingPaper,
} from '../lib/cpaStorage'
import type { CpaProfessionalProfile } from '../types'

interface AccAccount {
  id: string
  code: string
  name: string
  type: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto' | string
  nature: 'debito' | 'credito' | string
  is_postable: boolean
  active: boolean
}

interface AccEntry {
  id: string
  number: string
  entry_date: string
  description: string
  status: 'borrador' | 'contabilizado' | 'reversado'
  source_type: string
}

interface TrialRow {
  account_id: string
  code: string
  name: string
  opening_debit: number
  opening_credit: number
  period_debit: number
  period_credit: number
  closing_debit: number
  closing_credit: number
}

interface StatementRow {
  account_id: string | null
  code: string
  name: string
  type: string
  amount: number
}

interface ReconRow {
  code: string
  label: string
  operational: number
  accounting: number
  difference: number
  note: string
}

interface LedgerRow {
  seq: number
  entry_date: string
  number: string
  description: string
  debit: number
  credit: number
  balance: number
  is_opening: boolean
}

interface SaleTaxLite {
  id: string
  created_at: string
  customer_name: string | null
  total: number
  subtotal: number | null
  tax_rate: number | null
  tax_amount: number | null
  status: string
  payment_method: string
}

interface PurchaseLite {
  id: string
  created_at: string
  supplier_name: string | null
  total: number
  status: string
  payment_method?: string | null
}

interface ExpenseLite {
  id: string
  expense_date: string
  category_name: string
  description: string
  beneficiary: string | null
  amount: number
  status: string
}

type CpaTab = 'conciliacion' | 'hoja8' | 'indicadores' | 'tributario' | 'auditoria'

const PRINT_CPA_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .cpa-print-area, .cpa-print-area * { visibility: visible !important; }
  .cpa-print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; padding: 0 !important; }
  .no-print { display: none !important; }
}
`

const ymd = (d: Date) => d.toLocaleDateString('sv-SE')
const moneyNum = (n: number) => fmtNum(Number(n) || 0, 2, 2)

export default function AccountantDesk({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const { fmt: money, currency } = useCurrency()
  const allowed = canViewAccounting(user?.role)

  const now = new Date()
  const [dateFrom, setDateFrom] = useState(() =>
    ymd(new Date(now.getFullYear(), now.getMonth(), 1))
  )
  const [dateTo, setDateTo] = useState(() => ymd(now))
  const [activeTab, setActiveTab] = useState<CpaTab>('conciliacion')

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Datos contables y operativos
  const [companyInfo, setCompanyInfo] = useState<{
    name?: string
    rif?: string
    tax_rate?: number
  } | null>(null)
  const [accSettings, setAccSettings] = useState<{
    active: boolean
    start_date: string | null
  } | null>(null)
  const [accounts, setAccounts] = useState<AccAccount[]>([])
  const [entries, setEntries] = useState<AccEntry[]>([])
  const [trialRows, setTrialRows] = useState<TrialRow[]>([])
  const [erRows, setErRows] = useState<StatementRow[]>([])
  const [bsRows, setBsRows] = useState<StatementRow[]>([])
  const [reconRows, setReconRows] = useState<ReconRow[]>([])
  const [salesPeriod, setSalesPeriod] = useState<SaleTaxLite[]>([])
  const [purchasesPeriod, setPurchasesPeriod] = useState<PurchaseLite[]>([])
  const [expensesPeriod, setExpensesPeriod] = useState<ExpenseLite[]>([])
  const [inventoryCostTotal, setInventoryCostTotal] = useState(0)

  // Filtro de Hoja de Trabajo de 8 columnas y Auxiliar Mayor Analítico
  const [wsSearch, setWsSearch] = useState('')
  const [wsClassFilter, setWsClassFilter] = useState<'all' | 'resultados' | 'balance'>('all')
  const [drillAccount, setDrillAccount] = useState<{
    id: string
    code: string
    name: string
  } | null>(null)
  const [drillRows, setDrillRows] = useState<LedgerRow[]>([])
  const [drillLoading, setDrillLoading] = useState(false)

  // Papeles de trabajo y Credencial CPC
  const periodYm = dateTo.slice(0, 7)
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [auditNotes, setAuditNotes] = useState('')
  const [cpaProfile, setCpaProfile] = useState<CpaProfessionalProfile>({
    full_name: '',
    license_number: '',
    firm_name: '',
    title_label: 'Contador Público Colegiado',
    phone: '',
    email: '',
  })
  const [credentialModalOpen, setCredentialModalOpen] = useState(false)

  const loadAll = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    try {
      const startIso = `${dateFrom}T00:00:00.000Z`
      const endDateObj = new Date(`${dateTo}T23:59:59.999Z`)
      const endIso = Number.isFinite(endDateObj.getTime())
        ? endDateObj.toISOString()
        : new Date().toISOString()

      const [
        cfgRes,
        stRes,
        accRes,
        entRes,
        tbRes,
        erRes,
        bsRes,
        recRes,
        salesRes,
        purRes,
        expRes,
        prodRes,
      ] = await Promise.all([
        supabase.from('company_config').select('name, rif, tax_rate').limit(1).maybeSingle(),
        supabase.from('acc_settings').select('active, start_date').maybeSingle(),
        supabase.from('acc_accounts').select('*').order('code'),
        supabase
          .from('acc_entries')
          .select('*')
          .order('entry_date', { ascending: false })
          .order('number', { ascending: false })
          .limit(120),
        supabase.rpc('acc_trial_balance', { p_from: dateFrom, p_to: dateTo }),
        supabase.rpc('acc_income_statement', { p_from: dateFrom, p_to: dateTo }),
        supabase.rpc('acc_balance_sheet', { p_to: dateTo }),
        supabase.rpc('acc_reconcile'),
        supabase
          .from('sales')
          .select('id, created_at, customer_name, total, subtotal, tax_rate, tax_amount, status, payment_method')
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('purchases')
          .select('id, created_at, supplier_name, total, status, payment_method')
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('expenses')
          .select('id, expense_date, category_name, description, beneficiary, amount, status')
          .gte('expense_date', dateFrom)
          .lte('expense_date', dateTo)
          .order('expense_date', { ascending: false })
          .limit(500),
        supabase.from('products').select('stock, cost'),
      ])

      if (cfgRes.data) setCompanyInfo(cfgRes.data as { name?: string; rif?: string; tax_rate?: number })
      setAccSettings(
        (stRes.data as { active: boolean; start_date: string | null } | null) || null
      )
      setAccounts((accRes.data as AccAccount[]) || [])
      setEntries((entRes.data as AccEntry[]) || [])
      setTrialRows((tbRes.data as TrialRow[]) || [])
      setErRows((erRes.data as StatementRow[]) || [])
      setBsRows((bsRes.data as StatementRow[]) || [])
      setReconRows((recRes.data as ReconRow[]) || [])
      setSalesPeriod((salesRes.data as SaleTaxLite[]) || [])
      setPurchasesPeriod((purRes.data as PurchaseLite[]) || [])
      setExpensesPeriod((expRes.data as ExpenseLite[]) || [])

      const prods = (prodRes.data as { stock?: number; cost?: number }[] | null) || []
      const invVal = prods.reduce(
        (sum, p) => sum + Math.max(0, Number(p.stock) || 0) * Math.max(0, Number(p.cost) || 0),
        0
      )
      setInventoryCostTotal(Math.round(invVal * 100) / 100)
    } catch {
      /* conservar vista con datos disponibles */
    } finally {
      setLoading(false)
    }
  }, [allowed, dateFrom, dateTo])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // Cargar papeles de trabajo y firma del Contador Público
  useEffect(() => {
    if (!allowed || !user) return
    let active = true
    loadCpaWorkingPaper(user.company_id, periodYm, {
      full_name: user.role === 'contador' ? user.full_name : undefined,
      email: user.role === 'contador' ? user.email : undefined,
      phone: user.role === 'contador' ? user.phone : undefined,
    }).then(wp => {
      if (!active) return
      setChecklist(wp.checklist)
      setAuditNotes(wp.audit_notes)
      setCpaProfile(wp.cpa_profile)
    })
    return () => {
      active = false
    }
  }, [allowed, user?.company_id, user?.id, periodYm])

  function applyQuickRange(kind: 'mes_actual' | 'mes_anterior' | 'trimestre' | 'anio') {
    const ref = new Date()
    if (kind === 'mes_actual') {
      setDateFrom(ymd(new Date(ref.getFullYear(), ref.getMonth(), 1)))
      setDateTo(ymd(ref))
      return
    }
    if (kind === 'mes_anterior') {
      const start = new Date(ref.getFullYear(), ref.getMonth() - 1, 1)
      const end = new Date(ref.getFullYear(), ref.getMonth(), 0)
      setDateFrom(ymd(start))
      setDateTo(ymd(end))
      return
    }
    if (kind === 'trimestre') {
      const qStartMonth = Math.floor(ref.getMonth() / 3) * 3
      setDateFrom(ymd(new Date(ref.getFullYear(), qStartMonth, 1)))
      setDateTo(ymd(ref))
      return
    }
    setDateFrom(ymd(new Date(ref.getFullYear(), 0, 1)))
    setDateTo(ymd(ref))
  }

  async function openAccountDrilldown(accId: string, code: string, name: string) {
    setDrillAccount({ id: accId, code, name })
    setDrillLoading(true)
    const { data } = await supabase.rpc('acc_ledger', {
      p_account: accId,
      p_from: dateFrom,
      p_to: dateTo,
    })
    setDrillRows((data as LedgerRow[]) || [])
    setDrillLoading(false)
  }

  async function handleSeedAccounts() {
    setBusy(true)
    setFeedback(null)
    const { error } = await supabase.rpc('acc_seed_template', { p_template: 'generico' })
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setFeedback({
      ok: true,
      text: 'Catálogo base de cuentas aplicado. Puedes adaptarlo según el plan contable de la entidad.',
    })
    void loadAll()
  }

  async function handlePostPendingDocuments() {
    setBusy(true)
    setFeedback(null)
    const { data, error } = await supabase.rpc('acc_post_pending')
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    const r = (data || {}) as Record<string, number>
    const totalDocs = Object.values(r).reduce((a, b) => a + (Number(b) || 0), 0)
    setFeedback({
      ok: true,
      text:
        totalDocs > 0
          ? `Mayorización automática completada: ${totalDocs} documento(s) convertidos en asientos de partida doble.`
          : 'Revisión completada: no existen documentos pendientes por contabilizar desde la fecha de inicio.',
    })
    void loadAll()
  }

  async function handlePostDraftEntry(entryId: string) {
    setBusy(true)
    const { error } = await supabase.rpc('acc_post_entry', { p_entry_id: entryId })
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
    } else {
      setFeedback({ ok: true, text: 'Asiento en borrador mayorizado correctamente.' })
      void loadAll()
    }
  }

  async function handleSaveWorkingPapers(customProfile?: CpaProfessionalProfile) {
    if (!user) return
    setBusy(true)
    const nextProfile = customProfile || cpaProfile
    const { syncedRemote } = await saveCpaWorkingPaper(user.company_id, user.id, {
      period_ym: periodYm,
      checklist,
      audit_notes: auditNotes,
      cpa_profile: nextProfile,
      updated_at: new Date().toISOString(),
    })
    setBusy(false)
    setCredentialModalOpen(false)
    setFeedback({
      ok: true,
      text: syncedRemote
        ? `Papeles de trabajo y firma colegiada guardados para ${periodYm}.`
        : `Papeles de trabajo y firma colegiada guardados en este equipo para ${periodYm}.`,
    })
  }

  // Cálculos maestros contables y financieros
  const summary = useMemo(() => {
    const sumType = (rows: StatementRow[], t: string) =>
      rows.filter(r => r.type === t).reduce((s, r) => s + (Number(r.amount) || 0), 0)

    const ingresos = sumType(erRows, 'ingreso')
    const costos = sumType(erRows, 'costo')
    const gastos = sumType(erRows, 'gasto')
    const utilidadBruta = ingresos - costos
    const resultadoNeto = utilidadBruta - gastos

    const activos = sumType(bsRows, 'activo')
    const pasivos = sumType(bsRows, 'pasivo')
    const patrimonio = sumType(bsRows, 'patrimonio')
    const resultadoAcum = sumType(bsRows, 'resultado')
    const pasivoMasPatrimonio = pasivos + patrimonio + resultadoAcum
    const descuadrePatrimonial = Math.round((activos - pasivoMasPatrimonio) * 100) / 100
    const ecuacionCuadrada = Math.abs(descuadrePatrimonial) < 0.01

    const drafts = entries.filter(e => e.status === 'borrador')
    const postedCount = entries.filter(e => e.status === 'contabilizado').length

    // Cifras operativas reales en el rango
    const activeSales = salesPeriod.filter(s => s.status !== 'anulada')
    const opSalesTotal = activeSales.reduce((s, x) => s + (Number(x.total) || 0), 0)
    const opTaxCollected = activeSales.reduce((s, x) => s + (Number(x.tax_amount) || 0), 0)
    const opTaxableBase = activeSales
      .filter(x => (Number(x.tax_amount) || 0) > 0)
      .reduce(
        (s, x) =>
          s +
          (x.subtotal !== null && x.subtotal !== undefined
            ? Number(x.subtotal) || 0
            : (Number(x.total) || 0) - (Number(x.tax_amount) || 0)),
        0
      )
    const opExemptSales = Math.max(0, opSalesTotal - opTaxableBase - opTaxCollected)

    const activePurchases = purchasesPeriod.filter(p => p.status !== 'anulada')
    const opPurchasesTotal = activePurchases.reduce((s, p) => s + (Number(p.total) || 0), 0)

    const activeExpenses = expensesPeriod.filter(e => e.status !== 'anulado')
    const opExpensesTotal = activeExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)

    return {
      ingresos,
      costos,
      gastos,
      utilidadBruta,
      resultadoNeto,
      margenBrutoPct: ingresos > 0 ? (utilidadBruta / ingresos) * 100 : 0,
      margenNetoPct: ingresos > 0 ? (resultadoNeto / ingresos) * 100 : 0,
      activos,
      pasivos,
      patrimonio,
      resultadoAcum,
      pasivoMasPatrimonio,
      descuadrePatrimonial,
      ecuacionCuadrada,
      drafts,
      postedCount,
      activeSales,
      opSalesTotal,
      opTaxCollected,
      opTaxableBase,
      opExemptSales,
      activePurchases,
      opPurchasesTotal,
      activeExpenses,
      opExpensesTotal,
    }
  }, [erRows, bsRows, entries, salesPeriod, purchasesPeriod, expensesPeriod])

  // Construcción de la Hoja de Trabajo Clasificada de 8 Columnas
  const worksheet = useMemo(() => {
    const accTypeMap = new Map(accounts.map(a => [a.id, a.type]))

    const rows = trialRows.map(r => {
      const t = accTypeMap.get(r.account_id) || (
        r.code.startsWith('1')
          ? 'activo'
          : r.code.startsWith('2')
            ? 'pasivo'
            : r.code.startsWith('3')
              ? 'patrimonio'
              : r.code.startsWith('4')
                ? 'ingreso'
                : r.code.startsWith('5')
                  ? 'costo'
                  : 'gasto'
      )

      const salDeudor = Number(r.closing_debit) || 0
      const salAcreedor = Number(r.closing_credit) || 0
      const isResultado = t === 'ingreso' || t === 'costo' || t === 'gasto'

      const erEgreso = isResultado ? salDeudor : 0
      const erIngreso = isResultado ? salAcreedor : 0
      const bgActivo = !isResultado ? salDeudor : 0
      const bgPasPat = !isResultado ? salAcreedor : 0

      return {
        account_id: r.account_id,
        code: r.code,
        name: r.name,
        type: t,
        isResultado,
        movDebe: Number(r.period_debit) || 0,
        movHaber: Number(r.period_credit) || 0,
        salDeudor,
        salAcreedor,
        erEgreso,
        erIngreso,
        bgActivo,
        bgPasPat,
      }
    })

    const q = wsSearch.trim().toLowerCase()
    const visible = rows.filter(r => {
      if (wsClassFilter === 'resultados' && !r.isResultado) return false
      if (wsClassFilter === 'balance' && r.isResultado) return false
      if (!q) return true
      return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    })

    const sum = (fn: (x: (typeof rows)[number]) => number) =>
      Math.round(rows.reduce((a, b) => a + fn(b), 0) * 100) / 100

    const totSalDeudor = sum(x => x.salDeudor)
    const totSalAcreedor = sum(x => x.salAcreedor)
    const totErEgreso = sum(x => x.erEgreso)
    const totErIngreso = sum(x => x.erIngreso)
    const totBgActivo = sum(x => x.bgActivo)
    const totBgPasPat = sum(x => x.bgPasPat)

    // Resultado del ejercicio que cuadra Estado de Resultados contra Balance General
    const resultadoEjercicio = Math.round((totErIngreso - totErEgreso) * 100) / 100
    const erCuadreDebe = resultadoEjercicio > 0 ? resultadoEjercicio : 0
    const erCuadreHaber = resultadoEjercicio < 0 ? Math.abs(resultadoEjercicio) : 0
    const bgCuadreDebe = resultadoEjercicio < 0 ? Math.abs(resultadoEjercicio) : 0
    const bgCuadreHaber = resultadoEjercicio > 0 ? resultadoEjercicio : 0

    return {
      allRows: rows,
      visible,
      totSalDeudor,
      totSalAcreedor,
      totErEgreso,
      totErIngreso,
      totBgActivo,
      totBgPasPat,
      resultadoEjercicio,
      erCuadreDebe,
      erCuadreHaber,
      bgCuadreDebe,
      bgCuadreHaber,
      sumasIgualesErDebe: Math.round((totErEgreso + erCuadreDebe) * 100) / 100,
      sumasIgualesErHaber: Math.round((totErIngreso + erCuadreHaber) * 100) / 100,
      sumasIgualesBgDebe: Math.round((totBgActivo + bgCuadreDebe) * 100) / 100,
      sumasIgualesBgHaber: Math.round((totBgPasPat + bgCuadreHaber) * 100) / 100,
    }
  }, [accounts, trialRows, wsSearch, wsClassFilter])

  // Razones e Indicadores Financieros NIIF
  const financialRatios = useMemo(() => {
    const activoTotal = summary.activos
    const pasivoTotal = summary.pasivos
    const invContable =
      bsRows
        .filter(r => /inventario|mercanc/i.test(r.name))
        .reduce((s, r) => s + (Number(r.amount) || 0), 0) || inventoryCostTotal

    const liquidezCorriente = pasivoTotal > 0 ? activoTotal / pasivoTotal : null
    const pruebaAcida =
      pasivoTotal > 0 ? Math.max(0, activoTotal - invContable) / pasivoTotal : null
    const capitalTrabajo = activoTotal - pasivoTotal
    const endeudamientoPct = activoTotal > 0 ? (pasivoTotal / activoTotal) * 100 : 0
    const roaPct = activoTotal > 0 ? (summary.resultadoNeto / activoTotal) * 100 : 0

    return [
      {
        id: 'liquidez',
        title: 'Razón de Liquidez General',
        value: liquidezCorriente !== null ? `${fmtNum(liquidezCorriente, 2, 2)}x` : 'Sin pasivos',
        formula: 'Activo Corriente / Pasivo Corriente',
        base: `Activos ${money(activoTotal)} vs. Pasivos ${money(pasivoTotal)}`,
        status:
          liquidezCorriente === null || liquidezCorriente >= 1.5
            ? { label: 'Sólido', cls: 'text-emerald-700' }
            : liquidezCorriente >= 1
              ? { label: 'Ajustado', cls: 'text-amber-700' }
              : { label: 'Atención', cls: 'text-red-600' },
        interpretation:
          liquidezCorriente === null
            ? 'La entidad no registra obligaciones exigibles contabilizadas a la fecha de corte.'
            : `Por cada 1,00 ${currency} de deuda registrada, la empresa dispone de ${fmtNum(liquidezCorriente, 2, 2)} ${currency} en activos de respaldo.`,
      },
      {
        id: 'acida',
        title: 'Prueba Ácida (Liquidez Inmediata)',
        value: pruebaAcida !== null ? `${fmtNum(pruebaAcida, 2, 2)}x` : 'Sin pasivos',
        formula: '(Activo - Inventario) / Pasivo',
        base: `Disponible y exigible ${money(Math.max(0, activoTotal - invContable))} (excluye inv. ${money(invContable)})`,
        status:
          pruebaAcida === null || pruebaAcida >= 1
            ? { label: 'Óptimo', cls: 'text-emerald-700' }
            : pruebaAcida >= 0.7
              ? { label: 'Moderado', cls: 'text-amber-700' }
              : { label: 'Dependiente de stock', cls: 'text-red-600' },
        interpretation:
          'Mide la capacidad de cubrir pasivos de corto plazo sin depender de la realización inmediata del inventario.',
      },
      {
        id: 'capital_trabajo',
        title: 'Capital de Trabajo Neto',
        value: money(capitalTrabajo),
        formula: 'Activo Total - Pasivo Exigible',
        base: `Respaldo operativo neto en ${currency}`,
        status:
          capitalTrabajo > 0
            ? { label: 'Positivo', cls: 'text-emerald-700' }
            : { label: 'Déficit', cls: 'text-red-600' },
        interpretation:
          'Recursos netos con los que cuenta la empresa para sostener compras, rutas y operación comercial.',
      },
      {
        id: 'endeudamiento',
        title: 'Índice de Endeudamiento Total',
        value: `${fmtNum(endeudamientoPct, 1, 1)}%`,
        formula: '(Pasivo Total / Activo Total) × 100',
        base: `Patrimonio + Resultado: ${money(summary.patrimonio + summary.resultadoAcum)}`,
        status:
          endeudamientoPct <= 50
            ? { label: 'Conservador', cls: 'text-emerald-700' }
            : endeudamientoPct <= 70
              ? { label: 'Apalancado', cls: 'text-amber-700' }
              : { label: 'Alto riesgo', cls: 'text-red-600' },
        interpretation:
          'Proporción de los activos financiada por proveedores y terceros frente al patrimonio propio.',
      },
      {
        id: 'margen_bruto',
        title: 'Margen de Utilidad Bruta',
        value: `${fmtNum(summary.margenBrutoPct, 1, 1)}%`,
        formula: '(Ingresos - Costo de Ventas) / Ingresos',
        base: `Utilidad bruta ${money(summary.utilidadBruta)} sobre ventas ${money(summary.ingresos)}`,
        status:
          summary.margenBrutoPct >= 20
            ? { label: 'Rentable', cls: 'text-emerald-700' }
            : summary.ingresos === 0
              ? { label: 'Sin ingresos', cls: 'text-slate-500' }
              : { label: 'Margen estrecho', cls: 'text-amber-700' },
        interpretation:
          'Rentabilidad comercial directa después de descontar el costo promedio ponderado de la mercancía vendida.',
      },
      {
        id: 'margen_neto',
        title: 'Margen Neto y Rendimiento (ROA)',
        value: `${fmtNum(summary.margenNetoPct, 1, 1)}% · ROA ${fmtNum(roaPct, 1, 1)}%`,
        formula: 'Resultado Neto / Ingresos y / Activos',
        base: `Resultado neto del período: ${money(summary.resultadoNeto)}`,
        status:
          summary.resultadoNeto > 0
            ? { label: 'Superávit', cls: 'text-emerald-700' }
            : summary.resultadoNeto === 0
              ? { label: 'Equilibrio', cls: 'text-slate-500' }
              : { label: 'Pérdida', cls: 'text-red-600' },
        interpretation:
          'Porcentaje final de ganancia contable tras absorber costos de mercancía y gastos operativos del período.',
      },
    ]
  }, [summary, bsRows, inventoryCostTotal, money, currency])

  function exportWorksheetCsv() {
    downloadCsv(
      `hoja_trabajo_8_columnas_${dateFrom}_${dateTo}.csv`,
      [
        'Código',
        'Cuenta Contable',
        'Saldos Deudor',
        'Saldos Acreedor',
        'ER Costos y Gastos',
        'ER Ingresos',
        'BG Activo',
        'BG Pasivo y Patrimonio',
      ],
      [
        ...worksheet.allRows.map(r => [
          r.code,
          r.name,
          r.salDeudor,
          r.salAcreedor,
          r.erEgreso,
          r.erIngreso,
          r.bgActivo,
          r.bgPasPat,
        ]),
        [
          'SUBTOTAL',
          'Sumas antes de resultado',
          worksheet.totSalDeudor,
          worksheet.totSalAcreedor,
          worksheet.totErEgreso,
          worksheet.totErIngreso,
          worksheet.totBgActivo,
          worksheet.totBgPasPat,
        ],
        [
          '3901',
          worksheet.resultadoEjercicio >= 0
            ? 'Utilidad del ejercicio'
            : 'Pérdida del ejercicio',
          0,
          0,
          worksheet.erCuadreDebe,
          worksheet.erCuadreHaber,
          worksheet.bgCuadreDebe,
          worksheet.bgCuadreHaber,
        ],
        [
          'IGUALES',
          'Sumas iguales de control',
          worksheet.totSalDeudor,
          worksheet.totSalAcreedor,
          worksheet.sumasIgualesErDebe,
          worksheet.sumasIgualesErHaber,
          worksheet.sumasIgualesBgDebe,
          worksheet.sumasIgualesBgHaber,
        ],
      ]
    )
  }

  function exportTaxSalesBookCsv() {
    downloadCsv(
      `auxiliar_fiscal_ventas_${dateFrom}_${dateTo}.csv`,
      ['Fecha', 'Documento', 'Cliente', 'Método Pago', 'Base Gravada / Exenta', 'Alícuota %', 'IVA Débito', 'Total Facturado'],
      summary.activeSales.map(s => {
        const tot = Number(s.total) || 0
        const tax = Number(s.tax_amount) || 0
        const base =
          s.subtotal !== null && s.subtotal !== undefined
            ? Number(s.subtotal) || 0
            : tot - tax
        return [
          fmtDate(s.created_at),
          s.id.slice(0, 8).toUpperCase(),
          s.customer_name || 'Cliente general',
          s.payment_method,
          Math.round(base * 100) / 100,
          tax > 0 ? Number(s.tax_rate) || 0 : 0,
          Math.round(tax * 100) / 100,
          Math.round(tot * 100) / 100,
        ]
      })
    )
  }

  function exportPurchasesExpensesCsv() {
    downloadCsv(
      `auxiliar_compras_y_gastos_${dateFrom}_${dateTo}.csv`,
      ['Fecha', 'Origen', 'Proveedor / Beneficiario', 'Concepto / Categoría', 'Condición', 'Monto Total'],
      [
        ...summary.activePurchases.map(p => [
          fmtDate(p.created_at),
          'Compra Inventario',
          p.supplier_name || 'Proveedor general',
          `Recepción #${p.id.slice(0, 8).toUpperCase()}`,
          p.payment_method || 'contado',
          Math.round((Number(p.total) || 0) * 100) / 100,
        ]),
        ...summary.activeExpenses.map(e => [
          fmtDate(e.expense_date + 'T00:00:00'),
          'Gasto Operativo',
          e.beneficiary || 'Beneficiario general',
          `${e.category_name} · ${e.description}`,
          'egreso',
          Math.round((Number(e.amount) || 0) * 100) / 100,
        ]),
      ]
    )
  }

  function exportDrillLedgerCsv() {
    if (!drillAccount) return
    downloadCsv(
      `mayor_analitico_${drillAccount.code}_${dateFrom}_${dateTo}.csv`,
      ['Fecha', 'Comprobante', 'Concepto', 'Debe', 'Haber', 'Saldo'],
      drillRows.map(r => [
        r.entry_date,
        r.number,
        r.description,
        r.is_opening ? 0 : Number(r.debit) || 0,
        r.is_opening ? 0 : Number(r.credit) || 0,
        Number(r.balance) || 0,
      ])
    )
  }

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500">
        No tienes permisos asignados para acceder al Despacho Contable.
      </p>
    )
  }

  const completedChecks = CPA_AUDIT_CHECKLIST_ITEMS.filter(i => checklist[i.id]).length
  const inputCls =
    'px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-800 focus:outline-none focus:border-slate-700'

  return (
    <div className="space-y-6">
      <style>{PRINT_CPA_CSS}</style>

      {/* Encabezado Ejecutivo del Contador Público */}
      <div className="no-print bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <span className="font-semibold text-slate-800">
                Despacho del Contador Público
              </span>
              <span>·</span>
              <span>{companyInfo?.name || user?.company_name || 'Empresa Activa'}</span>
              {companyInfo?.rif && (
                <>
                  <span>·</span>
                  <span className="font-mono">{companyInfo.rif}</span>
                </>
              )}
              <span>·</span>
              <span className="font-mono">Moneda base {currency}</span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Centro de Auditoría, Hoja de Trabajo y Control Financiero
            </h1>

            <p className="text-xs sm:text-sm text-slate-500">
              {cpaProfile.full_name ? (
                <>
                  Profesional titular: <strong className="text-slate-800">{cpaProfile.full_name}</strong>
                  {cpaProfile.license_number ? ` · ${cpaProfile.license_number}` : ''}
                  {cpaProfile.firm_name ? ` · ${cpaProfile.firm_name}` : ''}
                </>
              ) : (
                'Configura tu nombre y número de colegiatura (CPC) para firmar automáticamente estados financieros y papeles de trabajo.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCredentialModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Award className="w-3.5 h-3.5 text-slate-600" />
              {cpaProfile.full_name ? 'Editar firma CPC' : 'Configurar firma CPC'}
            </button>

            <button
              type="button"
              onClick={() => void loadAll()}
              disabled={loading || busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Recalcular cifras
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir papel de trabajo
            </button>
          </div>
        </div>

        {/* Barra de rango de fechas + accesos directos a libros oficiales */}
        <div className="pt-3 border-t border-slate-100 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Período de análisis:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={`${inputCls} font-mono tabular-nums`}
            />
            <span className="text-xs text-slate-400">al</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={`${inputCls} font-mono tabular-nums`}
            />
            <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200">
              {(
                [
                  ['mes_actual', 'Este mes'],
                  ['mes_anterior', 'Mes ant.'],
                  ['trimestre', 'Trimestre'],
                  ['anio', 'Año'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => applyQuickRange(k)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white transition-colors whitespace-nowrap shrink-0"
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {onNavigate && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onNavigate('accounting')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                Diario y Mayor
              </button>
              <button
                type="button"
                onClick={() => onNavigate('accstate')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <FileBarChart className="w-3.5 h-3.5 text-slate-400" />
                Estados Financieros
              </button>
              <button
                type="button"
                onClick={() => onNavigate('taxes')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Percent className="w-3.5 h-3.5 text-slate-400" />
                Impuestos
              </button>
              <button
                type="button"
                onClick={() => onNavigate('accsetup')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Settings className="w-3.5 h-3.5 text-slate-400" />
                Reglas automáticas
              </button>
              <button
                type="button"
                onClick={() => onNavigate('accclose')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Cierre mensual
              </button>
              <button
                type="button"
                onClick={() => onNavigate('erpbridge')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-900 whitespace-nowrap shrink-0"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-700" />
                Siigo / Loggro
              </button>
            </div>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`no-print rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-1 rounded hover:bg-black/5 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Franja de 4 Indicadores Maestros de Integridad Contable */}
      <div className="no-print grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Ecuación patrimonial</span>
            <Scale
              className={`w-4 h-4 ${
                summary.ecuacionCuadrada ? 'text-emerald-600' : 'text-red-600'
              }`}
            />
          </div>
          <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {money(summary.activos)}
          </p>
          <p
            className={`text-xs mt-1 font-medium tabular-nums ${
              summary.ecuacionCuadrada ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {summary.ecuacionCuadrada
              ? 'Activo = Pasivo + Patrimonio (Dif. 0,00)'
              : `Diferencia detectada: ${money(summary.descuadrePatrimonial)}`}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Resultado contable del período</span>
            <Calculator className="w-4 h-4 text-slate-500" />
          </div>
          <p
            className={`text-xl font-bold font-mono tabular-nums mt-1.5 ${
              summary.resultadoNeto >= 0 ? 'text-slate-900' : 'text-red-600'
            }`}
          >
            {money(summary.resultadoNeto)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Margen bruto {fmtNum(summary.margenBrutoPct, 1, 1)}% · Neto {fmtNum(summary.margenNetoPct, 1, 1)}%
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Integridad del Libro Diario</span>
            <BookOpen className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {summary.postedCount} mayorizados
          </p>
          <p
            className={`text-xs mt-1 tabular-nums ${
              summary.drafts.length > 0 ? 'text-amber-700 font-medium' : 'text-emerald-700'
            }`}
          >
            {summary.drafts.length > 0
              ? `${summary.drafts.length} asiento(s) en borrador por aprobar`
              : '0 asientos en borrador · Partida doble al día'}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>IVA Débito e Inventario</span>
            <ClipboardCheck className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {money(summary.opTaxCollected)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Stock a costo: {money(inventoryCostTotal)} · Cierre {completedChecks}/8
          </p>
        </div>
      </div>

      {/* Navegación de Pestañas del Despacho Contable */}
      <div className="no-print flex items-center gap-1 p-1 bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {(
          [
            ['conciliacion', '1. Conciliación y Salud Contable'],
            ['hoja8', '2. Hoja de Trabajo (8 Columnas)'],
            ['indicadores', '3. Indicadores Financieros NIIF'],
            ['tributario', '4. Cédula Fiscal e IVA'],
            ['auditoria', '5. Checklist y Dictamen CPC'],
          ] as [CpaTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex-1 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
              activeTab === id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Área Imprimible y de Trabajo */}
      <div className="cpa-print-area space-y-5">
        {/* Encabezado exclusivo para impresión formal */}
        <div className="hidden print:block border-b-2 border-slate-900 pb-3 mb-4">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                {companyInfo?.name || user?.company_name || 'Entidad Empresarial'}
              </h1>
              <p className="text-xs text-slate-600">
                {companyInfo?.rif ? `Identificación Fiscal: ${companyInfo.rif} · ` : ''}
                Papeles de Trabajo de Contaduría Pública · Expresado en {currency}
              </p>
            </div>
            <div className="text-right text-xs font-mono tabular-nums text-slate-600">
              <p>Período: {dateFrom} al {dateTo}</p>
              <p>Emitido: {ymd(new Date())}</p>
            </div>
          </div>
        </div>

        {/* ===================================================================
            TAB 1: CONCILIACIÓN OPERATIVA VS LIBROS Y BORRADORES
        ==================================================================== */}
        {activeTab === 'conciliacion' && (
          <div className="space-y-5">
            {accounts.length === 0 && !loading && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900">
                    Inicializa el Plan de Cuentas para esta empresa
                  </h2>
                  <p className="text-xs text-slate-600 max-w-xl">
                    Esta empresa aún no tiene cuentas contables cargadas. Puedes aplicar la estructura base editable con un clic y revisarla antes de activar la mayorización automática.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSeedAccounts()}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Cargar plan de cuentas base
                </button>
              </div>
            )}

            {/* Tabla Puente Operativo vs Contable */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Puente de Conciliación: Módulos Operativos vs. Mayor General
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Estado de integración automática:{' '}
                    <strong className={accSettings?.active ? 'text-emerald-700' : 'text-amber-700'}>
                      {accSettings?.active
                        ? `Activa desde ${accSettings.start_date || 'inicio'}`
                        : 'Manual / Pendiente de activar en Reglas Automáticas'}
                    </strong>
                  </p>
                </div>

                <div className="no-print flex items-center gap-2 shrink-0">
                  {accSettings?.active ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handlePostPendingDocuments()}
                      className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      {busy ? 'Mayorizando...' : 'Contabilizar documentos pendientes'}
                    </button>
                  ) : (
                    onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('accsetup')}
                        className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                      >
                        Parametrizar cuentas puente
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs text-slate-500">
                      <th className="px-5 py-3 font-medium">Partida / Subdiario</th>
                      <th className="px-4 py-3 font-medium text-right">Auxiliar Operativo</th>
                      <th className="px-4 py-3 font-medium text-right">Saldo en Libros</th>
                      <th className="px-4 py-3 font-medium text-right">Diferencia</th>
                      <th className="px-5 py-3 font-medium">Estado y Observación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reconRows.length > 0 ? (
                      reconRows.map(r => {
                        const ok = Math.abs(Number(r.difference) || 0) < 0.01
                        return (
                          <tr key={r.code} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-5 py-3 font-medium text-slate-900">{r.label}</td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                              {moneyNum(r.operational)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                              {moneyNum(r.accounting)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                                ok ? 'text-emerald-700' : 'text-amber-700'
                              }`}
                            >
                              {moneyNum(r.difference)}
                            </td>
                            <td className="px-5 py-3 text-xs text-slate-600">
                              <span className={`font-semibold ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                                {ok ? 'Conciliado' : 'Por conciliar'}
                              </span>
                              {r.note ? ` · ${r.note}` : ''}
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <>
                        <tr className="hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-medium text-slate-900">
                            Facturación neta del período (sin IVA) vs. Ingresos Contables
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                            {moneyNum(summary.opSalesTotal - summary.opTaxCollected)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                            {moneyNum(summary.ingresos)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-700">
                            {moneyNum(summary.opSalesTotal - summary.opTaxCollected - summary.ingresos)}
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-500">
                            {summary.activeSales.length} venta(s) activas en el rango consultado
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-medium text-slate-900">
                            Gastos operativos registrados vs. Gastos en Estado de Resultados
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                            {moneyNum(summary.opExpensesTotal)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                            {moneyNum(summary.gastos)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-700">
                            {moneyNum(summary.opExpensesTotal - summary.gastos)}
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-500">
                            {summary.activeExpenses.length} comprobante(s) de gasto activo(s)
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-medium text-slate-900">
                            Existencias físicas valorizadas en Kardex (Costo promedio)
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                            {moneyNum(inventoryCostTotal)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                            {moneyNum(
                              bsRows
                                .filter(r => /inventario|mercanc/i.test(r.name))
                                .reduce((s, r) => s + (Number(r.amount) || 0), 0)
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-700">
                            {moneyNum(
                              inventoryCostTotal -
                                bsRows
                                  .filter(r => /inventario|mercanc/i.test(r.name))
                                  .reduce((s, r) => s + (Number(r.amount) || 0), 0)
                            )}
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-500">
                            Valoración en vivo del catálogo de productos
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Asientos en borrador pendientes de revisión por el Contador */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Bandeja de comprobantes en borrador pendientes de mayorización
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Revisa y aprueba los asientos preliminares antes de emitir estados financieros definitivos.
                  </p>
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('accounting')}
                    className="no-print inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap"
                  >
                    Ir al Libro Diario
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {summary.drafts.length === 0 ? (
                <div className="px-5 py-6 flex items-center gap-2 text-xs text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Excelente: todos los comprobantes registrados se encuentran mayorizados.</span>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {summary.drafts.map(d => (
                    <div
                      key={d.id}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          <span className="font-mono">{d.number}</span> · {d.description}
                        </p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          Fecha {d.entry_date} · Origen: {d.source_type}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handlePostDraftEntry(d.id)}
                        className="no-print px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        Mayorizar asiento
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 2: HOJA DE TRABAJO CLASIFICADA DE 8 COLUMNAS
        ==================================================================== */}
        {activeTab === 'hoja8' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Hoja de Trabajo Clasificada (Papel de Trabajo de 8 Columnas)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Haz clic sobre cualquier cuenta contable para inspeccionar al instante su Auxiliar de Mayor Analítico.
                </p>
              </div>

              <div className="no-print flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={wsSearch}
                    onChange={e => setWsSearch(e.target.value)}
                    placeholder="Filtrar código o cuenta..."
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-600"
                  />
                </div>

                <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200">
                  {(
                    [
                      ['all', 'Todas'],
                      ['resultados', 'Resultados'],
                      ['balance', 'Balance'],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setWsClassFilter(id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
                        wsClassFilter === id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={worksheet.allRows.length === 0}
                  onClick={exportWorksheetCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  Exportar Excel (CSV)
                </button>
              </div>
            </div>

            {worksheet.allRows.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Sin movimientos contabilizados en el período seleccionado
                </p>
                <p className="text-xs text-slate-500">
                  Amplía el rango de fechas o contabiliza operaciones para generar la Hoja de Trabajo de 8 columnas.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="px-4 py-2.5 text-left font-semibold" rowSpan={2}>
                        Código y Cuenta Contable
                      </th>
                      <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={2}>
                        Movimientos del Período
                      </th>
                      <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={2}>
                        Saldos Ajustados
                      </th>
                      <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={2}>
                        Estado de Resultados
                      </th>
                      <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={2}>
                        Balance General
                      </th>
                    </tr>
                    <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-500">
                      <th className="px-3 py-1.5 text-right font-medium border-l border-slate-200">Debe</th>
                      <th className="px-3 py-1.5 text-right font-medium">Haber</th>
                      <th className="px-3 py-1.5 text-right font-medium border-l border-slate-200">Deudor</th>
                      <th className="px-3 py-1.5 text-right font-medium">Acreedor</th>
                      <th className="px-3 py-1.5 text-right font-medium border-l border-slate-200">Costo/Gasto</th>
                      <th className="px-3 py-1.5 text-right font-medium">Ingreso</th>
                      <th className="px-3 py-1.5 text-right font-medium border-l border-slate-200">Activo</th>
                      <th className="px-3 py-1.5 text-right font-medium">Pasivo/Pat.</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {worksheet.visible.map(r => (
                      <tr
                        key={r.account_id}
                        onClick={() => void openAccountDrilldown(r.account_id, r.code, r.name)}
                        title="Haz clic para abrir el Auxiliar de Mayor Analítico de esta cuenta"
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="font-mono text-slate-500 mr-2">{r.code}</span>
                          <span className="font-medium text-slate-900 hover:underline">{r.name}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 border-l border-slate-100">
                          {r.movDebe > 0 ? moneyNum(r.movDebe) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {r.movHaber > 0 ? moneyNum(r.movHaber) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium text-slate-800 border-l border-slate-100">
                          {r.salDeudor > 0 ? moneyNum(r.salDeudor) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium text-slate-800">
                          {r.salAcreedor > 0 ? moneyNum(r.salAcreedor) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 border-l border-slate-100">
                          {r.erEgreso > 0 ? moneyNum(r.erEgreso) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {r.erIngreso > 0 ? moneyNum(r.erIngreso) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800 border-l border-slate-100">
                          {r.bgActivo > 0 ? moneyNum(r.bgActivo) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800">
                          {r.bgPasPat > 0 ? moneyNum(r.bgPasPat) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot className="bg-slate-50 border-t-2 border-slate-300 text-xs">
                    <tr className="font-semibold text-slate-700 border-b border-slate-200">
                      <td className="px-4 py-2" colSpan={3}>
                        Sumas antes del resultado del ejercicio
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-l border-slate-200">
                        {moneyNum(worksheet.totSalDeudor)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {moneyNum(worksheet.totSalAcreedor)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-l border-slate-200">
                        {moneyNum(worksheet.totErEgreso)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {moneyNum(worksheet.totErIngreso)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-l border-slate-200">
                        {moneyNum(worksheet.totBgActivo)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {moneyNum(worksheet.totBgPasPat)}
                      </td>
                    </tr>

                    <tr className="font-semibold text-emerald-800 border-b border-slate-200">
                      <td className="px-4 py-2" colSpan={3}>
                        {worksheet.resultadoEjercicio >= 0
                          ? 'Utilidad neta del ejercicio (traslado a Patrimonio)'
                          : 'Pérdida neta del ejercicio (traslado a Patrimonio)'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-l border-slate-200">—</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">—</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-l border-slate-200">
                        {worksheet.erCuadreDebe > 0 ? moneyNum(worksheet.erCuadreDebe) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {worksheet.erCuadreHaber > 0 ? moneyNum(worksheet.erCuadreHaber) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-l border-slate-200">
                        {worksheet.bgCuadreDebe > 0 ? moneyNum(worksheet.bgCuadreDebe) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {worksheet.bgCuadreHaber > 0 ? moneyNum(worksheet.bgCuadreHaber) : '—'}
                      </td>
                    </tr>

                    <tr className="font-bold text-slate-900 bg-slate-100">
                      <td className="px-4 py-2.5" colSpan={3}>
                        SUMAS IGUALES DE COMPROBACIÓN
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums border-l border-slate-200">
                        {moneyNum(worksheet.totSalDeudor)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {moneyNum(worksheet.totSalAcreedor)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums border-l border-slate-200">
                        {moneyNum(worksheet.sumasIgualesErDebe)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {moneyNum(worksheet.sumasIgualesErHaber)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums border-l border-slate-200">
                        {moneyNum(worksheet.sumasIgualesBgDebe)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {moneyNum(worksheet.sumasIgualesBgHaber)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 3: RAZONES E INDICADORES FINANCIEROS NIIF
        ==================================================================== */}
        {activeTab === 'indicadores' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-base font-bold text-slate-900">
                Análisis de Razones Financieras e Interpretación para Gerencia
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Indicadores calculados sobre las cifras contabilizadas al {dateTo}. Ideales para acompañar la entrega mensual de estados financieros al directorio o propietario.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {financialRatios.map(item => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 p-4 space-y-2 hover:bg-slate-50/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">{item.title}</span>
                      <span className={`text-xs font-semibold ${item.status.cls}`}>
                        {item.status.label}
                      </span>
                    </div>

                    <p className="text-xl font-bold text-slate-900 font-mono tabular-nums">
                      {item.value}
                    </p>

                    <div className="text-[11px] text-slate-500 font-mono">
                      Fórmula: {item.formula} · {item.base}
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed pt-1 border-t border-slate-100">
                      {item.interpretation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 4: CÉDULA FISCAL E IVA (AUXILIARES DE VENTAS Y COMPRAS)
        ==================================================================== */}
        {activeTab === 'tributario' && (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Cédula Tributaria Preliminar y Libros Auxiliares ({dateFrom} al {dateTo})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Consolidación de operaciones comerciales activas para preparación de declaración de IVA y retenciones.
                  </p>
                </div>

                <div className="no-print flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={summary.activeSales.length === 0}
                    onClick={exportTaxSalesBookCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-600" />
                    Auxiliar de Ventas (CSV)
                  </button>

                  <button
                    type="button"
                    disabled={
                      summary.activePurchases.length === 0 && summary.activeExpenses.length === 0
                    }
                    onClick={exportPurchasesExpensesCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Auxiliar Compras y Gastos (CSV)
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-4 py-3 font-medium">Concepto Tributario</th>
                      <th className="px-4 py-3 font-medium text-right">Documentos</th>
                      <th className="px-4 py-3 font-medium text-right">Base / Monto Neto</th>
                      <th className="px-4 py-3 font-medium text-right">Impuesto (IVA)</th>
                      <th className="px-4 py-3 font-medium text-right">Total Operaciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        Ventas internas gravadas (Débito Fiscal generado)
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                        {summary.activeSales.filter(s => (Number(s.tax_amount) || 0) > 0).length}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">
                        {money(summary.opTaxableBase)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-amber-800">
                        {money(summary.opTaxCollected)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {money(summary.opTaxableBase + summary.opTaxCollected)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        Ventas no gravadas / exentas o alícuota 0%
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                        {summary.activeSales.filter(s => (Number(s.tax_amount) || 0) <= 0).length}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">
                        {money(summary.opExemptSales)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-500">
                        {money(0)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {money(summary.opExemptSales)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        Compras de inventario recibidas en el período
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                        {summary.activePurchases.length}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">
                        {money(summary.opPurchasesTotal)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-400">
                        Según factura prov.
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {money(summary.opPurchasesTotal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        Gastos operativos y servicios pagados
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                        {summary.activeExpenses.length}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">
                        {money(summary.opExpensesTotal)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-400">
                        Según soporte
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {money(summary.opExpensesTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-slate-500">
                Nota técnica: Las ventas anuladas se excluyen automáticamente. Verifica los créditos fiscales soportados directamente contra las facturas físicas o electrónicas de proveedores antes de presentar la declaración definitiva.
              </p>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 5: CHECKLIST DE AUDITORÍA MENSUAL Y DICTAMEN DEL CONTADOR
        ==================================================================== */}
        {activeTab === 'auditoria' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Programa de Revisión Mensual y Dictamen Interno ({periodYm})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Control de calidad profesional previo al bloqueo definitivo del mes en Cierre de Libros.
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-800 font-mono tabular-nums">
                {completedChecks} de {CPA_AUDIT_CHECKLIST_ITEMS.length} puntos verificados
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CPA_AUDIT_CHECKLIST_ITEMS.map(item => {
                const checked = Boolean(checklist[item.id])
                return (
                  <label
                    key={item.id}
                    className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                      checked
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e =>
                        setChecklist(prev => ({ ...prev, [item.id]: e.target.checked }))
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900"
                    />
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-slate-900">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        {item.detail}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Notas de Auditoría, Salvedades o Recomendaciones del Contador Público
              </label>
              <textarea
                rows={4}
                value={auditNotes}
                onChange={e => setAuditNotes(e.target.value)}
                placeholder="Deja constancia de ajustes aplicados, reclasificaciones, conciliaciones bancarias o recomendaciones fiscales para la gerencia..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-slate-700"
              />
            </div>

            <div className="no-print flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                {completedChecks === CPA_AUDIT_CHECKLIST_ITEMS.length ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700 font-medium">
                      Revisión completa. El período está listo para cerrarse en Cierre de Libros.
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Marca cada control a medida que completes tus papeles de trabajo.</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('accclose')}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Ir a Cierre de Libros
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSaveWorkingPapers()}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {busy ? 'Guardando...' : 'Guardar papel de trabajo'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pie de Firma Colegiada para Impresión de Papeles de Trabajo */}
        <div className="hidden print:grid grid-cols-2 gap-12 pt-14 mt-10 text-xs text-slate-800">
          <div className="border-t border-slate-400 pt-2">
            <p className="font-bold">
              {cpaProfile.full_name || 'Contador Público Responsable'}
            </p>
            <p className="text-slate-600">
              {cpaProfile.title_label || 'Contador Público Colegiado'}
              {cpaProfile.license_number ? ` · ${cpaProfile.license_number}` : ''}
            </p>
            {cpaProfile.firm_name && <p className="text-slate-500">{cpaProfile.firm_name}</p>}
          </div>
          <div className="border-t border-slate-400 pt-2">
            <p className="font-bold">Representante Legal / Gerencia</p>
            <p className="text-slate-600">
              {companyInfo?.name || user?.company_name || 'Aprobación Administrativa'}
            </p>
          </div>
        </div>
      </div>

      {/* Modal: Auxiliar de Mayor Analítico al hacer clic en cualquier cuenta */}
      {drillAccount && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setDrillAccount(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-500">
                  Auxiliar de Mayor Analítico · {dateFrom} al {dateTo}
                </p>
                <h3 className="text-base font-bold text-slate-900 truncate">
                  {drillAccount.code} · {drillAccount.name}
                </h3>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {drillRows.length > 0 && (
                  <button
                    type="button"
                    onClick={exportDrillLedgerCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Excel (CSV)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDrillAccount(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {drillLoading ? (
                <p className="p-8 text-center text-xs text-slate-400">
                  Consultando movimientos del mayor...
                </p>
              ) : drillRows.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-400">
                  No se encontraron asientos mayorizados para esta cuenta en el período.
                </p>
              ) : (
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-4 py-2.5 font-medium">Fecha</th>
                      <th className="px-3 py-2.5 font-medium">Comprobante</th>
                      <th className="px-3 py-2.5 font-medium">Descripción / Glosa</th>
                      <th className="px-3 py-2.5 font-medium text-right">Debe</th>
                      <th className="px-3 py-2.5 font-medium text-right">Haber</th>
                      <th className="px-4 py-2.5 font-medium text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drillRows.map(r => (
                      <tr
                        key={r.seq}
                        className={r.is_opening ? 'bg-slate-50 font-medium' : 'hover:bg-slate-50/70'}
                      >
                        <td className="px-4 py-2 whitespace-nowrap font-mono tabular-nums text-slate-600">
                          {r.entry_date}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-800">
                          {r.number}
                        </td>
                        <td className="px-3 py-2 text-slate-700 max-w-[260px] truncate">
                          {r.description}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                          {r.is_opening || !Number(r.debit) ? '—' : moneyNum(r.debit)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                          {r.is_opening || !Number(r.credit) ? '—' : moneyNum(r.credit)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {moneyNum(r.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Credencial y Firma Profesional del Contador Público (CPC) */}
      {credentialModalOpen && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setCredentialModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Credencial Profesional del Contador Público
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Aparecerá al pie de los Estados Financieros y Papeles de Trabajo impresos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCredentialModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault()
                void handleSaveWorkingPapers(cpaProfile)
              }}
              className="p-5 space-y-3.5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Nombre y título del Contador Público
                  </label>
                  <input
                    value={cpaProfile.full_name}
                    onChange={e => setCpaProfile({ ...cpaProfile, full_name: e.target.value })}
                    placeholder="Ej. Lcdo. Carlos Alberto Gómez"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    N.º de Colegiatura / CPC / Tarjeta Prof.
                  </label>
                  <input
                    value={cpaProfile.license_number}
                    onChange={e =>
                      setCpaProfile({ ...cpaProfile, license_number: e.target.value })
                    }
                    placeholder="Ej. CPC-104.582"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Cargo o leyenda de firma
                  </label>
                  <input
                    value={cpaProfile.title_label}
                    onChange={e => setCpaProfile({ ...cpaProfile, title_label: e.target.value })}
                    placeholder="Contador Público Colegiado"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Firma o Despacho Contable (opcional)
                  </label>
                  <input
                    value={cpaProfile.firm_name}
                    onChange={e => setCpaProfile({ ...cpaProfile, firm_name: e.target.value })}
                    placeholder="Ej. Gómez & Asociados · Contadores Públicos"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCredentialModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  Guardar firma profesional
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
