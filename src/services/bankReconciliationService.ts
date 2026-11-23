import { supabase } from '../lib/supabase'
import { round2 } from '../lib/tax'
import type {
  BankAccountRecord,
  BankAccountType,
  BankReconciliationEventRecord,
  BankReconciliationMatchRecord,
  BankStatementLineRecord,
  BankStatementRecord,
  BankStatementSummary,
  LedgerBankLineCandidate,
} from '../types'

export interface PostableLedgerAccount {
  id: string
  code: string
  name: string
  type: string
  nature: string
  is_postable: boolean
  active: boolean
}

export interface ManualStatementLineInput {
  tx_date: string
  post_date?: string | null
  description: string
  bank_reference?: string | null
  direction: 'credit' | 'debit'
  amount: number
  reported_balance?: number | null
  notes?: string | null
}

export interface NonBindingHint {
  accLineId: string
  entryNumber: string
  entryDate: string
  amount: number
  remainingAmount: number
  scoreLabel: string
}

/* ============================================================================
 * 1. LECTURA DE CUENTAS BANCARIAS Y CATÁLOGO CONTABLE (acc_accounts)
 * ========================================================================== */

export async function fetchPostableBankLedgerAccounts(
  companyId?: string
): Promise<PostableLedgerAccount[]> {
  let query = supabase
    .from('acc_accounts')
    .select('id, code, name, type, nature, is_postable, active')
    .eq('active', true)
    .eq('is_postable', true)
    .eq('type', 'activo')

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query.order('code', { ascending: true })
  if (error) throw error
  return (data || []) as PostableLedgerAccount[]
}

export async function fetchBankAccounts(
  companyId?: string
): Promise<BankAccountRecord[]> {
  let bankQuery = supabase
    .from('bank_accounts')
    .select('*')
    .order('bank_name', { ascending: true })

  let accQuery = supabase
    .from('acc_accounts')
    .select('id, company_id, code, name, type, nature')

  if (companyId) {
    bankQuery = bankQuery.eq('company_id', companyId)
    accQuery = accQuery.eq('company_id', companyId)
  }

  const [bankRes, accRes] = await Promise.all([bankQuery, accQuery])
  if (bankRes.error) throw bankRes.error
  if (accRes.error) throw accRes.error

  const accById = new Map<string, BankAccountRecord['acc_accounts']>()
  for (const acc of (accRes.data || []) as Array<{
    id: string
    company_id: string
    code: string
    name: string
    type: string
    nature: string
  }>) {
    if (companyId && acc.company_id !== companyId) continue
    accById.set(acc.id, {
      id: acc.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      nature: acc.nature,
    })
  }

  return ((bankRes.data || []) as BankAccountRecord[])
    .filter(row => !companyId || row.company_id === companyId)
    .map(row => ({
      ...row,
      acc_accounts: accById.get(row.acc_account_id) || null,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return (a.bank_name || '').localeCompare(b.bank_name || '') ||
        (a.account_alias || '').localeCompare(b.account_alias || '')
    })
}

export async function upsertBankAccount(params: {
  id?: string | null
  bank_name: string
  account_alias: string
  account_type: BankAccountType
  account_number_raw: string
  acc_account_id: string
  currency?: string
  notes?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('bank_upsert_account', {
    p_id: params.id || null,
    p_bank_name: params.bank_name,
    p_account_alias: params.account_alias,
    p_account_type: params.account_type,
    p_account_number_raw: params.account_number_raw,
    p_acc_account_id: params.acc_account_id,
    p_currency: params.currency || 'COP',
    p_notes: params.notes || null,
  })
  if (error) throw error
  return String(data)
}

export async function toggleBankAccountStatus(params: {
  id: string
  active: boolean
  reason?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('bank_toggle_account_status', {
    p_id: params.id,
    p_active: params.active,
    p_reason: params.reason || null,
  })
  if (error) throw error
}

/* ============================================================================
 * 2. EXTRACTOS BANCARIOS MANUALES Y RESÚMENES
 * ========================================================================== */

export async function fetchBankStatements(
  bankAccountId?: string | null,
  companyId?: string
): Promise<BankStatementRecord[]> {
  let query = supabase
    .from('bank_statements')
    .select('*')
    .order('cutoff_date', { ascending: false })
    .limit(100)

  if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error) throw error

  return ((data || []) as BankStatementRecord[])
    .filter(row => !companyId || row.company_id === companyId)
    .sort(
      (a, b) =>
        (b.cutoff_date || '').localeCompare(a.cutoff_date || '') ||
        (b.created_at || '').localeCompare(a.created_at || '')
    )
}

export async function createBankStatement(params: {
  bank_account_id: string
  period_start: string
  period_end: string
  cutoff_date: string
  opening_balance: number
  reported_closing_balance?: number | null
  notes?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('bank_create_statement', {
    p_bank_account_id: params.bank_account_id,
    p_period_start: params.period_start,
    p_period_end: params.period_end,
    p_cutoff_date: params.cutoff_date,
    p_opening_balance: params.opening_balance,
    p_reported_closing_balance: params.reported_closing_balance ?? null,
    p_notes: params.notes || null,
  })
  if (error) throw error
  return String(data)
}

export async function fetchStatementSummary(
  statementId: string,
  support?: {
    companyId: string
    scope: 'lectura_diagnostico' | 'intervencion_asistida'
  }
): Promise<BankStatementSummary> {
  const { data, error } = support
    ? await supabase.rpc('bank_statement_summary_support', {
        p_statement_id: statementId,
        p_company_id: support.companyId,
        p_scope: support.scope,
      })
    : await supabase.rpc('bank_statement_summary', {
        p_statement_id: statementId,
      })

  if (error) throw error
  return data as BankStatementSummary
}

export async function fetchStatementWorkspace(params: {
  statement: BankStatementRecord
  bankAccount: BankAccountRecord
  supportCompanyId?: string
  supportScope?: 'lectura_diagnostico' | 'intervencion_asistida'
}): Promise<{
  summary: BankStatementSummary
  bankLines: BankStatementLineRecord[]
  ledgerLines: LedgerBankLineCandidate[]
  matches: BankReconciliationMatchRecord[]
  events: BankReconciliationEventRecord[]
}> {
  const { statement, bankAccount, supportCompanyId, supportScope } = params

  if (
    supportCompanyId &&
    (statement.company_id !== supportCompanyId ||
      bankAccount.company_id !== supportCompanyId)
  ) {
    throw new Error('La cuenta o el extracto no pertenecen a la empresa autorizada.')
  }

  const [
    summary,
    linesRes,
    stmtMatchesRes,
    accMatchesRes,
    entriesRes,
    eventsRes,
  ] = await Promise.all([
    fetchStatementSummary(
      statement.id,
      supportCompanyId
        ? {
            companyId: supportCompanyId,
            scope: supportScope || 'lectura_diagnostico',
          }
        : undefined
    ),
    supabase
      .from('bank_statement_lines')
      .select('*')
      .eq('company_id', statement.company_id)
      .eq('statement_id', statement.id)
      .order('line_number', { ascending: true }),
    supabase
      .from('bank_reconciliation_matches')
      .select('*')
      .eq('company_id', statement.company_id)
      .eq('statement_id', statement.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('bank_reconciliation_matches')
      .select('acc_line_id, matched_amount, status')
      .eq('company_id', statement.company_id)
      .eq('status', 'activo'),
    supabase
      .from('acc_entries')
      .select('id, company_id, number, entry_date, description, status, source_type')
      .eq('company_id', statement.company_id)
      .eq('status', 'contabilizado')
      .lte('entry_date', statement.cutoff_date)
      .order('entry_date', { ascending: false })
      .limit(600),
    supabase
      .from('bank_reconciliation_events')
      .select('*')
      .eq('company_id', statement.company_id)
      .eq('statement_id', statement.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  if (linesRes.error) throw linesRes.error
  if (stmtMatchesRes.error) throw stmtMatchesRes.error
  if (accMatchesRes.error) throw accMatchesRes.error
  if (entriesRes.error) throw entriesRes.error
  if (eventsRes.error) throw eventsRes.error

  const entryRows = ((entriesRes.data || []) as Array<{
    id: string
    company_id: string
    number: string
    entry_date: string
    description: string
    status: string
    source_type: string
  }>).filter(e => e.company_id === statement.company_id)
  const entryMap = new Map(entryRows.map(e => [e.id, e]))
  const entryIds = entryRows.map(e => e.id)

  const rawAccLines: Array<{
    id: string
    company_id: string
    entry_id: string
    account_id: string
    debit: number
    credit: number
    memo?: string | null
  }> = []

  if (entryIds.length > 0) {
    for (let i = 0; i < entryIds.length; i += 200) {
      const chunk = entryIds.slice(i, i + 200)
      const accLinesRes = await supabase
        .from('acc_lines')
        .select('id, company_id, entry_id, account_id, debit, credit, memo')
        .eq('company_id', statement.company_id)
        .eq('account_id', bankAccount.acc_account_id)
        .in('entry_id', chunk)
        .limit(1000)
      if (accLinesRes.error) throw accLinesRes.error
      const filteredChunk = ((accLinesRes.data || []) as typeof rawAccLines).filter(
        al => al.company_id === statement.company_id
      )
      rawAccLines.push(...filteredChunk)
    }
  }

  const matches = (stmtMatchesRes.data || []) as BankReconciliationMatchRecord[]

  // Acumulado conciliado por cada movimiento del extracto
  const matchedByStmtLine = new Map<string, number>()
  for (const m of matches) {
    if (m.status !== 'activo') continue
    matchedByStmtLine.set(
      m.statement_line_id,
      round2((matchedByStmtLine.get(m.statement_line_id) || 0) + Number(m.matched_amount || 0))
    )
  }

  const bankLines: BankStatementLineRecord[] = ((linesRes.data || []) as BankStatementLineRecord[])
    .map(line => {
      const matched = matchedByStmtLine.get(line.id) || 0
      const remaining = line.status === 'anulado' ? 0 : round2(Math.max(0, Number(line.amount || 0) - matched))
      return {
        ...line,
        matched_amount: matched,
        remaining_amount: remaining,
      }
    })
    .sort((a, b) => (a.tx_date || '').localeCompare(b.tx_date || '') || Number(a.line_number) - Number(b.line_number))

  // Acumulado conciliado global activo por cada acc_line dentro de la empresa (evita doble cruce entre extractos)
  const matchedByAccLine = new Map<string, number>()
  for (const m of (accMatchesRes.data || []) as Array<{ acc_line_id: string; matched_amount: number; status: string }>) {
    if (m.status !== 'activo') continue
    matchedByAccLine.set(
      m.acc_line_id,
      round2((matchedByAccLine.get(m.acc_line_id) || 0) + Number(m.matched_amount || 0))
    )
  }

  const accNature = (bankAccount.acc_accounts?.nature || 'debito').toLowerCase()
  const ledgerLines: LedgerBankLineCandidate[] = rawAccLines
    .map((raw): LedgerBankLineCandidate | null => {
      const entry = entryMap.get(raw.entry_id)
      if (!entry || entry.status !== 'contabilizado') return null
      if ((entry.entry_date || '') > (statement.cutoff_date || '')) return null
      const debit = round2(Number(raw.debit || 0))
      const credit = round2(Number(raw.credit || 0))
      const net = round2(Math.abs(debit - credit))
      if (net < 0.01) return null
      const matched = matchedByAccLine.get(raw.id) || 0
      const remaining = round2(Math.max(0, net - matched))
      // En cuenta Activo/Débito: débito contable corresponde a abono/crédito en extracto ('credit'); crédito contable a retiro/débito en extracto ('debit')
      const direction: 'credit' | 'debit' =
        accNature === 'credito'
          ? credit > debit
            ? 'credit'
            : 'debit'
          : debit > credit
            ? 'credit'
            : 'debit'

      return {
        acc_line_id: raw.id,
        entry_id: raw.entry_id,
        entry_number: entry.number || '',
        entry_date: entry.entry_date || '',
        entry_description: entry.description || '',
        source_type: entry.source_type || 'manual',
        account_id: raw.account_id,
        debit,
        credit,
        direction,
        amount: net,
        memo: raw.memo || null,
        matched_amount: matched,
        remaining_amount: remaining,
      }
    })
    .filter((x): x is LedgerBankLineCandidate => x !== null)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.entry_number.localeCompare(b.entry_number))

  return {
    summary,
    bankLines,
    ledgerLines,
    matches,
    events: (eventsRes.data || []) as BankReconciliationEventRecord[],
  }
}

export async function fetchAuditHistory(
  bankAccountId?: string | null,
  companyId?: string
): Promise<BankReconciliationEventRecord[]> {
  let query = supabase
    .from('bank_reconciliation_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(150)

  if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error) throw error
  return ((data || []) as BankReconciliationEventRecord[])
    .filter(row => !companyId || row.company_id === companyId)
}

/* ============================================================================
 * 3. OPERACIONES MANUALES VIA RPC
 * ========================================================================== */

export async function addManualStatementLines(params: {
  statement_id: string
  lines: ManualStatementLineInput[]
  source_origin?: 'manual' | 'csv_manual'
}): Promise<number> {
  const { data, error } = await supabase.rpc('bank_add_statement_lines', {
    p_statement_id: params.statement_id,
    p_lines: params.lines,
    p_source_origin: params.source_origin || 'manual',
  })
  if (error) throw error
  return Number(data || 0)
}

export async function voidStatementLine(lineId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('bank_void_statement_line', {
    p_line_id: lineId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function createManualMatch(params: {
  statement_id: string
  bank_allocations: Array<{ statement_line_id: string; amount: number }>
  acc_allocations: Array<{ acc_line_id: string; amount: number }>
  notes?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('bank_create_manual_match', {
    p_statement_id: params.statement_id,
    p_bank_allocations: params.bank_allocations,
    p_acc_allocations: params.acc_allocations,
    p_notes: params.notes || null,
  })
  if (error) throw error
  return String(data)
}

export async function markLineDifference(params: {
  line_id: string
  has_difference: boolean
  reason?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('bank_mark_line_difference', {
    p_line_id: params.line_id,
    p_has_difference: params.has_difference,
    p_reason: params.reason || null,
  })
  if (error) throw error
}

export async function voidMatch(matchId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('bank_void_match', {
    p_match_id: matchId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function confirmStatement(statementId: string, notes?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('bank_confirm_statement', {
    p_statement_id: statementId,
    p_notes: notes || null,
  })
  if (error) throw error
  return String(data)
}

export async function reopenStatement(statementId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('bank_reopen_statement', {
    p_statement_id: statementId,
    p_reason: reason,
  })
  if (error) throw error
  return String(data)
}

export async function voidStatement(statementId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('bank_void_statement', {
    p_statement_id: statementId,
    p_reason: reason,
  })
  if (error) throw error
}

/* ============================================================================
 * 4. PARSEO CSV CONTROLADO POR EL USUARIO (SOLO PREVISUALIZACIÓN)
 *    Nunca guarda ni concilia automáticamente.
 * ========================================================================== */

function parseFlexibleMoney(raw: string): number {
  const clean = (raw || '').replace(/[^\d.,-]/g, '').trim()
  if (!clean) return 0
  const neg = clean.startsWith('-') ? -1 : 1
  const unsigned = clean.replace(/-/g, '')
  const lastDot = unsigned.lastIndexOf('.')
  const lastComma = unsigned.lastIndexOf(',')

  let normalized = unsigned
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      normalized = unsigned.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = unsigned.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    const afterComma = unsigned.slice(lastComma + 1)
    normalized = afterComma.length === 3 && unsigned.length > 4
      ? unsigned.replace(/,/g, '')
      : unsigned.replace(',', '.')
  } else if (lastDot >= 0) {
    const parts = unsigned.split('.')
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = unsigned.replace(/\./g, '')
    }
  }

  const num = Number(normalized)
  return Number.isFinite(num) ? round2(num * neg) : 0
}

function normalizeDateString(raw: string): string {
  const s = (raw || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (dmy) {
    const d = dmy[1].padStart(2, '0')
    const m = dmy[2].padStart(2, '0')
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${y}-${m}-${d}`
  }
  return new Date().toLocaleDateString('sv-SE')
}

function splitCsvRow(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

export function parseManualCsvForPreview(csvText: string): ManualStatementLineInput[] {
  const lines = (csvText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const first = lines[0]
  const semiCount = (first.match(/;/g) || []).length
  const commaCount = (first.match(/,/g) || []).length
  const delimiter = semiCount > commaCount ? ';' : ','

  const headers = splitCsvRow(first, delimiter).map(h =>
    h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  )

  const findIdx = (rx: RegExp, fallback: number) => {
    const idx = headers.findIndex(h => rx.test(h))
    return idx >= 0 ? idx : fallback
  }

  const dateIdx = findIdx(/fecha.*trans|fecha|date|dia/, 0)
  const postDateIdx = findIdx(/fecha.*cont|registro|post/, -1)
  const descIdx = findIdx(/descripcion|concepto|detalle|movimiento|description/, 1)
  const refIdx = findIdx(/referencia|ref|documento|comprobante/, -1)
  const creditIdx = findIdx(/credito|abono|entrada|ingreso|credit/, -1)
  const debitIdx = findIdx(/debito|cargo|salida|egreso|retiro|debit/, -1)
  const amountIdx = findIdx(/valor|monto|importe|amount|total/, 2)
  const typeIdx = findIdx(/tipo|naturaleza|signo/, -1)
  const balanceIdx = findIdx(/saldo|balance/, -1)
  const noteIdx = findIdx(/nota|observacion|note/, -1)

  const out: ManualStatementLineInput[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i], delimiter)
    if (cols.length < 2) continue

    const desc = (cols[descIdx] || cols[1] || '').trim()
    if (!desc) continue

    let direction: 'credit' | 'debit' = 'credit'
    let amount = 0

    if (creditIdx >= 0 && debitIdx >= 0) {
      const cVal = Math.abs(parseFlexibleMoney(cols[creditIdx] || ''))
      const dVal = Math.abs(parseFlexibleMoney(cols[debitIdx] || ''))
      if (cVal > 0) {
        direction = 'credit'
        amount = cVal
      } else if (dVal > 0) {
        direction = 'debit'
        amount = dVal
      }
    } else {
      const signed = parseFlexibleMoney(cols[amountIdx] ?? cols[cols.length - 1] ?? '')
      if (signed < 0) {
        direction = 'debit'
        amount = Math.abs(signed)
      } else {
        amount = Math.abs(signed)
        const tVal = (typeIdx >= 0 ? cols[typeIdx] || '' : '').toLowerCase()
        direction = /deb|carg|salid|egres|retir|-/.test(tVal) ? 'debit' : 'credit'
      }
    }

    if (amount <= 0) continue

    const repBalanceRaw = balanceIdx >= 0 ? cols[balanceIdx] || '' : ''
    const repBalance = repBalanceRaw.trim() ? parseFlexibleMoney(repBalanceRaw) : null

    out.push({
      tx_date: normalizeDateString(cols[dateIdx] || ''),
      post_date: postDateIdx >= 0 && cols[postDateIdx] ? normalizeDateString(cols[postDateIdx]) : null,
      description: desc,
      bank_reference: refIdx >= 0 ? (cols[refIdx] || '').trim() || null : null,
      direction,
      amount: round2(amount),
      reported_balance: repBalance,
      notes: noteIdx >= 0 ? (cols[noteIdx] || '').trim() || null : null,
    })
  }

  return out
}

/* ============================================================================
 * 5. SUGERENCIAS VISUALES NO VINCULANTES (OPCIONALES, SOLO ORIENTACIÓN)
 *    Nunca selecciona ni concilia automáticamente.
 * ========================================================================== */

function dateDiffDays(a: string, b: string): number {
  const ta = Date.parse((a || '').slice(0, 10))
  const tb = Date.parse((b || '').slice(0, 10))
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 999
  return Math.abs(Math.round((ta - tb) / 86_400_000))
}

export function buildNonBindingSuggestions(
  bankLines: BankStatementLineRecord[],
  ledgerLines: LedgerBankLineCandidate[]
): Map<string, NonBindingHint[]> {
  const map = new Map<string, NonBindingHint[]>()

  for (const bl of bankLines) {
    if (bl.status === 'anulado' || bl.status === 'conciliado') continue
    const bankRem = round2(bl.remaining_amount ?? bl.amount)
    if (bankRem <= 0.009) continue

    const cleanRef = (bl.bank_reference || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    const hints: Array<NonBindingHint & { weight: number }> = []

    for (const ll of ledgerLines) {
      if (ll.remaining_amount <= 0.009) continue
      if (ll.direction !== bl.direction) continue

      const dDiff = dateDiffDays(bl.tx_date, ll.entry_date)
      const exactAmount = Math.abs(ll.remaining_amount - bankRem) <= 0.01
      const refText = `${ll.entry_number} ${ll.entry_description} ${ll.memo || ''}`
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()
      const refHit = cleanRef.length >= 3 && refText.includes(cleanRef)

      if (!exactAmount && !refHit) continue
      if (dDiff > 7 && !refHit) continue

      let weight = 0
      const reasons: string[] = []
      if (exactAmount) {
        weight += 50
        reasons.push('monto exacto')
      }
      if (refHit) {
        weight += 35
        reasons.push('referencia coincidente')
      }
      if (dDiff <= 2) {
        weight += 15
        reasons.push(dDiff === 0 ? 'misma fecha' : `±${dDiff}d`)
      }

      hints.push({
        accLineId: ll.acc_line_id,
        entryNumber: ll.entry_number,
        entryDate: ll.entry_date,
        amount: ll.amount,
        remainingAmount: ll.remaining_amount,
        scoreLabel: reasons.join(' · ') || 'coincidencia visual',
        weight,
      })
    }

    if (hints.length > 0) {
      hints.sort((a, b) => b.weight - a.weight)
      map.set(
        bl.id,
        hints.slice(0, 3).map(({ weight: _w, ...rest }) => rest)
      )
    }
  }

  return map
}
