import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageTeam, getRoleLabel } from '../lib/auth'
import { useCurrency, fmtDate, formatMoney } from '../lib/currency'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import type { CompanyConfig, PayrollMovement, PayrollPayment, Role, TeamPayrollMember } from '../types'
import AvatarCapture, { UserAvatar } from '../components/AvatarCapture'
import { SellerPerformanceBars, type SellerBarItem } from '../components/PerformanceCharts'
import InviteSellers from '../components/InviteSellers'
import {
  Users,
  ShoppingCart,
  Wallet,
  Target,
  Search,
  RefreshCw,
  UserPlus,
  Pencil,
  Trash2,
  X,
  Phone,
  ShieldOff,
  ShieldCheck,
  ArrowUpRight,
  Banknote,
  Plus,
  Printer,
  MessageCircle,
  Ban,
  Receipt,
} from 'lucide-react'

type PeriodKey = 'today' | '7d' | 'month' | 'prev_month' | '90d'
type RosterFilter = 'all' | 'vendedor' | 'managers' | 'inactive'
type ActiveKpi = 'sales' | 'payroll' | 'goals' | 'roster'
type ViewTab = 'roster' | 'ledger'

interface PerfRow {
  sellerId: string
  salesTotal: number
  salesCount: number
  clients: number
  salesGoal: number
  visitsGoal: number
}

interface MemberForm {
  full_name: string
  role: Role
  active: boolean
  avatar_url: string | null
  national_id: string
  phone: string
  job_title: string
  zone: string
  address: string
  emergency_contact: string
  hire_date: string
  base_salary: string
  commission_pct: string
  notes: string
}

interface LiquidationPreview {
  base_salary: number
  commission_pct: number
  sales_amount: number
  sales_count: number
  commission_amount: number
  advances_amount: number
  bonuses_amount: number
  deductions_amount: number
  overlapping_payments: number
}

const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'prev_month', label: 'Mes anterior' },
  { id: '90d', label: '90 días' },
]

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo (Caja)',
  transferencia: 'Transferencia (Bancos)',
  tarjeta: 'Tarjeta (Bancos)',
}

const todayIso = () => new Date().toLocaleDateString('sv-SE')
const monthStartIso = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE')
}

function computePeriodBounds(period: PeriodKey): { fromIso: string; toIso: string; monthDate: string; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()

  if (period === 'today') {
    const start = new Date(y, m, d)
    const end = new Date(y, m, d + 1)
    return {
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      monthDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      label: 'Hoy',
    }
  }
  if (period === '7d') {
    const start = new Date(y, m, d - 6)
    const end = new Date(y, m, d + 1)
    return {
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      monthDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      label: 'Últimos 7 días',
    }
  }
  if (period === 'prev_month') {
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 1)
    const pmY = start.getFullYear()
    const pmM = String(start.getMonth() + 1).padStart(2, '0')
    return {
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      monthDate: `${pmY}-${pmM}-01`,
      label: 'Mes anterior',
    }
  }
  if (period === '90d') {
    const start = new Date(y, m, d - 89)
    const end = new Date(y, m, d + 1)
    return {
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      monthDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      label: 'Últimos 90 días',
    }
  }
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 1)
  return {
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
    monthDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
    label: 'Mes en curso',
  }
}

function cleanPhoneForWhatsApp(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, '')
  return digits.length >= 8 ? digits : null
}

function buildPayrollReceiptDoc(p: PayrollPayment, member?: TeamPayrollMember): DocData {
  const lines: DocData['lines'] = []
  if (Number(p.base_amount) > 0) {
    lines.push({
      name: `Sueldo base del periodo (${p.period_from} a ${p.period_to})`,
      quantity: 1,
      price: Number(p.base_amount),
      subtotal: Number(p.base_amount),
    })
  }
  if (Number(p.commission_amount) > 0) {
    lines.push({
      name: `Comisión por ventas (${p.commission_pct}% sobre ${formatMoney(Number(p.sales_amount))})`,
      quantity: 1,
      price: Number(p.commission_amount),
      subtotal: Number(p.commission_amount),
    })
  }
  if (Number(p.bonuses_amount) > 0) {
    lines.push({
      name: 'Bonos e incentivos del periodo',
      quantity: 1,
      price: Number(p.bonuses_amount),
      subtotal: Number(p.bonuses_amount),
    })
  }
  if (Number(p.deductions_amount) > 0) {
    lines.push({
      name: 'Descuentos aplicados',
      quantity: 1,
      price: -Number(p.deductions_amount),
      subtotal: -Number(p.deductions_amount),
    })
  }
  if (Number(p.advances_deducted) > 0) {
    lines.push({
      name: 'Adelantos / vales entregados previamente',
      quantity: 1,
      price: -Number(p.advances_deducted),
      subtotal: -Number(p.advances_deducted),
    })
  }
  if (lines.length === 0) {
    lines.push({
      name: `Liquidación de periodo (${p.period_from} a ${p.period_to})`,
      quantity: 1,
      price: Number(p.net_paid),
      subtotal: Number(p.net_paid),
    })
  }

  return {
    title: 'RECIBO DE PAGO DE NÓMINA',
    number: 'NOM-' + p.id.slice(0, 8).toUpperCase(),
    date: p.payment_date || p.created_at.slice(0, 10),
    extra: `Periodo liquidado: ${p.period_from} al ${p.period_to}`,
    badge: p.status === 'anulado' ? 'ANULADO' : undefined,
    partyRoleLabel: 'Colaborador / Vendedor',
    unitColLabel: 'Importe',
    partyName: p.member_name,
    partyLines: [
      member?.national_id && `Identificación: ${member.national_id}`,
      member?.job_title && `Cargo: ${member.job_title}`,
      member?.zone && `Zona / Ruta: ${member.zone}`,
      p.reference && `Referencia de pago: ${p.reference}`,
      p.notes && `Notas: ${p.notes}`,
    ],
    paymentLabel: `Desembolsado vía: ${METHOD_LABEL[p.method] || p.method}`,
    lines,
    total: Number(p.net_paid),
    footer: 'Constancia de liquidación salarial y comisiones comerciales. Firma de conformidad del colaborador.',
  }
}

export default function SellersPayroll({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user: currentUser, refreshUser } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(currentUser)
  const isManager = canManageTeam(currentUser?.role)

  const [tab, setTab] = useState<ViewTab>('roster')
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all')
  const [activeKpi, setActiveKpi] = useState<ActiveKpi>('sales')
  const [search, setSearch] = useState('')
  const [showInvitePanel, setShowInvitePanel] = useState(false)

  const [members, setMembers] = useState<TeamPayrollMember[]>([])
  const [perfMap, setPerfMap] = useState<Record<string, PerfRow>>({})
  const [movements, setMovements] = useState<PayrollMovement[]>([])
  const [payments, setPayments] = useState<PayrollPayment[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [payrollSqlReady, setPayrollSqlReady] = useState(true)

  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [legacyFallback, setLegacyFallback] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Modal editar expediente
  const [editTarget, setEditTarget] = useState<TeamPayrollMember | null>(null)
  const [form, setForm] = useState<MemberForm | null>(null)
  const [saving, setSaving] = useState(false)

  // Modal retirar miembro
  const [removeTarget, setRemoveTarget] = useState<TeamPayrollMember | null>(null)
  const [removing, setRemoving] = useState(false)

  // Modal registrar vale / adelanto / bono / descuento
  const [movTarget, setMovTarget] = useState<TeamPayrollMember | null>(null)
  const [movForm, setMovForm] = useState({
    type: 'adelanto' as 'adelanto' | 'bono' | 'descuento',
    amount: '',
    method: 'efectivo' as 'efectivo' | 'transferencia' | 'tarjeta',
    date: todayIso(),
    reason: '',
  })
  const [savingMov, setSavingMov] = useState(false)

  // Modal liquidar nómina
  const [liqTarget, setLiqTarget] = useState<TeamPayrollMember | null>(null)
  const [liqFrom, setLiqFrom] = useState(() => monthStartIso())
  const [liqTo, setLiqTo] = useState(() => todayIso())
  const [liqPreview, setLiqPreview] = useState<LiquidationPreview | null>(null)
  const [liqLoading, setLiqLoading] = useState(false)
  const [baseScale, setBaseScale] = useState<'full' | 'half' | 'zero' | 'custom'>('full')
  const [liqBaseInput, setLiqBaseInput] = useState('0')
  const [liqCommInput, setLiqCommInput] = useState('0')
  const [liqMethod, setLiqMethod] = useState<'efectivo' | 'transferencia' | 'tarjeta'>('efectivo')
  const [liqRef, setLiqRef] = useState('')
  const [liqNotes, setLiqNotes] = useState('')
  const [liqSaving, setLiqSaving] = useState(false)

  // Modal ver recibo / confirmar anulaciones
  const [receiptTarget, setReceiptTarget] = useState<PayrollPayment | null>(null)
  const [voidPayTarget, setVoidPayTarget] = useState<PayrollPayment | null>(null)
  const [voidMovTarget, setVoidMovTarget] = useState<PayrollMovement | null>(null)
  const [voidBusy, setVoidBusy] = useState(false)

  const load = useCallback(async () => {
    if (!isManager) return
    setSyncing(true)
    const bounds = computePeriodBounds(period)

    try {
      const [nominaRes, perfRes, movRes, payRes, cfgRes] = await Promise.all([
        supabase.rpc('listar_nomina_equipo'),
        supabase.rpc('metas_progreso', {
          p_month: bounds.monthDate,
          p_from: bounds.fromIso,
          p_to: bounds.toIso,
        }),
        supabase.from('payroll_movements').select('*').order('movement_date', { ascending: false }).limit(200),
        supabase.from('payroll_payments').select('*').order('payment_date', { ascending: false }).limit(200),
        supabase.from('company_config').select('*').limit(1).maybeSingle(),
      ])

      if (cfgRes.data) setConfig(cfgRes.data as CompanyConfig)

      if (movRes.error && /payroll_movements|does not exist|schema cache/i.test(movRes.error.message || '')) {
        setPayrollSqlReady(false)
        setMovements([])
        setPayments([])
      } else {
        setPayrollSqlReady(true)
        setMovements((movRes.data || []) as PayrollMovement[])
        setPayments((payRes.data || []) as PayrollPayment[])
      }

      let teamList: TeamPayrollMember[] = []
      if (!nominaRes.error && Array.isArray(nominaRes.data)) {
        setLegacyFallback(false)
        teamList = (nominaRes.data as TeamPayrollMember[]).map(m => ({
          ...m,
          base_salary: Number(m.base_salary) || 0,
          commission_pct: Number(m.commission_pct) || 0,
        }))
      } else {
        const fb = await supabase.rpc('list_team')
        if (!fb.error && Array.isArray(fb.data)) {
          setLegacyFallback(true)
          teamList = (fb.data as Record<string, unknown>[]).map(raw => ({
            id: String(raw.id || ''),
            email: String(raw.email || ''),
            full_name: (raw.full_name as string | null) ?? null,
            role: ((raw.role as Role) || 'vendedor'),
            active: raw.active !== false,
            avatar_url: (raw.avatar_url as string | null) ?? null,
            national_id: (raw.national_id as string | null) ?? null,
            phone: (raw.phone as string | null) ?? null,
            job_title: (raw.job_title as string | null) ?? null,
            zone: null,
            address: (raw.address as string | null) ?? null,
            emergency_contact: null,
            hire_date: null,
            base_salary: 0,
            commission_pct: 0,
            notes: (raw.notes as string | null) ?? null,
          }))
        }
      }

      setMembers(teamList)

      const nextPerf: Record<string, PerfRow> = {}
      if (!perfRes.error && Array.isArray(perfRes.data)) {
        for (const r of perfRes.data as Record<string, unknown>[]) {
          const sid = String(r.r_seller_id || '')
          if (!sid) continue
          nextPerf[sid] = {
            sellerId: sid,
            salesTotal: Number(r.r_sales_total) || 0,
            salesCount: Number(r.r_sales_count) || 0,
            clients: Number(r.r_clients) || 0,
            salesGoal: Number(r.r_sales_goal) || 0,
            visitsGoal: Number(r.r_visits_goal) || 0,
          }
        }
      }
      setPerfMap(nextPerf)
    } finally {
      setSyncing(false)
      setLoading(false)
    }
  }, [isManager, period])

  useEffect(() => {
    void load()
  }, [load])

  const sellersOnly = useMemo(() => members.filter(m => m.role === 'vendedor'), [members])

  const pendingAdvancesByUser = useMemo(() => {
    const map: Record<string, number> = {}
    for (const mv of movements) {
      if (mv.status === 'pendiente' && mv.type === 'adelanto') {
        map[mv.user_id] = (map[mv.user_id] || 0) + Number(mv.amount || 0)
      }
    }
    return map
  }, [movements])

  const summary = useMemo(() => {
    let teamSales = 0
    let teamSalesCount = 0
    let teamClients = 0
    let totalGoal = 0
    let totalBaseSalary = 0
    let totalCommissions = 0

    for (const m of members) {
      const p = perfMap[m.id]
      const salesAmt = p?.salesTotal || 0
      const comm = salesAmt * ((Number(m.commission_pct) || 0) / 100)
      if (m.role === 'vendedor' || salesAmt > 0) {
        teamSales += salesAmt
        teamSalesCount += p?.salesCount || 0
        teamClients += p?.clients || 0
      }
      if (p?.salesGoal) totalGoal += p.salesGoal
      if (m.active) {
        totalBaseSalary += Number(m.base_salary) || 0
      }
      totalCommissions += comm
    }

    const monthPrefix = monthStartIso().slice(0, 7)
    const paidThisMonth = payments
      .filter(p => p.status === 'activo' && (p.payment_date || '').startsWith(monthPrefix))
      .reduce((acc, p) => acc + Number(p.net_paid || 0), 0)

    const pendingAdvancesTotal = movements
      .filter(m => m.status === 'pendiente' && m.type === 'adelanto')
      .reduce((acc, m) => acc + Number(m.amount || 0), 0)

    const activeSellers = sellersOnly.filter(s => s.active).length
    const suspendedMembers = members.filter(m => !m.active).length
    const goalPct = totalGoal > 0 ? Math.round((teamSales / totalGoal) * 100) : null
    const avgTicket = teamSalesCount > 0 ? teamSales / teamSalesCount : 0

    return {
      teamSales,
      teamSalesCount,
      teamClients,
      totalGoal,
      goalPct,
      avgTicket,
      totalBaseSalary,
      totalCommissions,
      totalPayroll: totalBaseSalary + totalCommissions,
      paidThisMonth,
      pendingAdvancesTotal,
      activeSellers,
      totalSellers: sellersOnly.length,
      suspendedMembers,
    }
  }, [members, sellersOnly, perfMap, payments, movements])

  const chartItems = useMemo<SellerBarItem[]>(() => {
    const candidates = sellersOnly.length > 0 ? sellersOnly : members
    return candidates
      .map(m => {
        const p = perfMap[m.id]
        const sales = p?.salesTotal || 0
        const commission = sales * ((Number(m.commission_pct) || 0) / 100)
        return {
          id: m.id,
          name: m.full_name || m.email,
          email: m.email,
          avatar_url: m.avatar_url,
          zone: m.zone || m.job_title || null,
          sales,
          goal: p?.salesGoal || 0,
          commission,
          clients: p?.clients || 0,
          salesCount: p?.salesCount || 0,
          active: m.active,
        }
      })
      .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name))
  }, [sellersOnly, members, perfMap])

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter(m => {
      if (rosterFilter === 'vendedor' && m.role !== 'vendedor') return false
      if (rosterFilter === 'managers' && m.role === 'vendedor') return false
      if (rosterFilter === 'inactive' && m.active) return false
      if (!q) return true
      return (
        (m.full_name || '').toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.national_id || '').toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q) ||
        (m.job_title || '').toLowerCase().includes(q) ||
        (m.zone || '').toLowerCase().includes(q)
      )
    })
  }, [members, rosterFilter, search])

  function openEditModal(m: TeamPayrollMember) {
    setFeedback(null)
    setEditTarget(m)
    setForm({
      full_name: m.full_name || '',
      role: m.role,
      active: m.active,
      avatar_url: m.avatar_url || null,
      national_id: m.national_id || '',
      phone: m.phone || '',
      job_title: m.job_title || (m.role === 'vendedor' ? 'Vendedor de ruta' : 'Dirección'),
      zone: m.zone || '',
      address: m.address || '',
      emergency_contact: m.emergency_contact || '',
      hire_date: m.hire_date ? String(m.hire_date).slice(0, 10) : '',
      base_salary: String(Number(m.base_salary) || 0),
      commission_pct: String(Number(m.commission_pct) || 0),
      notes: m.notes || '',
    })
  }

  async function handleSaveMember(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget || !form) return
    setSaving(true)
    setFeedback(null)

    const salaryNum = Math.max(0, Number(form.base_salary) || 0)
    const commNum = Math.min(100, Math.max(0, Number(form.commission_pct) || 0))

    const { error } = await supabase.rpc('guardar_ficha_miembro', {
      p_user_id: editTarget.id,
      p_full_name: form.full_name.trim() || null,
      p_role: form.role,
      p_active: form.active,
      p_avatar_url: form.avatar_url || null,
      p_national_id: form.national_id.trim() || null,
      p_phone: form.phone.trim() || null,
      p_job_title: form.job_title.trim() || null,
      p_zone: form.zone.trim() || null,
      p_address: form.address.trim() || null,
      p_emergency_contact: form.emergency_contact.trim() || null,
      p_hire_date: form.hire_date || null,
      p_base_salary: salaryNum,
      p_commission_pct: commNum,
      p_notes: form.notes.trim() || null,
    })

    if (error) {
      if (/guardar_ficha_miembro|schema cache|does not exist/i.test(error.message || '')) {
        const fb = await supabase.rpc('save_staff_details', {
          p_user_id: editTarget.id,
          p_phone: form.phone.trim() || null,
          p_job_title: form.job_title.trim() || null,
          p_national_id: form.national_id.trim() || null,
          p_address: form.address.trim() || null,
          p_notes: form.notes.trim() || null,
        })
        setSaving(false)
        if (fb.error) {
          setFeedback({ ok: false, text: fb.error.message })
          return
        }
        setEditTarget(null)
        setForm(null)
        setFeedback({
          ok: true,
          text: 'Datos básicos guardados. Ejecuta en Supabase el script SQL de Nómina para habilitar fotos, sueldos y comisiones.',
        })
        await load()
        return
      }
      setSaving(false)
      setFeedback({ ok: false, text: error.message })
      return
    }

    setSaving(false)
    setEditTarget(null)
    setForm(null)
    setFeedback({ ok: true, text: 'Expediente, foto y condiciones de nómina actualizados.' })
    if (editTarget.id === currentUser?.id) {
      await refreshUser()
    }
    await load()
  }

  async function handleQuickToggleActive(m: TeamPayrollMember) {
    if (m.id === currentUser?.id) return
    setFeedback(null)
    const { error } = await supabase.rpc('guardar_ficha_miembro', {
      p_user_id: m.id,
      p_full_name: m.full_name,
      p_role: m.role,
      p_active: !m.active,
      p_avatar_url: m.avatar_url || null,
      p_national_id: m.national_id || null,
      p_phone: m.phone || null,
      p_job_title: m.job_title || null,
      p_zone: m.zone || null,
      p_address: m.address || null,
      p_emergency_contact: m.emergency_contact || null,
      p_hire_date: m.hire_date || null,
      p_base_salary: Number(m.base_salary) || 0,
      p_commission_pct: Number(m.commission_pct) || 0,
      p_notes: m.notes || null,
    })
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setFeedback({
      ok: true,
      text: !m.active
        ? `Acceso reactivado para ${m.full_name || m.email}.`
        : `Acceso suspendido para ${m.full_name || m.email}.`,
    })
    await load()
  }

  async function handleConfirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    setFeedback(null)
    const { data, error } = await supabase.rpc('retirar_miembro_empresa', { p_user_id: removeTarget.id })
    setRemoving(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      setRemoveTarget(null)
      return
    }
    setRemoveTarget(null)
    setFeedback({
      ok: true,
      text: (data as any)?.message || 'Perfil retirado correctamente de la empresa.',
    })
    await load()
  }

  function openMovementModal(m: TeamPayrollMember) {
    setFeedback(null)
    setMovTarget(m)
    setMovForm({
      type: 'adelanto',
      amount: '',
      method: 'efectivo',
      date: todayIso(),
      reason: '',
    })
  }

  async function handleSaveMovement(e: React.FormEvent) {
    e.preventDefault()
    if (!movTarget || savingMov || readOnly) return
    const amt = Number(movForm.amount) || 0
    if (amt <= 0) {
      setFeedback({ ok: false, text: 'Ingresa un monto mayor a cero.' })
      return
    }
    setSavingMov(true)
    const { error } = await supabase.rpc('registrar_movimiento_nomina', {
      p_user_id: movTarget.id,
      p_type: movForm.type,
      p_amount: amt,
      p_method: movForm.type === 'adelanto' ? movForm.method : 'sin_desembolso',
      p_reason: movForm.reason.trim(),
      p_date: movForm.date,
    })
    setSavingMov(false)
    if (error) {
      setFeedback({
        ok: false,
        text: /registrar_movimiento_nomina|does not exist/i.test(error.message)
          ? 'Ejecuta primero en Supabase el SQL 20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql.'
          : error.message,
      })
      return
    }
    setMovTarget(null)
    setFeedback({
      ok: true,
      text:
        movForm.type === 'adelanto'
          ? 'Adelanto registrado y contabilizado en Gastos / Caja. Se descontará al liquidar la nómina.'
          : movForm.type === 'bono'
            ? 'Bono registrado para la próxima liquidación de nómina.'
            : 'Descuento registrado para la próxima liquidación de nómina.',
    })
    await load()
  }

  const fetchLiquidationPreview = useCallback(
    async (member: TeamPayrollMember, fromStr: string, toStr: string, scale: 'full' | 'half' | 'zero' | 'custom') => {
      setLiqLoading(true)
      const { data, error } = await supabase.rpc('previsualizar_liquidacion_nomina', {
        p_user_id: member.id,
        p_from: fromStr,
        p_to: toStr,
      })
      setLiqLoading(false)

      if (!error && data) {
        const prev = data as LiquidationPreview
        setLiqPreview(prev)
        const baseVal =
          scale === 'half'
            ? Math.round(prev.base_salary * 50) / 100
            : scale === 'zero'
              ? 0
              : prev.base_salary
        if (scale !== 'custom') setLiqBaseInput(String(baseVal))
        setLiqCommInput(String(prev.commission_amount))
      } else {
        const p = perfMap[member.id]
        const fallbackSales = p?.salesTotal || 0
        const fallbackComm = Math.round(fallbackSales * (Number(member.commission_pct) || 0)) / 100
        const fallbackBase = Number(member.base_salary) || 0
        setLiqPreview({
          base_salary: fallbackBase,
          commission_pct: Number(member.commission_pct) || 0,
          sales_amount: fallbackSales,
          sales_count: p?.salesCount || 0,
          commission_amount: fallbackComm,
          advances_amount: pendingAdvancesByUser[member.id] || 0,
          bonuses_amount: 0,
          deductions_amount: 0,
          overlapping_payments: 0,
        })
        if (scale !== 'custom') {
          setLiqBaseInput(
            String(scale === 'half' ? Math.round(fallbackBase * 50) / 100 : scale === 'zero' ? 0 : fallbackBase)
          )
        }
        setLiqCommInput(String(fallbackComm))
      }
    },
    [perfMap, pendingAdvancesByUser]
  )

  function openLiquidation(m: TeamPayrollMember) {
    const f = monthStartIso()
    const t = todayIso()
    setFeedback(null)
    setLiqTarget(m)
    setLiqFrom(f)
    setLiqTo(t)
    setBaseScale('full')
    setLiqMethod('efectivo')
    setLiqRef('')
    setLiqNotes('')
    void fetchLiquidationPreview(m, f, t, 'full')
  }

  async function handleConfirmLiquidation(e: React.FormEvent) {
    e.preventDefault()
    if (!liqTarget || !liqPreview || liqSaving || readOnly) return
    setLiqSaving(true)

    const baseAmt = Math.max(0, Number(liqBaseInput) || 0)
    const commAmt = Math.max(0, Number(liqCommInput) || 0)

    const { data: payId, error } = await supabase.rpc('liquidar_pago_nomina', {
      p_user_id: liqTarget.id,
      p_from: liqFrom,
      p_to: liqTo,
      p_base_amount: baseAmt,
      p_sales_amount: liqPreview.sales_amount,
      p_commission_pct: liqPreview.commission_pct,
      p_commission_amount: commAmt,
      p_method: liqMethod,
      p_reference: liqRef.trim() || null,
      p_notes: liqNotes.trim() || null,
      p_payment_date: todayIso(),
    })

    setLiqSaving(false)
    if (error) {
      setFeedback({
        ok: false,
        text: /liquidar_pago_nomina|does not exist/i.test(error.message)
          ? 'Ejecuta primero en Supabase el SQL 20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql.'
          : error.message,
      })
      return
    }

    const netVal = Math.max(
      0,
      Math.round(
        (baseAmt +
          commAmt +
          liqPreview.bonuses_amount -
          liqPreview.deductions_amount -
          liqPreview.advances_amount) *
          100
      ) / 100
    )

    const createdReceipt: PayrollPayment = {
      id: String(payId),
      user_id: liqTarget.id,
      member_name: liqTarget.full_name || liqTarget.email,
      period_from: liqFrom,
      period_to: liqTo,
      payment_date: todayIso(),
      base_amount: baseAmt,
      sales_amount: liqPreview.sales_amount,
      commission_pct: liqPreview.commission_pct,
      commission_amount: commAmt,
      bonuses_amount: liqPreview.bonuses_amount,
      deductions_amount: liqPreview.deductions_amount,
      advances_deducted: liqPreview.advances_amount,
      net_paid: netVal,
      method: liqMethod,
      reference: liqRef.trim() || null,
      notes: liqNotes.trim() || null,
      status: 'activo',
      created_at: new Date().toISOString(),
    }

    setLiqTarget(null)
    setReceiptTarget(createdReceipt)
    setFeedback({
      ok: true,
      text: 'Nómina liquidada y contabilizada automáticamente en Gastos y Caja.',
    })
    await load()
  }

  async function handleVoidPayment() {
    if (!voidPayTarget || voidBusy) return
    setVoidBusy(true)
    const { error } = await supabase.rpc('anular_pago_nomina', { p_payment_id: voidPayTarget.id })
    setVoidBusy(false)
    setVoidPayTarget(null)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setFeedback({ ok: true, text: 'Liquidación anulada; se revirtió el gasto/caja y se restauraron los vales pendientes.' })
    await load()
  }

  async function handleVoidMovement() {
    if (!voidMovTarget || voidBusy) return
    setVoidBusy(true)
    const { error } = await supabase.rpc('anular_movimiento_nomina', { p_movement_id: voidMovTarget.id })
    setVoidBusy(false)
    setVoidMovTarget(null)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setFeedback({ ok: true, text: 'Registro anulado correctamente.' })
    await load()
  }

  if (!isManager) {
    return <p className="text-sm text-slate-500">Solo el dueño o administrador puede consultar la nómina de vendedores.</p>
  }

  const periodInfo = computePeriodBounds(period)
  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-slate-600'

  const netLiquidationAmount = liqPreview
    ? Math.max(
        0,
        Math.round(
          ((Number(liqBaseInput) || 0) +
            (Number(liqCommInput) || 0) +
            liqPreview.bonuses_amount -
            liqPreview.deductions_amount -
            liqPreview.advances_amount) *
            100
        ) / 100
      )
    : 0

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Nómina y liquidación de vendedores</h1>
          <p className="text-xs text-slate-500 mt-1">
            Expediente fotográfico, comisiones por ventas, vales/bonos y liquidación real conectada a Gastos y Caja.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('roster')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === 'roster' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Plantilla y comisiones
            </button>
            <button
              type="button"
              onClick={() => setTab('ledger')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === 'ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pagos, vales y recibos ({payments.filter(p => p.status === 'activo').length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>

          <button
            type="button"
            onClick={() => setShowInvitePanel(v => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {showInvitePanel ? 'Ocultar invitaciones' : 'Invitar o vincular vendedor'}
          </button>
        </div>
      </div>

      {!payrollSqlReady && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          Para activar <strong>Liquidación real de nómina, vales/bonos y recibos de pago</strong>, ejecuta en el Editor SQL de Supabase la migración{' '}
          <code className="font-mono">20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql</code>.
        </div>
      )}

      {legacyFallback && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          Estás viendo la lista básica de equipo. Ejecuta también{' '}
          <code className="font-mono">20261101_vendedores_nomina_invitaciones_usuarios.sql</code> si aún no lo has aplicado.
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="p-1 rounded hover:bg-black/5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {(showInvitePanel || sellersOnly.length === 0) && (
        <InviteSellers defaultOpen={true} onTeamChanged={load} />
      )}

      {/* 4 KPIs interactivos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => {
            setTab('roster')
            setActiveKpi('sales')
            setRosterFilter('vendedor')
            void load()
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            activeKpi === 'sales' && tab === 'roster'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShoppingCart className="w-4 h-4 text-emerald-600" />
              Ventas del equipo
            </span>
            <span className="text-[11px] text-slate-400">{periodInfo.label}</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{money(summary.teamSales)}</p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {summary.teamSalesCount} {summary.teamSalesCount === 1 ? 'operación' : 'operaciones'} · Ticket prom.{' '}
            {money(summary.avgTicket)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveKpi('payroll')
            setTab('ledger')
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            tab === 'ledger' || activeKpi === 'payroll'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Wallet className="w-4 h-4 text-slate-700" />
              Nómina y pagos reales
            </span>
            <span className="text-[11px] text-slate-400">Ver recibos</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{money(summary.totalPayroll)}</p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            Pagado mes {money(summary.paidThisMonth)} · Vales {money(summary.pendingAdvancesTotal)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveKpi('goals')
            setTab('roster')
            void load()
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            activeKpi === 'goals' && tab === 'roster'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Target className="w-4 h-4 text-blue-600" />
              Cumplimiento de metas
            </span>
            {onNavigate && (
              <span
                onClick={e => {
                  e.stopPropagation()
                  onNavigate('goals')
                }}
                className="text-[11px] text-slate-700 underline underline-offset-2"
              >
                Configurar metas
              </span>
            )}
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {summary.goalPct !== null ? `${summary.goalPct}%` : 'Sin meta'}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            Meta global {money(summary.totalGoal)} · {summary.teamClients}{' '}
            {summary.teamClients === 1 ? 'cliente atendido' : 'clientes atendidos'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('roster')
            setActiveKpi('roster')
            setRosterFilter(prev => (prev === 'inactive' ? 'all' : summary.suspendedMembers > 0 ? 'inactive' : 'all'))
          }}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            activeKpi === 'roster' && tab === 'roster'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Users className="w-4 h-4 text-slate-700" />
              Plantilla comercial
            </span>
            <span className="text-[11px] text-slate-400">{members.length} en total</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {summary.activeSellers} {summary.activeSellers === 1 ? 'vendedor activo' : 'vendedores activos'}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {summary.suspendedMembers > 0
              ? `${summary.suspendedMembers} con acceso suspendido`
              : 'Todos los perfiles autorizados'}
          </p>
        </button>
      </div>

      {tab === 'roster' ? (
        <>
          {/* Barra de periodo para cálculo de ventas y comisiones */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPeriod(opt.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    period === opt.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {onNavigate && (
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => onNavigate('dispatch')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap"
                >
                  Despacho y carga de ruta
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('routeplan')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap"
                >
                  Planificar paradas
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Gráfico interactivo */}
          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">Rendimiento comparativo por vendedor</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Haz clic sobre un vendedor para inspeccionar o editar su expediente y condiciones de comisión.
              </p>
            </div>

            <SellerPerformanceBars
              items={chartItems}
              formatMoney={money}
              selectedId={selectedSellerId}
              onSelect={id => {
                setSelectedSellerId(id)
                const found = members.find(m => m.id === id)
                if (found) openEditModal(found)
              }}
            />
          </section>

          {/* Directorio y acciones de liquidación */}
          <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Directorio, comisiones y pago de nómina</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Registra vales o bonos y liquida el periodo generando el comprobante y el gasto automático.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar nombre, cédula, zona..."
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      ['all', `Todos (${members.length})`],
                      ['vendedor', `Vendedores (${sellersOnly.length})`],
                      ['managers', `Dirección (${members.length - sellersOnly.length})`],
                      ['inactive', `Suspendidos (${summary.suspendedMembers})`],
                    ] as [RosterFilter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRosterFilter(key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        rosterFilter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-slate-400">Cargando nómina de equipo...</div>
            ) : filteredMembers.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800">No hay perfiles para el filtro seleccionado</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Usa el botón «Invitar o vincular vendedor» arriba para integrar a tu equipo de ventas.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="py-3 px-5 font-medium">Perfil e identidad</th>
                      <th className="py-3 px-4 font-medium">Contacto y zona</th>
                      <th className="py-3 px-4 font-medium text-right">
                        Ventas ({PERIOD_OPTIONS.find(p => p.id === period)?.label})
                      </th>
                      <th className="py-3 px-4 font-medium text-right">Sueldo, comisión y vales</th>
                      <th className="py-3 px-5 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMembers.map(m => {
                      const p = perfMap[m.id]
                      const salesAmt = p?.salesTotal || 0
                      const salesCnt = p?.salesCount || 0
                      const commPct = Number(m.commission_pct) || 0
                      const commAmt = salesAmt * (commPct / 100)
                      const baseSal = Number(m.base_salary) || 0
                      const advAmt = pendingAdvancesByUser[m.id] || 0
                      const waDigits = cleanPhoneForWhatsApp(m.phone)
                      const roleText = getRoleLabel(m.role)

                      return (
                        <tr key={m.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-5">
                            <div className="flex items-center gap-3">
                              <UserAvatar src={m.avatar_url} name={m.full_name} email={m.email} size="md" />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900 truncate max-w-[220px]">
                                  {m.full_name || 'Sin nombre registrado'}
                                </p>
                                <p className="text-xs text-slate-500 truncate max-w-[220px]">{m.email}</p>
                                <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500 mt-0.5">
                                  <span>{roleText}</span>
                                  {m.national_id && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono text-slate-600">ID: {m.national_id}</span>
                                    </>
                                  )}
                                  <span aria-hidden="true">·</span>
                                  <span className={m.active ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                                    {m.active ? 'Autorizado' : 'Suspendido'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-xs text-slate-600">
                            <p className="font-medium text-slate-800">
                              {[m.job_title, m.zone].filter(Boolean).join(' · ') || 'Sin cargo / zona asignada'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5 text-slate-500">
                              {m.phone ? (
                                waDigits ? (
                                  <a
                                    href={`https://wa.me/${waDigits}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 underline underline-offset-2 tabular-nums"
                                  >
                                    <Phone className="w-3 h-3" />
                                    {m.phone}
                                  </a>
                                ) : (
                                  <span className="tabular-nums">{m.phone}</span>
                                )
                              ) : (
                                <span className="text-slate-400">Sin teléfono</span>
                              )}
                              {m.hire_date && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>Ingreso {fmtDate(m.hire_date)}</span>
                                </>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                            <p className="font-semibold text-slate-900">{money(salesAmt)}</p>
                            <p className="text-[11px] text-slate-500">
                              {salesCnt} {salesCnt === 1 ? 'venta' : 'ventas'}
                            </p>
                          </td>

                          <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap text-xs">
                            <p className="text-slate-800">
                              Base {money(baseSal)} · Com. ({commPct}%) {money(commAmt)}
                            </p>
                            {advAmt > 0 ? (
                              <p className="text-amber-700 font-medium">Vales pendientes: -{money(advAmt)}</p>
                            ) : (
                              <p className="text-slate-500">Est. bruto: {money((m.active ? baseSal : 0) + commAmt)}</p>
                            )}
                          </td>

                          <td className="py-3.5 px-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1">
                              {!readOnly && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openLiquidation(m)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
                                  >
                                    <Banknote className="w-3.5 h-3.5" />
                                    Liquidar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openMovementModal(m)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    Vale / Bono
                                  </button>
                                </>
                              )}

                              <button
                                type="button"
                                onClick={() => openEditModal(m)}
                                title="Editar foto, datos personales y comisión"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Ficha
                              </button>

                              {m.id !== currentUser?.id && !readOnly && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleQuickToggleActive(m)}
                                    title={m.active ? 'Suspender acceso' : 'Reactivar acceso'}
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                  >
                                    {m.active ? (
                                      <ShieldOff className="w-3.5 h-3.5 text-amber-600" />
                                    ) : (
                                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRemoveTarget(m)}
                                    title="Retirar o eliminar perfil no autorizado"
                                    className="p-1.5 rounded-lg border border-slate-200 text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        /* Pestaña 2: Historial de Liquidaciones, Vales y Recibos */
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Columna izquierda: Liquidaciones emitidas */}
          <section className="xl:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Liquidaciones y recibos emitidos</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cada liquidación activa generó su comprobante en Gastos («Nómina y comisiones») y salida de Caja o Bancos.
                </p>
              </div>
            </div>

            {payments.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-sm font-medium text-slate-800">Aún no hay liquidaciones registradas</p>
                <p className="text-xs text-slate-500">
                  En la pestaña «Plantilla y comisiones» pulsa <strong>Liquidar</strong> sobre cualquier vendedor para emitir su primer pago.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-3 px-5 font-medium">Colaborador / Recibo</th>
                      <th className="py-3 px-4 font-medium">Periodo</th>
                      <th className="py-3 px-4 font-medium text-right">Base + Com.</th>
                      <th className="py-3 px-4 font-medium text-right">Neto pagado</th>
                      <th className="py-3 px-5 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map(pp => {
                      const code = 'NOM-' + pp.id.slice(0, 8).toUpperCase()
                      const isVoid = pp.status === 'anulado'
                      const memberObj = members.find(m => m.id === pp.user_id)
                      return (
                        <tr key={pp.id} className={isVoid ? 'opacity-50 bg-slate-50/50' : 'hover:bg-slate-50/60'}>
                          <td className="py-3 px-5">
                            <p className={`font-semibold text-slate-900 ${isVoid ? 'line-through' : ''}`}>
                              {pp.member_name}
                            </p>
                            <p className="text-xs text-slate-500">
                              <span className="font-mono">{code}</span> · {pp.payment_date} ·{' '}
                              {METHOD_LABEL[pp.method] || pp.method}
                              {isVoid ? ' · ANULADO' : ''}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            {pp.period_from} al {pp.period_to}
                          </td>
                          <td className="py-3 px-4 text-right text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            <div>Base {money(pp.base_amount)}</div>
                            <div>Com. {money(pp.commission_amount)}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                            {money(pp.net_paid)}
                          </td>
                          <td className="py-3 px-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setReceiptTarget(pp)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Recibo
                              </button>
                              <button
                                type="button"
                                onClick={() => printHtml(buildDocHtml(buildPayrollReceiptDoc(pp, memberObj), config))}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                title="Imprimir recibo"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                              {!isVoid && !readOnly && (
                                <button
                                  type="button"
                                  onClick={() => setVoidPayTarget(pp)}
                                  className="p-1.5 rounded-lg border border-slate-200 text-red-600 hover:bg-red-50"
                                  title="Anular liquidación"
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Columna derecha: Adelantos / vales, bonos y descuentos */}
          <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Vales, bonos y descuentos</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Novedades registradas antes del cierre de quincena o mes.
              </p>
            </div>

            {movements.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No hay adelantos ni bonos registrados.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
                {movements.map(mv => (
                  <div
                    key={mv.id}
                    className={`p-4 flex items-start justify-between gap-3 ${
                      mv.status === 'anulado' ? 'opacity-45' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900">{mv.member_name}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{mv.reason}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {mv.type === 'adelanto' ? 'Adelanto' : mv.type === 'bono' ? 'Bono' : 'Descuento'} ·{' '}
                        {mv.movement_date} ·{' '}
                        {mv.status === 'pendiente'
                          ? 'Pendiente de liquidar'
                          : mv.status === 'aplicado'
                            ? 'Aplicado en nómina'
                            : 'Anulado'}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p
                        className={`text-xs font-bold tabular-nums ${
                          mv.type === 'bono' ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {mv.type === 'bono' ? '+' : '-'}
                        {money(mv.amount)}
                      </p>
                      {mv.status === 'pendiente' && !readOnly && (
                        <button
                          type="button"
                          onClick={() => setVoidMovTarget(mv)}
                          className="text-[11px] text-red-600 hover:underline"
                        >
                          Anular
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Modal: Registrar Adelanto / Bono / Descuento */}
      {movTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !savingMov && setMovTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Registrar vale, bono o descuento</h2>
                <p className="text-xs text-slate-500">{movTarget.full_name || movTarget.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setMovTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMovement} className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    ['adelanto', 'Adelanto / Vale'],
                    ['bono', 'Bono (+)'],
                    ['descuento', 'Descuento (-)'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMovForm(f => ({ ...f, type: k }))}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                      movForm.type === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Monto</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={movForm.amount}
                    onChange={e => setMovForm(f => ({ ...f, amount: e.target.value }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                  <input
                    type="date"
                    required
                    value={movForm.date}
                    onChange={e => setMovForm(f => ({ ...f, date: e.target.value }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </div>
              </div>

              {movForm.type === 'adelanto' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">¿De dónde sale el dinero hoy?</label>
                  <select
                    value={movForm.method}
                    onChange={e => setMovForm(f => ({ ...f, method: e.target.value as any }))}
                    className={inputCls}
                  >
                    <option value="efectivo">Efectivo (descuenta de Caja hoy)</option>
                    <option value="transferencia">Transferencia (Bancos)</option>
                    <option value="tarjeta">Tarjeta (Bancos)</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Registra hoy la salida real de dinero y se descontará automáticamente del neto en la liquidación de nómina.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Concepto / Motivo</label>
                <input
                  required
                  value={movForm.reason}
                  onChange={e => setMovForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder={
                    movForm.type === 'adelanto'
                      ? 'Ej. Anticipo quincenal en efectivo'
                      : movForm.type === 'bono'
                        ? 'Ej. Bono por sobrecumplimiento de ruta'
                        : 'Ej. Faltante en liquidación de ruta'
                  }
                  className={inputCls}
                />
              </div>

              <div className="pt-2 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMovTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingMov}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingMov ? 'Guardando...' : 'Guardar registro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Liquidar y Pagar Nómina */}
      {liqTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !liqSaving && setLiqTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <UserAvatar src={liqTarget.avatar_url} name={liqTarget.full_name} email={liqTarget.email} size="sm" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">Liquidar y pagar nómina</h2>
                  <p className="text-xs text-slate-500">{liqTarget.full_name || liqTarget.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLiqTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmLiquidation} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              {/* Rango del periodo */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Desde</label>
                  <input
                    type="date"
                    required
                    value={liqFrom}
                    onChange={e => {
                      setLiqFrom(e.target.value)
                      void fetchLiquidationPreview(liqTarget, e.target.value, liqTo, baseScale)
                    }}
                    className={`${inputCls} tabular-nums`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Hasta</label>
                  <input
                    type="date"
                    required
                    value={liqTo}
                    onChange={e => {
                      setLiqTo(e.target.value)
                      void fetchLiquidationPreview(liqTarget, liqFrom, e.target.value, baseScale)
                    }}
                    className={`${inputCls} tabular-nums`}
                  />
                </div>
              </div>

              {liqPreview && liqPreview.overlapping_payments > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
                  Ya existe {liqPreview.overlapping_payments} liquidación activa que se cruza con estas fechas. Las ventas ya pagadas fueron excluidas automáticamente del cálculo de comisiones.
                </div>
              )}

              {/* Proporción de sueldo base */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Modalidad de sueldo base</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg mb-2">
                  {(
                    [
                      ['full', 'Mes completo (100%)'],
                      ['half', 'Quincena (50%)'],
                      ['zero', 'Solo comisiones'],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setBaseScale(k)
                        if (liqPreview) {
                          const v =
                            k === 'half'
                              ? Math.round(liqPreview.base_salary * 50) / 100
                              : k === 'zero'
                                ? 0
                                : liqPreview.base_salary
                          setLiqBaseInput(String(v))
                        }
                      }}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                        baseScale === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Sueldo base a pagar</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liqBaseInput}
                      onChange={e => {
                        setBaseScale('custom')
                        setLiqBaseInput(e.target.value)
                      }}
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Comisiones ({liqPreview?.commission_pct || 0}% de {money(liqPreview?.sales_amount || 0)})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liqCommInput}
                      onChange={e => setLiqCommInput(e.target.value)}
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                </div>
              </div>

              {/* Resumen aritmético */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-xs tabular-nums">
                {liqLoading ? (
                  <p className="text-slate-400 text-center py-2">Calculando ventas y novedades...</p>
                ) : (
                  <>
                    <div className="flex justify-between text-slate-700">
                      <span>+ Sueldo base del periodo</span>
                      <span>{money(Number(liqBaseInput) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>
                        + Comisiones ({liqPreview?.sales_count || 0} ventas no liquidadas)
                      </span>
                      <span>{money(Number(liqCommInput) || 0)}</span>
                    </div>
                    {(liqPreview?.bonuses_amount || 0) > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>+ Bonos pendientes</span>
                        <span>{money(liqPreview?.bonuses_amount || 0)}</span>
                      </div>
                    )}
                    {(liqPreview?.deductions_amount || 0) > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>- Descuentos pendientes</span>
                        <span>-{money(liqPreview?.deductions_amount || 0)}</span>
                      </div>
                    )}
                    {(liqPreview?.advances_amount || 0) > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>- Adelantos / vales ya entregados</span>
                        <span>-{money(liqPreview?.advances_amount || 0)}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-200 flex justify-between text-base font-bold text-slate-900">
                      <span>Neto a desembolsar hoy</span>
                      <span>{money(netLiquidationAmount)}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Medio de desembolso</label>
                  <select
                    value={liqMethod}
                    onChange={e => setLiqMethod(e.target.value as any)}
                    className={inputCls}
                  >
                    <option value="efectivo">Efectivo (sale de Caja)</option>
                    <option value="transferencia">Transferencia (Bancos)</option>
                    <option value="tarjeta">Tarjeta (Bancos)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">N.º comprobante / Ref.</label>
                  <input
                    value={liqRef}
                    onChange={e => setLiqRef(e.target.value)}
                    placeholder="Opcional: ref. bancaria"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Observaciones en el recibo</label>
                <input
                  value={liqNotes}
                  onChange={e => setLiqNotes(e.target.value)}
                  placeholder="Opcional: pago quincena / cierre de mes"
                  className={inputCls}
                />
              </div>

              <div className="pt-2 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setLiqTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={liqSaving || liqLoading}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  {liqSaving ? 'Registrando pago...' : `Confirmar y emitir recibo (${money(netLiquidationAmount)})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Vista rápida de Recibo de Nómina */}
      {receiptTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setReceiptTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-mono text-slate-500">NOM-{receiptTarget.id.slice(0, 8).toUpperCase()}</p>
                <h3 className="text-base font-bold text-slate-900">Recibo de nómina · {receiptTarget.member_name}</h3>
                <p className="text-xs text-slate-500">
                  Periodo {receiptTarget.period_from} al {receiptTarget.period_to}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceiptTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-1.5 text-xs tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-600">Sueldo base</span>
                <span className="font-medium">{money(receiptTarget.base_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Comisiones ({receiptTarget.commission_pct}%)</span>
                <span className="font-medium">{money(receiptTarget.commission_amount)}</span>
              </div>
              {Number(receiptTarget.bonuses_amount) > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Bonos</span>
                  <span>+{money(receiptTarget.bonuses_amount)}</span>
                </div>
              )}
              {Number(receiptTarget.deductions_amount) > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Descuentos</span>
                  <span>-{money(receiptTarget.deductions_amount)}</span>
                </div>
              )}
              {Number(receiptTarget.advances_deducted) > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>Vales descontados</span>
                  <span>-{money(receiptTarget.advances_deducted)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-bold text-slate-900">
                <span>Neto pagado ({METHOD_LABEL[receiptTarget.method] || receiptTarget.method})</span>
                <span>{money(receiptTarget.net_paid)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {(() => {
                const mem = members.find(m => m.id === receiptTarget.user_id)
                const doc = buildPayrollReceiptDoc(receiptTarget, mem)
                const waDigits = cleanPhoneForWhatsApp(mem?.phone)
                const waUrl =
                  (waDigits ? `https://wa.me/${waDigits}?text=` : 'https://wa.me/?text=') +
                  encodeURIComponent(buildShareText(doc, config))
                return (
                  <>
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Enviar por WhatsApp
                    </a>
                    <button
                      type="button"
                      onClick={() => printHtml(buildDocHtml(doc, config))}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Imprimir recibo
                    </button>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Expediente, Foto y Nómina */}
      {editTarget && form && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !saving && setEditTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Expediente de personal y nómina</h2>
                <p className="text-xs text-slate-500">{editTarget.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMember} className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
              <AvatarCapture
                value={form.avatar_url}
                name={form.full_name}
                email={editTarget.email}
                onChange={avatar_url => setForm({ ...form, avatar_url })}
                disabled={saving}
              />

              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-800 mb-3">1. Datos personales e identificación</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo</label>
                    <input
                      required
                      value={form.full_name}
                      onChange={e => setForm({ ...form, full_name: e.target.value })}
                      placeholder="Nombre y apellido"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Cédula / Documento de identidad</label>
                    <input
                      value={form.national_id}
                      onChange={e => setForm({ ...form, national_id: e.target.value })}
                      placeholder="Ej. V-18234567 / CC / DNI"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono / WhatsApp</label>
                    <input
                      value={form.phone}
                      onChange={e => setForm({ ...form, phone: e.target.value })}
                      placeholder="Ej. +58 412 0000000"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Contacto de emergencia</label>
                    <input
                      value={form.emergency_contact}
                      onChange={e => setForm({ ...form, emergency_contact: e.target.value })}
                      placeholder="Nombre y teléfono familiar"
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Dirección de habitación</label>
                    <input
                      value={form.address}
                      onChange={e => setForm({ ...form, address: e.target.value })}
                      placeholder="Ciudad, sector, calle y referencia"
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-800 mb-3">2. Cargo, ruta y condiciones de nómina</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Rol en la empresa</label>
                    <select
                      value={form.role}
                      disabled={editTarget.id === currentUser?.id || editTarget.role === 'admin'}
                      onChange={e => setForm({ ...form, role: e.target.value as Role })}
                      className={inputCls}
                    >
                      <option value="vendedor">Vendedor</option>
                      <option value="cajero">Cajero / Mostrador</option>
                      <option value="almacen">Jefe de almacén / Bodega</option>
                      <option value="comprador">Compras y abastecimiento</option>
                      <option value="transportador">Logística / Transporte</option>
                      <option value="contador">Contador</option>
                      <option value="gerente">Gerente operativo</option>
                      <option value="admin_empresa">Administrador de empresa</option>
                      <option value="dueno">Dueño / Dirección general</option>
                      {currentUser?.role === 'admin' && <option value="admin">Administrador central</option>}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Cargo</label>
                    <input
                      value={form.job_title}
                      onChange={e => setForm({ ...form, job_title: e.target.value })}
                      placeholder="Ej. Vendedor senior"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Zona o ruta asignada</label>
                    <input
                      value={form.zone}
                      onChange={e => setForm({ ...form, zone: e.target.value })}
                      placeholder="Ej. Ruta Norte / Centro"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de ingreso</label>
                    <input
                      type="date"
                      value={form.hire_date}
                      onChange={e => setForm({ ...form, hire_date: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Sueldo base mensual</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.base_salary}
                      onChange={e => setForm({ ...form, base_salary: e.target.value })}
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">% Comisión sobre ventas</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={form.commission_pct}
                      onChange={e => setForm({ ...form, commission_pct: e.target.value })}
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Observaciones internas</label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Vehículo asignado, acuerdos de comisión, equipo entregado..."
                    className={inputCls}
                  />
                </div>

                {editTarget.id !== currentUser?.id && (
                  <label className="flex items-center gap-2.5 mt-3 text-xs text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={e => setForm({ ...form, active: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    <span>
                      <strong>Perfil autorizado para entrar a la aplicación.</strong> Si desmarcas esta casilla se bloquea su acceso y sus dispositivos de inmediato.
                    </span>
                  </label>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Guardando expediente...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirmar anulación de liquidación */}
      {voidPayTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !voidBusy && setVoidPayTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-sm p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">Anular liquidación de nómina</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Se anulará el pago a <strong>{voidPayTarget.member_name}</strong> por {money(voidPayTarget.net_paid)}, revirtiendo su gasto en Caja/Contabilidad y dejando sus vales o bonos pendientes nuevamente.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setVoidPayTarget(null)}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={voidBusy}
                onClick={() => void handleVoidPayment()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {voidBusy ? 'Anulando...' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar anulación de vale/bono */}
      {voidMovTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !voidBusy && setVoidMovTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-sm p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">Anular novedad de nómina</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              ¿Anular {voidMovTarget.type} de <strong>{voidMovTarget.member_name}</strong> por {money(voidMovTarget.amount)}? Si fue un adelanto en efectivo o banco, también se revertirá el gasto.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setVoidMovTarget(null)}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={voidBusy}
                onClick={() => void handleVoidMovement()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {voidBusy ? 'Anulando...' : 'Anular registro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar retiro o eliminación de perfil no autorizado */}
      {removeTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !removing && setRemoveTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <UserAvatar src={removeTarget.avatar_url} name={removeTarget.full_name} email={removeTarget.email} size="md" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">Retirar perfil de la empresa</h2>
                  <p className="text-xs text-slate-500">{removeTarget.full_name || removeTarget.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                Esta acción revoca de inmediato todos sus dispositivos autorizados, limpia sus rutas futuras pendientes y retira el perfil de tu nómina activa.
              </p>
              <p className="text-slate-500">
                Si este usuario nunca registró operaciones se eliminará por completo; si ya realizó ventas o visitas, su cuenta quedará bloqueada permanentemente conservando el historial contable.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                disabled={removing}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRemove()}
                disabled={removing}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {removing ? 'Procesando baja...' : 'Confirmar retiro del perfil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
