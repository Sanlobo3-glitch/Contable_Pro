import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  Building2,
  RefreshCw,
  Search,
  Users,
  CreditCard,
  Mail,
  UserRound,
  Clock,
  ShieldAlert,
  CheckCircle2,
  SlidersHorizontal,
  History,
  Database,
  X,
} from 'lucide-react'
import { fmtDate, fmtDateTime } from '../lib/currency'
import type { CompanySummary, PlatformAuditEntry } from '../types'

const PLAN_OPTIONS = [
  { id: 'emprendedor', label: 'Emprendedor' },
  { id: 'profesional', label: 'Profesional' },
  { id: 'empresarial', label: 'Empresarial' },
  { id: 'corporativo', label: 'Corporativo' },
] as const

const MONTH_OPTIONS = [
  { value: 1, label: '1 mes (30 días)' },
  { value: 3, label: '3 meses (90 días)' },
  { value: 6, label: '6 meses (180 días)' },
  { value: 12, label: '12 meses (1 año)' },
  { value: 0, label: 'Indefinido / De por vida' },
] as const

const TRIAL_DAY_OPTIONS = [
  { value: 7, label: '7 días' },
  { value: 15, label: '15 días' },
  { value: 30, label: '30 días' },
] as const

type StatusFilter = 'all' | 'active' | 'trial' | 'attention'
type ModalActionTab = 'plan' | 'trial' | 'status'

function statusInfo(
  status: string | null | undefined,
  trialEnd: string | null | undefined,
  subEnd: string | null | undefined
): { label: string; category: 'active' | 'trial' | 'attention'; textClass: string } {
  if (status === 'active') {
    const expired = subEnd
      ? new Date(subEnd).getTime() <= Date.now()
      : false

    return expired
      ? { label: 'Suscripción vencida', category: 'attention', textClass: 'text-red-700' }
      : { label: 'Activa', category: 'active', textClass: 'text-emerald-700' }
  }

  if (status === 'trial') {
    const expired =
      !trialEnd || new Date(trialEnd).getTime() <= Date.now()

    return expired
      ? { label: 'Prueba vencida', category: 'attention', textClass: 'text-red-700' }
      : { label: 'En prueba', category: 'trial', textClass: 'text-amber-700' }
  }

  if (status === 'suspended') {
    return { label: 'Suspendida', category: 'attention', textClass: 'text-red-700' }
  }

  if (status === 'expired') {
    return { label: 'Vencida', category: 'attention', textClass: 'text-red-700' }
  }

  return { label: 'Sin suscripción', category: 'attention', textClass: 'text-slate-600' }
}

function companyDisplayName(company: CompanySummary) {
  const name = (company.company_name || '').trim()

  const genericNames = [
    'mi empresa',
    'mi negocio',
    'empresa',
  ]

  if (
    !name ||
    genericNames.includes(name.toLowerCase())
  ) {
    if (company.owner_name?.trim()) {
      return `Empresa de ${company.owner_name.trim()}`
    }

    return 'Empresa sin nombre comercial'
  }

  return name
}

function companyInitials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length >= 2) {
    return (
      words[0][0] + words[1][0]
    ).toUpperCase()
  }

  return name.slice(0, 2).toUpperCase()
}

function formatAuditEventLabel(eventType: string): string {
  switch (eventType) {
    case 'company_plan_activated':
      return 'Activación / renovación de plan'
    case 'company_trial_granted':
      return 'Concesión de periodo de prueba'
    case 'company_subscription_status_changed':
      return 'Cambio de estado comercial'
    case 'platform_staff_assigned':
      return 'Asignación en equipo de plataforma'
    case 'platform_staff_status_changed':
      return 'Cambio de estado en equipo de plataforma'
    default:
      return eventType.replace(/_/g, ' ')
  }
}

export default function CompanyClients({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()

  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [auditLogs, setAuditLogs] = useState<PlatformAuditEntry[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [needsMigration45, setNeedsMigration45] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Modal de gestión comercial por empresa cliente
  const [manageTarget, setManageTarget] = useState<CompanySummary | null>(null)
  const [modalTab, setModalTab] = useState<ModalActionTab>('plan')
  const [selectedPlan, setSelectedPlan] = useState<string>('profesional')
  const [selectedMonths, setSelectedMonths] = useState<number>(1)
  const [trialDays, setTrialDays] = useState<number>(7)
  const [targetSubStatus, setTargetSubStatus] = useState<'active' | 'suspended' | 'expired'>('suspended')
  const [actionNote, setActionNote] = useState<string>('')

  const load = useCallback(async () => {
    if (user?.role !== 'admin') {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const [commercialRes, auditRes] = await Promise.all([
      supabase.rpc('admin_listar_empresas_comerciales'),
      supabase.rpc('admin_listar_auditoria_plataforma', { p_limit: 40 }),
    ])

    let rows: CompanySummary[] = []
    let missing45 = false

    if (!commercialRes.error && Array.isArray(commercialRes.data)) {
      rows = commercialRes.data as CompanySummary[]
      missing45 = false
    } else if (
      commercialRes.error &&
      /admin_listar_empresas_comerciales|does not exist|schema cache|42883|PGRST202/i.test(
        commercialRes.error.message || ''
      )
    ) {
      missing45 = true
      const legacyRes = await supabase.rpc('admin_listar_empresas')
      if (legacyRes.error) {
        setError(legacyRes.error.message)
        setLoading(false)
        return
      }
      rows = (Array.isArray(legacyRes.data) ? legacyRes.data : []) as CompanySummary[]
    } else if (commercialRes.error) {
      setError(commercialRes.error.message)
      setLoading(false)
      return
    }

    setNeedsMigration45(missing45)

    // La empresa del administrador global es el entorno interno de pruebas.
    // Nunca debe aparecer ni administrarse como empresa cliente externa.
    const clients = rows.filter(
      company => company.company_id !== user.company_id
    )

    setCompanies(clients)

    if (!auditRes.error && Array.isArray(auditRes.data)) {
      setAuditLogs(auditRes.data as PlatformAuditEntry[])
    } else {
      setAuditLogs([])
    }

    setLoading(false)
  }, [user?.id, user?.role, user?.company_id])

  useEffect(() => {
    void load()
  }, [load])

  function openManageModal(company: CompanySummary, initialTab: ModalActionTab = 'plan') {
    setFeedback(null)
    setManageTarget(company)
    setModalTab(initialTab)
    setSelectedPlan(
      PLAN_OPTIONS.some(p => p.id === company.plan_type)
        ? String(company.plan_type)
        : 'profesional'
    )
    setSelectedMonths(1)
    setTrialDays(7)
    setTargetSubStatus(
      company.subscription_status === 'suspended' ? 'active' : 'suspended'
    )
    setActionNote('')
  }

  async function handleQuickTrial7d(company: CompanySummary) {
    if (busy) return
    setBusy(true)
    setFeedback(null)
    const { error: rpcErr } = await supabase.rpc('admin_reactivar_prueba_empresa', {
      p_company_id: company.company_id,
      p_days: 7,
    })
    setBusy(false)

    if (rpcErr) {
      setFeedback({ ok: false, text: rpcErr.message })
      return
    }

    setFeedback({
      ok: true,
      text: `Se concedieron 7 días de prueba a ${companyDisplayName(company)}.`,
    })
    await load()
  }

  async function handleExecuteModalAction(e: React.FormEvent) {
    e.preventDefault()
    if (!manageTarget || busy) return

    setBusy(true)
    setFeedback(null)

    try {
      const display = companyDisplayName(manageTarget)

      if (modalTab === 'plan') {
        const { error: rpcErr } = await supabase.rpc('admin_activar_plan_empresa', {
          p_company_id: manageTarget.company_id,
          p_plan: selectedPlan,
          p_months: selectedMonths,
          p_note: actionNote.trim() || null,
        })
        if (rpcErr) throw rpcErr

        setFeedback({
          ok: true,
          text:
            selectedMonths === 0
              ? `Plan ${selectedPlan} activado de forma indefinida para ${display}.`
              : `Plan ${selectedPlan} activado por ${selectedMonths} ${selectedMonths === 1 ? 'mes' : 'meses'} para ${display}.`,
        })
      } else if (modalTab === 'trial') {
        const { error: rpcErr } = await supabase.rpc('admin_reactivar_prueba_empresa', {
          p_company_id: manageTarget.company_id,
          p_days: trialDays,
        })
        if (rpcErr) throw rpcErr

        setFeedback({
          ok: true,
          text: `Periodo de prueba reactivado por ${trialDays} días para ${display}.`,
        })
      } else {
        const { error: rpcErr } = await supabase.rpc('admin_cambiar_estado_empresa', {
          p_company_id: manageTarget.company_id,
          p_status: targetSubStatus,
          p_note: actionNote.trim() || null,
        })
        if (rpcErr) throw rpcErr

        const statusLabel =
          targetSubStatus === 'active'
            ? 'Activa'
            : targetSubStatus === 'suspended'
              ? 'Suspendida'
              : 'Vencida'
        setFeedback({
          ok: true,
          text: `Estado comercial de ${display} actualizado a ${statusLabel}.`,
        })
      }

      setManageTarget(null)
      await load()
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudo aplicar la operación comercial.',
      })
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    let active = 0
    let trial = 0
    let attention = 0

    for (const c of companies) {
      const st = statusInfo(c.subscription_status, c.trial_end, c.subscription_end)
      if (st.category === 'active') active++
      else if (st.category === 'trial') trial++
      else attention++
    }

    return {
      total: companies.length,
      active,
      trial,
      attention,
    }
  }, [companies])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return companies.filter(company => {
      const st = statusInfo(
        company.subscription_status,
        company.trial_end,
        company.subscription_end
      )

      if (statusFilter !== 'all' && st.category !== statusFilter) {
        return false
      }

      if (!q) return true

      const displayName = companyDisplayName(company)

      return (
        displayName.toLowerCase().includes(q) ||
        (company.company_name || '').toLowerCase().includes(q) ||
        (company.owner_name || '').toLowerCase().includes(q) ||
        (company.owner_email || '').toLowerCase().includes(q) ||
        company.company_id.toLowerCase().includes(q)
      )
    })
  }, [companies, search, statusFilter])

  if (user?.role !== 'admin') {
    return (
      <p className="text-sm text-slate-500">
        No tienes permiso para consultar las empresas clientes.
      </p>
    )
  }

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:border-slate-700'

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Empresas clientes
          </h1>

          <p className="text-sm text-slate-500 mt-1">
            Administración comercial, suscripciones y licencias de las empresas registradas con aislamiento total de sus datos operativos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate?.('users')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Users className="w-3.5 h-3.5 text-slate-500" />
            Equipo de plataforma
          </button>

          <button
            type="button"
            onClick={() => onNavigate?.('adminplans')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <CreditCard className="w-3.5 h-3.5 text-slate-500" />
            Activar planes
          </button>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Actualizar
          </button>
        </div>
      </div>

      {needsMigration45 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-amber-900 space-y-1">
            <p className="font-semibold">
              Migración 000045 de Administración Global Comercial pendiente en Supabase
            </p>
            <p className="text-amber-800">
              Para activar planes por empresa cliente, conceder pruebas, suspender suscripciones y registrar auditoría central, aplica el paquete <strong>Administración Global Comercial y Equipo de Plataforma (Migración 000045)</strong> en el Centro SQL.
            </p>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('sqlcenter')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-900 text-white text-xs font-semibold hover:bg-amber-800 whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              Ir al Centro SQL
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          No se pudieron cargar las empresas: {error}
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
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

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Building2 className="w-4 h-4 text-slate-600" />
            <span>Total empresas clientes</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">
            {counts.total}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Organizaciones externas registradas
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Suscripciones activas</span>
          </div>
          <p className="text-2xl font-bold text-emerald-700 mt-2 tabular-nums">
            {counts.active}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Con licencia comercial vigente
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Clock className="w-4 h-4 text-amber-600" />
            <span>En periodo de prueba</span>
          </div>
          <p className="text-2xl font-bold text-amber-700 mt-2 tabular-nums">
            {counts.trial}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Evaluación gratuita activa
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            <span>Vencidas / Suspendidas</span>
          </div>
          <p className="text-2xl font-bold text-red-700 mt-2 tabular-nums">
            {counts.attention}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Requieren renovación o reactivación
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 w-fit">
            {[
              { id: 'all', label: `Todas (${counts.total})` },
              { id: 'active', label: `Activas (${counts.active})` },
              { id: 'trial', label: `En prueba (${counts.trial})` },
              { id: 'attention', label: `Vencidas / Suspendidas (${counts.attention})` },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as StatusFilter)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors tabular-nums ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />

              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar empresa, titular o correo..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-800 outline-none focus:border-slate-500"
              />
            </div>

            <span className="text-xs text-slate-500 whitespace-nowrap tabular-nums">
              {filtered.length} de {companies.length}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">
            Cargando empresas clientes...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />

            <p className="text-sm font-medium text-slate-700">
              No hay empresas clientes que coincidan con el filtro
            </p>

            <p className="text-xs text-slate-500 mt-1">
              Las organizaciones externas registradas aparecerán aquí con su estado comercial.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50/70">
                  <th className="px-4 py-3 font-medium">Empresa y titular</th>
                  <th className="px-4 py-3 font-medium text-right">Miembros</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Estado comercial</th>
                  <th className="px-4 py-3 font-medium">Vigencia</th>
                  <th className="px-4 py-3 font-medium text-right">Gestión comercial</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filtered.map(company => {
                  const status = statusInfo(
                    company.subscription_status,
                    company.trial_end,
                    company.subscription_end
                  )

                  const expiry =
                    company.subscription_status === 'trial'
                      ? company.trial_end
                      : company.subscription_end

                  const displayName = companyDisplayName(company)

                  const hasConfiguredName =
                    Boolean(company.company_name?.trim()) &&
                    ![
                      'mi empresa',
                      'mi negocio',
                      'empresa',
                    ].includes(company.company_name.trim().toLowerCase())

                  const isSuspended = company.subscription_status === 'suspended'

                  return (
                    <tr
                      key={company.company_id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-4 py-3.5 min-w-[250px]">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                            {companyInitials(displayName)}
                          </div>

                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate max-w-[260px]">
                              {displayName}
                            </p>

                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 mt-0.5">
                              <span className="inline-flex items-center gap-1">
                                <UserRound className="w-3 h-3 text-slate-400 shrink-0" />
                                {company.owner_name || 'Sin titular'}
                              </span>
                              {company.owner_email && (
                                <>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1 text-slate-500">
                                    <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                                    {company.owner_email}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 tabular-nums">
                              <span className="font-mono">{company.company_id.slice(0, 8)}</span>
                              {company.created_at && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>Alta {fmtDate(company.created_at)}</span>
                                </>
                              )}
                              {!hasConfiguredName && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-700">Nombre comercial pendiente</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                        {company.members_count}
                      </td>

                      <td className="px-4 py-3.5 text-xs font-medium capitalize text-slate-800 whitespace-nowrap">
                        {company.plan_type || 'Sin plan'}
                      </td>

                      <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                        <span className={`font-semibold ${status.textClass}`}>
                          {status.label}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {company.subscription_status === 'active' && !company.subscription_end
                          ? 'Indefinida'
                          : expiry
                            ? fmtDate(expiry)
                            : 'Sin fecha'}
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openManageModal(company, 'plan')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                            Plan / Renovar
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleQuickTrial7d(company)}
                            title="Conceder o extender 7 días de prueba"
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            Prueba 7d
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openManageModal(company, 'status')}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium disabled:opacity-50 whitespace-nowrap shrink-0 ${
                              isSuspended
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                : 'border-red-200 bg-white text-red-700 hover:bg-red-50'
                            }`}
                          >
                            {isSuspended ? 'Reactivar' : 'Suspender'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Auditoría global de acciones administrativas */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Auditoría global de plataforma
            </h2>
          </div>
          <span className="text-xs text-slate-500 tabular-nums">
            Últimos {auditLogs.length} eventos
          </span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 text-center">
            Los cambios de planes, reactivaciones de prueba y asignaciones del equipo de plataforma quedarán auditados aquí automáticamente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/70">
                  <th className="px-4 py-2.5 font-medium">Fecha y hora</th>
                  <th className="px-4 py-2.5 font-medium">Evento</th>
                  <th className="px-4 py-2.5 font-medium">Actor central</th>
                  <th className="px-4 py-2.5 font-medium">Objetivo</th>
                  <th className="px-4 py-2.5 font-medium">Detalle comercial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map(entry => {
                  const evData = entry.event_data || {}
                  const summaryParts = [
                    evData.plan_type ? `Plan: ${String(evData.plan_type)}` : null,
                    evData.months !== undefined
                      ? Number(evData.months) === 0
                        ? 'Duración: Indefinido'
                        : `Duración: ${String(evData.months)}m`
                      : null,
                    evData.days !== undefined ? `Prueba: ${String(evData.days)}d` : null,
                    evData.subscription_status ? `Estado: ${String(evData.subscription_status)}` : null,
                    evData.staff_role ? `Rol: ${String(evData.staff_role)}` : null,
                    evData.note ? `Nota: ${String(evData.note)}` : null,
                  ].filter(Boolean)

                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">
                        {fmtDateTime(entry.created_at)}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                        {formatAuditEventLabel(entry.event_type)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {entry.actor_email || entry.actor_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {entry.target_email ||
                          (entry.target_company_id
                            ? `Empresa ${entry.target_company_id.slice(0, 8)}`
                            : entry.target_user_id
                              ? `Usuario ${entry.target_user_id.slice(0, 8)}`
                              : 'Plataforma')}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {summaryParts.length > 0 ? summaryParts.join(' · ') : 'Registro confirmado'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de gestión comercial por empresa cliente */}
      {manageTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !busy && setManageTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Gestión comercial · {companyDisplayName(manageTarget)}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {manageTarget.owner_name || 'Titular'}
                  {manageTarget.owner_email ? ` · ${manageTarget.owner_email}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setManageTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteModalAction} className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalTab('plan')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    modalTab === 'plan'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Activar plan
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('trial')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    modalTab === 'trial'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Conceder prueba
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('status')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    modalTab === 'status'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cambiar estado
                </button>
              </div>

              {modalTab === 'plan' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Plan comercial
                    </label>
                    <select
                      value={selectedPlan}
                      onChange={e => setSelectedPlan(e.target.value)}
                      className={inputCls}
                    >
                      {PLAN_OPTIONS.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Vigencia de la suscripción
                    </label>
                    <select
                      value={selectedMonths}
                      onChange={e => setSelectedMonths(Number(e.target.value))}
                      className={inputCls}
                    >
                      {MONTH_OPTIONS.map(m => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nota de respaldo comercial (opcional)
                    </label>
                    <input
                      value={actionNote}
                      onChange={e => setActionNote(e.target.value)}
                      placeholder="Ej. Transferencia verificada #8821 / Renovación anual"
                      className={inputCls}
                    />
                  </div>
                </div>
              )}

              {modalTab === 'trial' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Duración del periodo de prueba
                    </label>
                    <select
                      value={trialDays}
                      onChange={e => setTrialDays(Number(e.target.value))}
                      className={inputCls}
                    >
                      {TRIAL_DAY_OPTIONS.map(d => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    Habilita acceso completo operativo para todos los miembros de la empresa cliente durante el plazo elegido sin acceder a sus registros internos.
                  </p>
                </div>
              )}

              {modalTab === 'status' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nuevo estado de suscripción
                    </label>
                    <select
                      value={targetSubStatus}
                      onChange={e =>
                        setTargetSubStatus(
                          e.target.value as 'active' | 'suspended' | 'expired'
                        )
                      }
                      className={inputCls}
                    >
                      <option value="active">Activa · Habilitar acceso comercial</option>
                      <option value="suspended">Suspendida · Bloquear acceso por mora o revisión</option>
                      <option value="expired">Vencida · Marcar suscripción finalizada</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Motivo o observación (opcional)
                    </label>
                    <input
                      value={actionNote}
                      onChange={e => setActionNote(e.target.value)}
                      placeholder="Ej. Suspensión por falta de renovación / Reactivación autorizada"
                      className={inputCls}
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setManageTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {busy ? 'Aplicando...' : 'Confirmar cambio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

