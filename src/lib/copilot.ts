import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { cacheGet, cacheSet } from './offlineQueue'

export type Severity = 'alta' | 'media' | 'info'

export interface InsightItem { label: string; note?: string; money?: number | null }
export interface Insight {
  id: string
  kind: string
  severity: Severity
  title: string
  detail?: string
  items?: InsightItem[]
  amount?: number
  amount_label?: string
  page?: string
  cta?: string
}

export interface CopilotState {
  uid: string | null
  alerts: Insight[]
  loading: boolean
  loaded: boolean
  error: string
  at: string | null
  fromCache: boolean
  dismissed: Record<string, string> // id -> día (YYYY-MM-DD) en que se ocultó
}

const REFRESH_MS = 5 * 60 * 1000
const FRESH_MS = 90 * 1000

let state: CopilotState = {
  uid: null, alerts: [], loading: false, loaded: false, error: '', at: null, fromCache: false, dismissed: {},
}
const listeners = new Set<() => void>()
let lastOk = 0

function set(patch: Partial<CopilotState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => state

export function useCopilot(): CopilotState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

const todayKey = () => new Date().toLocaleDateString('sv-SE')

/** Alertas que no se ocultaron hoy. */
export function visibleAlerts(s: CopilotState): Insight[] {
  const t = todayKey()
  return s.alerts.filter(a => s.dismissed[a.id] !== t)
}
export function hiddenAlerts(s: CopilotState): Insight[] {
  const t = todayKey()
  return s.alerts.filter(a => s.dismissed[a.id] === t)
}
/** Número que se muestra en la campanita: urgentes y por atender. */
export function pendingCount(s: CopilotState): number {
  return visibleAlerts(s).filter(a => a.severity !== 'info').length
}

export function dismissInsight(id: string) {
  if (!state.uid) return
  const dismissed = { ...state.dismissed, [id]: todayKey() }
  cacheSet(state.uid, 'copilot_dismissed', dismissed)
  set({ dismissed })
}
export function restoreInsight(id: string) {
  if (!state.uid) return
  const dismissed = { ...state.dismissed }
  delete dismissed[id]
  cacheSet(state.uid, 'copilot_dismissed', dismissed)
  set({ dismissed })
}

function cleanAlerts(raw: unknown): Insight[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a: any) => a && typeof a.id === 'string' && typeof a.title === 'string')
    .map((a: any) => ({
      ...a,
      severity: a.severity === 'alta' || a.severity === 'info' ? a.severity : 'media',
      items: Array.isArray(a.items) ? a.items.filter(Boolean) : [],
    })) as Insight[]
}

export async function loadInsights(force = false) {
  const uid = state.uid
  if (!uid || state.loading) return
  if (!force && Date.now() - lastOk < FRESH_MS) return
  set({ loading: true })
  let tz = 'UTC'
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { /* usa UTC */ }
  const [insRes, cxpRes] = await Promise.all([
    supabase.rpc('copilot_insights', { p_tz: tz }),
    supabase.rpc('cuentas_por_pagar'),
  ])
  const { data, error } = insRes
  if (state.uid !== uid) return
  if (error) {
    const missing = /copilot_insights|does not exist|schema cache/i.test(error.message || '')
    set({
      loading: false,
      loaded: true,
      error: missing ? 'sin_sql' : (navigator.onLine ? error.message : ''),
      fromCache: state.alerts.length > 0,
    })
    return
  }
  const alerts = cleanAlerts((data as any)?.alerts)
  if (!cxpRes.error && cxpRes.data && typeof cxpRes.data === 'object' && !alerts.some(a => a.kind === 'cxp' || a.page === 'payables')) {
    const cxp: any = cxpRes.data
    const owed = Number(cxp.total_owed) || 0
    const overdue = Number(cxp.total_overdue) || 0
    const sups: any[] = Array.isArray(cxp.suppliers) ? cxp.suppliers : []
    if (overdue > 0) {
      alerts.unshift({
        id: 'cxp-vencida',
        kind: 'cxp',
        severity: 'alta',
        title: 'Facturas de proveedores vencidas',
        detail: 'Tienes compras a crédito cuyo plazo ya venció.',
        amount: overdue,
        amount_label: 'Vencido por pagar',
        items: sups
          .filter(s => Number(s.overdue) > 0)
          .slice(0, 5)
          .map(s => ({ label: String(s.name), note: s.oldest_due ? `venció ${s.oldest_due}` : 'vencido', money: Number(s.overdue) })),
        page: 'payables',
        cta: 'Ver cuentas por pagar',
      })
    } else if (owed > 0) {
      alerts.push({
        id: 'cxp-pendiente',
        kind: 'cxp',
        severity: 'info',
        title: 'Cuentas por pagar al día',
        detail: `${sups.length} ${sups.length === 1 ? 'proveedor' : 'proveedores'} con saldo pendiente dentro del plazo.`,
        amount: owed,
        amount_label: 'Total por pagar',
        items: sups
          .slice(0, 5)
          .map(s => ({ label: String(s.name), note: s.oldest_due ? `próx. vence ${s.oldest_due}` : undefined, money: Number(s.owed) })),
        page: 'payables',
        cta: 'Ver cuentas por pagar',
      })
    }
  }
  const at = (data as any)?.generated_at || new Date().toISOString()
  lastOk = Date.now()
  cacheSet(uid, 'copilot_alerts', { alerts, at })
  set({ alerts, at, loading: false, loaded: true, error: '', fromCache: false })
}

/** Inicia el Copiloto para un usuario: carga lo guardado, consulta y se actualiza solo. */
export function startCopilot(uid: string): () => void {
  if (state.uid !== uid) {
    const cached = cacheGet<{ alerts: Insight[]; at: string }>(uid, 'copilot_alerts')
    const dismissed = cacheGet<Record<string, string>>(uid, 'copilot_dismissed') || {}
    lastOk = 0
    state = {
      uid, alerts: cached ? cleanAlerts(cached.alerts) : [], loading: false, loaded: !!cached,
      error: '', at: cached?.at ?? null, fromCache: !!cached, dismissed,
    }
    listeners.forEach(l => l())
  }
  loadInsights(true)
  const onOnline = () => { loadInsights(true) }
  const onVisible = () => { if (document.visibilityState === 'visible') loadInsights() }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(() => { if (navigator.onLine) loadInsights(true) }, REFRESH_MS)
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}

export function stopCopilot() {
  lastOk = 0
  state = { uid: null, alerts: [], loading: false, loaded: false, error: '', at: null, fromCache: false, dismissed: {} }
  listeners.forEach(l => l())
}
