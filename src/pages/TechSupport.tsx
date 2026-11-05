import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  Database,
  KeyRound,
  LifeBuoy,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Wrench,
  X,
} from 'lucide-react'
import { useAuth, canManageTechSupport, getRoleLabel } from '../lib/auth'
import { PAGE_LABELS, getPageLabel } from '../lib/navigation'
import { useWarehouse } from '../lib/warehouseContext'
import { useCurrency, fmtDateTime } from '../lib/currency'
import {
  buildSessionSnapshot,
  createSupportTicket,
  fetchSupportTickets,
  isSessionAuthorizationActive,
  updateTicketSessionAuthorization,
  updateTicketTechnicalResolution,
} from '../lib/supportTickets'
import SqlActivationModal from '../components/SqlActivationModal'
import type {
  SupportAuthorizationScope,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '../types'

const CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  operacion: 'Operación general',
  ventas_pos: 'Mostrador POS y ventas',
  inventario: 'Inventario y multibodega',
  contabilidad: 'Contabilidad e impuestos',
  dispositivos: 'Acceso y dispositivos',
  facturacion_pdf: 'Catálogo, recibos y PDF',
  otro: 'Otra consulta técnica',
}

const PRIORITY_LABELS: Record<SupportTicketPriority, { label: string; tone: string }> = {
  baja: { label: 'Prioridad baja', tone: 'text-slate-500' },
  normal: { label: 'Prioridad normal', tone: 'text-slate-700' },
  alta: { label: 'Prioridad alta', tone: 'text-amber-700' },
  critica: { label: 'Prioridad crítica', tone: 'text-red-600' },
}

const STATUS_LABELS: Record<SupportTicketStatus, { label: string; tone: string }> = {
  pendiente: { label: 'Pendiente de revisión', tone: 'text-amber-700' },
  en_revision: { label: 'En revisión técnica', tone: 'text-blue-700' },
  resuelto: { label: 'Resuelto', tone: 'text-emerald-700' },
  cerrado: { label: 'Cerrado', tone: 'text-slate-500' },
}

type QueueFilter = 'all' | 'authorized' | 'pendiente' | 'en_revision' | 'resuelto'

function formatRemainingTime(untilIso: string | null): string {
  if (!untilIso) return 'Sin vencimiento válido'
  const diffMs = new Date(untilIso).getTime() - Date.now()
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'Expirada'
  const totalMin = Math.round(diffMs / 60000)
  if (totalMin < 60) return `${totalMin} min restantes`
  const hours = Math.floor(totalMin / 60)
  if (hours < 48) return `${hours} h restantes`
  return `${Math.ceil(hours / 24)} días restantes`
}

export default function TechSupport({
  currentOriginPage = 'dashboard',
  onNavigate,
}: {
  currentOriginPage?: string
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const { activeWarehouse, activeBranch } = useWarehouse()
  const cur = useCurrency()

  const isTechTeam = canManageTechSupport(user?.role)

  const [mode, setMode] = useState<'inbox' | 'client'>(() =>
    canManageTechSupport(user?.role) ? 'inbox' : 'client'
  )

  useEffect(() => {
    if (!isTechTeam && mode === 'inbox') {
      setMode('client')
    } else if (user?.role === 'tecnico') {
      setMode('inbox')
    }
  }, [isTechTeam, user?.role, mode])

  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [needsSql, setNeedsSql] = useState(false)
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Filtros de bandeja técnica
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Campos de gestión técnica
  const [techStatus, setTechStatus] = useState<SupportTicketStatus>('en_revision')
  const [techDiagnosis, setTechDiagnosis] = useState('')
  const [techResolution, setTechResolution] = useState('')

  // Formulario de nueva solicitud del usuario
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [category, setCategory] = useState<SupportTicketCategory>('operacion')
  const [priority, setPriority] = useState<SupportTicketPriority>('normal')
  const [modulePage, setModulePage] = useState<string>(
    currentOriginPage && currentOriginPage !== 'support' ? currentOriginPage : 'pos'
  )
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [authorizeSession, setAuthorizeSession] = useState(true)
  const [durationChoice, setDurationChoice] = useState<'2' | '24' | '72' | 'until_resolved'>('24')
  const [authScope, setAuthScope] = useState<SupportAuthorizationScope>('intervencion_asistida')

  const loadTickets = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await fetchSupportTickets({
        user,
        isTechTeam: isTechTeam && mode === 'inbox',
      })
      setTickets(res.tickets)
      setNeedsSql(res.needsSqlMigration)
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudieron consultar las solicitudes.',
      })
    } finally {
      setLoading(false)
    }
  }, [user, isTechTeam, mode])

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  const selectedTicket = useMemo(
    () => tickets.find(t => t.id === selectedId) || tickets[0] || null,
    [tickets, selectedId]
  )

  useEffect(() => {
    if (selectedTicket) {
      setTechStatus(selectedTicket.status)
      setTechDiagnosis(selectedTicket.tech_diagnosis || '')
      setTechResolution(selectedTicket.resolution_notes || '')
    }
  }, [selectedTicket?.id])

  const kpis = useMemo(() => {
    const openCount = tickets.filter(t => t.status === 'pendiente' || t.status === 'en_revision').length
    const authorizedActive = tickets.filter(t => isSessionAuthorizationActive(t)).length
    const inReview = tickets.filter(t => t.status === 'en_revision').length
    const resolved = tickets.filter(t => t.status === 'resuelto' || t.status === 'cerrado').length
    return { openCount, authorizedActive, inReview, resolved }
  }, [tickets])

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.filter(t => {
      if (queueFilter === 'authorized' && !isSessionAuthorizationActive(t)) return false
      if (queueFilter === 'pendiente' && t.status !== 'pendiente') return false
      if (queueFilter === 'en_revision' && t.status !== 'en_revision') return false
      if (queueFilter === 'resuelto' && t.status !== 'resuelto' && t.status !== 'cerrado') return false
      if (!q) return true
      return (
        t.ticket_number.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.user_name.toLowerCase().includes(q) ||
        t.user_email.toLowerCase().includes(q) ||
        (t.company_name || '').toLowerCase().includes(q) ||
        (t.authorization_code || '').toLowerCase().includes(q)
      )
    })
  }, [tickets, queueFilter, search])

  if (!user) return null

  async function handleSubmitTicket(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !subject.trim() || !description.trim() || busy) return
    setBusy(true)
    setFeedback(null)

    try {
      const snapshot = buildSessionSnapshot({
        user,
        activePage: modulePage || 'dashboard',
        warehouseName: activeWarehouse?.name || null,
        branchName: activeBranch?.name || null,
        currency: cur.currency,
      })

      const hours =
        durationChoice === 'until_resolved' ? 'until_resolved' : Number(durationChoice)

      const { ticket, savedInLocalFallback } = await createSupportTicket({
        user,
        category,
        priority,
        subject,
        description,
        modulePage,
        authorizeSession,
        durationHours: hours,
        authorizationScope: authScope,
        snapshot,
      })

      setSubject('')
      setDescription('')
      setShowCreateForm(false)
      setSelectedId(ticket.id)
      setFeedback({
        ok: true,
        text: savedInLocalFallback
          ? `Solicitud ${ticket.ticket_number} guardada en este dispositivo. No se concedió autorización técnica ni se sincronizó con Supabase.`
          : ticket.session_authorized && ticket.authorization_code
            ? `Solicitud ${ticket.ticket_number} enviada. Autorización confirmada por Supabase: ${ticket.authorization_code}.`
            : `Solicitud ${ticket.ticket_number} enviada al equipo técnico sin autorización de inspección.`,
      })
      await loadTickets()
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudo registrar la solicitud.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleAuthorization(ticket: SupportTicket, grant: boolean) {
    if (!user || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const snapshot = grant
        ? buildSessionSnapshot({
            user,
            activePage: ticket.module_page || 'dashboard',
            warehouseName: activeWarehouse?.name || null,
            branchName: activeBranch?.name || null,
            currency: cur.currency,
          })
        : undefined

      await updateTicketSessionAuthorization({
        ticketId: ticket.id,
        authorize: grant,
        durationHours: 24,
        scope: ticket.authorization_scope || 'intervencion_asistida',
        snapshot,
      })

      setFeedback({
        ok: true,
        text: grant
          ? `Autorización temporal reactivada por 24 horas para ${ticket.ticket_number}.`
          : `Autorización de sesión revocada inmediatamente para ${ticket.ticket_number}.`,
      })
      await loadTickets()
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudo actualizar la autorización.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveTechnicalUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !selectedTicket || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      await updateTicketTechnicalResolution({
        ticketId: selectedTicket.id,
        status: techStatus,
        techUser: user,
        techDiagnosis,
        resolutionNotes: techResolution,
      })
      setFeedback({
        ok: true,
        text: `Gestión técnica guardada en ${selectedTicket.ticket_number} (${STATUS_LABELS[techStatus].label}).`,
      })
      await loadTickets()
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudo guardar el avance técnico.',
      })
    } finally {
      setBusy(false)
    }
  }
    const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:border-slate-700'

  const moduleEntries = useMemo(
    () =>
      Object.entries(PAGE_LABELS).filter(
        ([id]) => id !== 'support' && id !== 'users' && id !== 'companies' && id !== 'adminplans'
      ),
    []
  )

  return (
    <div className="space-y-6">
      {/* Encabezado principal */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {isTechTeam && mode === 'inbox'
              ? 'Centro de Soporte Técnico y Autorizaciones'
              : 'Soporte técnico y autorización de sesión'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {isTechTeam && mode === 'inbox'
              ? 'Bandeja central de solicitudes de soporte y seguimiento técnico.'
              : 'Reporta cualquier novedad operativa y controla las autorizaciones temporales de soporte.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isTechTeam && (
            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setMode('inbox')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  mode === 'inbox' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bandeja técnica
              </button>
              <button
                type="button"
                onClick={() => setMode('client')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  mode === 'client' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Vista solicitud usuario
              </button>
            </div>
          )}

          {isTechTeam && (
            <button
              type="button"
              onClick={() => setSqlModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5 text-slate-500" />
              SQL Supabase
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadTickets()}
            disabled={loading || busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>

          {mode === 'client' && (
            <button
              type="button"
              onClick={() => setShowCreateForm(v => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {showCreateForm ? 'Cerrar formulario' : 'Nueva solicitud'}
            </button>
          )}
        </div>
      </div>

      {needsSql && isTechTeam && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-amber-900">
            <p className="font-semibold">Activación de tabla public.support_tickets en Supabase pendiente</p>
            <p className="mt-0.5 text-amber-800">
              Las solicitudes están operando en modo de respaldo local. Las tablas y funciones de soporte requieren la aplicación coordinada de las nuevas migraciones de seguridad. No ejecutes scripts antiguos desde este aviso.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSqlModalOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 whitespace-nowrap shrink-0"
          >
            Ver información SQL
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
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

      {/* Franja de indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Casos abiertos</span>
            <LifeBuoy className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {kpis.openCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">Pendientes o en atención</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Autorizaciones activas</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-1.5">
            {kpis.authorizedActive}
          </p>
          <p className="text-xs text-slate-500 mt-1">Registradas en las solicitudes</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>En revisión técnica</span>
            <Wrench className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {kpis.inReview}
          </p>
          <p className="text-xs text-slate-500 mt-1">Tomados por soporte</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Solicitudes resueltas</span>
            <CheckCircle2 className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {kpis.resolved}
          </p>
          <p className="text-xs text-slate-500 mt-1">Historial documentado</p>
        </div>
      </div>

      {/* MODO 1: VISTA DE USUARIO / EMPRESA */}
      {mode === 'client' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 max-w-3xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Tú tienes el control sobre las autorizaciones de soporte</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Puedes registrar una solicitud y expresar tu consentimiento para una asistencia técnica temporal. La autorización del ticket no habilita por sí sola el acceso a los datos privados de la empresa. Ese acceso solo podrá habilitarse cuando las políticas de seguridad de Supabase estén integradas y verificadas.
              </p>
            </div>
            {!showCreateForm && (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap shrink-0 self-start md:self-center"
              >
                Solicitar asistencia técnica
              </button>
            )}
          </div>

          {/* Formulario de creación y autorización */}
          {showCreateForm && (
            <form
              onSubmit={handleSubmitTicket}
              className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Nueva solicitud para el equipo técnico
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Solicitante: {user.full_name || user.email} · {getRoleLabel(user.role)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Área o módulo
                  </label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as SupportTicketCategory)}
                    className={inputCls}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Pantalla relacionada
                  </label>
                  <select
                    value={modulePage}
                    onChange={e => setModulePage(e.target.value)}
                    className={inputCls}
                  >
                    {moduleEntries.map(([id, lbl]) => (
                      <option key={id} value={id}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Urgencia operativa
                  </label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as SupportTicketPriority)}
                    className={inputCls}
                  >
                    <option value="baja">Baja · Consulta general</option>
                    <option value="normal">Normal · Revisión estándar</option>
                    <option value="alta">Alta · Afecta operación del día</option>
                    <option value="critica">Crítica · Bloqueo de facturación o caja</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Asunto breve de la situación
                </label>
                <input
                  required
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Ej. Diferencia al cuadrar devolución en mostrador o ajuste en bodega"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Descripción detallada para el técnico
                </label>
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Explica qué estabas realizando, el número de documento o producto involucrado y cómo deseas que te ayudemos..."
                  className={inputCls}
                />
              </div>

              {/* Bloque de autorización expresa */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={authorizeSession}
                    onChange={e => setAuthorizeSession(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      Expreso mi consentimiento para solicitar asistencia técnica
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Se adjunta el contexto de la pantalla actual ({getPageLabel(modulePage)}, bodega {activeWarehouse?.name || 'principal'}, moneda {cur.currency}). Este consentimiento no concede acceso directo a los datos de la empresa mientras no esté integrado con las políticas RLS.
                    </p>
                  </div>
                </label>

                {authorizeSession && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Vigencia de la autorización
                      </label>
                      <select
                        value={durationChoice}
                        onChange={e =>
                          setDurationChoice(
                            e.target.value as '2' | '24' | '72' | 'until_resolved'
                          )
                        }
                        className={inputCls}
                      >
                        <option value="2">2 horas</option>
                        <option value="24">24 horas (Recomendado)</option>
                        <option value="72">72 horas</option>
                        <option value="until_resolved">Hasta resolver la solicitud (máximo 168 h)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Alcance solicitado
                      </label>
                      <select
                        value={authScope}
                        onChange={e => setAuthScope(e.target.value as SupportAuthorizationScope)}
                        className={inputCls}
                      >
                        <option value="intervencion_asistida">
                          Diagnóstico y corrección asistida
                        </option>
                        <option value="lectura_diagnostico">
                          Solo lectura y diagnóstico
                        </option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || !subject.trim() || !description.trim()}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {busy ? 'Enviando solicitud...' : 'Enviar solicitud'}
                </button>
              </div>
            </form>
          )}

          {/* Historial de solicitudes del usuario/empresa */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Mis solicitudes y autorizaciones emitidas
              </h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {tickets.length} {tickets.length === 1 ? 'registro' : 'registros'}
              </span>
            </div>

            {loading ? (
              <p className="px-5 py-10 text-center text-xs text-slate-400">
                Cargando solicitudes...
              </p>
            ) : tickets.length === 0 ? (
              <div className="px-5 py-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  No has registrado solicitudes técnicas todavía
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Cuando necesites asistencia en tu cuenta o sesión, crea una solicitud aquí y decide por cuánto tiempo autorizas la asistencia.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tickets.map(t => {
                  const authActive = isSessionAuthorizationActive(t)
                  const st = STATUS_LABELS[t.status] || STATUS_LABELS.pendiente
                  const pr = PRIORITY_LABELS[t.priority] || PRIORITY_LABELS.normal

                  return (
                    <div key={t.id} className="p-5 space-y-3 hover:bg-slate-50/50 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span className="font-mono font-semibold text-slate-900 tabular-nums">
                              {t.ticket_number}
                            </span>
                            <span className="text-slate-300">·</span>
                            <span className={`font-semibold ${st.tone}`}>{st.label}</span>
                            <span className="text-slate-300">·</span>
                            <span className={pr.tone}>{pr.label}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-500 tabular-nums">
                              {fmtDateTime(t.created_at)}
                            </span>
                          </div>
                          <h3 className="text-sm font-semibold text-slate-900 mt-1">
                            {t.subject}
                          </h3>
                          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                            {t.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {authActive ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleToggleAuthorization(t, false)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              Revocar autorización
                            </button>
                          ) : (
                            t.status !== 'cerrado' &&
                            t.status !== 'resuelto' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleToggleAuthorization(t, true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Autorizar sesión 24h
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 pt-1">
                        <span>Módulo: {t.module_page ? getPageLabel(t.module_page) : 'General'}</span>
                        <span className="text-slate-300">·</span>
                        {authActive ? (
                          <span className="text-emerald-700 font-medium font-mono tabular-nums">
                            Autorización registrada ({t.authorization_code}) · {formatRemainingTime(t.authorized_until)}
                          </span>
                        ) : t.revoked_at ? (
                          <span className="text-slate-500">
                            Autorización revocada el {fmtDateTime(t.revoked_at)}
                          </span>
                        ) : (
                          <span>Sin autorización activa de sesión</span>
                        )}
                        {t.assigned_name && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span>Atendido por: {t.assigned_name}</span>
                          </>
                        )}
                      </div>

                      {(t.tech_diagnosis || t.resolution_notes) && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-xs">
                          {t.tech_diagnosis && (
                            <p className="text-slate-700">
                              <strong className="text-slate-900">Diagnóstico técnico:</strong>{' '}
                              {t.tech_diagnosis}
                            </p>
                          )}
                          {t.resolution_notes && (
                            <p className="text-emerald-800">
                              <strong className="text-emerald-900">Respuesta / Solución:</strong>{' '}
                              {t.resolution_notes}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODO 2: BANDEJA TÉCNICA */}
      {isTechTeam && mode === 'inbox' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Columna izquierda: Cola filtrable de tickets */}
          <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por SOP, empresa, usuario o código AUT..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-600"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                {(
                  [
                    ['all', 'Todas'],
                    ['authorized', 'Autorizadas'],
                    ['pendiente', 'Pendientes'],
                    ['en_revision', 'En revisión'],
                    ['resuelto', 'Resueltas'],
                  ] as [QueueFilter, string][]
                ).map(([id, lbl]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setQueueFilter(id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      queueFilter === id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <p className="p-8 text-center text-xs text-slate-400">Cargando bandeja técnica...</p>
            ) : filteredTickets.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-400">
                No hay solicitudes que coincidan con el filtro seleccionado.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
                {filteredTickets.map(t => {
                  const isSel = selectedTicket?.id === t.id
                  const authActive = isSessionAuthorizationActive(t)
                  const st = STATUS_LABELS[t.status] || STATUS_LABELS.pendiente
                  const pr = PRIORITY_LABELS[t.priority] || PRIORITY_LABELS.normal

                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left p-4 transition-colors ${
                        isSel ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            isSel ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {t.ticket_number}
                        </span>
                        <span
                          className={`font-medium ${
                            isSel
                              ? authActive
                                ? 'text-emerald-300'
                                : 'text-slate-300'
                              : authActive
                                ? 'text-emerald-700'
                                : st.tone
                          }`}
                        >
                          {authActive ? 'Autorización registrada' : st.label}
                        </span>
                      </div>

                      <p
                        className={`text-sm font-semibold mt-1 line-clamp-1 ${
                          isSel ? 'text-white' : 'text-slate-900'
                        }`}
                      >
                        {t.subject}
                      </p>

                      <div
                        className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] mt-1.5 ${
                          isSel ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        <span className="truncate max-w-[150px]">
                          {t.company_name || 'Empresa cliente'}
                        </span>
                        <span>·</span>
                        <span className="truncate max-w-[130px]">{t.user_name}</span>
                        <span>·</span>
                        <span className={isSel ? 'text-amber-300' : pr.tone}>{pr.label}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
                    {/* Columna derecha: Detalle del ticket y resolución técnica */}
          <div className="xl:col-span-7">
            {!selectedTicket ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
                Selecciona una solicitud de la bandeja para revisar su información y registrar el diagnóstico técnico.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Cabecera del caso */}
                <div className="p-5 border-b border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {selectedTicket.ticket_number}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-600">
                        {CATEGORY_LABELS[selectedTicket.category] || selectedTicket.category}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className={`font-semibold ${STATUS_LABELS[selectedTicket.status].tone}`}>
                        {STATUS_LABELS[selectedTicket.status].label}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono tabular-nums">
                      {fmtDateTime(selectedTicket.created_at)}
                    </span>
                  </div>

                  <h2 className="text-base sm:text-lg font-bold text-slate-900">
                    {selectedTicket.subject}
                  </h2>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                    <span>
                      Empresa: <strong className="text-slate-800">{selectedTicket.company_name || 'Sin nombre comercial'}</strong>
                    </span>
                    <span className="text-slate-300">·</span>
                    <span>
                      Usuario: <strong className="text-slate-800">{selectedTicket.user_name}</strong> ({selectedTicket.user_email})
                    </span>
                    <span className="text-slate-300">·</span>
                    <span>Rol: {getRoleLabel(selectedTicket.user_role)}</span>
                  </div>

                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3.5 leading-relaxed">
                    {selectedTicket.description}
                  </p>
                </div>

                {/* Estado de autorización: informativo, no habilita inspección */}
                <div className="p-5 border-b border-slate-200 space-y-3">
                  {isSessionAuthorizationActive(selectedTicket) ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                          <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>Consentimiento registrado en el ticket</span>
                        </div>
                        <span className="font-mono text-xs font-semibold text-amber-800 tabular-nums">
                          Código {selectedTicket.authorization_code || 'AUT-REGISTRADO'} ·{' '}
                          {formatRemainingTime(selectedTicket.authorized_until)}
                        </span>
                      </div>

                      <p className="text-xs text-amber-900">
                        Alcance solicitado por el usuario:{' '}
                        <strong>
                          {selectedTicket.authorization_scope === 'intervencion_asistida'
                            ? 'Diagnóstico y corrección asistida'
                            : 'Lectura y diagnóstico técnico'}
                        </strong>
                        {selectedTicket.authorized_until
                          ? ` · Vence ${fmtDateTime(selectedTicket.authorized_until)}`
                          : ''}
                      </p>

                      {selectedTicket.session_snapshot && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 border-t border-amber-200/70 text-xs">
                          <div>
                            <span className="text-amber-800 block">Pantalla reportada</span>
                            <strong className="text-slate-900">
                              {selectedTicket.session_snapshot.active_page_label}
                            </strong>
                          </div>
                          <div>
                            <span className="text-amber-800 block">Bodega / Sede activa</span>
                            <strong className="text-slate-900">
                              {selectedTicket.session_snapshot.warehouse_name || 'Principal'}
                            </strong>
                          </div>
                          <div>
                            <span className="text-amber-800 block">Entorno cliente</span>
                            <strong className="text-slate-900">
                              {selectedTicket.session_snapshot.platform || 'Web'} ·{' '}
                              {selectedTicket.session_snapshot.currency || 'USD'}
                            </strong>
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-amber-300 bg-white p-3 text-xs text-amber-950">
                        <strong>Inspección de datos protegida.</strong>
                        <p className="mt-1">
                          Aunque un ticket tenga autorización, esta no concede por sí sola acceso a los datos de la empresa. La inspección directa permanece deshabilitada hasta integrar y verificar el permiso en las políticas RLS de cada tabla operativa.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                      <ShieldAlert className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                      <div className="text-xs text-slate-600 space-y-1">
                        <p className="font-semibold text-slate-800">
                          {selectedTicket.revoked_at
                            ? 'El usuario revocó la autorización de sesión'
                            : selectedTicket.authorized_until
                              ? 'La autorización temporal de sesión expiró'
                              : 'Solicitud sin autorización de sesión activa'}
                        </p>
                        <p>
                          Puedes responder y orientar al usuario desde este panel. No se permite inspeccionar datos privados desde esta pantalla.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Formulario de Diagnóstico y Solución Técnica */}
                <form onSubmit={handleSaveTechnicalUpdate} className="p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-slate-500" />
                      Registro técnico de diagnóstico y solución
                    </h3>
                    {selectedTicket.assigned_name && (
                      <span className="text-xs text-slate-500">
                        Responsable actual: <strong className="text-slate-700">{selectedTicket.assigned_name}</strong>
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Estado de la solicitud
                      </label>
                      <select
                        value={techStatus}
                        onChange={e => setTechStatus(e.target.value as SupportTicketStatus)}
                        className={inputCls}
                      >
                        <option value="pendiente">Pendiente de revisión</option>
                        <option value="en_revision">En revisión técnica</option>
                        <option value="resuelto">Resuelto · Solución aplicada</option>
                        <option value="cerrado">Cerrado definitivamente</option>
                      </select>
                    </div>

                    <div className="flex items-end">
                      <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          Última actualización: {fmtDateTime(selectedTicket.updated_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Diagnóstico técnico identificado
                    </label>
                    <textarea
                      rows={2}
                      value={techDiagnosis}
                      onChange={e => setTechDiagnosis(e.target.value)}
                      placeholder="Ej. Se verificó configuración de bodega activa / pendiente mayorización de comprobante..."
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Solución aplicada e instrucciones para el usuario
                    </label>
                    <textarea
                      rows={3}
                      value={techResolution}
                      onChange={e => setTechResolution(e.target.value)}
                      placeholder="Describe cómo quedó solventada la situación para que el usuario lo visualice en su historial..."
                      className={inputCls}
                    />
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                    {techStatus !== 'resuelto' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setTechStatus('resuelto')
                        }}
                        className="px-3.5 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                      >
                        Preseleccionar Resuelto
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {busy ? 'Guardando...' : 'Guardar gestión técnica'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      <SqlActivationModal
        open={sqlModalOpen}
        onClose={() => setSqlModalOpen(false)}
        initialBundle="support_cpa"
      />
    </div>
  )
}
