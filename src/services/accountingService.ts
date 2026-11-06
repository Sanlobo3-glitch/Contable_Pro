import { supabase } from '../lib/supabase'
import type {
  Account,
  JournalEntry,
  CreateJournalEntryPayload,
  TrialBalanceReport,
  BalanceSheetReport,
  IncomeStatementReport,
} from '../types'

/**
 * Servicio Centralizado de Contabilidad
 * Gestiona la comunicación con la API REST de Contable Pro (/api/accounting)
 * y con las funciones RPC atómicas y de agregación de PostgreSQL/Supabase.
 */

async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    if (data?.session?.access_token) {
      return { Authorization: `Bearer ${data.session.access_token}` }
    }
  } catch {
    /* fallback to unauthenticated or local */
  }
  return {}
}

export const accountingService = {
  /**
   * Obtiene el catálogo de cuentas contables de la empresa
   */
  async getAccounts(companyId: string): Promise<Account[]> {
    const authHeaders = await getAuthHeader()
    try {
      const res = await fetch(`/api/accounting/accounts?company_id=${encodeURIComponent(companyId)}`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      })
      if (res.ok) {
        const json = await res.json()
        if (json.ok && Array.isArray(json.data)) return json.data
      }
    } catch {
      /* fallback to direct Supabase query */
    }

    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('company_id', companyId)
      .eq('active', true)
      .order('code', { ascending: true })

    if (error) throw error
    return data || []
  },

  /**
   * Obtiene la lista de asientos contables con sus líneas
   */
  async getJournalEntries(companyId: string): Promise<JournalEntry[]> {
    const { data, error } = await supabase
      .from('journal_entries')
      .select(`
        *,
        lines:journal_lines(
          id, company_id, entry_id, account_id, line_number, description, debit, credit, created_at,
          account:accounts(id, code, name, nature, account_type)
        )
      `)
      .eq('company_id', companyId)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  },

  /**
   * Registra un nuevo asiento contable con validación atómica de partida doble
   */
  async createJournalEntry(payload: CreateJournalEntryPayload): Promise<{
    ok: boolean
    entry_id: string
    entry_number: string
    status: string
    total_debit: number
    total_credit: number
  }> {
    const authHeaders = await getAuthHeader()
    try {
      const res = await fetch('/api/accounting/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error al guardar el asiento contable.')
      }
      return json
    } catch (err: any) {
      // Fallback a llamada directa RPC Supabase
      const { data, error } = await supabase.rpc('fn_create_journal_entry_atomic', {
        p_company_id: payload.company_id,
        p_entry_date: payload.entry_date,
        p_concept: payload.concept,
        p_status: payload.status,
        p_source_module: payload.source_module || 'manual',
        p_source_id: payload.source_id || null,
        p_lines: payload.lines,
      })

      if (error) {
        throw new Error(error.message || 'Error en validación de partida doble o base de datos.')
      }
      return data
    }
  },

  /**
   * Transiciona un asiento de 'borrador' a 'posteado'
   */
  async postJournalEntry(entryId: string): Promise<{ ok: boolean; entry_id: string; entry_number: string }> {
    const authHeaders = await getAuthHeader()
    try {
      const res = await fetch(`/api/accounting/entries/${encodeURIComponent(entryId)}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error al postear el asiento.')
      }
      return json
    } catch {
      const { data, error } = await supabase.rpc('fn_post_journal_entry', { p_entry_id: entryId })
      if (error) throw new Error(error.message || 'Error al postear el asiento.')
      return data
    }
  },

  /**
   * Genera un contraasiento automático de reversión inmutable
   */
  async reverseJournalEntry(
    entryId: string,
    reverseConcept?: string
  ): Promise<{ ok: boolean; reversal_entry_id: string; reversal_entry_number: string }> {
    const authHeaders = await getAuthHeader()
    try {
      const res = await fetch(`/api/accounting/entries/${encodeURIComponent(entryId)}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ reverse_concept: reverseConcept }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error al reversar el asiento.')
      }
      return json
    } catch {
      const { data, error } = await supabase.rpc('fn_reverse_journal_entry', {
        p_entry_id: entryId,
        p_reverse_concept: reverseConcept,
      })
      if (error) throw new Error(error.message || 'Error al reversar el asiento.')
      return data
    }
  },

  /**
   * Genera el Balance de Comprobación de sumas y saldos
   */
  async getTrialBalance(companyId: string, startDate: string, endDate: string): Promise<TrialBalanceReport> {
    const authHeaders = await getAuthHeader()
    try {
      const query = new URLSearchParams({ company_id: companyId, start_date: startDate, end_date: endDate })
      const res = await fetch(`/api/accounting/reports/trial-balance?${query.toString()}`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      })
      const json = await res.json()
      if (res.ok && json.ok) return json.data
    } catch {
      /* fallback to direct RPC */
    }

    const { data, error } = await supabase.rpc('fn_trial_balance', {
      p_company_id: companyId,
      p_start_date: startDate,
      p_end_date: endDate,
    })
    if (error) throw new Error(error.message || 'Error al calcular Balance de Comprobación.')
    return data
  },

  /**
   * Genera el Balance General clasificado
   */
  async getBalanceSheet(companyId: string, asOfDate: string): Promise<BalanceSheetReport> {
    const authHeaders = await getAuthHeader()
    try {
      const query = new URLSearchParams({ company_id: companyId, as_of_date: asOfDate })
      const res = await fetch(`/api/accounting/reports/balance-sheet?${query.toString()}`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      })
      const json = await res.json()
      if (res.ok && json.ok) return json.data
    } catch {
      /* fallback to direct RPC */
    }

    const { data, error } = await supabase.rpc('fn_balance_sheet', {
      p_company_id: companyId,
      p_as_of_date: asOfDate,
    })
    if (error) throw new Error(error.message || 'Error al calcular Balance General.')
    return data
  },

  /**
   * Genera el Estado de Resultados (Pérdidas y Ganancias)
   */
  async getIncomeStatement(companyId: string, startDate: string, endDate: string): Promise<IncomeStatementReport> {
    const authHeaders = await getAuthHeader()
    try {
      const query = new URLSearchParams({ company_id: companyId, start_date: startDate, end_date: endDate })
      const res = await fetch(`/api/accounting/reports/income-statement?${query.toString()}`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      })
      const json = await res.json()
      if (res.ok && json.ok) return json.data
    } catch {
      /* fallback to direct RPC */
    }

    const { data, error } = await supabase.rpc('fn_income_statement', {
      p_company_id: companyId,
      p_start_date: startDate,
      p_end_date: endDate,
    })
    if (error) throw new Error(error.message || 'Error al calcular Estado de Resultados.')
    return data
  },
}
