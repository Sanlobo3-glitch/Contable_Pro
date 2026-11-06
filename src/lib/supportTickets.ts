
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

type RpcPayload = {
  success?: boolean
  authorization_code?: string | null
  authorized_until?: string | null
  authorization_id?: string | null
  technician_id?: string | null
  technician_name?: string | null
  message?: string
  error?: string
}

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

/**
 * Se conserva por compatibilidad con posibles importaciones existentes.
 * Este código ya no concede autorización: la autorización válida la genera
 * exclusivamente support_grant_ticket_authorization en Supabase.
 */
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
  if (ticket.status === 'cerrado' || ticket.status === 'resuelto') return false

  // Una autorización real siempre debe tener vencimiento.
  if (!ticket.authorized_until) return false

  const untilMs = new Date(ticket.authorized_until).getTime()
  return Number.isFinite(untilMs) && untilMs > Date.now()
}

export function computeAuthorizedUntilIso(
  hours: number | 'until_resolved',
): string | null {
  const safeHours =
    hours === 'until_resolved'
      ? 168
      : Math.min(168, Math.max(1, Math.floor(Number(hours) || 1)))

  return new Date(Date.now() + safeHours * 3600 * 1000).toISOString()
}

function getDurationHours(hours: number | 'until_resolved'): number {
  if (hours === 'until_resolved') return 168
  return Math.min(168, Math.max(1, Math.floor(Number(hours) || 1)))
}

function isMissingTableError(msg: string | undefined): boolean {
  if (!msg) return false
  return /support_tickets|relation .* does not exist|schema cache|42P01|PGRST205/i.test(
    msg,
  )
}

function getRpcPayload(data: unknown): RpcPayload {
  if (Array.isArray(data)) {
    return (data[0] || {}) as RpcPayload
  }

  if (data && typeof data === 'object') {
    return data as RpcPayload
  }

  return {}
}

function getRpcError(payload: RpcPayload, fallback: string): string {
  return payload.message || payload.error || fallback
}

function normalizeModuleName(modulePage: string | null | undefined): string {
  const moduleName = (modulePage || '').trim()
  if (!moduleName) {
    throw new Error('El ticket no tiene un módulo asociado para autorizar.')
  }

  if (moduleName.length > 100) {
    throw new Error('El identificador del módulo supera los 100 caracteres.')
  }

  return moduleName
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
        (user.role === 'dueno' ||
          user.role === 'admin_empresa' ||
          user.role === 'gerente')
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
                  (user.role === 'dueno' || user.role === 'admin_empresa')),
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
      tickets: isTechTeam
        ? local
        : local.filter(t => t.user_id === user.id),
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

  // El navegador nunca crea un ticket con autorización activa.
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
    session_authorized: false,
    authorization_code: null,
    authorized_at: null,
    authorized_until: null,
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

      // Consentimiento y autorización se gestionan después mediante RPC.
      session_authorized: false,
      authorization_code: null,
      authorized_at: null,
      authorized_until: null,
      revoked_at: null,
      authorization_scope: authorizationScope,
      session_snapshot: newTicket.session_snapshot,
      status: 'pendiente',
    })
    .select('*')
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error.message)) {
      // El almacenamiento local nunca concede acceso técnico.
      const local = readLocalTickets()
      writeLocalTickets([newTicket, ...local])
      return { ticket: newTicket, savedInLocalFallback: true }
    }

    throw new Error(error.message)
  }

  const savedTicket = (data as SupportTicket) || newTicket

  if (!authorizeSession) {
    return { ticket: savedTicket, savedInLocalFallback: false }
  }

  // La solicitud ya existe. Ahora el servidor valida el consentimiento,
  // selecciona al técnico elegible y crea la autorización auditable.
  const moduleName = normalizeModuleName(savedTicket.module_page)

  const { data: authorizationData, error: authorizationError } =
    await supabase.rpc('support_grant_ticket_authorization', {
      p_ticket_id: savedTicket.id,
      p_technician_id: null,
      p_module: moduleName,
      p_scope: authorizationScope,
      p_duration_hours: getDurationHours(durationHours),
    })

  if (authorizationError) {
    throw new Error(
      `La solicitud ${savedTicket.ticket_number} fue creada, pero la autorización técnica no pudo activarse. Motivo: ${authorizationError.message}`,
    )
  }

  const authorization = getRpcPayload(authorizationData)

  if (authorization.success === false) {
    throw new Error(
      `La solicitud ${savedTicket.ticket_number} fue creada, pero la autorización técnica no pudo activarse. Motivo: ${getRpcError(
        authorization,
        'El servidor rechazó la autorización.',
      )}`,
    )
  }

  return {
    ticket: {
      ...savedTicket,
      session_authorized: true,
      authorization_code: authorization.authorization_code || null,
      authorized_at: now,
      authorized_until:
        authorization.authorized_until ||
        computeAuthorizedUntilIso(durationHours),
      revoked_at: null,
      authorization_scope: authorizationScope,
      assigned_to: authorization.technician_id || savedTicket.assigned_to,
      assigned_name:
        authorization.technician_name || savedTicket.assigned_name,
    },
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
  // Se conserva el parámetro para no romper las llamadas actuales.
  // El snapshot no es prueba de consentimiento ni concede permisos.
  void snapshot

  if (!ticketId) {
    throw new Error('Falta el identificador del ticket.')
  }

  if (!authorize) {
    const { data, error } = await supabase.rpc(
      'support_revoke_ticket_authorization',
      {
        p_ticket_id: ticketId,
      },
    )

    if (error) {
      if (isMissingTableError(error.message)) {
        const now = new Date().toISOString()
        writeLocalTickets(
          readLocalTickets().map(t =>
            t.id === ticketId
              ? {
                  ...t,
                  session_authorized: false,
                  revoked_at: now,
                  updated_at: now,
                }
              : t,
          ),
        )
        return
      }
      throw new Error(error.message)
    }

    const result = getRpcPayload(data)
    if (result.success === false) {
      throw new Error(
        getRpcError(result, 'No fue posible revocar la autorización.'),
      )
    }

    return
  }

  // El módulo se obtiene del ticket remoto; no se acepta un módulo inventado
  // desde el estado local del navegador.
  const { data: ticket, error: ticketError } = await supabase
    .from('support_tickets')
    .select('module_page')
    .eq('id', ticketId)
    .single()

  if (ticketError) {
    if (isMissingTableError(ticketError.message)) {
      const localList = readLocalTickets()
      const localTicket = localList.find(t => t.id === ticketId)
      const localModule = normalizeModuleName(localTicket?.module_page)
      const now = new Date().toISOString()
      writeLocalTickets(
        localList.map(t =>
          t.id === ticketId
            ? {
                ...t,
                module_page: localModule,
                session_authorized: true,
                authorization_code:
                  t.authorization_code || generateAuthorizationCode(),
                authorized_at: now,
                authorized_until: computeAuthorizedUntilIso(durationHours),
                revoked_at: null,
                authorization_scope: scope,
                updated_at: now,
              }
            : t,
        ),
      )
      return
    }

    throw new Error(
      `No se pudo consultar el módulo del ticket antes de autorizar: ${ticketError.message}`,
    )
  }

  const moduleName = normalizeModuleName(ticket?.module_page)

  const { data, error } = await supabase.rpc(
    'support_grant_ticket_authorization',
    {
      p_ticket_id: ticketId,
      p_technician_id: null,
      p_module: moduleName,
      p_scope: scope,
      p_duration_hours: getDurationHours(durationHours),
    },
  )

  if (error) {
    if (isMissingTableError(error.message)) {
      const now = new Date().toISOString()
      writeLocalTickets(
        readLocalTickets().map(t =>
          t.id === ticketId
            ? {
                ...t,
                module_page: moduleName,
                session_authorized: true,
                authorization_code:
                  t.authorization_code || generateAuthorizationCode(),
                authorized_at: now,
                authorized_until: computeAuthorizedUntilIso(durationHours),
                revoked_at: null,
                authorization_scope: scope,
                updated_at: now,
              }
            : t,
        ),
      )
      return
    }
    throw new Error(error.message)
  }

  const result = getRpcPayload(data)
  if (result.success === false) {
    throw new Error(
      getRpcError(result, 'El servidor rechazó la autorización.'),
    )
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
  // La identidad del técnico la determina auth.uid() en Supabase.
  // No confiamos en techUser.id ni en assigned_to enviados por el cliente.
  const { data, error } = await supabase.rpc(
    'support_update_ticket_technical_resolution',
    {
      p_ticket_id: ticketId,
      p_status: status,
      p_tech_diagnosis: techDiagnosis.trim() || null,
      p_resolution_notes: resolutionNotes.trim() || null,
    },
  )

  if (error) {
    if (isMissingTableError(error.message)) {
      const now = new Date().toISOString()
      writeLocalTickets(
        readLocalTickets().map(t =>
          t.id === ticketId
            ? {
                ...t,
                status,
                tech_diagnosis: techDiagnosis.trim() || null,
                resolution_notes: resolutionNotes.trim() || null,
                assigned_to: techUser.id,
                assigned_name: techUser.full_name || techUser.email,
                resolved_at:
                  status === 'resuelto' || status === 'cerrado'
                    ? now
                    : t.resolved_at,
                updated_at: now,
              }
            : t,
        ),
      )
      return
    }
    throw new Error(error.message)
  }

  const result = getRpcPayload(data)
  if (result.success === false) {
    throw new Error(
      getRpcError(result, 'No fue posible guardar la actualización técnica.'),
    )
  }
}
