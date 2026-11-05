import { supabase } from './supabase'
import type {
  Role,
  SupportAuthorizationScope,
  SupportSessionSnapshot,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  UserProfile,
} from '../types'
import { getRoleLabel } from './auth'
import { getPageLabel } from './navigation'

const LOCAL_TICKETS_KEY = 'ip_support_tickets_fallback_v1'

function readLocalTickets(): SupportTicket[] {
  try {
    const raw = localStorage.getItem(LOCAL_TICKETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SupportTicket[]) : []
  } catch {
    return []
  }
}

function writeLocalTickets(tickets: SupportTicket[]): void {
  try {
    localStorage.setItem(LOCAL_TICKETS_KEY, JSON.stringify(tickets.slice(0, 120)))
  } catch {
    /* ignore */
  }
}

export function generateAuthorizationCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const suffix =
    chars[Math.floor(Math.random() * chars.length)] +
    chars[Math.floor(Math.random() * chars.length)]
  return `AUT-${digits}-${suffix}`
}

export function generateTicketNumber(): string {
  const num = Math.floor(1050 + Math.random() * 8900)
  return `SOP-${num}`
}

export function detectClientPlatform(): string {
  try {
    const ua = navigator.userAgent || ''
    const os = /Android/i.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua)
        ? 'iOS'
        : /Mac/i.test(ua)
          ? 'macOS'
          : /Win/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Web'
    const browser = /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome\//i.test(ua)
        ? 'Chrome'
        : /Safari\//i.test(ua) && !/Chrome\//i.test(ua)
          ? 'Safari'
          : /Firefox\//i.test(ua)
            ? 'Firefox'
            : 'Navegador'
    return `${os} · ${browser}`
  } catch {
    return 'Navegador web'
  }
}

export function buildSessionSnapshot({
  user,
  activePage,
  warehouseName,
  branchName,
  currency,
}: {
  user: UserProfile
  activePage: string
  warehouseName?: string | null
  branchName?: string | null
  currency?: string | null
}): SupportSessionSnapshot {
  return {
    captured_at: new Date().toISOString(),
    active_page: activePage,
    active_page_label: getPageLabel(activePage),
    user_role: getRoleLabel(user.role),
    warehouse_name: warehouseName || null,
    branch_name: branchName || null,
    currency: currency || null,
    platform: detectClientPlatform(),
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  }
}

export function isSessionAuthorizationActive(ticket: SupportTicket): boolean {
  if (!ticket.session_authorized || ticket.revoked_at) return false
  if (ticket.status === 'cerrado') return false
  if (!ticket.authorized_until) return true
  const untilMs = new Date(ticket.authorized_until).getTime()
  return Number.isFinite(untilMs) && untilMs > Date.now()
}

export function computeAuthorizedUntilIso(hours: number | 'until_resolved'): string | null {
  if (hours === 'until_resolved') {
    // Tope de seguridad auditable de 7 días si elige hasta resolver
    return new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
  }
  return new Date(Date.now() + hours * 3600 * 1000).toISOString()
}

function isMissingTableError(msg: string | undefined): boolean {
  if (!msg) return false
  return /support_tickets|relation .* does not exist|schema cache|42P01|PGRST205/i.test(msg)
}

export async function fetchSupportTickets({
  user,
  isTechTeam,
}: {
  user: UserProfile
  isTechTeam: boolean
}): Promise<{ tickets: SupportTicket[]; needsSqlMigration: boolean }> {
  try {
    let query = supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (!isTechTeam) {
      if (
        user.company_id &&
        (user.role === 'dueno' || user.role === 'admin_empresa' || user.role === 'gerente')
      ) {
        query = query.eq('company_id', user.company_id)
      } else {
        query = query.eq('user_id', user.id)
      }
    }

    const { data, error } = await query

    if (error) {
      if (isMissingTableError(error.message)) {
        const local = readLocalTickets()
        const visible = isTechTeam
          ? local
          : local.filter(
              t =>
                t.user_id === user.id ||
                (user.company_id &&
                  t.company_id === user.company_id &&
                  (user.role === 'dueno' || user.role === 'admin_empresa'))
            )
        return { tickets: visible, needsSqlMigration: true }
      }
      throw error
    }

    const remoteRows = ((data || []) as SupportTicket[]).map(r => ({
      ...r,
      user_role: (r.user_role || 'vendedor') as Role,
    }))

    return { tickets: remoteRows, needsSqlMigration: false }
  } catch {
    const local = readLocalTickets()
    return {
      tickets: isTechTeam ? local : local.filter(t => t.user_id === user.id),
      needsSqlMigration: true,
    }
  }
}

export async function createSupportTicket({
  user,
  category,
  priority,
  subject,
  description,
  modulePage,
  authorizeSession,
  durationHours,
  authorizationScope,
  snapshot,
}: {
  user: UserProfile
  category: SupportTicketCategory
  priority: SupportTicketPriority
  subject: string
  description: string
  modulePage: string
  authorizeSession: boolean
  durationHours: number | 'until_resolved'
  authorizationScope: SupportAuthorizationScope
  snapshot: SupportSessionSnapshot
}): Promise<{ ticket: SupportTicket; savedInLocalFallback: boolean }> {
  const now = new Date().toISOString()
  const authCode = authorizeSession ? generateAuthorizationCode() : null
  const authUntil = authorizeSession ? computeAuthorizedUntilIso(durationHours) : null

  const newTicket: SupportTicket = {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `tk-${Date.now()}`,
    ticket_number: generateTicketNumber(),
    company_id: user.company_id || null,
    company_name: user.company_name || null,
    user_id: user.id,
    user_name: user.full_name || user.email,
    user_email: user.email,
    user_role: user.role,
    category,
    priority,
    subject: subject.trim(),
    description: description.trim(),
    module_page: modulePage || null,
    session_authorized: authorizeSession,
    authorization_code: authCode,
    authorized_at: authorizeSession ? now : null,
    authorized_until: authUntil,
    revoked_at: null,
    authorization_scope: authorizationScope,
    session_snapshot: snapshot,
    status: 'pendiente',
    assigned_to: null,
    assigned_name: null,
    tech_diagnosis: null,
    resolution_notes: null,
    resolved_at: null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      ticket_number: newTicket.ticket_number,
      company_id: newTicket.company_id,
      company_name: newTicket.company_name,
      user_id: newTicket.user_id,
      user_name: newTicket.user_name,
      user_email: newTicket.user_email,
      user_role: newTicket.user_role,
      category: newTicket.category,
      priority: newTicket.priority,
      subject: newTicket.subject,
      description: newTicket.description,
      module_page: newTicket.module_page,
      session_authorized: newTicket.session_authorized,
      authorization_code: newTicket.authorization_code,
      authorized_at: newTicket.authorized_at,
      authorized_until: newTicket.authorized_until,
      revoked_at: null,
      authorization_scope: newTicket.authorization_scope,
      session_snapshot: newTicket.session_snapshot,
      status: 'pendiente',
    })
    .select('*')
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error.message)) {
      const local = readLocalTickets()
      writeLocalTickets([newTicket, ...local])
      return { ticket: newTicket, savedInLocalFallback: true }
    }
    throw new Error(error.message)
  }

  return {
    ticket: (data as SupportTicket) || newTicket,
    savedInLocalFallback: false,
  }
}

export async function updateTicketSessionAuthorization({
  ticketId,
  authorize,
  durationHours = 24,
  scope = 'intervencion_asistida',
  snapshot,
}: {
  ticketId: string
  authorize: boolean
  durationHours?: number | 'until_resolved'
  scope?: SupportAuthorizationScope
  snapshot?: SupportSessionSnapshot
}): Promise<void> {
  const now = new Date().toISOString()
  const patch = authorize
    ? {
        session_authorized: true,
        authorization_code: generateAuthorizationCode(),
        authorized_at: now,
        authorized_until: computeAuthorizedUntilIso(durationHours),
        revoked_at: null,
        authorization_scope: scope,
        ...(snapshot ? { session_snapshot: snapshot } : {}),
        updated_at: now,
      }
    : {
        session_authorized: false,
        revoked_at: now,
        updated_at: now,
      }

  const { error } = await supabase
    .from('support_tickets')
    .update(patch)
    .eq('id', ticketId)

  if (error) {
    if (isMissingTableError(error.message)) {
      const local = readLocalTickets().map(t =>
        t.id === ticketId ? ({ ...t, ...patch } as SupportTicket) : t
      )
      writeLocalTickets(local)
      return
    }
    throw new Error(error.message)
  }
}

export async function updateTicketTechnicalResolution({
  ticketId,
  status,
  techUser,
  techDiagnosis,
  resolutionNotes,
}: {
  ticketId: string
  status: SupportTicketStatus
  techUser: UserProfile
  techDiagnosis: string
  resolutionNotes: string
}): Promise<void> {
  const now = new Date().toISOString()
  const patch = {
    status,
    assigned_to: techUser.id,
    assigned_name: techUser.full_name || techUser.email,
    tech_diagnosis: techDiagnosis.trim() || null,
    resolution_notes: resolutionNotes.trim() || null,
    resolved_at: status === 'resuelto' || status === 'cerrado' ? now : null,
    updated_at: now,
  }

  const { error } = await supabase
    .from('support_tickets')
    .update(patch)
    .eq('id', ticketId)

  if (error) {
    if (isMissingTableError(error.message)) {
      const local = readLocalTickets().map(t =>
        t.id === ticketId ? ({ ...t, ...patch } as SupportTicket) : t
      )
      writeLocalTickets(local)
      return
    }
    throw new Error(error.message)
  }
}
