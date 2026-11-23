import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Building2,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  History,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  canAccessBankReconciliation,
  canCaptureBankStatements,
  canManageBankAccounts,
  canReconcileBankStatements,
  canReopenBankStatements,
  canVoidBankReconciliationItems,
  isReadOnly,
  useAuth,
} from '../lib/auth'
import { downloadCsv } from '../lib/csv'
import { supabase } from '../lib/supabase'
import { isSessionAuthorizationActive } from '../lib/supportTickets'
import { fmtDate, fmtDateTime, useCurrency } from '../lib/currency'
import { esc, printHtml } from '../lib/documents'
import { round2 } from '../lib/tax'
import {
  addManualStatementLines,
  buildNonBindingSuggestions,
  confirmStatement,
  createBankStatement,
  createManualMatch,
  fetchAuditHistory,
  fetchBankAccounts,
  fetchBankStatements,
  fetchPostableBankLedgerAccounts,
  fetchStatementWorkspace,
  markLineDifference,
  parseManualCsvForPreview,
  reopenStatement,
  toggleBankAccountStatus,
  upsertBankAccount,
  voidMatch,
  voidStatement,
  voidStatementLine,
  type ManualStatementLineInput,
  type PostableLedgerAccount,
} from '../services/bankReconciliationService'
import type {
  BankAccountRecord,
  BankAccountType,
  BankReconciliationEventRecord,
  BankReconciliationMatchRecord,
  BankReconciliationStatus,
  BankStatementLineRecord,
  BankStatementRecord,
  BankStatementSummary,
  LedgerBankLineCandidate,
  SupportTicket,
} from '../types'

type WorkspaceTab = 'conciliacion' | 'extractos' | 'cuentas' | 'historial'
type LineStatusFilter =
  | 'todos'
  | 'pendiente'
  | 'parcialmente_conciliado'
  | 'con_diferencia'
  | 'conciliado'
  | 'anulado'

const ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  ahorros: 'Cuenta de ahorros',
  corriente: 'Cuenta corriente',
  billetera_digital: 'Billetera digital',
  fiduciaria: 'Encargo fiduciario',
  otra: 'Otra cuenta',
}

const STATUS_META: Record<
  BankReconciliationStatus,
  { label: string; toneClass: string }
> = {
  pendiente: { label: 'Pendiente', toneClass: 'text-slate-600' },
  parcialmente_conciliado: {
    label: 'Parcialmente conciliado',
    toneClass: 'text-amber-700',
  },
  con_diferencia: { label: 'Con diferencia', toneClass: 'text-red-700' },
  conciliado: { label: 'Conciliado', toneClass: 'text-emerald-700' },
  anulado: { label: 'Anulado', toneClass: 'text-slate-400' },
}

const EVENT_LABELS: Record<string, string> = {
  bank_account_created: 'Cuenta bancaria registrada',
  bank_account_updated: 'Cuenta bancaria actualizada',
  bank_account_activated: 'Cuenta bancaria reactivada',
  bank_account_deactivated: 'Cuenta bancaria inactivada',
  bank_statement_created: 'Extracto manual creado',
  bank_statement_lines_added: 'Movimientos añadidos al extracto',
  bank_statement_line_voided: 'Movimiento del extracto anulado',
  bank_manual_match_created: 'Cruce manual registrado',
  bank_line_difference_marked: 'Diferencia bancaria documentada',
  bank_line_difference_cleared: 'Marca de diferencia retirada',
  bank_match_voided: 'Cruce manual deshecho',
  bank_statement_confirmed: 'Conciliación confirmada',
  bank_statement_reopened: 'Conciliación reabierta',
  bank_statement_voided: 'Extracto anulado',
}

function emptyDraftRow(): ManualStatementLineInput {
  return {
    tx_date: new Date().toLocaleDateString('sv-SE'),
    post_date: '',
    description: '',
    bank_reference: '',
    direction: 'credit',
    amount: 0,
    reported_balance: null,
    notes: '',
  }
}

type ActionModalState =
  | {
      kind: 'mark_diff'
      line: BankStatementLineRecord
      hasDiff: boolean
      reason: string
    }
  | { kind: 'void_line'; line: BankStatementLineRecord; reason: string }
  | { kind: 'void_match'; match: BankReconciliationMatchRecord; reason: string }
  | { kind: 'confirm_statement'; notes: string }
  | { kind: 'reopen_statement'; reason: string }
  | { kind: 'void_statement'; reason: string }
  | { kind: 'toggle_account'; account: BankAccountRecord; reason: string }
  | null

export default function BankReconciliation({
  onNavigate,
  supportInspectionTicket = null,
}: {
  onNavigate?: (page: string) => void
  supportInspectionTicket?: SupportTicket | null
}) {
  const { user } = useAuth()
  const { fmt: money, currency } = useCurrency()
  const role = user?.role
  const readOnly = isReadOnly(user)
  const supportMode = Boolean(supportInspectionTicket)
  const [supportAuthorizationValid, setSupportAuthorizationValid] = useState(false)
  const [supportAuthorizationLoading, setSupportAuthorizationLoading] = useState(
    Boolean(supportInspectionTicket)
  )
  const hasAccess = supportMode
    ? supportAuthorizationValid
    : canAccessBankReconciliation(role)
  const canManageAccounts = !supportMode && !readOnly && canManageBankAccounts(role)
  const canCaptureStatements = !supportMode && !readOnly && canCaptureBankStatements(role)
  const canReconcile = !supportMode && !readOnly && canReconcileBankStatements(role)
  const canVoidItems = !supportMode && !readOnly && canVoidBankReconciliationItems(role)
  const canReopen = !supportMode && !readOnly && canReopenBankStatements(role)

  const csvFileInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<WorkspaceTab>('conciliacion')
  const [loadingInit, setLoadingInit] = useState(true)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  )

  // Catálogos y estado maestro
  const [ledgerAccounts, setLedgerAccounts] = useState<PostableLedgerAccount[]>(
    []
  )
  const [bankAccounts, setBankAccounts] = useState<BankAccountRecord[]>([])
  const [statements, setStatements] = useState<BankStatementRecord[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [selectedStatementId, setSelectedStatementId] = useState<string>('')

  // Espacio de trabajo del extracto seleccionado
  const [summary, setSummary] = useState<BankStatementSummary | null>(null)
  const [bankLines, setBankLines] = useState<BankStatementLineRecord[]>([])
  const [ledgerLines, setLedgerLines] = useState<LedgerBankLineCandidate[]>([])
  const [matches, setMatches] = useState<BankReconciliationMatchRecord[]>([])
  const [statementEvents, setStatementEvents] = useState<
    BankReconciliationEventRecord[]
  >([])
  const [historyEvents, setHistoryEvents] = useState<
    BankReconciliationEventRecord[]
  >([])
  const [historyScope, setHistoryScope] = useState<'extracto' | 'empresa'>('empresa')

  // Filtros de comparación manual
  const [bankSearch, setBankSearch] = useState('')
  const [bankStatusFilter, setBankStatusFilter] =
    useState<LineStatusFilter>('todos')
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [ledgerPendingOnly, setLedgerPendingOnly] = useState(true)
  const [highlightedAccLineId, setHighlightedAccLineId] = useState<string | null>(
    null
  )

  // Selección manual (N-a-M / parcial) — NUNCA automática
  const [selectedBankAllocs, setSelectedBankAllocs] = useState<
    Record<string, number>
  >({})
  const [selectedAccAllocs, setSelectedAccAllocs] = useState<
    Record<string, number>
  >({})
  const [matchNotes, setMatchNotes] = useState('')

  // Modal de cuenta bancaria (Crear / Editar)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] =
    useState<BankAccountRecord | null>(null)
  const [accountForm, setAccountForm] = useState({
    bank_name: '',
    account_alias: '',
    account_type: 'corriente' as BankAccountType,
    account_number_raw: '',
    acc_account_id: '',
    currency: currency || 'COP',
    notes: '',
  })

  // Modal de nuevo extracto manual
  const [statementModalOpen, setStatementModalOpen] = useState(false)
  const [statementForm, setStatementForm] = useState(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const today = now.toLocaleDateString('sv-SE')
    return {
      bank_account_id: '',
      period_start: `${y}-${m}-01`,
      period_end: today,
      cutoff_date: today,
      opening_balance: '0',
      reported_closing_balance: '',
      notes: '',
    }
  })

  // Captura manual de movimientos del extracto + vista previa CSV controlada
  const [manualRows, setManualRows] = useState<ManualStatementLineInput[]>(() => [
    emptyDraftRow(),
  ])
  const [csvPreviewOrigin, setCsvPreviewOrigin] = useState<'manual' | 'csv_manual'>(
    'manual'
  )

  // Diálogo unificado de confirmaciones / motivos (sin window.alert/prompt)
  const [actionModal, setActionModal] = useState<ActionModalState>(null)

  // La inspección técnica requiere autorización activa del servidor.
  // Esta vista siempre es de solo lectura, incluso con intervención asistida.
  useEffect(() => {
    let cancelled = false

    const clearInspectionData = () => {
      setLedgerAccounts([])
      setBankAccounts([])
      setStatements([])
      setHistoryEvents([])
      setSelectedAccountId('')
      setSelectedStatementId('')
      setSummary(null)
      setBankLines([])
      setLedgerLines([])
      setMatches([])
      setStatementEvents([])
    }

    const validateSupportAuthorization = async () => {
      if (!supportInspectionTicket) {
        setSupportAuthorizationValid(false)
        setSupportAuthorizationLoading(false)
        return
      }

      clearInspectionData()
      setSupportAuthorizationValid(false)
      setSupportAuthorizationLoading(true)

      try {
        if (
          supportInspectionTicket.module_page !== 'bankrecon' ||
          !supportInspectionTicket.company_id ||
          !isSessionAuthorizationActive(supportInspectionTicket)
        ) {
          throw new Error('El ticket de soporte no tiene una autorización bancaria vigente.')
        }

        const { data, error } = await supabase.rpc(
          'support_has_active_authorization',
          {
            p_company_id: supportInspectionTicket.company_id,
            p_module: 'accounting',
            p_scope: supportInspectionTicket.authorization_scope || 'lectura_diagnostico',
          }
        )

        if (error) throw error
        if (data !== true) {
          throw new Error('Supabase no confirmó la autorización para consultar esta empresa.')
        }

        if (!cancelled) setSupportAuthorizationValid(true)
      } catch (err) {
        if (!cancelled) {
          setSupportAuthorizationValid(false)
          setFeedback({
            ok: false,
            text: err instanceof Error
              ? err.message
              : 'No se pudo validar la autorización técnica.',
          })
        }
      } finally {
        if (!cancelled) setSupportAuthorizationLoading(false)
      }
    }

    void validateSupportAuthorization()

    return () => {
      cancelled = true
    }
  }, [supportInspectionTicket])


  // Vigilar vencimiento y revocación de la autorización durante la inspección.
  useEffect(() => {
    const ticket = supportInspectionTicket
    if (!ticket) return

    let stopped = false
    let checking = false

    const clearInspectionData = () => {
      setSupportAuthorizationValid(false)
      setLedgerAccounts([])
      setBankAccounts([])
      setStatements([])
      setHistoryEvents([])
      setSelectedAccountId('')
      setSelectedStatementId('')
      setSummary(null)
      setBankLines([])
      setLedgerLines([])
      setMatches([])
      setStatementEvents([])
    }

    const revokeInspectionView = (message: string) => {
      if (stopped) return
      clearInspectionData()
      setFeedback({ ok: false, text: message })
    }

    const verifyAuthorization = async () => {
      if (stopped || checking) return
      checking = true

      try {
        if (
          !ticket.company_id ||
          ticket.module_page !== 'bankrecon' ||
          !isSessionAuthorizationActive(ticket)
        ) {
          revokeInspectionView('La autorización de soporte venció o dejó de estar activa.')
          return
        }

        const { data, error } = await supabase.rpc(
          'support_has_active_authorization',
          {
            p_company_id: ticket.company_id,
            p_module: 'accounting',
            p_scope: ticket.authorization_scope || 'lectura_diagnostico',
          }
        )

        if (error) throw error

        if (data !== true) {
          revokeInspectionView('La autorización de soporte fue revocada. Se cerró la consulta de esta empresa.')
        }
      } catch {
        revokeInspectionView('No fue posible confirmar la autorización. Por seguridad, se ocultaron los datos de la inspección.')
      } finally {
        checking = false
      }
    }

    const expiresAt = Date.parse(ticket.authorized_until || '')
    const expiryDelay = Number.isFinite(expiresAt)
      ? Math.max(0, expiresAt - Date.now())
      : 0

    const expiryTimer = window.setTimeout(() => {
      revokeInspectionView('La autorización de soporte venció. Se ocultaron los datos de la inspección.')
    }, expiryDelay)

    const interval = window.setInterval(() => {
      void verifyAuthorization()
    }, 15000)

    return () => {
      stopped = true
      window.clearTimeout(expiryTimer)
      window.clearInterval(interval)
    }
  }, [supportInspectionTicket])

  const selectedAccount = useMemo(
    () => bankAccounts.find(a => a.id === selectedAccountId) || null,
    [bankAccounts, selectedAccountId]
  )

  const selectedStatement = useMemo(
    () => statements.find(s => s.id === selectedStatementId) || null,
    [statements, selectedStatementId]
  )

  const accountStatements = useMemo(
    () =>
      selectedAccountId
        ? statements.filter(s => s.bank_account_id === selectedAccountId)
        : statements,
    [statements, selectedAccountId]
  )

  const loadMasterCatalogs = useCallback(
    async (preferAccountId?: string, preferStatementId?: string) => {
      if (supportMode && supportAuthorizationLoading) {
        setLoadingInit(true)
        return
      }
      if (!hasAccess) {
        if (supportMode) {
          setLedgerAccounts([])
          setBankAccounts([])
          setStatements([])
          setHistoryEvents([])
          setSelectedAccountId('')
          setSelectedStatementId('')
          setSummary(null)
          setBankLines([])
          setLedgerLines([])
          setMatches([])
          setStatementEvents([])
        }
        setLoadingInit(false)
        return
      }
      setLoadingInit(true)
      try {
        const supportCompanyId = supportMode
          ? supportInspectionTicket?.company_id || undefined
          : undefined

        const [pucRows, accRows, stmtRows, auditRows] = await Promise.all([
          fetchPostableBankLedgerAccounts(supportCompanyId),
          fetchBankAccounts(supportCompanyId),
          fetchBankStatements(undefined, supportCompanyId),
          fetchAuditHistory(undefined, supportCompanyId),
        ])
        setLedgerAccounts(pucRows)
        setBankAccounts(accRows)
        setStatements(stmtRows)
        setHistoryEvents(auditRows)

        const targetAccId =
          preferAccountId && accRows.some(a => a.id === preferAccountId)
            ? preferAccountId
            : selectedAccountId && accRows.some(a => a.id === selectedAccountId)
              ? selectedAccountId
              : accRows[0]?.id || ''

        setSelectedAccountId(targetAccId)

        const candidateStmts = targetAccId
          ? stmtRows.filter(s => s.bank_account_id === targetAccId)
          : stmtRows
        const targetStmtId =
          preferStatementId &&
          candidateStmts.some(s => s.id === preferStatementId)
            ? preferStatementId
            : selectedStatementId &&
                candidateStmts.some(s => s.id === selectedStatementId)
              ? selectedStatementId
              : candidateStmts[0]?.id || ''

        setSelectedStatementId(targetStmtId)
      } catch (err) {
        if (supportMode) {
          setLedgerAccounts([])
          setBankAccounts([])
          setStatements([])
          setHistoryEvents([])
          setSelectedAccountId('')
          setSelectedStatementId('')
          setSummary(null)
          setBankLines([])
          setLedgerLines([])
          setMatches([])
          setStatementEvents([])
        }
        setFeedback({
          ok: false,
          text:
            err instanceof Error
              ? err.message
              : 'No se pudo cargar el módulo de conciliación bancaria.',
        })
      } finally {
        setLoadingInit(false)
      }
    },
    [
      hasAccess,
      selectedAccountId,
      selectedStatementId,
      supportMode,
      supportInspectionTicket,
      supportAuthorizationLoading,
    ]
  )

  const loadWorkspace = useCallback(async () => {
    if (!selectedStatement || !selectedAccount) {
      setSummary(null)
      setBankLines([])
      setLedgerLines([])
      setMatches([])
      setStatementEvents([])
      return
    }
    setLoadingWorkspace(true)
    try {
      if (
        supportMode &&
        (
          !supportAuthorizationValid ||
          !supportInspectionTicket?.company_id ||
          selectedStatement.company_id !== supportInspectionTicket.company_id ||
          selectedAccount.company_id !== supportInspectionTicket.company_id ||
          !isSessionAuthorizationActive(supportInspectionTicket)
        )
      ) {
        throw new Error('El extracto o la cuenta no pertenecen a la empresa autorizada, o el ticket expiró.')
      }

      const ws = await fetchStatementWorkspace({
        statement: selectedStatement,
        bankAccount: selectedAccount,
        ...(supportMode
          ? {
              supportCompanyId: supportInspectionTicket?.company_id || undefined,
              supportScope: supportInspectionTicket?.authorization_scope || 'lectura_diagnostico',
            }
          : {}),
      })
      setSummary(ws.summary)
      setBankLines(ws.bankLines)
      setLedgerLines(ws.ledgerLines)
      setMatches(ws.matches)
      setStatementEvents(ws.events)
      setSelectedBankAllocs({})
      setSelectedAccAllocs({})
      setHighlightedAccLineId(null)
    } catch (err) {
      if (supportMode) {
        setSummary(null)
        setBankLines([])
        setLedgerLines([])
        setMatches([])
        setStatementEvents([])
      }
      setFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el extracto ni los movimientos contables.',
      })
    } finally {
      setLoadingWorkspace(false)
    }
  }, [
    selectedStatement,
    selectedAccount,
    supportMode,
    supportAuthorizationValid,
    supportInspectionTicket,
  ])

  useEffect(() => {
    void loadMasterCatalogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccountId(accountId)
    const firstStmt = statements.find(s => s.bank_account_id === accountId)
    setSelectedStatementId(firstStmt?.id || '')
    setSelectedBankAllocs({})
    setSelectedAccAllocs({})
  }

  // Cálculos de selección manual (N-a-M)
  const bankLineById = useMemo(
    () => new Map(bankLines.map(l => [l.id, l])),
    [bankLines]
  )
  const ledgerLineById = useMemo(
    () => new Map(ledgerLines.map(l => [l.acc_line_id, l])),
    [ledgerLines]
  )

  const matchTotals = useMemo(() => {
    let signedBank = 0
    let absBank = 0
    let bankInflows = 0
    let bankOutflows = 0
    const bankAllocs: Array<{ statement_line_id: string; amount: number }> = []
    for (const [id, amt] of Object.entries(selectedBankAllocs)) {
      const line = bankLineById.get(id)
      const val = round2(Number(amt || 0))
      if (!line || val <= 0) continue
      bankAllocs.push({ statement_line_id: id, amount: val })
      absBank = round2(absBank + val)
      if (line.direction === 'credit') {
        bankInflows = round2(bankInflows + val)
        signedBank = round2(signedBank + val)
      } else {
        bankOutflows = round2(bankOutflows + val)
        signedBank = round2(signedBank - val)
      }
    }

    let signedAcc = 0
    let absAcc = 0
    let accInflows = 0
    let accOutflows = 0
    const accAllocs: Array<{ acc_line_id: string; amount: number }> = []
    for (const [id, amt] of Object.entries(selectedAccAllocs)) {
      const line = ledgerLineById.get(id)
      const val = round2(Number(amt || 0))
      if (!line || val <= 0) continue
      accAllocs.push({ acc_line_id: id, amount: val })
      absAcc = round2(absAcc + val)
      if (line.direction === 'credit') {
        accInflows = round2(accInflows + val)
        signedAcc = round2(signedAcc + val)
      } else {
        accOutflows = round2(accOutflows + val)
        signedAcc = round2(signedAcc - val)
      }
    }

    const signedDiff = round2(signedBank - signedAcc)
    const absDiff = round2(absBank - absAcc)
    const inflowDiff = round2(bankInflows - accInflows)
    const outflowDiff = round2(bankOutflows - accOutflows)
    const canMatch =
      bankAllocs.length > 0 &&
      accAllocs.length > 0 &&
      Math.abs(inflowDiff) <= 0.01 &&
      Math.abs(outflowDiff) <= 0.01 &&
      Math.abs(signedDiff) <= 0.01 &&
      Math.abs(absDiff) <= 0.01

    return {
      bankAllocs,
      accAllocs,
      signedBank,
      signedAcc,
      absBank,
      absAcc,
      signedDiff,
      canMatch,
    }
  }, [selectedBankAllocs, selectedAccAllocs, bankLineById, ledgerLineById])

  // Sugerencias visuales NO vinculantes (nunca auto-seleccionan ni concilian)
  const visualHints = useMemo(
    () => buildNonBindingSuggestions(bankLines, ledgerLines),
    [bankLines, ledgerLines]
  )

  const filteredBankLines = useMemo(() => {
    const q = bankSearch.trim().toLowerCase()
    return bankLines.filter(line => {
      if (bankStatusFilter !== 'todos' && line.status !== bankStatusFilter) {
        return false
      }
      if (!q) return true
      return (
        line.description.toLowerCase().includes(q) ||
        (line.bank_reference || '').toLowerCase().includes(q) ||
        line.tx_date.includes(q) ||
        String(line.amount).includes(q)
      )
    })
  }, [bankLines, bankStatusFilter, bankSearch])

  const filteredLedgerLines = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase()
    return ledgerLines.filter(line => {
      if (ledgerPendingOnly && line.remaining_amount <= 0.009) return false
      if (!q) return true
      return (
        line.entry_number.toLowerCase().includes(q) ||
        line.entry_description.toLowerCase().includes(q) ||
        (line.memo || '').toLowerCase().includes(q) ||
        line.entry_date.includes(q) ||
        String(line.amount).includes(q)
      )
    })
  }, [ledgerLines, ledgerPendingOnly, ledgerSearch])

  const statementEditable = useMemo(() => {
    if (readOnly || !selectedStatement) return false
    if (
      Boolean(selectedStatement.confirmed_at) ||
      selectedStatement.status === 'conciliado' ||
      selectedStatement.status === 'anulado'
    ) {
      return false
    }
    if (summary && !summary.is_period_open) return false
    return true
  }, [readOnly, selectedStatement, summary])

  // Manejadores de UI
  const toggleBankLineSelection = (line: BankStatementLineRecord) => {
    const rem = round2(line.remaining_amount ?? line.amount)
    if (rem <= 0.009 || line.status === 'anulado') return
    setSelectedBankAllocs(prev => {
      const next = { ...prev }
      if (next[line.id] !== undefined) {
        delete next[line.id]
      } else {
        next[line.id] = rem
      }
      return next
    })
  }

  const toggleLedgerLineSelection = (line: LedgerBankLineCandidate) => {
    if (line.remaining_amount <= 0.009) return
    setSelectedAccAllocs(prev => {
      const next = { ...prev }
      if (next[line.acc_line_id] !== undefined) {
        delete next[line.acc_line_id]
      } else {
        next[line.acc_line_id] = round2(line.remaining_amount)
      }
      return next
    })
  }

  const handleCreateManualMatch = async () => {
    if (supportMode || !selectedStatement || !matchTotals.canMatch || !statementEditable || !canReconcile) return
    setBusy(true)
    setFeedback(null)
    try {
      await createManualMatch({
        statement_id: selectedStatement.id,
        bank_allocations: matchTotals.bankAllocs,
        acc_allocations: matchTotals.accAllocs,
        notes: matchNotes.trim() || null,
      })
      setMatchNotes('')
      setFeedback({
        ok: true,
        text: 'Cruce manual registrado correctamente en la conciliación.',
      })
      await loadMasterCatalogs(selectedAccountId, selectedStatement.id)
      await loadWorkspace()
    } catch (err) {
      setFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo registrar el cruce manual.',
      })
    } finally {
      setBusy(false)
    }
  }

  const openNewAccountModal = () => {
    setEditingAccount(null)
    setAccountForm({
      bank_name: '',
      account_alias: '',
      account_type: 'corriente',
      account_number_raw: '',
      acc_account_id: ledgerAccounts[0]?.id || '',
      currency: currency || 'COP',
      notes: '',
    })
    setAccountModalOpen(true)
  }

  const openEditAccountModal = (acc: BankAccountRecord) => {
    setEditingAccount(acc)
    setAccountForm({
      bank_name: acc.bank_name,
      account_alias: acc.account_alias,
      account_type: acc.account_type,
      account_number_raw: '',
      acc_account_id: acc.acc_account_id,
      currency: acc.currency || currency || 'COP',
      notes: acc.notes || '',
    })
    setAccountModalOpen(true)
  }

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (supportMode || !canManageAccounts) return
    setBusy(true)
    setFeedback(null)
    try {
      const savedId = await upsertBankAccount({
        id: editingAccount?.id || null,
        bank_name: accountForm.bank_name.trim(),
        account_alias: accountForm.account_alias.trim(),
        account_type: accountForm.account_type,
        account_number_raw: accountForm.account_number_raw.trim(),
        acc_account_id: accountForm.acc_account_id,
        currency: accountForm.currency.trim() || currency || 'COP',
        notes: accountForm.notes.trim() || null,
      })
      setAccountModalOpen(false)
      setFeedback({
        ok: true,
        text: editingAccount
          ? 'Cuenta bancaria actualizada correctamente.'
          : 'Cuenta bancaria registrada y vinculada al PUC.',
      })
      await loadMasterCatalogs(savedId)
    } catch (err) {
      setFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo guardar la cuenta bancaria.',
      })
    } finally {
      setBusy(false)
    }
  }

  const openNewStatementModal = () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const today = now.toLocaleDateString('sv-SE')
    setStatementForm({
      bank_account_id:
        selectedAccount?.active
          ? selectedAccount.id
          : bankAccounts.find(b => b.active)?.id || '',
      period_start: `${y}-${m}-01`,
      period_end: today,
      cutoff_date: today,
      opening_balance: '0',
      reported_closing_balance: '',
      notes: '',
    })
    setStatementModalOpen(true)
  }

  const handleCreateStatement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (supportMode || !canCaptureStatements) return
    if (statementForm.period_end < statementForm.period_start) {
      setFeedback({
        ok: false,
        text: 'La fecha fin del período no puede ser anterior a la fecha inicial.',
      })
      return
    }
    if (
      statementForm.cutoff_date < statementForm.period_start ||
      statementForm.cutoff_date > statementForm.period_end
    ) {
      setFeedback({
        ok: false,
        text: 'La fecha de corte debe estar comprendida dentro del rango inicio–fin del extracto.',
      })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const opening = Number(statementForm.opening_balance || 0)
      const repClosing =
        statementForm.reported_closing_balance.trim() !== ''
          ? Number(statementForm.reported_closing_balance)
          : null
      const stmtId = await createBankStatement({
        bank_account_id: statementForm.bank_account_id,
        period_start: statementForm.period_start,
        period_end: statementForm.period_end,
        cutoff_date: statementForm.cutoff_date,
        opening_balance: opening,
        reported_closing_balance: repClosing,
        notes: statementForm.notes.trim() || null,
      })
      setStatementModalOpen(false)
      setFeedback({
        ok: true,
        text: 'Extracto bancario manual creado. Ahora puedes capturar o revisar sus movimientos.',
      })
      await loadMasterCatalogs(statementForm.bank_account_id, stmtId)
      setTab('extractos')
    } catch (err) {
      setFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo crear el extracto bancario.',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleCsvFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseManualCsvForPreview(text)
      if (!parsed.length) {
        setFeedback({
          ok: false,
          text: 'No se detectaron filas válidas en el CSV. Verifica columnas de fecha, descripción y monto/crédito/débito.',
        })
        return
      }
      setManualRows(parsed)
      setCsvPreviewOrigin('csv_manual')
      setFeedback({
        ok: true,
        text: `Se cargaron ${parsed.length} filas en vista previa editable. Revísalas manualmente y pulsa «Guardar movimientos en extracto» para confirmar.`,
      })
    } catch (err) {
      setFeedback({
        ok: false,
        text:
          err instanceof Error ? err.message : 'Error leyendo el archivo CSV.',
      })
    }
  }

  const handleDownloadCsvTemplate = () => {
    downloadCsv(
      'plantilla_extracto_bancario_manual.csv',
      [
        'fecha_transaccion',
        'fecha_contable',
        'descripcion',
        'referencia',
        'credito',
        'debito',
        'saldo_reportado',
        'notas',
      ],
      [
        [
          new Date().toLocaleDateString('sv-SE'),
          '',
          'Transferencia recibida cliente ejemplo',
          'REF-1024',
          '250000',
          '0',
          '1250000',
          'Ejemplo de ingreso bancario',
        ],
        [
          new Date().toLocaleDateString('sv-SE'),
          '',
          'Cuota de manejo mensual',
          'COM-099',
          '0',
          '15000',
          '1235000',
          'Ejemplo de cargo bancario',
        ],
      ]
    )
  }

  const handleSaveManualLines = async () => {
    if (supportMode || !selectedStatement || !statementEditable || !canCaptureStatements) return
    const valid = manualRows
      .map(r => ({
        ...r,
        description: (r.description || '').trim(),
        amount: round2(Number(r.amount || 0)),
      }))
      .filter(r => r.tx_date && r.description && r.amount > 0)

    if (!valid.length) {
      setFeedback({
        ok: false,
        text: 'Completa al menos un movimiento con fecha, descripción y monto mayor a cero.',
      })
      return
    }

    const outOfRange = valid.find(
      r =>
        r.tx_date < selectedStatement.period_start ||
        r.tx_date > selectedStatement.period_end ||
        r.tx_date > selectedStatement.cutoff_date ||
        (r.post_date && r.post_date > selectedStatement.cutoff_date)
    )
    if (outOfRange) {
      setFeedback({
        ok: false,
        text: `El movimiento «${outOfRange.description}» (${outOfRange.tx_date}) está fuera del período del extracto (${selectedStatement.period_start} a ${selectedStatement.cutoff_date}).`,
      })
      return
    }

    setBusy(true)
    setFeedback(null)
    try {
      const added = await addManualStatementLines({
        statement_id: selectedStatement.id,
        lines: valid,
        source_origin: csvPreviewOrigin,
      })
      setManualRows([emptyDraftRow()])
      setCsvPreviewOrigin('manual')
      setFeedback({
        ok: true,
        text: `Se guardaron ${added} movimientos en el extracto ${selectedStatement.statement_code}. Puedes pasar a «Conciliación manual» para realizar los cruces.`,
      })
      await loadMasterCatalogs(selectedAccountId, selectedStatement.id)
      await loadWorkspace()
    } catch (err) {
      setFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudieron guardar los movimientos del extracto.',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleExecuteActionModal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (supportMode || !actionModal) return
    setBusy(true)
    setFeedback(null)
    try {
      if (actionModal.kind === 'mark_diff') {
        await markLineDifference({
          line_id: actionModal.line.id,
          has_difference: actionModal.hasDiff,
          reason: actionModal.hasDiff ? actionModal.reason.trim() : null,
        })
        setFeedback({
          ok: true,
          text: actionModal.hasDiff
            ? 'Diferencia documentada manualmente sin alterar los libros contables.'
            : 'Marca de diferencia retirada del movimiento.',
        })
      } else if (actionModal.kind === 'void_line') {
        await voidStatementLine(
          actionModal.line.id,
          actionModal.reason.trim()
        )
        setFeedback({
          ok: true,
          text: 'Movimiento del extracto anulado con trazabilidad.',
        })
      } else if (actionModal.kind === 'void_match') {
        await voidMatch(actionModal.match.id, actionModal.reason.trim())
        setFeedback({
          ok: true,
          text: 'Cruce manual deshecho y registrado en auditoría.',
        })
      } else if (actionModal.kind === 'confirm_statement' && selectedStatement) {
        const finalSt = await confirmStatement(
          selectedStatement.id,
          actionModal.notes.trim() || null
        )
        setFeedback({
          ok: true,
          text: `Conciliación confirmada en estado «${STATUS_META[finalSt as BankReconciliationStatus]?.label || finalSt}».`,
        })
      } else if (actionModal.kind === 'reopen_statement' && selectedStatement) {
        await reopenStatement(selectedStatement.id, actionModal.reason.trim())
        setFeedback({
          ok: true,
          text: 'Conciliación reabierta para revisión y edición manual.',
        })
      } else if (actionModal.kind === 'void_statement' && selectedStatement) {
        await voidStatement(selectedStatement.id, actionModal.reason.trim())
        setFeedback({
          ok: true,
          text: 'Extracto bancario anulado con registro de auditoría.',
        })
      } else if (actionModal.kind === 'toggle_account') {
        await toggleBankAccountStatus({
          id: actionModal.account.id,
          active: !actionModal.account.active,
          reason: actionModal.reason.trim() || null,
        })
        setFeedback({
          ok: true,
          text: actionModal.account.active
            ? 'Cuenta bancaria marcada como inactiva.'
            : 'Cuenta bancaria reactivada.',
        })
      }

      setActionModal(null)
      await loadMasterCatalogs(selectedAccountId, selectedStatementId)
      await loadWorkspace()
    } catch (err) {
      setFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo completar la operación solicitada.',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleExportCsv = () => {
    if (!selectedStatement || !summary) return
    downloadCsv(
      `conciliacion_manual_${selectedStatement.statement_code}.csv`,
      [
        'Extracto',
        'Cuenta Bancaria',
        'Cuenta PUC',
        'Corte',
        'Linea',
        'Fecha Tx',
        'Referencia',
        'Descripcion',
        'Tipo',
        'Valor',
        'Conciliado',
        'Pendiente',
        'Estado',
        'Motivo Diferencia / Nota',
      ],
      bankLines.map(l => [
        selectedStatement.statement_code,
        `${summary.bank_name} · ${summary.account_alias} (${summary.account_number_masked})`,
        `${summary.acc_account_code} ${summary.acc_account_name}`,
        summary.cutoff_date,
        String(l.line_number),
        l.tx_date,
        l.bank_reference || '',
        l.description,
        l.direction === 'credit' ? 'Abono/Ingreso' : 'Cargo/Salida',
        String(l.amount),
        String(l.matched_amount ?? 0),
        String(l.remaining_amount ?? l.amount),
        STATUS_META[l.status]?.label || l.status,
        l.difference_reason || l.notes || '',
      ])
    )
  }

  const handlePrintActa = () => {
    if (!selectedStatement || !summary) return
    const activeMatches = matches.filter(m => m.status === 'activo')
    const matchRowsHtml = activeMatches
      .map(m => {
        const bLine = bankLineById.get(m.statement_line_id)
        const aLine = ledgerLineById.get(m.acc_line_id)
        return `
          <tr>
            <td>${esc(bLine?.tx_date || '')} · ${esc(bLine?.description || 'Movimiento extracto')}</td>
            <td>${esc(aLine?.entry_number || '')} · ${esc(aLine?.entry_description || '')}</td>
            <td style="text-align:right">${esc(money(m.matched_amount))}</td>
            <td>${esc(m.created_by_name || '')}</td>
          </tr>
        `
      })
      .join('')

    const pendingLinesHtml = bankLines
      .filter(l => l.status !== 'anulado' && l.status !== 'conciliado')
      .map(
        l => `
        <tr>
          <td>${esc(l.tx_date)}</td>
          <td>${esc(l.bank_reference || '—')}</td>
          <td>${esc(l.description)}</td>
          <td>${esc(l.direction === 'credit' ? 'Abono' : 'Cargo')}</td>
          <td style="text-align:right">${esc(money(l.remaining_amount ?? l.amount))}</td>
          <td>${esc(l.difference_reason || STATUS_META[l.status]?.label || l.status)}</td>
        </tr>
      `
      )
      .join('')

    printHtml(`
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Acta Conciliación Bancaria ${esc(summary.statement_code)}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 28px; font-size: 12px; }
            h1 { font-size: 18px; margin: 0 0 4px 0; }
            .sub { color: #475569; margin-bottom: 18px; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
            .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
            .lbl { font-size: 11px; color: #64748b; }
            .val { font-size: 14px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 18px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
            th { background: #f8fafc; font-weight: 600; }
            h2 { font-size: 13px; margin: 14px 0 6px 0; }
            .footer { margin-top: 32px; display: flex; justify-content: space-between; font-size: 11px; color: #475569; }
            .sig { border-top: 1px solid #94a3b8; width: 220px; padding-top: 6px; text-align: center; }
          </style>
        </head>
        <body>
          <h1>Acta de Conciliación Bancaria Manual · ${esc(summary.statement_code)}</h1>
          <div class="sub">
            Cuenta: ${esc(summary.bank_name)} — ${esc(summary.account_alias)} (${esc(summary.account_number_masked)}) ·
            PUC: ${esc(summary.acc_account_code)} ${esc(summary.acc_account_name)} ·
            Período: ${esc(fmtDate(summary.period_start))} al ${esc(fmtDate(summary.period_end))} ·
            Corte: ${esc(fmtDate(summary.cutoff_date))} ·
            Estado: ${esc(STATUS_META[summary.status]?.label || summary.status)}
          </div>
          <div class="grid">
            <div class="box"><div class="lbl">Saldo inicial extracto</div><div class="val">${esc(money(summary.opening_balance))}</div></div>
            <div class="box"><div class="lbl">Abonos / Ingresos extracto</div><div class="val">${esc(money(summary.bank_credits))}</div></div>
            <div class="box"><div class="lbl">Cargos / Salidas extracto</div><div class="val">${esc(money(summary.bank_debits))}</div></div>
            <div class="box"><div class="lbl">Saldo final extracto (calculado)</div><div class="val">${esc(money(summary.calculated_bank_closing))}</div></div>
            <div class="box"><div class="lbl">Saldo en libros contables (acc_entries)</div><div class="val">${esc(money(summary.accounting_balance))}</div></div>
            <div class="box"><div class="lbl">Diferencia Extracto vs. Libros</div><div class="val">${esc(money(summary.difference_bank_vs_books))}</div></div>
            <div class="box"><div class="lbl">Conciliado en extracto</div><div class="val">${esc(money(summary.bank_reconciled_total))}</div></div>
            <div class="box"><div class="lbl">Pendiente en extracto</div><div class="val">${esc(money(summary.bank_pending_total))}</div></div>
            <div class="box"><div class="lbl">Pendiente en libros (período)</div><div class="val">${esc(money(summary.accounting_pending_total))}</div></div>
          </div>

          <h2>Cruces manuales activos (${activeMatches.length})</h2>
          <table>
            <thead><tr><th>Extracto</th><th>Asiento Contable (acc_entries)</th><th style="text-align:right">Valor Cruzado</th><th>Registrado por</th></tr></thead>
            <tbody>${matchRowsHtml || '<tr><td colspan="4">Sin cruces registrados</td></tr>'}</tbody>
          </table>

          <h2>Partidas pendientes o con diferencia (${bankLines.filter(l => l.status !== 'anulado' && l.status !== 'conciliado').length})</h2>
          <table>
            <thead><tr><th>Fecha</th><th>Referencia</th><th>Descripción</th><th>Tipo</th><th style="text-align:right">Pendiente</th><th>Estado / Motivo</th></tr></thead>
            <tbody>${pendingLinesHtml || '<tr><td colspan="6">Sin partidas pendientes</td></tr>'}</tbody>
          </table>

          <div class="footer">
            <div class="sig">Elaborado por: ${esc(user?.full_name || user?.email || 'Usuario')}</div>
            <div class="sig">Confirmado por: ${esc(selectedStatement.confirmed_by_name || 'Pendiente de firma')}</div>
          </div>
        </body>
      </html>
    `)
  }

  if (supportMode && supportAuthorizationLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto my-12">
        <ShieldCheck className="w-10 h-10 text-slate-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">
          Verificando autorización de soporte
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Estamos comprobando que el permiso para esta empresa siga vigente.
        </p>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto my-12">
        <ShieldCheck className="w-10 h-10 text-red-700 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">
          Acceso restringido a Conciliación Bancaria Manual
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Tu perfil actual no cuenta con autorización para consultar cuentas
          bancarias, extractos ni cruces contables.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1440px]">
      {/* Encabezado 3-zonas limpio */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Conciliación bancaria manual
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-500 mt-1">
            <span>Cuentas vinculadas al PUC (acc_accounts)</span>
            <span aria-hidden="true">·</span>
            <span>Extractos cargados manualmente</span>
            <span aria-hidden="true">·</span>
            <span>Cruces 100% manuales contra acc_entries</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {selectedStatement && summary && (
            <>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={handlePrintActa}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                Imprimir acta
              </button>
            </>
          )}
          {canCaptureStatements && (
            <button
              type="button"
              disabled={bankAccounts.filter(b => b.active).length === 0}
              onClick={openNewStatementModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Nuevo extracto manual
            </button>
          )}
        </div>
      </div>

      {/* Feedback no bloqueante */}
      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs sm:text-sm flex items-start justify-between gap-3 ${
            feedback.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span className="leading-relaxed">{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-800 shrink-0"
            aria-label="Cerrar mensaje"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Aviso de extracto confirmado (bloqueado hasta reapertura formal) */}
      {selectedStatement &&
        selectedStatement.confirmed_at &&
        selectedStatement.status !== 'anulado' && (
          <div className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-xs sm:text-sm text-slate-800 flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-slate-700 shrink-0" />
            <span>
              Extracto confirmado el {fmtDateTime(selectedStatement.confirmed_at)} por{' '}
              <strong>{selectedStatement.confirmed_by_name || 'Usuario'}</strong>. No admite
              nuevos movimientos, cruces ni anulaciones sin una reapertura formal autorizada.
            </span>
          </div>
        )}

      {/* Aviso de periodo cerrado */}
      {summary && !summary.is_period_open && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs sm:text-sm text-amber-900 flex items-center gap-2.5">
          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            El periodo contable de la fecha de corte ({fmtDate(summary.cutoff_date)}) se
            encuentra cerrado en libros. Esta conciliación es de solo lectura
            hasta que un administrador reabra el periodo contable.
          </span>
        </div>
      )}

      {/* Barra selectora de Cuenta Bancaria + Extracto + Pestañas */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Cuenta bancaria
            </label>
            <select
              value={selectedAccountId}
              onChange={e => handleSelectAccount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-slate-500"
            >
              {bankAccounts.length === 0 ? (
                <option value="">Sin cuentas bancarias registradas</option>
              ) : (
                bankAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bank_name} — {acc.account_alias} ({acc.account_number_masked})
                    {!acc.active ? ' [Inactiva]' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Extracto bancario manual
            </label>
            <select
              value={selectedStatementId}
              onChange={e => setSelectedStatementId(e.target.value)}
              disabled={accountStatements.length === 0}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-slate-500 disabled:bg-slate-50"
            >
              {accountStatements.length === 0 ? (
                <option value="">Sin extractos para esta cuenta</option>
              ) : (
                accountStatements.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.statement_code} · Corte {fmtDate(s.cutoff_date)} ·{' '}
                    {STATUS_META[s.status]?.label || s.status}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="md:col-span-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void loadMasterCatalogs(selectedAccountId, selectedStatementId)}
              disabled={loadingInit || loadingWorkspace}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  loadingInit || loadingWorkspace ? 'animate-spin' : ''
                }`}
              />
              Actualizar
            </button>
          </div>
        </div>

        {/* Navegación por pestañas */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            [
              {
                id: 'conciliacion',
                label: 'Conciliación manual',
                icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
              },
              {
                id: 'extractos',
                label: 'Extractos y captura manual',
                icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
              },
              {
                id: 'cuentas',
                label: `Cuentas bancarias (${bankAccounts.length})`,
                icon: <Building2 className="w-3.5 h-3.5" />,
              },
              {
                id: 'historial',
                label: 'Historial y auditoría',
                icon: <History className="w-3.5 h-3.5" />,
              },
            ] as const
          ).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                tab === item.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Estado de carga inicial */}
      {loadingInit && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      )}

      {/* PESTAÑA 1: CONCILIACIÓN MANUAL (DOS PANELES) */}
      {!loadingInit && tab === 'conciliacion' && (
        <>
          {!selectedAccount ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <Building2 className="w-10 h-10 text-slate-400 mx-auto" />
              <h2 className="text-base font-bold text-slate-900">
                Configura primero una cuenta bancaria vinculada al PUC
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto">
                Registra la cuenta del banco o billetera y vincúlala a una cuenta
                contable activa de tipo Activo en tu Plan de Cuentas (`acc_accounts`).
              </p>
              {canManageAccounts && (
                <button
                  type="button"
                  onClick={openNewAccountModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Registrar primera cuenta bancaria
                </button>
              )}
            </div>
          ) : !selectedStatement || !summary ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <FileSpreadsheet className="w-10 h-10 text-slate-400 mx-auto" />
              <h2 className="text-base font-bold text-slate-900">
                No hay extractos registrados para esta cuenta bancaria
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto">
                Crea un extracto manual definiendo período, fecha de corte y saldo
                inicial para comenzar a capturar movimientos y cruzarlos contra
                tus asientos contabilizados.
              </p>
              {canCaptureStatements && selectedAccount.active && (
                <button
                  type="button"
                  onClick={openNewStatementModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Crear extracto manual
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Resumen numérico tabular */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="font-bold text-slate-900">
                      {summary.statement_code}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {summary.bank_name} — {summary.account_alias} (
                      {summary.account_number_masked})
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      PUC {summary.acc_account_code} {summary.acc_account_name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      Corte {fmtDate(summary.cutoff_date)}
                    </span>
                  </div>

                  <span
                    className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                      STATUS_META[summary.status]?.toneClass || 'text-slate-700'
                    }`}
                  >
                    {STATUS_META[summary.status]?.label || summary.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-6 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
                  <div className="p-4">
                    <p className="text-xs text-slate-500">Saldo inicial extracto</p>
                    <p className="text-base font-bold text-slate-900 mt-1 font-mono tabular-nums">
                      {money(summary.opening_balance)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      +{money(summary.bank_credits)} / -{money(summary.bank_debits)}
                    </p>
                  </div>

                  <div className="p-4">
                    <p className="text-xs text-slate-500">
                      Saldo final extracto
                    </p>
                    <p className="text-base font-bold text-slate-900 mt-1 font-mono tabular-nums">
                      {money(summary.calculated_bank_closing)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      {summary.reported_closing_balance !== null
                        ? `Reportado: ${money(summary.reported_closing_balance)}`
                        : 'Sin saldo reportado'}
                    </p>
                  </div>

                  <div className="p-4">
                    <p className="text-xs text-slate-500">
                      Saldo contable (acc_entries)
                    </p>
                    <p className="text-base font-bold text-slate-900 mt-1 font-mono tabular-nums">
                      {money(summary.accounting_balance)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      Déb {money(summary.accounting_period_debits)} · Créd{' '}
                      {money(summary.accounting_period_credits)}
                    </p>
                  </div>

                  <div className="p-4">
                    <p className="text-xs text-slate-500">Conciliado extracto</p>
                    <p className="text-base font-bold text-emerald-700 mt-1 font-mono tabular-nums">
                      {money(summary.bank_reconciled_total)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      {summary.lines_reconciled} cerradas · {summary.lines_partial}{' '}
                      parciales
                    </p>
                  </div>

                  <div className="p-4">
                    <p className="text-xs text-slate-500">Pendiente extracto</p>
                    <p className="text-base font-bold text-amber-700 mt-1 font-mono tabular-nums">
                      {money(summary.bank_pending_total)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      {summary.lines_pending} pendientes ·{' '}
                      {summary.lines_with_difference} con diferencia
                    </p>
                  </div>

                  <div className="p-4">
                    <p className="text-xs text-slate-500">
                      Diferencia Banco vs. Libros
                    </p>
                    <p
                      className={`text-base font-bold mt-1 font-mono tabular-nums ${
                        Math.abs(summary.difference_bank_vs_books) <= 0.01
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {money(summary.difference_bank_vs_books)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      Libros por conciliar: {money(summary.accounting_pending_total)}
                    </p>
                  </div>
                </div>

                {/* Nota explícita + acciones de cierre/reapertura */}
                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>
                      La conciliación no altera asientos ni saldos contables de
                      forma automática. Si detectas gastos bancarios o partidas no
                      contabilizadas, regístralos manualmente en Libro Diario.
                    </span>
                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('journal_entry')}
                        className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:underline whitespace-nowrap shrink-0"
                      >
                        Ir a Registrar Asiento Diario
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {statementEditable && canReconcile && (
                      <button
                        type="button"
                        disabled={busy || summary.lines_total === 0}
                        onClick={() =>
                          setActionModal({ kind: 'confirm_statement', notes: '' })
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap shrink-0"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Confirmar conciliación
                      </button>
                    )}
                    {canReopen &&
                      selectedStatement.confirmed_at &&
                      selectedStatement.status !== 'anulado' &&
                      summary.is_period_open && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setActionModal({
                              kind: 'reopen_statement',
                              reason: '',
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                        >
                          Reabrir conciliación
                        </button>
                      )}
                    {canVoidItems &&
                      !selectedStatement.confirmed_at &&
                      selectedStatement.status !== 'anulado' &&
                      summary.is_period_open && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setActionModal({ kind: 'void_statement', reason: '' })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-medium text-red-700 whitespace-nowrap shrink-0"
                        >
                          Anular extracto
                        </button>
                      )}
                  </div>
                </div>
              </div>

              {/* Barra central de cruce manual N-a-M / parcial */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
                  <div>
                    <p className="text-[11px] text-slate-500">
                      Seleccionado extracto ({matchTotals.bankAllocs.length})
                    </p>
                    <p className="text-sm font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                      {money(matchTotals.signedBank)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">
                      Seleccionado contabilidad ({matchTotals.accAllocs.length})
                    </p>
                    <p className="text-sm font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                      {money(matchTotals.signedAcc)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Diferencia cruce</p>
                    <p
                      className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${
                        matchTotals.canMatch ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {money(matchTotals.signedDiff)}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Nota del cruce (opcional)
                    </label>
                    <input
                      value={matchNotes}
                      onChange={e => setMatchNotes(e.target.value)}
                      disabled={!statementEditable || !canReconcile}
                      placeholder="Ej. Pago parcial o lote #2..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-500 disabled:bg-slate-50"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {(matchTotals.bankAllocs.length > 0 ||
                    matchTotals.accAllocs.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedBankAllocs({})
                        setSelectedAccAllocs({})
                      }}
                      className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
                    >
                      Limpiar selección
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || !statementEditable || !canReconcile || !matchTotals.canMatch}
                    onClick={() => void handleCreateManualMatch()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Confirmar cruce manual seleccionado
                  </button>
                </div>
              </div>

              {/* Dos paneles de comparación manual lado a lado */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
                {/* Panel 1: Extracto bancario */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-slate-200 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          1. Movimientos del extracto bancario
                        </h2>
                        <p className="text-xs text-slate-500">
                          Selecciona manualmente uno o varios movimientos y ajusta
                          el monto si el cruce es parcial.
                        </p>
                      </div>
                      {statementEditable && canCaptureStatements && (
                        <button
                          type="button"
                          onClick={() => setTab('extractos')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Agregar filas
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          value={bankSearch}
                          onChange={e => setBankSearch(e.target.value)}
                          placeholder="Buscar descripción, referencia, fecha o valor..."
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-500"
                        />
                      </div>
                      <select
                        value={bankStatusFilter}
                        onChange={e =>
                          setBankStatusFilter(e.target.value as LineStatusFilter)
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-slate-500"
                      >
                        <option value="todos">Todos los estados</option>
                        <option value="pendiente">Pendientes</option>
                        <option value="parcialmente_conciliado">
                          Parciales
                        </option>
                        <option value="con_diferencia">Con diferencia</option>
                        <option value="conciliado">Conciliados</option>
                        <option value="anulado">Anulados</option>
                      </select>
                    </div>
                  </div>

                  {filteredBankLines.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                      <p>
                        {bankLines.length === 0
                          ? 'Este extracto todavía no tiene movimientos capturados.'
                          : 'Ningún movimiento coincide con el filtro actual.'}
                      </p>
                      {bankLines.length === 0 && statementEditable && canCaptureStatements && (
                        <button
                          type="button"
                          onClick={() => setTab('extractos')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium"
                        >
                          Capturar movimientos manualmente
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
                      {filteredBankLines.map(line => {
                        const rem = round2(line.remaining_amount ?? line.amount)
                        const isChecked =
                          selectedBankAllocs[line.id] !== undefined
                        const canSelect =
                          statementEditable &&
                          canReconcile &&
                          line.status !== 'anulado' &&
                          rem > 0.009
                        const hints = visualHints.get(line.id) || []
                        const stMeta = STATUS_META[line.status]

                        return (
                          <div
                            key={line.id}
                            className={`px-4 py-3 text-xs transition-colors ${
                              isChecked
                                ? 'bg-slate-50'
                                : 'hover:bg-slate-50/70'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!canSelect}
                                onChange={() => toggleBankLineSelection(line)}
                                aria-label={`Seleccionar ${line.description}`}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                              />

                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="font-semibold text-slate-900 leading-snug">
                                    {line.description}
                                  </p>
                                  <span
                                    className={`font-mono font-bold tabular-nums whitespace-nowrap shrink-0 ${
                                      line.direction === 'credit'
                                        ? 'text-emerald-700'
                                        : 'text-slate-900'
                                    }`}
                                  >
                                    {line.direction === 'credit' ? '+' : '-'}
                                    {money(line.amount)}
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
                                  <span>
                                    #{line.line_number} · {fmtDate(line.tx_date)}
                                  </span>
                                  {line.bank_reference && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono">
                                        Ref: {line.bank_reference}
                                      </span>
                                    </>
                                  )}
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={`font-semibold ${
                                      stMeta?.toneClass || 'text-slate-600'
                                    }`}
                                  >
                                    {stMeta?.label || line.status}
                                  </span>
                                  {rem < line.amount - 0.009 &&
                                    line.status !== 'anulado' && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="text-slate-700 font-medium">
                                          Pendiente: {money(rem)}
                                        </span>
                                      </>
                                    )}
                                </div>

                                {line.difference_reason && (
                                  <p className="text-[11px] text-red-700">
                                    Motivo registrado: {line.difference_reason}
                                  </p>
                                )}

                                {/* Sugerencia visual estrictamente no vinculante */}
                                {hints.length > 0 && rem > 0.009 && (
                                  <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-slate-600">
                                    <span>Sugerencia visual (no vinculante):</span>
                                    {hints.slice(0, 1).map(h => (
                                      <button
                                        key={h.accLineId}
                                        type="button"
                                        onClick={() =>
                                          setHighlightedAccLineId(h.accLineId)
                                        }
                                        className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                                      >
                                        {h.entryNumber} ({h.scoreLabel})
                                      </button>
                                    ))}
                                  </div>
                                )}

                                {/* Monto parcial + acciones de fila */}
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                  {isChecked ? (
                                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700">
                                      <span>Monto a conciliar:</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        max={rem}
                                        value={selectedBankAllocs[line.id] ?? ''}
                                        onChange={e => {
                                          const val = Number(e.target.value)
                                          setSelectedBankAllocs(prev => ({
                                            ...prev,
                                            [line.id]: Number.isFinite(val)
                                              ? Math.min(rem, Math.max(0, val))
                                              : 0,
                                          }))
                                        }}
                                        className="w-28 px-2 py-1 rounded border border-slate-300 font-mono text-xs text-slate-900 tabular-nums"
                                      />
                                    </label>
                                  ) : (
                                    <span />
                                  )}

                                  {statementEditable &&
                                    line.status !== 'anulado' && (
                                      <div className="flex items-center gap-3 text-[11px]">
                                        {canReconcile && line.status !== 'conciliado' && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setActionModal({
                                                kind: 'mark_diff',
                                                line,
                                                hasDiff: !line.difference_reason,
                                                reason:
                                                  line.difference_reason || '',
                                              })
                                            }
                                            className="font-medium text-slate-600 hover:text-slate-900"
                                          >
                                            {line.difference_reason
                                              ? 'Quitar diferencia'
                                              : 'Marcar diferencia'}
                                          </button>
                                        )}
                                        {canVoidItems && (line.matched_amount ?? 0) <= 0.009 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setActionModal({
                                                kind: 'void_line',
                                                line,
                                                reason: '',
                                              })
                                            }
                                            className="font-medium text-red-700 hover:text-red-900"
                                          >
                                            Anular línea
                                          </button>
                                        )}
                                      </div>
                                    )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Panel 2: Contabilidad real (acc_entries + acc_lines) */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-slate-200 space-y-3">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        2. Movimientos en libros contables (acc_entries /
                        acc_lines)
                      </h2>
                      <p className="text-xs text-slate-500">
                        Asientos contabilizados de la cuenta PUC{' '}
                        <span className="font-mono font-semibold text-slate-700">
                          {summary.acc_account_code} {summary.acc_account_name}
                        </span>{' '}
                        hasta el {fmtDate(summary.cutoff_date)}.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          value={ledgerSearch}
                          onChange={e => setLedgerSearch(e.target.value)}
                          placeholder="Buscar número de asiento, concepto o valor..."
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-500"
                        />
                      </div>

                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ledgerPendingOnly}
                          onChange={e => setLedgerPendingOnly(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
                        />
                        Solo con saldo pendiente
                      </label>
                    </div>
                  </div>

                  {filteredLedgerLines.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                      <p>
                        No hay movimientos contables disponibles bajo el filtro
                        actual para esta cuenta PUC hasta el corte.
                      </p>
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate('journal_entry')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs font-medium hover:bg-slate-50"
                        >
                          Registrar asiento en Libro Diario
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
                      {filteredLedgerLines.map(line => {
                        const isChecked =
                          selectedAccAllocs[line.acc_line_id] !== undefined
                        const canSelect =
                          statementEditable &&
                          canReconcile &&
                          line.remaining_amount > 0.009
                        const isHighlighted =
                          highlightedAccLineId === line.acc_line_id

                        return (
                          <div
                            key={line.acc_line_id}
                            className={`px-4 py-3 text-xs transition-colors ${
                              isChecked
                                ? 'bg-slate-50'
                                : isHighlighted
                                  ? 'bg-amber-50/70'
                                  : 'hover:bg-slate-50/70'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!canSelect}
                                onChange={() => toggleLedgerLineSelection(line)}
                                aria-label={`Seleccionar asiento ${line.entry_number}`}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                              />

                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="font-semibold text-slate-900 leading-snug">
                                    <span className="font-mono">
                                      {line.entry_number}
                                    </span>{' '}
                                    · {line.entry_description}
                                  </p>
                                  <span
                                    className={`font-mono font-bold tabular-nums whitespace-nowrap shrink-0 ${
                                      line.direction === 'credit'
                                        ? 'text-emerald-700'
                                        : 'text-slate-900'
                                    }`}
                                  >
                                    {line.debit > 0
                                      ? `Déb ${money(line.debit)}`
                                      : `Créd ${money(line.credit)}`}
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
                                  <span>{fmtDate(line.entry_date)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>Origen: {line.source_type}</span>
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={
                                      line.remaining_amount <= 0.009
                                        ? 'text-emerald-700 font-semibold'
                                        : 'text-slate-700 font-medium'
                                    }
                                  >
                                    {line.remaining_amount <= 0.009
                                      ? 'Totalmente conciliado'
                                      : `Por conciliar: ${money(line.remaining_amount)}`}
                                  </span>
                                </div>

                                {line.memo && (
                                  <p className="text-[11px] text-slate-500">
                                    Detalle línea: {line.memo}
                                  </p>
                                )}

                                {isChecked && (
                                  <div className="pt-1">
                                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700">
                                      <span>Monto a cruzar:</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        max={line.remaining_amount}
                                        value={
                                          selectedAccAllocs[line.acc_line_id] ??
                                          ''
                                        }
                                        onChange={e => {
                                          const val = Number(e.target.value)
                                          setSelectedAccAllocs(prev => ({
                                            ...prev,
                                            [line.acc_line_id]: Number.isFinite(
                                              val
                                            )
                                              ? Math.min(
                                                  line.remaining_amount,
                                                  Math.max(0, val)
                                                )
                                              : 0,
                                          }))
                                        }}
                                        className="w-28 px-2 py-1 rounded border border-slate-300 font-mono text-xs text-slate-900 tabular-nums"
                                      />
                                    </label>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Tabla de cruces manuales del extracto */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    Cruces manuales registrados en este extracto (
                    {matches.filter(m => m.status === 'activo').length} activos)
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {matches.filter(m => m.status === 'anulado').length} anulados
                  </span>
                </div>

                {matches.length === 0 ? (
                  <p className="p-6 text-xs text-slate-500 text-center">
                    Aún no se han realizado cruces manuales en este extracto.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Movimiento extracto
                          </th>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Asiento contable (acc_entries)
                          </th>
                          <th className="text-right px-4 py-2.5 font-semibold">
                            Monto cruzado
                          </th>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Usuario y fecha
                          </th>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Estado
                          </th>
                          <th className="text-right px-4 py-2.5 font-semibold">
                            Acción
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {matches.map(m => {
                          const bLine = bankLineById.get(m.statement_line_id)
                          const aLine = ledgerLineById.get(m.acc_line_id)
                          return (
                            <tr
                              key={m.id}
                              className={
                                m.status === 'anulado'
                                  ? 'bg-slate-50/60 text-slate-400'
                                  : 'hover:bg-slate-50/70'
                              }
                            >
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-slate-900">
                                  {bLine?.description || 'Movimiento'}
                                </p>
                                <p className="text-[11px] text-slate-500 tabular-nums">
                                  {bLine ? fmtDate(bLine.tx_date) : ''} ·{' '}
                                  {bLine?.bank_reference || 'Sin ref.'}
                                </p>
                              </td>
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-slate-900">
                                  <span className="font-mono">
                                    {aLine?.entry_number || 'Asiento'}
                                  </span>{' '}
                                  · {aLine?.entry_description || ''}
                                </p>
                                {m.notes && (
                                  <p className="text-[11px] text-slate-500">
                                    Nota: {m.notes}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-slate-900">
                                {money(m.matched_amount)}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums">
                                <p>{m.created_by_name || 'Usuario'}</p>
                                <p className="text-[11px] text-slate-500">
                                  {fmtDateTime(m.created_at)}
                                </p>
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`font-semibold ${
                                    m.status === 'activo'
                                      ? 'text-emerald-700'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {m.status === 'activo' ? 'Activo' : 'Anulado'}
                                </span>
                                {m.void_reason && (
                                  <p className="text-[11px] text-slate-500">
                                    {m.void_reason}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {statementEditable && canVoidItems && m.status === 'activo' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActionModal({
                                        kind: 'void_match',
                                        match: m,
                                        reason: '',
                                      })
                                    }
                                    className="text-red-700 hover:text-red-900 font-medium whitespace-nowrap"
                                  >
                                    Deshacer cruce
                                  </button>
                                )}
                              </td>
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
        </>
      )}

      {/* PESTAÑA 2: EXTRACTOS Y CAPTURA MANUAL */}
      {!loadingInit && tab === 'extractos' && (
        <div className="space-y-5">
          {!selectedAccount ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
              Registra primero una cuenta bancaria en la pestaña «Cuentas bancarias».
            </div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Captura manual de movimientos del extracto
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {selectedStatement
                        ? `Extracto destino: ${selectedStatement.statement_code} · Corte ${fmtDate(selectedStatement.cutoff_date)}`
                        : 'Crea primero un extracto manual para esta cuenta bancaria.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <input
                      ref={csvFileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={e => void handleCsvFileSelected(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={handleDownloadCsvTemplate}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Plantilla CSV
                    </button>
                    <button
                      type="button"
                      disabled={!statementEditable || !canCaptureStatements}
                      onClick={() => csvFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Cargar CSV para revisión manual
                    </button>
                  </div>
                </div>

                {!selectedStatement ? (
                  <div className="py-6 text-center space-y-3">
                    <p className="text-xs sm:text-sm text-slate-600">
                      Aún no has creado un extracto manual para la cuenta
                      seleccionada.
                    </p>
                    {canCaptureStatements && selectedAccount.active && (
                      <button
                        type="button"
                        onClick={openNewStatementModal}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Crear extracto manual
                      </button>
                    )}
                  </div>
                ) : !statementEditable || !canCaptureStatements ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
                    {!canCaptureStatements
                      ? 'Tu perfil tiene acceso de solo lectura para la captura de movimientos en este extracto.'
                      : selectedStatement.confirmed_at
                        ? 'Este extracto se encuentra confirmado y bloqueado; requiere reapertura formal antes de agregar movimientos.'
                        : `Este extracto está en estado «${STATUS_META[selectedStatement.status]?.label || selectedStatement.status}» o su periodo contable está cerrado; no admite nuevos movimientos.`}
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            <th className="px-2.5 py-2 text-left font-semibold">
                              Fecha tx *
                            </th>
                            <th className="px-2.5 py-2 text-left font-semibold">
                              Descripción *
                            </th>
                            <th className="px-2.5 py-2 text-left font-semibold">
                              Referencia
                            </th>
                            <th className="px-2.5 py-2 text-left font-semibold">
                              Tipo *
                            </th>
                            <th className="px-2.5 py-2 text-right font-semibold">
                              Monto *
                            </th>
                            <th className="px-2.5 py-2 text-right font-semibold">
                              Saldo reportado
                            </th>
                            <th className="px-2.5 py-2 text-left font-semibold">
                              Notas
                            </th>
                            <th className="px-2 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {manualRows.map((row, idx) => (
                            <tr key={idx}>
                              <td className="p-2">
                                <input
                                  type="date"
                                  value={row.tx_date}
                                  onChange={e =>
                                    setManualRows(prev =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? { ...r, tx_date: e.target.value }
                                          : r
                                      )
                                    )
                                  }
                                  className="px-2 py-1.5 rounded border border-slate-200 text-xs font-mono"
                                />
                              </td>
                              <td className="p-2 min-w-[200px]">
                                <input
                                  value={row.description}
                                  onChange={e =>
                                    setManualRows(prev =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? { ...r, description: e.target.value }
                                          : r
                                      )
                                    )
                                  }
                                  placeholder="Concepto del movimiento bancario"
                                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  value={row.bank_reference || ''}
                                  onChange={e =>
                                    setManualRows(prev =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? {
                                              ...r,
                                              bank_reference: e.target.value,
                                            }
                                          : r
                                      )
                                    )
                                  }
                                  placeholder="REF / DOC"
                                  className="w-28 px-2 py-1.5 rounded border border-slate-200 text-xs font-mono"
                                />
                              </td>
                              <td className="p-2">
                                <select
                                  value={row.direction}
                                  onChange={e =>
                                    setManualRows(prev =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? {
                                              ...r,
                                              direction: e.target.value as
                                                | 'credit'
                                                | 'debit',
                                            }
                                          : r
                                      )
                                    )
                                  }
                                  className="px-2 py-1.5 rounded border border-slate-200 bg-white text-xs"
                                >
                                  <option value="credit">Abono (+)</option>
                                  <option value="debit">Cargo (-)</option>
                                </select>
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={row.amount || ''}
                                  onChange={e =>
                                    setManualRows(prev =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? {
                                              ...r,
                                              amount: Number(e.target.value),
                                            }
                                          : r
                                      )
                                    )
                                  }
                                  placeholder="0.00"
                                  className="w-28 px-2 py-1.5 rounded border border-slate-200 text-xs text-right font-mono tabular-nums"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={row.reported_balance ?? ''}
                                  onChange={e =>
                                    setManualRows(prev =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? {
                                              ...r,
                                              reported_balance:
                                                e.target.value.trim() === ''
                                                  ? null
                                                  : Number(e.target.value),
                                            }
                                          : r
                                      )
                                    )
                                  }
                                  placeholder="Opcional"
                                  className="w-28 px-2 py-1.5 rounded border border-slate-200 text-xs text-right font-mono tabular-nums"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  value={row.notes || ''}
                                  onChange={e =>
                                    setManualRows(prev =>
                                      prev.map((r, i) =>
                                        i === idx
                                          ? { ...r, notes: e.target.value }
                                          : r
                                      )
                                    )
                                  }
                                  placeholder="Nota opcional"
                                  className="w-36 px-2 py-1.5 rounded border border-slate-200 text-xs"
                                />
                              </td>
                              <td className="p-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualRows(prev =>
                                      prev.length > 1
                                        ? prev.filter((_, i) => i !== idx)
                                        : [emptyDraftRow()]
                                    )
                                  }
                                  className="text-slate-400 hover:text-red-700 p-1"
                                  aria-label="Quitar fila"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setManualRows(prev => [...prev, emptyDraftRow()])
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Agregar fila manual
                        </button>
                        {csvPreviewOrigin === 'csv_manual' && (
                          <span className="text-xs text-slate-600">
                            Origen actual: vista previa CSV pendiente de
                            confirmación manual
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleSaveManualLines()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        Guardar movimientos en extracto
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Lista de extractos registrados */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    Extractos registrados de la empresa ({statements.length})
                  </h2>
                </div>
                {statements.length === 0 ? (
                  <p className="p-6 text-xs text-slate-500 text-center">
                    No existen extractos registrados todavía.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Código
                          </th>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Cuenta bancaria
                          </th>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Período y corte
                          </th>
                          <th className="text-right px-4 py-2.5 font-semibold">
                            Saldo inicial
                          </th>
                          <th className="text-right px-4 py-2.5 font-semibold">
                            Saldo reportado
                          </th>
                          <th className="text-left px-4 py-2.5 font-semibold">
                            Estado
                          </th>
                          <th className="text-right px-4 py-2.5 font-semibold">
                            Acción
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statements.map(s => {
                          const bAcc = bankAccounts.find(
                            b => b.id === s.bank_account_id
                          )
                          return (
                            <tr key={s.id} className="hover:bg-slate-50">
                              <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                                {s.statement_code}
                              </td>
                              <td className="px-4 py-2.5">
                                {bAcc
                                  ? `${bAcc.bank_name} — ${bAcc.account_alias} (${bAcc.account_number_masked})`
                                  : 'Cuenta bancaria'}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-slate-600">
                                {fmtDate(s.period_start)} – {fmtDate(s.period_end)}{' '}
                                · Corte {fmtDate(s.cutoff_date)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                                {money(s.opening_balance)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                                {s.reported_closing_balance !== null
                                  ? money(s.reported_closing_balance)
                                  : '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`font-semibold ${
                                    STATUS_META[s.status]?.toneClass ||
                                    'text-slate-700'
                                  }`}
                                >
                                  {STATUS_META[s.status]?.label || s.status}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedAccountId(s.bank_account_id)
                                    setSelectedStatementId(s.id)
                                    setTab('conciliacion')
                                  }}
                                  className="font-semibold text-slate-900 hover:underline whitespace-nowrap"
                                >
                                  Abrir en conciliación
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* PESTAÑA 3: CUENTAS BANCARIAS VINCULADAS AL PUC */}
      {!loadingInit && tab === 'cuentas' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cuentas bancarias de la empresa
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Cada cuenta bancaria se vincula a una cuenta contable imputable
                existente del PUC (acc_accounts) y almacena únicamente los
                últimos dígitos enmascarados (****XXXX).
              </p>
            </div>
            {canManageAccounts && (
              <button
                type="button"
                onClick={openNewAccountModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Nueva cuenta bancaria
              </button>
            )}
          </div>

          {bankAccounts.length === 0 ? (
            <div className="p-8 text-center text-xs sm:text-sm text-slate-500">
              No has registrado cuentas bancarias todavía.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">
                      Banco y alias
                    </th>
                    <th className="text-left px-4 py-2.5 font-semibold">
                      Tipo / Número enmascarado
                    </th>
                    <th className="text-left px-4 py-2.5 font-semibold">
                      Cuenta PUC vinculada (acc_accounts)
                    </th>
                    <th className="text-left px-4 py-2.5 font-semibold">
                      Moneda
                    </th>
                    <th className="text-left px-4 py-2.5 font-semibold">
                      Estado
                    </th>
                    <th className="text-right px-4 py-2.5 font-semibold">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bankAccounts.map(acc => (
                    <tr key={acc.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {acc.bank_name} · {acc.account_alias}
                        </p>
                        {acc.notes && (
                          <p className="text-[11px] text-slate-500">
                            {acc.notes}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">
                          {ACCOUNT_TYPE_LABELS[acc.account_type] ||
                            acc.account_type}
                        </p>
                        <p className="font-mono text-slate-500">
                          {acc.account_number_masked}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-800">
                        {acc.acc_accounts
                          ? `${acc.acc_accounts.code} · ${acc.acc_accounts.name}`
                          : acc.acc_account_id}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">
                        {acc.currency}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-semibold ${
                            acc.active ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {acc.active ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                        {canManageAccounts && (
                          <button
                            type="button"
                            onClick={() => openEditAccountModal(acc)}
                            className="font-medium text-slate-700 hover:text-slate-900"
                          >
                            Editar
                          </button>
                        )}
                        {canManageAccounts && (
                          <button
                            type="button"
                            onClick={() =>
                              setActionModal({
                                kind: 'toggle_account',
                                account: acc,
                                reason: '',
                              })
                            }
                            className={`font-medium ${
                              acc.active
                                ? 'text-amber-700 hover:text-amber-900'
                                : 'text-emerald-700 hover:text-emerald-900'
                            }`}
                          >
                            {acc.active ? 'Desactivar' : 'Reactivar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PESTAÑA 4: HISTORIAL Y AUDITORÍA */}
      {!loadingInit && tab === 'historial' && (() => {
        const displayedEvents =
          historyScope === 'extracto' && selectedStatement
            ? statementEvents
            : historyEvents

        return (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Bitácora inmutable de conciliación bancaria
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Trazabilidad de cuentas, extractos, cruces manuales,
                  diferencias, confirmaciones y reaperturas.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {selectedStatement && (
                  <select
                    value={historyScope}
                    onChange={e =>
                      setHistoryScope(e.target.value as 'extracto' | 'empresa')
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700"
                    aria-label="Alcance de eventos"
                  >
                    <option value="empresa">
                      Todo el módulo ({historyEvents.length})
                    </option>
                    <option value="extracto">
                      Extracto {selectedStatement.statement_code} ({statementEvents.length})
                    </option>
                  </select>
                )}
                <span className="text-xs text-slate-500 tabular-nums">
                  {displayedEvents.length} eventos
                </span>
              </div>
            </div>

            {displayedEvents.length === 0 ? (
              <p className="p-8 text-xs text-slate-500 text-center">
                Sin eventos registrados en auditoría para este filtro.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                {displayedEvents.map(ev => (
                <div
                  key={ev.id}
                  className="px-5 py-3 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-semibold text-slate-900">
                      {EVENT_LABELS[ev.action] || ev.action}
                    </p>
                    <p className="text-slate-600 truncate">
                      {Object.entries(ev.detail || {})
                        .filter(([, v]) => v !== null && v !== undefined && v !== '')
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(' · ') || 'Sin detalles adicionales'}
                    </p>
                  </div>
                  <div className="text-[11px] text-slate-500 sm:text-right shrink-0 tabular-nums">
                    <p>
                      {ev.actor_name || 'Usuario'} ({ev.actor_role || 'rol'})
                    </p>
                    <p>{fmtDateTime(ev.created_at)}</p>
                  </div>
                </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* MODAL CUENTA BANCARIA */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={e => void handleSaveAccount(e)}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                {editingAccount
                  ? 'Editar cuenta bancaria'
                  : 'Registrar cuenta bancaria'}
              </h3>
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {ledgerAccounts.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
                <p>
                  No hay cuentas contables imputables de tipo Activo en tu Plan
                  de Cuentas (`acc_accounts`). Crea o activa primero la cuenta
                  contable de Bancos en el módulo de Contabilidad.
                </p>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => {
                      setAccountModalOpen(false)
                      onNavigate('accounting')
                    }}
                    className="font-semibold underline"
                  >
                    Ir al Catálogo PUC NIIF
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Entidad bancaria *
                    </label>
                    <input
                      required
                      value={accountForm.bank_name}
                      onChange={e =>
                        setAccountForm(p => ({
                          ...p,
                          bank_name: e.target.value,
                        }))
                      }
                      placeholder="Ej. Bancolombia, Davivienda..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Alias interno *
                    </label>
                    <input
                      required
                      value={accountForm.account_alias}
                      onChange={e =>
                        setAccountForm(p => ({
                          ...p,
                          account_alias: e.target.value,
                        }))
                      }
                      placeholder="Ej. Cuenta Operativa Principal"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tipo de cuenta *
                    </label>
                    <select
                      value={accountForm.account_type}
                      onChange={e =>
                        setAccountForm(p => ({
                          ...p,
                          account_type: e.target.value as BankAccountType,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm"
                    >
                      {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {editingAccount
                        ? 'Nuevos últimos 4 dígitos (opcional)'
                        : 'Últimos 4 dígitos o número *'}
                    </label>
                    <input
                      required={!editingAccount}
                      value={accountForm.account_number_raw}
                      onChange={e =>
                        setAccountForm(p => ({
                          ...p,
                          account_number_raw: e.target.value,
                        }))
                      }
                      placeholder={
                        editingAccount
                          ? editingAccount.account_number_masked
                          : 'Ej. 4821'
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Moneda
                    </label>
                    <input
                      value={accountForm.currency}
                      onChange={e =>
                        setAccountForm(p => ({
                          ...p,
                          currency: e.target.value.toUpperCase(),
                        }))
                      }
                      maxLength={6}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm font-mono"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  Por seguridad, el sistema nunca guarda ni muestra el número
                  completo: solo conserva los últimos 4 dígitos enmascarados
                  (****XXXX).
                </p>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Cuenta contable PUC vinculada (`acc_accounts`) *
                  </label>
                  <select
                    required
                    value={accountForm.acc_account_id}
                    onChange={e =>
                      setAccountForm(p => ({
                        ...p,
                        acc_account_id: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm"
                  >
                    <option value="">Selecciona cuenta contable de activo...</option>
                    {ledgerAccounts.map(la => (
                      <option key={la.id} value={la.id}>
                        {la.code} · {la.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Notas (opcional)
                  </label>
                  <input
                    value={accountForm.notes}
                    onChange={e =>
                      setAccountForm(p => ({ ...p, notes: e.target.value }))
                    }
                    placeholder="Titular, sucursal bancaria o uso operativo..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              {ledgerAccounts.length > 0 && (
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {busy ? 'Guardando…' : 'Guardar cuenta bancaria'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* MODAL NUEVO EXTRACTO MANUAL */}
      {statementModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={e => void handleCreateStatement(e)}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                Crear extracto bancario manual
              </h3>
              <button
                type="button"
                onClick={() => setStatementModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cuenta bancaria *
                </label>
                <select
                  required
                  value={statementForm.bank_account_id}
                  onChange={e =>
                    setStatementForm(p => ({
                      ...p,
                      bank_account_id: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm"
                >
                  <option value="">Selecciona cuenta activa...</option>
                  {bankAccounts
                    .filter(b => b.active)
                    .map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bank_name} — {b.account_alias} (
                        {b.account_number_masked})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Inicio período *
                  </label>
                  <input
                    required
                    type="date"
                    value={statementForm.period_start}
                    onChange={e =>
                      setStatementForm(p => ({
                        ...p,
                        period_start: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fin período *
                  </label>
                  <input
                    required
                    type="date"
                    value={statementForm.period_end}
                    onChange={e =>
                      setStatementForm(p => ({
                        ...p,
                        period_end: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fecha de corte *
                  </label>
                  <input
                    required
                    type="date"
                    value={statementForm.cutoff_date}
                    onChange={e =>
                      setStatementForm(p => ({
                        ...p,
                        cutoff_date: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Saldo inicial del extracto *
                  </label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={statementForm.opening_balance}
                    onChange={e =>
                      setStatementForm(p => ({
                        ...p,
                        opening_balance: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Saldo final reportado (opcional)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={statementForm.reported_closing_balance}
                    onChange={e =>
                      setStatementForm(p => ({
                        ...p,
                        reported_closing_balance: e.target.value,
                      }))
                    }
                    placeholder="Según PDF del banco"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Observaciones (opcional)
                </label>
                <input
                  value={statementForm.notes}
                  onChange={e =>
                    setStatementForm(p => ({ ...p, notes: e.target.value }))
                  }
                  placeholder="Ej. Extracto oficial mes en curso"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setStatementModalOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Creando…' : 'Crear extracto'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL UNIFICADO DE CONFIRMACIONES Y MOTIVOS */}
      {actionModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={e => void handleExecuteActionModal(e)}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                {actionModal.kind === 'mark_diff'
                  ? actionModal.hasDiff
                    ? 'Documentar diferencia bancaria'
                    : 'Retirar marca de diferencia'
                  : actionModal.kind === 'void_line'
                    ? 'Anular movimiento del extracto'
                    : actionModal.kind === 'void_match'
                      ? 'Deshacer cruce manual'
                      : actionModal.kind === 'confirm_statement'
                        ? 'Confirmar conciliación manual'
                        : actionModal.kind === 'reopen_statement'
                          ? 'Reabrir conciliación confirmada'
                          : actionModal.kind === 'void_statement'
                            ? 'Anular extracto bancario'
                            : actionModal.account.active
                              ? 'Desactivar cuenta bancaria'
                              : 'Reactivar cuenta bancaria'}
              </h3>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionModal.kind === 'mark_diff' && (
              <div className="space-y-3 text-xs text-slate-600">
                <p>
                  {actionModal.hasDiff
                    ? 'Registra la explicación contable o bancaria de esta diferencia. No se creará ni modificará ningún asiento automático.'
                    : '¿Confirmas retirar la marca de diferencia sobre este movimiento?'}
                </p>
                {actionModal.hasDiff && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Motivo de la diferencia *
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={actionModal.reason}
                      onChange={e =>
                        setActionModal(prev =>
                          prev?.kind === 'mark_diff'
                            ? { ...prev, reason: e.target.value }
                            : prev
                        )
                      }
                      placeholder="Ej. Comisión bancaria pendiente de registrar manualmente en Libro Diario..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900"
                    />
                  </div>
                )}
              </div>
            )}

            {(actionModal.kind === 'void_line' ||
              actionModal.kind === 'void_match' ||
              actionModal.kind === 'reopen_statement' ||
              actionModal.kind === 'void_statement') && (
              <div className="space-y-3 text-xs text-slate-600">
                <p>
                  Esta acción queda registrada de forma inmutable en la bitácora
                  de auditoría.
                </p>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Motivo obligatorio *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={actionModal.reason}
                    onChange={e =>
                      setActionModal(prev =>
                        prev && 'reason' in prev
                          ? { ...prev, reason: e.target.value }
                          : prev
                      )
                    }
                    placeholder="Describe el motivo de auditoría..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>
              </div>
            )}

            {actionModal.kind === 'confirm_statement' && summary && (
              <div className="space-y-3 text-xs text-slate-600">
                <p>
                  Se registrará tu confirmación manual sobre el extracto{' '}
                  <strong className="text-slate-900">
                    {summary.statement_code}
                  </strong>
                  . Diferencia actual Extracto vs. Libros:{' '}
                  <strong className="font-mono text-slate-900">
                    {money(summary.difference_bank_vs_books)}
                  </strong>
                  .
                </p>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Nota de cierre / explicación{' '}
                    {Math.abs(summary.difference_bank_vs_books) > 0.01 &&
                    summary.lines_with_difference === 0
                      ? '(obligatoria por diferencia de saldo) *'
                      : '(opcional)'}
                  </label>
                  <textarea
                    required={
                      Math.abs(summary.difference_bank_vs_books) > 0.01 &&
                      summary.lines_with_difference === 0
                    }
                    rows={3}
                    value={actionModal.notes}
                    onChange={e =>
                      setActionModal(prev =>
                        prev?.kind === 'confirm_statement'
                          ? { ...prev, notes: e.target.value }
                          : prev
                      )
                    }
                    placeholder="Observaciones finales de la conciliación..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>
              </div>
            )}

            {actionModal.kind === 'toggle_account' && (
              <div className="space-y-3 text-xs text-slate-600">
                <p>
                  {actionModal.account.active
                    ? `La cuenta ${actionModal.account.bank_name} — ${actionModal.account.account_alias} quedará inactiva y no permitirá crear nuevos extractos.`
                    : `La cuenta ${actionModal.account.bank_name} — ${actionModal.account.account_alias} volverá a estar disponible para nuevos extractos.`}
                </p>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Motivo (opcional)
                  </label>
                  <input
                    value={actionModal.reason}
                    onChange={e =>
                      setActionModal(prev =>
                        prev?.kind === 'toggle_account'
                          ? { ...prev, reason: e.target.value }
                          : prev
                      )
                    }
                    placeholder="Observación de auditoría..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Procesando…' : 'Confirmar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
