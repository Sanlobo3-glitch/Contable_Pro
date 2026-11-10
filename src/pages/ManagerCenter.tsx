import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Briefcase,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Package,
  Layers,
  FileText,
  Bell,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Printer,
  Plus,
  RefreshCw,
  Search,
  Filter,
  Check,
  ChevronRight,
  ShieldAlert,
  Calendar,
  Building2,
  PieChart,
  ShoppingBag,
  Award,
  ArrowRight,
  Activity,
  AlertCircle,
  HelpCircle,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtDateTime } from '../lib/currency'
import {
  managerService,
  type ExecutiveOverviewData,
} from '../services/managerService'
import type {
  ManagerApprovalRequest,
  ManagerActionPlan,
  ManagerEmployeeEvaluation,
  ApprovalRequestStatus,
  ApprovalRequestType,
  ActionPlanStatus,
  ActionPlanPriority,
  ActionPlanArea,
  EmployeeIncidentType,
} from '../types'

interface ManagerCenterProps {
  pageId?: string
  initialTab?: string
  onNavigate?: (page: string) => void
}

export const TAB_TO_PAGE_ID: Record<string, string> = {
  resumen: 'manager_summary',
  comercial: 'manager_commercial',
  operaciones: 'manager_operations',
  financiera: 'manager_financial',
  talento: 'manager_hr',
  autorizaciones: 'manager_authorizations',
  planes: 'manager_action_plans',
  inteligencia: 'manager_intelligence',
  informes: 'manager_reports',
  notificaciones: 'manager_notifications',
}

export const PAGE_ID_TO_TAB: Record<string, string> = {
  manager_center: 'resumen',
  manager_summary: 'resumen',
  manager_commercial: 'comercial',
  manager_operations: 'operaciones',
  manager_financial: 'financiera',
  manager_hr: 'talento',
  manager_authorizations: 'autorizaciones',
  manager_action_plans: 'planes',
  manager_intelligence: 'inteligencia',
  manager_reports: 'informes',
  manager_notifications: 'notificaciones',
}

export default function ManagerCenter({ pageId, initialTab = 'resumen', onNavigate }: ManagerCenterProps) {
  const { user, isDemo } = useAuth()
  const { fmt } = useCurrency()

  const resolvedTab = pageId ? (PAGE_ID_TO_TAB[pageId] || initialTab) : initialTab
  const [activeTab, setActiveTab] = useState<string>(resolvedTab)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [overview, setOverview] = useState<ExecutiveOverviewData | null>(null)

  // Submódulos interactivos
  const [approvals, setApprovals] = useState<ManagerApprovalRequest[]>([])
  const [actionPlans, setActionPlans] = useState<ManagerActionPlan[]>([])
  const [evaluations, setEvaluations] = useState<ManagerEmployeeEvaluation[]>([])

  // Filtros de Autorizaciones
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<'todas' | ApprovalRequestStatus>('todas')
  const [approvalSearch, setApprovalSearch] = useState('')

  // Filtros de Planes de Acción
  const [planStatusFilter, setPlanStatusFilter] = useState<'todos' | ActionPlanStatus | 'atrasado'>('todos')
  const [planAreaFilter, setPlanAreaFilter] = useState<string>('todas')
  const [planSearch, setPlanSearch] = useState('')

  // Filtros de Talento Humano
  const [evalSearch, setEvalSearch] = useState('')
  const [evalScoreFilter, setEvalScoreFilter] = useState<'todos' | 'alto' | 'medio' | 'atencion'>('todos')

  // Filtros de Operaciones
  const [stockFilter, setStockFilter] = useState<'todos' | 'agotados' | 'bajo_minimo' | 'inmovilizado'>('todos')
  const [stockSearch, setStockSearch] = useState('')

  // Filtros de Inteligencia
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<'todas' | 'alta' | 'media'>('todas')

  // Modales y formularios
  const [decisionModal, setDecisionModal] = useState<{
    id: string
    action: ApprovalRequestStatus
    title: string
  } | null>(null)
  const [decisionNotes, setDecisionNotes] = useState('')

  const [newApprovalModal, setNewApprovalModal] = useState(false)
  const [newApprovalData, setNewApprovalData] = useState({
    title: '',
    description: '',
    request_type: 'compra' as ApprovalRequestType,
    amount: 0,
    justification: '',
    document_reference: '',
  })

  const [newPlanModal, setNewPlanModal] = useState(false)
  const [newPlanData, setNewPlanData] = useState({
    title: '',
    objective: '',
    area: 'operaciones' as ActionPlanArea,
    assigned_to_name: '',
    priority: 'alta' as ActionPlanPriority,
    kpi_target: '',
    due_date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
  })

  const [newEvalModal, setNewEvalModal] = useState(false)
  const [newEvalData, setNewEvalData] = useState({
    employee_id: '',
    employee_name: '',
    evaluation_period: 'Noviembre 2026',
    score: 4.5,
    strengths: '',
    areas_for_improvement: '',
    commitments: '',
    incident_type: 'evaluacion_periodica' as EmployeeIncidentType,
  })

  const [reportType, setReportType] = useState<
    'diario' | 'semanal' | 'mensual' | 'comercial' | 'financiero' | 'operativo'
  >('mensual')
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null)

  const showFeedback = (text: string, ok = true) => {
    setFeedback({ text, ok })
    setTimeout(() => setFeedback(null), 4000)
  }

  // Cargar datos
  const loadData = useCallback(async () => {
    try {
      const ov = await managerService.getExecutiveOverview(user?.company_id || undefined)
      setOverview(ov)
      const apps = await managerService.getApprovalRequests(user?.company_id || undefined)
      setApprovals(apps)
      const plans = await managerService.getActionPlans(user?.company_id || undefined)
      setActionPlans(plans)
      const evs = await managerService.getEmployeeEvaluations(user?.company_id || undefined)
      setEvaluations(evs)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user?.company_id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    const nextTab = pageId ? (PAGE_ID_TO_TAB[pageId] || initialTab) : initialTab
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab)
    }
  }, [pageId, initialTab])

  const handleTabChange = (newTabId: string) => {
    setActiveTab(newTabId)
    const pageTarget = TAB_TO_PAGE_ID[newTabId]
    if (pageTarget && onNavigate) {
      onNavigate(pageTarget)
    }
  }

  // Contadores de badges
  const pendingApprovalsCount = useMemo(
    () => approvals.filter(a => a.status === 'pendiente').length,
    [approvals]
  )
  const activePlansCount = useMemo(
    () => actionPlans.filter(p => p.status === 'pendiente' || p.status === 'en_ejecucion').length,
    [actionPlans]
  )
  const activeAlertsCount = useMemo(
    () => (overview?.smartAlerts || []).filter(a => a.status === 'activa').length,
    [overview?.smartAlerts]
  )

  // Acciones de Autorización
  const handleConfirmDecision = async () => {
    if (!decisionModal) return
    const updated = await managerService.decideApprovalRequest(
      decisionModal.id,
      decisionModal.action,
      user?.full_name || 'Gerente Operativo',
      decisionNotes.trim() || 'Dictamen gerencial registrado',
      user?.company_id || undefined
    )
    setApprovals(updated)
    setDecisionModal(null)
    setDecisionNotes('')
    showFeedback(`Solicitud ${decisionModal.action.toUpperCase()} correctamente`)
  }

  // Crear Solicitud de Autorización
  const handleCreateApprovalRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newApprovalData.title.trim() || !newApprovalData.justification.trim()) {
      showFeedback('Por favor completa el título y la justificación de la solicitud', false)
      return
    }

    const created = await managerService.createApprovalRequest({
      company_id: user?.company_id || 'default',
      title: newApprovalData.title.trim(),
      description: newApprovalData.description.trim() || newApprovalData.title.trim(),
      request_type: newApprovalData.request_type,
      amount: Number(newApprovalData.amount) || 0,
      currency: 'COP',
      justification: newApprovalData.justification.trim(),
      document_reference: newApprovalData.document_reference.trim() || null,
      requester_name: user?.full_name || 'Gerente Operativo',
      requester_role: user?.role || 'gerente',
    })

    setApprovals(prev => [created, ...prev])
    setNewApprovalModal(false)
    setNewApprovalData({
      title: '',
      description: '',
      request_type: 'compra',
      amount: 0,
      justification: '',
      document_reference: '',
    })
    showFeedback('Solicitud de autorización registrada con éxito')
  }

  // Crear Plan de Acción
  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPlanData.title.trim() || !newPlanData.assigned_to_name.trim()) {
      showFeedback('Por favor completa el título y el responsable asignado', false)
      return
    }

    const created = await managerService.createActionPlan({
      company_id: user?.company_id || 'default',
      title: newPlanData.title.trim(),
      objective: newPlanData.objective.trim() || newPlanData.title.trim(),
      area: newPlanData.area,
      assigned_to_name: newPlanData.assigned_to_name.trim(),
      priority: newPlanData.priority,
      kpi_target: newPlanData.kpi_target.trim(),
      due_date: newPlanData.due_date,
      progress_percent: 0,
      status: 'pendiente',
      created_by_name: user?.full_name || 'Gerente',
    })

    setActionPlans(prev => [created, ...prev])
    setNewPlanModal(false)
    setNewPlanData({
      title: '',
      objective: '',
      area: 'operaciones',
      assigned_to_name: '',
      priority: 'alta',
      kpi_target: '',
      due_date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
    })
    showFeedback('Plan de acción registrado con éxito')
  }

  // Actualizar avance de Plan
  const handleUpdatePlanProgress = async (id: string, progress: number, st: ActionPlanStatus) => {
    const updated = await managerService.updateActionPlanProgress(id, progress, st)
    setActionPlans(updated)
    showFeedback('Avance del plan actualizado')
  }

  // Registrar Evaluación de Talento
  const handleCreateEvaluation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEvalData.employee_name.trim()) {
      showFeedback('Por favor indica el nombre del colaborador', false)
      return
    }

    const created = await managerService.createEmployeeEvaluation({
      company_id: user?.company_id || 'default',
      employee_id: `emp-${Date.now()}`,
      employee_name: newEvalData.employee_name.trim(),
      evaluator_name: user?.full_name || 'Gerente General',
      evaluation_period: newEvalData.evaluation_period,
      score: Number(newEvalData.score) || 5,
      strengths: newEvalData.strengths.trim(),
      areas_for_improvement: newEvalData.areas_for_improvement.trim(),
      commitments: newEvalData.commitments.trim(),
      incident_type: newEvalData.incident_type,
    })

    setEvaluations(prev => [created, ...prev])
    setNewEvalModal(false)
    setNewEvalData({
      employee_id: '',
      employee_name: '',
      evaluation_period: 'Noviembre 2026',
      score: 4.5,
      strengths: '',
      areas_for_improvement: '',
      commitments: '',
      incident_type: 'evaluacion_periodica',
    })
    showFeedback('Evaluación registrada en el expediente gerencial')
  }

  const generatedReport = useMemo(() => {
    if (!overview) return null
    return managerService.generateExecutiveReport(
      reportType,
      overview,
      user?.company_name || 'InventarioPro Enterprise'
    )
  }, [overview, reportType, user?.company_name])

  // Listas filtradas para cada submódulo
  const filteredApprovals = useMemo(() => {
    return approvals.filter(req => {
      const matchStatus = approvalStatusFilter === 'todas' || req.status === approvalStatusFilter
      const term = approvalSearch.toLowerCase().trim()
      const matchSearch =
        !term ||
        req.title.toLowerCase().includes(term) ||
        req.requester_name.toLowerCase().includes(term) ||
        (req.document_reference && req.document_reference.toLowerCase().includes(term))
      return matchStatus && matchSearch
    })
  }, [approvals, approvalStatusFilter, approvalSearch])

  const filteredPlans = useMemo(() => {
    return actionPlans.filter(p => {
      const isOverdue =
        p.status !== 'completado' &&
        p.status !== 'cancelado' &&
        new Date(p.due_date).getTime() < Date.now()
      const matchStatus =
        planStatusFilter === 'todos' ||
        (planStatusFilter === 'atrasado' ? isOverdue : p.status === planStatusFilter)
      const matchArea = planAreaFilter === 'todas' || p.area === planAreaFilter
      const term = planSearch.toLowerCase().trim()
      const matchSearch =
        !term ||
        p.title.toLowerCase().includes(term) ||
        p.assigned_to_name.toLowerCase().includes(term) ||
        p.objective.toLowerCase().includes(term)
      return matchStatus && matchArea && matchSearch
    })
  }, [actionPlans, planStatusFilter, planAreaFilter, planSearch])

  const filteredEvaluations = useMemo(() => {
    return evaluations.filter(ev => {
      const matchScore =
        evalScoreFilter === 'todos' ||
        (evalScoreFilter === 'alto' && ev.score >= 4.5) ||
        (evalScoreFilter === 'medio' && ev.score >= 3.5 && ev.score < 4.5) ||
        (evalScoreFilter === 'atencion' && ev.score < 3.5)
      const term = evalSearch.toLowerCase().trim()
      const matchSearch =
        !term ||
        ev.employee_name.toLowerCase().includes(term) ||
        ev.evaluator_name.toLowerCase().includes(term)
      return matchScore && matchSearch
    })
  }, [evaluations, evalScoreFilter, evalSearch])

  const filteredAlerts = useMemo(() => {
    return (overview?.smartAlerts || []).filter(alt => {
      return alertSeverityFilter === 'todas' || alt.severity === alertSeverityFilter
    })
  }, [overview?.smartAlerts, alertSeverityFilter])

  const SCREEN_CONFIG: Record<
    string,
    {
      title: string
      subtitle: string
      breadcrumb: string
      icon: any
      badgeCount?: number
    }
  > = {
    resumen: {
      title: 'CENTRO DE DIRECCIÓN GERENCIAL — RESUMEN EJECUTIVO',
      subtitle: 'Dirección estratégica, supervisión empresarial y control integral de operaciones.',
      breadcrumb: '1. Resumen Ejecutivo & Pulso General',
      icon: Briefcase,
    },
    comercial: {
      title: 'DIRECCIÓN COMERCIAL & FUERZA DE VENTAS',
      subtitle: 'Monitoreo de ingresos comerciales, ranking de asesores, ticket promedio y mezcla de canales de recaudo.',
      breadcrumb: '2. Dirección Comercial',
      icon: TrendingUp,
    },
    operaciones: {
      title: 'DIRECCIÓN DE OPERACIONES, LOGÍSTICA & STOCK',
      subtitle: 'Supervisión de quiebres de inventario (Stock 0), alertas de stock bajo mínimo y valorización de stock inmovilizado.',
      breadcrumb: '3. Operaciones & Stock',
      icon: Package,
    },
    financiera: {
      title: 'DIRECCIÓN FINANCIERA & CONTROL DE GESTIÓN',
      subtitle: 'Estado de Resultados Gerencial (P&G), margen de contribución operativo y envejecimiento de cartera (Aging).',
      breadcrumb: '4. Dirección Financiera',
      icon: DollarSign,
    },
    talento: {
      title: 'DIRECCIÓN DEL TALENTO HUMANO & PRODUCTIVIDAD',
      subtitle: 'Expediente gerencial, evaluaciones periódicas de desempeño, matriz de competencias, fortalezas y planes de mejora.',
      breadcrumb: '5. Talento Humano',
      icon: Users,
    },
    autorizaciones: {
      title: 'CENTRO DE AUTORIZACIONES & DICTAMEN GERENCIAL',
      subtitle: 'Bandeja de decisiones: Compras excepcionales, gastos fuera de presupuesto, descuentos comerciales y bajas de inventario.',
      breadcrumb: '6. Centro de Autorizaciones',
      icon: CheckCircle2,
      badgeCount: pendingApprovalsCount,
    },
    planes: {
      title: 'PLANES DE ACCIÓN & OBJETIVOS ESTRATÉGICOS',
      subtitle: 'Gestión por objetivos, asignación de responsables, metas KPI, seguimiento porcentual y control de atrasos.',
      breadcrumb: '7. Planes de Acción',
      icon: Layers,
      badgeCount: activePlansCount,
    },
    inteligencia: {
      title: 'INTELIGENCIA EMPRESARIAL & MATRIZ DE RIESGOS',
      subtitle: 'Diagnóstico cuantitativo determinista en 4 fases: Hallazgo, Información numérica, Riesgo representado y Acción correctiva.',
      breadcrumb: '8. Inteligencia & Riesgos',
      icon: Sparkles,
      badgeCount: activeAlertsCount,
    },
    informes: {
      title: 'INFORMES EJECUTIVOS & REPORTES DE GESTIÓN',
      subtitle: 'Generador de informes consolidados de gestión (diario, semanal, mensual, comercial, financiero, operativo) listos para exportar a PDF o imprimir.',
      breadcrumb: '9. Informes Gerenciales',
      icon: FileText,
    },
    notificaciones: {
      title: 'NOTIFICACIONES & ALERTAS GERENCIALES',
      subtitle: 'Centro consolidado de avisos operativos, vencimientos críticos y alertas preventivas de la empresa.',
      breadcrumb: '10. Notificaciones',
      icon: Bell,
    },
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin text-slate-400 mb-3" />
        <p className="text-sm font-medium">Cargando Centro de Dirección Gerencial…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* HEADER DINÁMICO SEGÚN PANTALLA GERENCIAL ACTIVA */}
      {(() => {
        const currentTabConfig = SCREEN_CONFIG[activeTab] || SCREEN_CONFIG.resumen
        const isOverview = activeTab === 'resumen'
        const IconComponent = currentTabConfig.icon

        return (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            {/* BREADCRUMB Y RETORNO RÁPIDO */}
            <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100 text-xs">
              <div className="flex items-center gap-1.5 text-slate-500">
                <span className="font-semibold text-slate-700">Dirección Gerencial</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-bold text-slate-900">{currentTabConfig.breadcrumb}</span>
              </div>

              {!isOverview && (
                <button
                  onClick={() => handleTabChange('resumen')}
                  className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-semibold text-xs transition-colors bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md"
                >
                  <span>← Volver al Tablero General</span>
                </button>
              )}
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="p-2.5 rounded-xl bg-slate-900 text-white shrink-0 mt-0.5 shadow-xs">
                  <IconComponent className="w-5 h-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                      {currentTabConfig.title}
                    </h1>
                    {typeof currentTabConfig.badgeCount === 'number' && currentTabConfig.badgeCount > 0 && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                        {currentTabConfig.badgeCount} pendientes
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1 font-medium">
                    {currentTabConfig.subtitle}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setRefreshing(true)
                    void loadData()
                  }}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  Actualizar datos
                </button>

                {activeTab === 'autorizaciones' && (
                  <button
                    onClick={() => setNewApprovalModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-xs font-semibold text-white shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nueva solicitud de autorización
                  </button>
                )}

                {activeTab === 'planes' && (
                  <button
                    onClick={() => setNewPlanModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nuevo plan de acción
                  </button>
                )}

                {activeTab === 'talento' && (
                  <button
                    onClick={() => setNewEvalModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Registrar evaluación
                  </button>
                )}

                {activeTab === 'informes' && (
                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white shadow-xs"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Imprimir / PDF
                  </button>
                )}

                {activeTab === 'comercial' && onNavigate && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onNavigate('pos')}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
                    >
                      Mostrador (POS)
                    </button>
                    <button
                      onClick={() => onNavigate('sales')}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white"
                    >
                      Historial de ventas
                    </button>
                  </div>
                )}

                {activeTab === 'operaciones' && onNavigate && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onNavigate('products')}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
                    >
                      Catálogo productos
                    </button>
                    <button
                      onClick={() => onNavigate('purchases')}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white"
                    >
                      Gestión compras
                    </button>
                  </div>
                )}

                {activeTab === 'financiera' && onNavigate && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onNavigate('cartera')}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
                    >
                      Cartera (CxC)
                    </button>
                    <button
                      onClick={() => onNavigate('treasury')}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white"
                    >
                      Tesorería & Flujo
                    </button>
                  </div>
                )}

                {isOverview && (
                  <button
                    onClick={() => setNewPlanModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nuevo plan de acción
                  </button>
                )}
              </div>
            </div>

            {/* BARRA DE PULSO EJECUTIVO RÁPIDO (Se muestra en Resumen General) */}
            {isOverview && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-5 border-t border-slate-100">
                <div>
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Ventas de Hoy</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                    {fmt(overview?.salesToday || 0)}
                  </p>
                  <p className="text-[10px] text-slate-500">{overview?.salesTodayCount || 0} operaciones</p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Ventas del Mes</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                    {fmt(overview?.salesThisMonth || 0)}
                  </p>
                  <p
                    className={`text-[10px] font-semibold flex items-center gap-0.5 ${
                      (overview?.monthGrowthPercent || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {(overview?.monthGrowthPercent || 0) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {overview?.monthGrowthPercent || 0}% vs mes ant.
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Utilidad Bruta (Mes)</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                    {fmt(overview?.grossProfitMonth || 0)}
                  </p>
                  <p className="text-[10px] text-slate-500">Margen real ~{overview?.grossMarginPercent || 0}%</p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Caja Cobrada</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                    {fmt(overview?.cashCollectedMonth || 0)}
                  </p>
                  <p className="text-[10px] text-slate-500">Efectivo / Transferencias</p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Cartera Total</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                    {fmt(overview?.pendingReceivables || 0)}
                  </p>
                  <p
                    className={`text-[10px] font-semibold ${
                      (overview?.overdueReceivables || 0) > 0 ? 'text-amber-700' : 'text-slate-500'
                    }`}
                  >
                    Vencida: {fmt(overview?.overdueReceivables || 0)}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Autorizaciones</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                    {pendingApprovalsCount} pendientes
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {activePlansCount} planes activos
                  </p>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* FEEDBACK BANNER */}
      {feedback && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            feedback.ok
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {feedback.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* BARRA DE NAVEGACIÓN ENTRE PANTALLAS (10 MÓDULOS GERENCIALES) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200">
        {[
          { id: 'resumen', label: '1. Resumen Ejecutivo' },
          { id: 'comercial', label: '2. Dirección Comercial' },
          { id: 'operaciones', label: '3. Operaciones & Stock' },
          { id: 'financiera', label: '4. Dirección Financiera' },
          { id: 'talento', label: '5. Talento Humano' },
          {
            id: 'autorizaciones',
            label: '6. Autorizaciones',
            badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
          },
          {
            id: 'planes',
            label: '7. Planes de Acción',
            badge: activePlansCount > 0 ? activePlansCount : undefined,
          },
          {
            id: 'inteligencia',
            label: '8. Inteligencia & Riesgos',
            badge: activeAlertsCount > 0 ? activeAlertsCount : undefined,
          },
          { id: 'informes', label: '9. Informes Gerenciales' },
          { id: 'notificaciones', label: '10. Notificaciones' },
        ].map(t => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                active
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {t.label}
              {typeof t.badge === 'number' && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    active ? 'bg-amber-400 text-slate-900' : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* CONTENIDO DEL MÓDULO SELECCIONADO */}

      {/* ===================================================================== */}
      {/* MÓDULO 1: RESUMEN EJECUTIVO — MI EMPRESA */}
      {/* ===================================================================== */}
      {activeTab === 'resumen' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Salud Operativa del Negocio</span>
                <Activity className="w-4 h-4 text-emerald-600" />
              </h3>
              <div className="mt-4 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Ventas hoy vs ritmo típico:</span>
                  <span className="font-semibold text-slate-900">
                    {overview?.salesTodayCount || 0} facturas emitidas
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Facturación acumulada (Mes):</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {fmt(overview?.salesThisMonth || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Margen bruto proyectado:</span>
                  <span className="font-semibold text-emerald-700">
                    ~{overview?.grossMarginPercent || 0}% de rentabilidad
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Gastos operativos reportados:</span>
                  <span className="font-semibold text-rose-700 tabular-nums">
                    {fmt(overview?.operatingExpensesMonth || 0)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Flujo de Fondos & Cartera</span>
                <DollarSign className="w-4 h-4 text-indigo-600" />
              </h3>
              <div className="mt-4 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Efectivo / Transferencias cobradas:</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {fmt(overview?.cashCollectedMonth || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Cartera vigente (&lt;30 días):</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {fmt((overview?.pendingReceivables || 0) - (overview?.overdueReceivables || 0))}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Cartera vencida (&gt;30 días):</span>
                  <span className="font-bold text-amber-700 tabular-nums">
                    {fmt(overview?.overdueReceivables || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Estimación de cuentas por pagar:</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {fmt(overview?.pendingPayables || 0)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Inventario & Almacén</span>
                <Package className="w-4 h-4 text-amber-600" />
              </h3>
              <div className="mt-4 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Valoración total a costo:</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {fmt(overview?.inventoryValuationCost || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Valoración potencial de venta:</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {fmt(overview?.inventoryValuationRetail || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Productos con quiebre (Stock 0):</span>
                  <span className={`font-bold ${overview?.outOfStockCount ? 'text-rose-700' : 'text-slate-900'}`}>
                    {overview?.outOfStockCount || 0} referencias
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600">Productos bajo stock mínimo:</span>
                  <span className="font-semibold text-amber-700">
                    {overview?.lowStockCount || 0} referencias
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* TABLERO DE ACCIÓN GERENCIAL INMEDIATA */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-slate-700" />
              Diagnóstico Gerencial del Día: ¿Cómo está funcionando mi empresa hoy?
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <p className="font-semibold text-slate-900">Rendimiento Comercial</p>
                <p className="text-slate-600 mt-1">
                  {(overview?.monthGrowthPercent || 0) >= 0
                    ? `Crecimiento positivo de +${overview?.monthGrowthPercent}% respecto al mes anterior.`
                    : `Ritmo inferior en ${overview?.monthGrowthPercent}% frente al mes precedente.`}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <p className="font-semibold text-slate-900">Liquidez & Cobranza</p>
                <p className="text-slate-600 mt-1">
                  Se ha recaudado el{' '}
                  {overview?.salesThisMonth
                    ? Math.round(((overview.cashCollectedMonth || 0) / overview.salesThisMonth) * 100)
                    : 100}
                  % de la facturación en medios inmediatos.
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <p className="font-semibold text-slate-900">Eficiencia en Almacén</p>
                <p className="text-slate-600 mt-1">
                  {overview?.outOfStockCount === 0
                    ? 'Catálogo con abastecimiento pleno; sin referencias en quiebre.'
                    : `Atención: ${overview?.outOfStockCount} productos requieren reabastecimiento urgente.`}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <p className="font-semibold text-slate-900">Gobernanza & Tareas</p>
                <p className="text-slate-600 mt-1">
                  {pendingApprovalsCount} autorizaciones pendientes y {activePlansCount} planes de acción activos.
                </p>
              </div>
            </div>
          </div>

          {/* DIRECTORIO OPERATIVO DE DIRECCIÓN — 9 PANTALLAS ESPECIALIZADAS */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-slate-800" />
                  Directorio de Dirección y Supervisión — 9 Pantallas Especializadas
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Haz clic en cualquier tarjeta para abrir su pantalla con todas las herramientas y lógica operativa.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {/* 2. Comercial */}
              <div
                onClick={() => handleTabChange('comercial')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-blue-50 text-blue-700">
                      <TrendingUp className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 2</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">2. Dirección Comercial</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Ventas, ranking de asesores y radar de clientes.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{fmt(overview?.salesThisMonth || 0)}</span>
                  <span className="text-blue-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 3. Operaciones */}
              <div
                onClick={() => handleTabChange('operaciones')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-amber-50 text-amber-700">
                      <Package className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 3</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">3. Dirección de Operaciones</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Quiebres de stock, reposición y mercancía inmovilizada.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className={`font-semibold ${overview?.outOfStockCount ? 'text-rose-600' : 'text-slate-800'}`}>
                    {overview?.outOfStockCount || 0} en quiebre
                  </span>
                  <span className="text-amber-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 4. Financiera */}
              <div
                onClick={() => handleTabChange('financiera')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
                      <DollarSign className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 4</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">4. Dirección Financiera</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Estado de Resultados (P&G), margen y cartera vencida.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-700">Utilidad: {fmt(overview?.grossProfitMonth || 0)}</span>
                  <span className="text-emerald-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 5. Talento Humano */}
              <div
                onClick={() => handleTabChange('talento')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-purple-50 text-purple-700">
                      <Users className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 5</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">5. Talento Humano</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Evaluaciones de desempeño, fortalezas y compromisos.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{evaluations.length} evaluados</span>
                  <span className="text-purple-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 6. Autorizaciones */}
              <div
                onClick={() => handleTabChange('autorizaciones')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-rose-50 text-rose-700">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 6</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">6. Centro de Autorizaciones</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Dictamen de compras, gastos y excepciones comerciales.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-700">{pendingApprovalsCount} por dictaminar</span>
                  <span className="text-rose-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 7. Planes de Acción */}
              <div
                onClick={() => handleTabChange('planes')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-indigo-50 text-indigo-700">
                      <Layers className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 7</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">7. Planes de Acción</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Metas estratégicas, responsables y control de atrasos.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{activePlansCount} en ejecución</span>
                  <span className="text-indigo-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 8. Inteligencia & Riesgos */}
              <div
                onClick={() => handleTabChange('inteligencia')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-teal-50 text-teal-700">
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 8</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">8. Inteligencia & Riesgos</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Diagnósticos cuantitativos y mitigación de anomalías.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{activeAlertsCount} alertas activas</span>
                  <span className="text-teal-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 9. Informes Gerenciales */}
              <div
                onClick={() => handleTabChange('informes')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-slate-100 text-slate-700">
                      <FileText className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 9</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">9. Informes Gerenciales</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Emisión de informes consolidados para exportar a PDF.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">6 formatos listos</span>
                  <span className="text-slate-700 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* 10. Notificaciones */}
              <div
                onClick={() => handleTabChange('notificaciones')}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/60 transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-lg bg-amber-50 text-amber-700">
                      <Bell className="w-4 h-4" />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo 10</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-2.5">10. Notificaciones</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Alertas críticas, vencimientos y avisos de prevención.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">Consolidado general</span>
                  <span className="text-amber-600 font-semibold inline-flex items-center gap-0.5">
                    Abrir pantalla <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 2: DIRECCIÓN COMERCIAL */}
      {/* ===================================================================== */}
      {activeTab === 'comercial' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* RANKING DE VENDEDORES */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  Rendimiento y Ranking del Equipo de Ventas
                </h3>
                <span className="text-xs text-slate-500">Mes actual</span>
              </div>

              {overview?.topSellers && overview.topSellers.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {overview.topSellers.map((seller, idx) => (
                    <div key={idx} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{seller.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {seller.salesCount} ventas cerradas
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-slate-900 tabular-nums">
                          {fmt(seller.totalSold)}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Ticket prom: {fmt(seller.salesCount > 0 ? Math.round(seller.totalSold / seller.salesCount) : 0)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No se registran ventas asociadas a vendedores este mes.
                </p>
              )}
            </div>

            {/* RADAR DE CLIENTES */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                Comportamiento de la Cartera de Clientes
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-600">Clientes Nuevos (Mes):</span>
                  <span className="text-xs font-bold text-emerald-700">
                    +{overview?.newCustomersThisMonth || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-600">Clientes Activos (&lt;45d):</span>
                  <span className="text-xs font-bold text-slate-900">
                    {overview?.activeCustomersCount || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-600">Clientes Inactivos (&gt;45d):</span>
                  <span className="text-xs font-bold text-amber-700">
                    {overview?.inactiveCustomersCount || 0}
                  </span>
                </div>
              </div>

              <div className="mt-5 p-3 rounded-lg border border-indigo-100 bg-indigo-50/50 text-[11px] text-indigo-900">
                <p className="font-semibold">Recomendación Gerencial:</p>
                <p className="mt-0.5">
                  Hay {overview?.inactiveCustomersCount || 0} clientes sin compras en más de mes y medio. Asigna una ronda de visitas o reactivación por WhatsApp.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 3: DIRECCIÓN DE OPERACIONES */}
      {/* ===================================================================== */}
      {activeTab === 'operaciones' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ALERTA DE STOCK & AGOTADOS */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                <span>Riesgos de Abastecimiento & Stock Crítico</span>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Referencias que presentan quiebre o están por debajo de su margen de seguridad.
              </p>
              <div className="space-y-2">
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-rose-900">Productos Agotados (Stock 0)</p>
                    <p className="text-rose-700">{overview?.outOfStockCount || 0} referencias sin inventario</p>
                  </div>
                  <button
                    onClick={() => onNavigate?.('purchases')}
                    className="px-2.5 py-1 bg-white border border-rose-200 text-rose-900 text-[11px] font-semibold rounded-md hover:bg-rose-100"
                  >
                    Crear compra
                  </button>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-amber-900">Stock Mínimo Superado</p>
                    <p className="text-amber-700">{overview?.lowStockCount || 0} referencias en umbral de alerta</p>
                  </div>
                  <button
                    onClick={() => onNavigate?.('buyplan')}
                    className="px-2.5 py-1 bg-white border border-amber-200 text-amber-900 text-[11px] font-semibold rounded-md hover:bg-amber-100"
                  >
                    Ver sugerencia
                  </button>
                </div>
              </div>
            </div>

            {/* PRODUCTOS DE BAJA ROTACIÓN (DEAD STOCK) */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                <span>Inventario Inmovilizado (Capital Parado)</span>
                <Package className="w-4 h-4 text-slate-600" />
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Referencias con stock significativo que comprometen liquidez.
              </p>
              {overview?.deadStockProducts && overview.deadStockProducts.length > 0 ? (
                <div className="space-y-2">
                  {overview.deadStockProducts.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs p-2.5 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-semibold text-slate-900">{p.name}</p>
                        <p className="text-[10px] text-slate-500">SKU: {p.sku} · {p.stock} unidades</p>
                      </div>
                      <span className="font-bold text-slate-800 tabular-nums">
                        {fmt(p.cost)} costo
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">Sin stock inmovilizado detectado.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 4: DIRECCIÓN FINANCIERA */}
      {/* ===================================================================== */}
      {activeTab === 'financiera' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* P&G GERENCIAL */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-emerald-600" />
                Estado de Resultados Gerencial (Mes en curso)
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="font-semibold text-slate-700">Facturación Total (Ventas):</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {fmt(overview?.salesThisMonth || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100 text-slate-600">
                  <span>(-) Costo Estimado de Mercancía:</span>
                  <span className="tabular-nums">
                    {fmt((overview?.salesThisMonth || 0) - (overview?.grossProfitMonth || 0))}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-200 font-bold bg-slate-50 px-2 rounded">
                  <span className="text-slate-900">(=) Utilidad Bruta:</span>
                  <span className="text-emerald-700 tabular-nums">
                    {fmt(overview?.grossProfitMonth || 0)} (~{overview?.grossMarginPercent || 0}%)
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100 text-slate-600">
                  <span>(-) Gastos Operativos Totales:</span>
                  <span className="text-rose-700 tabular-nums">
                    {fmt(overview?.operatingExpensesMonth || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 font-bold bg-slate-900 text-white px-3 rounded-lg text-sm">
                  <span>(=) Utilidad Operativa Estimada:</span>
                  <span className="tabular-nums">
                    {fmt(overview?.operatingProfitMonth || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* ANTIGÜEDAD DE CARTERA */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                Antigüedad de Saldos por Cobrar (Aging)
              </h3>
              <div className="space-y-3">
                {overview?.agingBuckets.map((bucket, i) => (
                  <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">{bucket.bucket}</p>
                      <p className="text-[10px] text-slate-500">{bucket.count} saldos en este rango</p>
                    </div>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {fmt(bucket.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 5: DIRECCIÓN DEL TALENTO HUMANO */}
      {/* ===================================================================== */}
      {activeTab === 'talento' && (
        <div className="space-y-6">
          {/* TARJETAS RESUMEN DE TALENTO */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Colaboradores Evaluados</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{evaluations.length}</p>
              <p className="text-[10px] text-slate-500">Expedientes registrados</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-purple-800 uppercase tracking-wider">Promedio de Equipo</p>
              <p className="text-xl font-bold text-purple-900 mt-1">
                {evaluations.length > 0
                  ? (evaluations.reduce((acc, ev) => acc + ev.score, 0) / evaluations.length).toFixed(1)
                  : '5.0'} / 5.0
              </p>
              <p className="text-[10px] text-purple-700">Escala de desempeño</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-emerald-800 uppercase tracking-wider">Sobresalientes</p>
              <p className="text-xl font-bold text-emerald-900 mt-1">
                {evaluations.filter(ev => ev.score >= 4.5).length}
              </p>
              <p className="text-[10px] text-emerald-700">Calificación &ge; 4.5</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-amber-800 uppercase tracking-wider">En Mejora Continua</p>
              <p className="text-xl font-bold text-amber-900 mt-1">
                {evaluations.filter(ev => ev.score < 4.5).length}
              </p>
              <p className="text-[10px] text-amber-700">Con compromisos fijados</p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-600" />
                  Expediente de Desempeño y Novedades del Personal
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Registro confidencial de evaluaciones de colaboradores y compromisos de mejora.
                </p>
              </div>
              <button
                onClick={() => setNewEvalModal(true)}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Registrar evaluación
              </button>
            </div>

            {/* BARRA DE BÚSQUEDA Y FILTROS */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pt-3 border-t border-slate-100">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={evalSearch}
                  onChange={e => setEvalSearch(e.target.value)}
                  placeholder="Buscar por colaborador o evaluador..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {[
                  { id: 'todos', label: 'Todos' },
                  { id: 'alto', label: 'Sobresalientes (≥4.5)' },
                  { id: 'medio', label: 'Satisfactorios (3.5 - 4.4)' },
                  { id: 'atencion', label: 'Requiere Atención (<3.5)' },
                ].map(flt => (
                  <button
                    key={flt.id}
                    onClick={() => setEvalScoreFilter(flt.id as any)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition ${
                      evalScoreFilter === flt.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {flt.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredEvaluations.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {filteredEvaluations.map(ev => (
                  <div key={ev.id} className="py-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-900">{ev.employee_name}</p>
                        <p className="text-[11px] text-slate-500">
                          Periodo: {ev.evaluation_period} · Evaluador: {ev.evaluator_name}
                        </p>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">
                        Nota: {ev.score} / 5.0
                      </span>
                    </div>
                    {ev.strengths && (
                      <p className="text-xs text-slate-600">
                        <strong className="text-slate-800">Fortalezas:</strong> {ev.strengths}
                      </p>
                    )}
                    {ev.areas_for_improvement && (
                      <p className="text-xs text-slate-600">
                        <strong className="text-slate-800">Áreas de mejora:</strong> {ev.areas_for_improvement}
                      </p>
                    )}
                    {ev.commitments && (
                      <p className="text-xs text-indigo-700 bg-indigo-50/50 p-2 rounded border border-indigo-100">
                        <strong>Compromisos acordados:</strong> {ev.commitments}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">
                No hay evaluaciones registradas con los filtros seleccionados.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 6: CENTRO DE AUTORIZACIONES */}
      {/* ===================================================================== */}
      {activeTab === 'autorizaciones' && (
        <div className="space-y-6">
          {/* TARJETAS RESUMEN DE AUTORIZACIONES */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Solicitudes</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{approvals.length}</p>
              <p className="text-[10px] text-slate-500">Historial acumulado</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-amber-800 uppercase tracking-wider">Pendientes de Dictamen</p>
              <p className="text-xl font-bold text-amber-900 mt-1">{pendingApprovalsCount}</p>
              <p className="text-[10px] text-amber-700">Requieren tu decisión</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-emerald-800 uppercase tracking-wider">Aprobadas</p>
              <p className="text-xl font-bold text-emerald-900 mt-1">
                {approvals.filter(a => a.status === 'aprobada').length}
              </p>
              <p className="text-[10px] text-emerald-700">Autorizadas por gerencia</p>
            </div>
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-rose-800 uppercase tracking-wider">Rechazadas / Revisión</p>
              <p className="text-xl font-bold text-rose-900 mt-1">
                {approvals.filter(a => a.status === 'rechazada' || a.status === 'en_revision' || a.status === 'en_correccion').length}
              </p>
              <p className="text-[10px] text-rose-700">Con observaciones</p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Bandeja de Solicitudes y Dictámenes Gerenciales
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Compras excepcionales, gastos fuera de presupuesto, descuentos comerciales y bajas de inventario.
                </p>
              </div>

              <button
                onClick={() => setNewApprovalModal(true)}
                className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Nueva Solicitud
              </button>
            </div>

            {/* BARRA DE BÚSQUEDA Y FILTROS */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pt-3 border-t border-slate-100">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={approvalSearch}
                  onChange={e => setApprovalSearch(e.target.value)}
                  placeholder="Buscar por título, solicitante o referencia..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {(['todas', 'pendiente', 'aprobada', 'rechazada', 'en_correccion', 'en_revision'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setApprovalStatusFilter(st)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg capitalize whitespace-nowrap transition ${
                      approvalStatusFilter === st
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {st === 'todas' ? 'Todas' : st.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {filteredApprovals.length > 0 ? (
              <div className="space-y-4">
                {filteredApprovals.map(req => {
                  const isPending = req.status === 'pendiente'
                  return (
                    <div
                      key={req.id}
                      className={`p-4 rounded-xl border transition-colors ${
                        isPending
                          ? 'border-amber-200 bg-amber-50/20'
                          : req.status === 'aprobada'
                            ? 'border-emerald-200 bg-emerald-50/10'
                            : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-900 text-white">
                              {req.request_type.replace('_', ' ')}
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                req.status === 'pendiente'
                                  ? 'bg-amber-100 text-amber-800'
                                  : req.status === 'aprobada'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {req.status}
                            </span>
                            <span className="text-xs text-slate-400">
                              {fmtDateTime(req.created_at)}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-slate-900 mt-1">{req.title}</h4>
                          <p className="text-xs text-slate-600 mt-0.5">{req.description}</p>
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          {req.amount > 0 && (
                            <p className="text-base font-bold text-slate-900 tabular-nums">
                              {fmt(req.amount)}
                            </p>
                          )}
                          <p className="text-[11px] text-slate-500">
                            Solicitante: <strong className="text-slate-800">{req.requester_name}</strong> ({req.requester_role})
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 p-3 bg-white/80 rounded-lg border border-slate-100 text-xs text-slate-700">
                        <strong>Justificación:</strong> {req.justification}
                        {req.document_reference && (
                          <span className="ml-2 text-slate-500 font-mono">
                            Ref: {req.document_reference}
                          </span>
                        )}
                      </div>

                      {/* Botones de acción directa si está pendiente */}
                      {isPending ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                          <button
                            onClick={() =>
                              setDecisionModal({
                                id: req.id,
                                action: 'aprobada',
                                title: req.title,
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Aprobar solicitud
                          </button>
                          <button
                            onClick={() =>
                              setDecisionModal({
                                id: req.id,
                                action: 'rechazada',
                                title: req.title,
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Rechazar
                          </button>
                          <button
                            onClick={() =>
                              setDecisionModal({
                                id: req.id,
                                action: 'en_correccion',
                                title: req.title,
                              })
                            }
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium"
                          >
                            Solicitar corrección
                          </button>
                          <button
                            onClick={() =>
                              setDecisionModal({
                                id: req.id,
                                action: 'en_revision',
                                title: req.title,
                              })
                            }
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium"
                          >
                            Devolver para revisión
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 text-[11px] text-slate-500 flex items-center justify-between">
                          <span>
                            Dictaminado por: <strong className="text-slate-700">{req.manager_decision_name}</strong> el {fmtDateTime(req.decided_at || '')}
                          </span>
                          {req.manager_decision_notes && (
                            <span className="italic">"{req.manager_decision_notes}"</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">
                Bandeja limpia: no hay solicitudes pendientes de autorización gerencial.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 7: PLANES DE ACCIÓN GERENCIAL */}
      {/* ===================================================================== */}
      {activeTab === 'planes' && (
        <div className="space-y-6">
          {/* TARJETAS RESUMEN DE PLANES DE ACCIÓN */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Planes</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{actionPlans.length}</p>
              <p className="text-[10px] text-slate-500">Objetivos registrados</p>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-indigo-800 uppercase tracking-wider">En Ejecución</p>
              <p className="text-xl font-bold text-indigo-900 mt-1">
                {actionPlans.filter(p => p.status === 'en_ejecucion' || p.status === 'pendiente').length}
              </p>
              <p className="text-[10px] text-indigo-700">En avance activo</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-emerald-800 uppercase tracking-wider">Completados</p>
              <p className="text-xl font-bold text-emerald-900 mt-1">
                {actionPlans.filter(p => p.status === 'completado').length}
              </p>
              <p className="text-[10px] text-emerald-700">Objetivo 100% alcanzado</p>
            </div>
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 shadow-xs">
              <p className="text-[11px] font-medium text-rose-800 uppercase tracking-wider">Atrasados</p>
              <p className="text-xl font-bold text-rose-900 mt-1">
                {actionPlans.filter(p => p.status !== 'completado' && p.status !== 'cancelado' && new Date(p.due_date).getTime() < Date.now()).length}
              </p>
              <p className="text-[10px] text-rose-700">Superaron fecha límite</p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  Planes de Acción y Objetivos Estratégicos
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Supervisión de metas, asignación de responsables y seguimiento porcentual de avances.
                </p>
              </div>
              <button
                onClick={() => setNewPlanModal(true)}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Crear plan de acción
              </button>
            </div>

            {/* BARRA DE BÚSQUEDA Y FILTROS */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pt-3 border-t border-slate-100">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={planSearch}
                  onChange={e => setPlanSearch(e.target.value)}
                  placeholder="Buscar objetivo, título o responsable..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={planAreaFilter}
                  onChange={e => setPlanAreaFilter(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                >
                  <option value="todas">Todas las áreas</option>
                  <option value="operaciones">Operaciones</option>
                  <option value="comercial">Comercial</option>
                  <option value="financiera">Financiera</option>
                  <option value="inventario">Inventario</option>
                  <option value="talento_humano">Talento Humano</option>
                  <option value="calidad">Calidad</option>
                  <option value="estrategica">Estratégica</option>
                </select>

                <div className="flex items-center gap-1 overflow-x-auto">
                  {(['todos', 'en_ejecucion', 'pendiente', 'atrasado', 'completado'] as const).map(st => (
                    <button
                      key={st}
                      onClick={() => setPlanStatusFilter(st)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg capitalize whitespace-nowrap transition ${
                        planStatusFilter === st
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {st === 'todos' ? 'Todos' : st.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {filteredPlans.length > 0 ? (
                filteredPlans.map(plan => {
                const isOverdue =
                  plan.status !== 'completado' &&
                  plan.status !== 'cancelado' &&
                  new Date(plan.due_date).getTime() < Date.now()

                return (
                  <div key={plan.id} className="p-4 rounded-xl border border-slate-200 bg-white">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                            {plan.area}
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                              plan.priority === 'critica'
                                ? 'bg-rose-100 text-rose-800'
                                : plan.priority === 'alta'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            Prioridad: {plan.priority}
                          </span>
                          {isOverdue && (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-rose-600 text-white">
                              Atrasado
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 mt-1">{plan.title}</h4>
                        <p className="text-xs text-slate-600 mt-0.5">{plan.objective}</p>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <p className="text-xs font-bold text-slate-900">{plan.assigned_to_name}</p>
                        <p className="text-[11px] text-slate-500">
                          Límite: <strong className="text-slate-700">{plan.due_date}</strong>
                        </p>
                      </div>
                    </div>

                    {/* BARRA DE PROGRESO */}
                    <div className="mt-4 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600">Avance reportado:</span>
                        <span className="font-bold text-slate-900">{plan.progress_percent}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            plan.progress_percent >= 100
                              ? 'bg-emerald-600'
                              : plan.progress_percent >= 50
                                ? 'bg-indigo-600'
                                : 'bg-amber-500'
                          }`}
                          style={{ width: `${plan.progress_percent}%` }}
                        />
                      </div>
                    </div>

                    {/* CONTROLES DE AVANCE */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Ajustar avance:</span>
                        {[25, 50, 75, 100].map(pct => (
                          <button
                            key={pct}
                            onClick={() =>
                              handleUpdatePlanProgress(
                                plan.id,
                                pct,
                                pct >= 100 ? 'completado' : 'en_ejecucion'
                              )
                            }
                            className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-800"
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        {plan.status !== 'completado' && (
                          <button
                            onClick={() =>
                              handleUpdatePlanProgress(plan.id, 100, 'completado')
                            }
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg"
                          >
                            Completar
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">
                No se encontraron planes de acción con los filtros seleccionados.
              </p>
            )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 8: INTELIGENCIA EMPRESARIAL */}
      {/* ===================================================================== */}
      {activeTab === 'inteligencia' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  Alertas Inteligentes & Diagnósticos Estratégicos
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Análisis determinista fundamentado en datos reales de ventas, márgenes, almacén y cobranzas.
                </p>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {[
                  { id: 'todas', label: 'Todas' },
                  { id: 'alta', label: 'Alta (Crítica)' },
                  { id: 'media', label: 'Media' },
                ].map(flt => (
                  <button
                    key={flt.id}
                    onClick={() => setAlertSeverityFilter(flt.id as any)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition ${
                      alertSeverityFilter === flt.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {flt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {filteredAlerts.length > 0 ? (
                filteredAlerts.map(alt => (
                  <div key={alt.id} className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            alt.severity === 'alta'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          Severidad: {alt.severity}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{alt.title}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-medium">Área: {alt.area}</span>
                    </div>

                    {/* CUATRO PARTES OBLIGATORIAS */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <p className="font-bold text-slate-900">1. Qué está ocurriendo:</p>
                        <p className="text-slate-600 mt-0.5">{alt.what_is_happening}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <p className="font-bold text-slate-900">2. Información que respalda:</p>
                        <p className="text-slate-600 mt-0.5">{alt.supporting_evidence}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-rose-50/50 border border-rose-100">
                        <p className="font-bold text-rose-900">3. Riesgo representado:</p>
                        <p className="text-rose-700 mt-0.5">{alt.risk_represented}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100">
                        <p className="font-bold text-emerald-900">4. Acción recomendada:</p>
                        <p className="text-emerald-700 mt-0.5">{alt.recommended_action}</p>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={() => {
                          setNewPlanData({
                            title: `Mitigación: ${alt.title}`,
                            objective: alt.recommended_action,
                            area: alt.area as ActionPlanArea,
                            assigned_to_name: 'Equipo de área',
                            priority: alt.severity === 'alta' ? 'critica' : 'alta',
                            kpi_target: 'Resolución de riesgo en 7 días',
                            due_date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
                          })
                          setNewPlanModal(true)
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        Convertir en plan de acción
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500 py-6 text-center">
                  Sin anomalías críticas detectadas en este momento.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 9: INFORMES GERENCIALES */}
      {/* ===================================================================== */}
      {activeTab === 'informes' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-700" />
                  Generador de Informes Gerenciales
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Reportes ejecutivos listos para exportar a PDF o presentar a la junta directiva / dueño.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={reportType}
                  onChange={e => setReportType(e.target.value as any)}
                  className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white focus:outline-none"
                >
                  <option value="diario">Informe Diario de Gestión</option>
                  <option value="semanal">Informe Semanal de Operaciones</option>
                  <option value="mensual">Informe Mensual Ejecutivo</option>
                  <option value="comercial">Informe de Rendimiento Comercial</option>
                  <option value="financiero">Informe Financiero y Cartera</option>
                  <option value="operativo">Informe de Eficiencia y Stock</option>
                </select>

                <button
                  onClick={() => window.print()}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimir / PDF
                </button>
              </div>
            </div>

            {/* VISTA PREVIA DEL INFORME */}
            {generatedReport && (
              <div className="p-6 border border-slate-200 rounded-xl bg-slate-50/50 space-y-6">
                <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{generatedReport.companyName}</h2>
                    <p className="text-xs font-semibold text-slate-600 mt-0.5">{generatedReport.periodLabel}</p>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <p>Fecha de emisión: {generatedReport.generatedAt}</p>
                    <p>Autorizado por: Gerente Operativo</p>
                  </div>
                </div>

                {/* KPIS DEL INFORME */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {generatedReport.kpis.map((kpi, i) => (
                    <div key={i} className="p-3 bg-white border border-slate-200 rounded-lg">
                      <p className="text-[11px] font-medium text-slate-500">{kpi.label}</p>
                      <p className="text-base font-bold text-slate-900 mt-0.5 tabular-nums">{kpi.value}</p>
                      {kpi.trend && <p className="text-[10px] text-slate-500 mt-0.5">{kpi.trend}</p>}
                    </div>
                  ))}
                </div>

                {/* HITOS & CONCLUSIONES */}
                <div className="space-y-3 bg-white p-4 border border-slate-200 rounded-lg">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Puntos Clave & Conclusiones Gerenciales
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-xs text-slate-700">
                    {generatedReport.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>

                {/* ACCIONES RECOMENDADAS */}
                <div className="space-y-3 bg-white p-4 border border-slate-200 rounded-lg">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Plan de Intervención Prioritario
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-xs text-slate-700">
                    {generatedReport.recommendedActions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>

                {/* TABLA DE DETALLE */}
                {generatedReport.tableData && (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-bold">
                        <tr>
                          {generatedReport.tableData.headers.map((h, i) => (
                            <th key={i} className="p-2.5">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {generatedReport.tableData.rows.map((row, i) => (
                          <tr key={i}>
                            {row.map((cell, j) => (
                              <td key={j} className="p-2.5 font-medium text-slate-800">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MÓDULO 10: NOTIFICACIONES GERENCIALES */}
      {/* ===================================================================== */}
      {activeTab === 'notificaciones' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-500" />
              Centro de Alertas Críticas & Notificaciones de Gestión
            </h3>

            <div className="space-y-3">
              {pendingApprovalsCount > 0 && (
                <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/50 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <p className="font-bold text-slate-900">
                        Tienes {pendingApprovalsCount} solicitudes esperando autorización
                      </p>
                      <p className="text-slate-600">
                        Compras extraordinarias o descuentos requieren tu visto bueno.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('autorizaciones')}
                    className="px-3 py-1 bg-white border border-amber-300 text-slate-800 font-semibold rounded-md hover:bg-amber-100"
                  >
                    Revisar ahora
                  </button>
                </div>
              )}

              {(overview?.overdueReceivables || 0) > 0 && (
                <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50/50 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <div>
                      <p className="font-bold text-slate-900">
                        Cartera vencida superior a 30 días detectada: {fmt(overview?.overdueReceivables || 0)}
                      </p>
                      <p className="text-slate-600">
                        Se recomienda asignar tareas de cobranza a los vendedores.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('financiera')}
                    className="px-3 py-1 bg-white border border-rose-300 text-slate-800 font-semibold rounded-md hover:bg-rose-100"
                  >
                    Ver detalle
                  </button>
                </div>
              )}

              {(overview?.outOfStockCount || 0) > 0 && (
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <Package className="w-4 h-4 text-slate-600 shrink-0" />
                    <div>
                      <p className="font-bold text-slate-900">
                        {overview?.outOfStockCount} productos con quiebre de stock en bodega
                      </p>
                      <p className="text-slate-600">
                        Riesgo de pérdida de ventas en mostrador y pedidos omnicanal.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('operaciones')}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-800 font-semibold rounded-md hover:bg-slate-100"
                  >
                    Ver stock
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PARA DICTAMEN DE AUTORIZACIÓN */}
      {/* ===================================================================== */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Confirmar Dictamen: {decisionModal.action.toUpperCase()}
            </h3>
            <p className="text-xs text-slate-600">{decisionModal.title}</p>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Notas y Justificación Gerencial (Auditoría)
              </label>
              <textarea
                value={decisionNotes}
                onChange={e => setDecisionNotes(e.target.value)}
                placeholder="Escribe el motivo del dictamen, observaciones para el solicitante o ajustes solicitados…"
                className="w-full text-xs p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                className="px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDecision}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Confirmar Dictamen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PARA CREAR PLAN DE ACCIÓN */}
      {/* ===================================================================== */}
      {newPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreatePlan}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Nuevo Plan de Acción Gerencial</h3>
              <button
                type="button"
                onClick={() => setNewPlanModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Título del Plan / Objetivo</label>
                <input
                  type="text"
                  required
                  value={newPlanData.title}
                  onChange={e => setNewPlanData({ ...newPlanData, title: e.target.value })}
                  placeholder="Ej: Reducción de cartera vencida a más de 30 días"
                  className="w-full p-2.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Área</label>
                  <select
                    value={newPlanData.area}
                    onChange={e => setNewPlanData({ ...newPlanData, area: e.target.value as any })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="operaciones">Operaciones</option>
                    <option value="comercial">Comercial</option>
                    <option value="financiera">Financiera</option>
                    <option value="inventario">Inventario</option>
                    <option value="talento_humano">Talento Humano</option>
                    <option value="calidad">Calidad</option>
                    <option value="estrategica">Estratégica</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Prioridad</label>
                  <select
                    value={newPlanData.priority}
                    onChange={e => setNewPlanData({ ...newPlanData, priority: e.target.value as any })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="critica">Crítica (Inmediata)</option>
                    <option value="alta">Alta</option>
                    <option value="media">Media</option>
                    <option value="baja">Baja</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Responsable Asignado</label>
                  <input
                    type="text"
                    required
                    value={newPlanData.assigned_to_name}
                    onChange={e => setNewPlanData({ ...newPlanData, assigned_to_name: e.target.value })}
                    placeholder="Nombre del colaborador / cargo"
                    className="w-full p-2.5 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Fecha Límite</label>
                  <input
                    type="date"
                    required
                    value={newPlanData.due_date}
                    onChange={e => setNewPlanData({ ...newPlanData, due_date: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Indicador de Cumplimiento (KPI Target)</label>
                <input
                  type="text"
                  value={newPlanData.kpi_target}
                  onChange={e => setNewPlanData({ ...newPlanData, kpi_target: e.target.value })}
                  placeholder="Ej: Cartera vencida menor al 5% del total facturado"
                  className="w-full p-2.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Descripción / Pasos de Ejecución</label>
                <textarea
                  value={newPlanData.objective}
                  onChange={e => setNewPlanData({ ...newPlanData, objective: e.target.value })}
                  placeholder="Detalla qué acciones debe realizar el equipo para alcanzar el objetivo…"
                  className="w-full p-2.5 border border-slate-300 rounded-lg"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setNewPlanModal(false)}
                className="px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Guardar Plan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PARA EVALUACIÓN DE TALENTO */}
      {/* ===================================================================== */}
      {newEvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreateEvaluation}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Registrar Evaluación de Desempeño</h3>
              <button
                type="button"
                onClick={() => setNewEvalModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Nombre del Colaborador</label>
                  <input
                    type="text"
                    required
                    value={newEvalData.employee_name}
                    onChange={e => setNewEvalData({ ...newEvalData, employee_name: e.target.value })}
                    placeholder="Ej: Yonny Perez"
                    className="w-full p-2.5 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Período</label>
                  <input
                    type="text"
                    required
                    value={newEvalData.evaluation_period}
                    onChange={e => setNewEvalData({ ...newEvalData, evaluation_period: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Calificación (1.0 a 5.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="5"
                    required
                    value={newEvalData.score}
                    onChange={e => setNewEvalData({ ...newEvalData, score: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Tipo de Registro</label>
                  <select
                    value={newEvalData.incident_type}
                    onChange={e => setNewEvalData({ ...newEvalData, incident_type: e.target.value as any })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="evaluacion_periodica">Evaluación Periódica</option>
                    <option value="compromiso_mejora">Compromiso de Mejora</option>
                    <option value="felicitacion">Reconocimiento / Felicitación</option>
                    <option value="llamado_atencion">Llamado de Atención</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Fortalezas Demostradas</label>
                <textarea
                  value={newEvalData.strengths}
                  onChange={e => setNewEvalData({ ...newEvalData, strengths: e.target.value })}
                  placeholder="Aspectos destacados en servicio, puntualidad o ventas…"
                  className="w-full p-2.5 border border-slate-300 rounded-lg"
                  rows={2}
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Oportunidades de Mejora</label>
                <textarea
                  value={newEvalData.areas_for_improvement}
                  onChange={e => setNewEvalData({ ...newEvalData, areas_for_improvement: e.target.value })}
                  placeholder="Aspectos a pulir en cobranza, inventario o seguimiento…"
                  className="w-full p-2.5 border border-slate-300 rounded-lg"
                  rows={2}
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Compromisos Acordados</label>
                <textarea
                  value={newEvalData.commitments}
                  onChange={e => setNewEvalData({ ...newEvalData, commitments: e.target.value })}
                  placeholder="Metas acordadas entre el colaborador y la gerencia…"
                  className="w-full p-2.5 border border-slate-300 rounded-lg"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setNewEvalModal(false)}
                className="px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Guardar en Expediente
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
