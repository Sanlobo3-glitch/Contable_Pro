import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { captureInviteFromUrl } from './auth'
import { getPublicStoreIdentifierFromLocation, isValidStoreIdentifier } from './whatsappStudio'

const NAV_SESSION_KEY = 'ip_nav_session_v1'
const NAV_BACKUP_KEY = 'ip_nav_backup_v1'
const BACKUP_MAX_AGE_MS = 12 * 60 * 60 * 1000
const MAX_STACK_LENGTH = 40
const EXIT_CONFIRM_WINDOW_MS = 2500

export type AuthViewMode = 'landing' | 'login' | 'register'

export interface NavRouteEntry {
  page: string
  previewCatalogId: string | null
}

interface PersistedNavSession {
  stack: NavRouteEntry[]
  index: number
  scopeKey: string | null
  updatedAt: number
}

interface IpHistoryState {
  __ipNav: true
  kind: 'sentinel' | 'app' | 'auth'
  stackIndex?: number
  page?: string
  previewCatalogId?: string | null
  overlay?: boolean
  authView?: AuthViewMode
  fromLanding?: boolean
}

export const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Panel ejecutivo',
  command: 'Centro de mando',
  summary: 'Resumen del día',
  copilot: 'Copiloto',
  ask: 'Pregúntale al Copiloto',
  pos: 'Mostrador (POS)',
  catalog: 'Catálogo comercial',
  catorders: 'Pedidos de catálogo',
  sales: 'Ventas',
  layaways: 'Plan Separe y apartados',
  cartera: 'Cartera (fiado)',
  quotations: 'Cotizaciones',
  customers: 'Clientes',
  devolutions: 'Devoluciones',
  exchanges: 'Cambios y garantías',
  sellers: 'Equipo y nómina',
  routeplan: 'Planificar rutas',
  dispatch: 'Despacho de ruta',
  goals: 'Metas',
  purchaseorders: 'Órdenes de compra',
  purchases: 'Compras',
  payables: 'Cuentas por pagar',
  buyplan: 'Sugerencia de compras',
  suppliers: 'Proveedores',
  products: 'Productos',
  priceshield: 'Escudo de precios y márgenes',
  blindcount: 'Toma física ciega',
  warehouses: 'Sedes y multibodega',
  categories: 'Categorías',
  lots: 'Lotes y vencimientos',
  kardex: 'Kardex',
  labels: 'Etiquetas',
  treasury: 'Tesorería y presupuesto',
  bankrecon: 'Conciliación bancaria',
  cash: 'Caja y arqueos',
  expenses: 'Gastos operativos',
  reports: 'Reportes',
  profit: 'Rentabilidad',
  predict: 'Predicciones',
  stats: 'Estadísticas',
  map: 'Mapa y rutas',
  history: 'Historial de auditoría',
  cpa: 'Despacho contable',
  accounting: 'Contabilidad',
  accstate: 'Estados financieros',
  costcenters: 'Centros de costo',
  accsetup: 'Config. contable',
  accclose: 'Cierre de libros',
  taxes: 'Impuestos',
  erpbridge: 'Migración Siigo y Loggro',
  support: 'Soporte y autorización',
  sqlcenter: 'Scripts SQL y Supabase',
  team: 'Equipo y dispositivos',
  users: 'Usuarios de plataforma',
  companies: 'Empresas clientes',
  adminplans: 'Activar planes',
  subscription: 'Suscripción',
  settings: 'Configuración',
  manual: 'Manual de usuario',
  omnichannel: 'Pedidos omnicanal',
  ai_actions: 'Acciones de IA (Aprobaciones)',
  branch_balance: 'Balanceo de sedes',
  supplier_intel: 'Evaluación de proveedores',
  anomaly_detector: 'Detección de anomalías',
  equipment_assets: 'Activos y maquinaria',
  employee_portal: 'Portal de vendedores',
  compliance: 'Cumplimiento y vencimientos',
  api_ecosystem: 'API y Webhooks',
}

export function isValidAppPage(page: string | null | undefined): page is string {
  return Boolean(page && Object.prototype.hasOwnProperty.call(PAGE_LABELS, page))
}

export function getPageLabel(page: string): string {
  return PAGE_LABELS[page] || 'Panel ejecutivo'
}

function isSameEntry(a: NavRouteEntry, b: NavRouteEntry): boolean {
  return a.page === b.page && (a.previewCatalogId || null) === (b.previewCatalogId || null)
}

function hasSupabaseAuthHash(): boolean {
  try {
    const h = window.location.hash || ''
    return (
      h.includes('access_token=') ||
      h.includes('refresh_token=') ||
      h.includes('type=recovery') ||
      h.includes('error_description=')
    )
  } catch {
    return false
  }
}

export function isStandalonePublicRoute(): boolean {
  try {
    if (getPublicStoreIdentifierFromLocation()) return true

    const path = window.location.pathname
    if (
      path === '/terminos' ||
      path === '/privacidad' ||
      path === '/manual' ||
      path === '/reset-password'
    ) {
      return true
    }

    if (window.location.hash.includes('type=recovery')) return true
  } catch {
    /* ignore */
  }
  return false
}

function readUrlRoute(): {
  page: string | null
  previewCatalogId: string | null
  authView: AuthViewMode | null
} {
  try {
    const params = new URLSearchParams(window.location.search)
    const rawPage = (params.get('vista') || '').trim()
    const rawPreview = (params.get('vista_catalogo') || '').trim()
    const rawAuth = (params.get('acceso') || '').trim().toLowerCase()

    const page = isValidAppPage(rawPage) ? rawPage : null
    const previewCatalogId = isValidStoreIdentifier(rawPreview) ? rawPreview : null
    const authView: AuthViewMode | null =
      rawAuth === 'login'
        ? 'login'
        : rawAuth === 'registro' || rawAuth === 'register'
          ? 'register'
          : null

    return { page, previewCatalogId, authView }
  } catch {
    return { page: null, previewCatalogId: null, authView: null }
  }
}

function buildAppUrl(page: string, previewCatalogId: string | null): string {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('acceso')

    if (page && page !== 'dashboard' && isValidAppPage(page)) {
      url.searchParams.set('vista', page)
    } else {
      url.searchParams.delete('vista')
    }

    if (previewCatalogId && isValidStoreIdentifier(previewCatalogId)) {
      url.searchParams.set('vista_catalogo', previewCatalogId)
    } else {
      url.searchParams.delete('vista_catalogo')
    }

    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}

function buildAuthUrl(authView: AuthViewMode): string {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('vista')
    url.searchParams.delete('vista_catalogo')

    if (authView === 'login') {
      url.searchParams.set('acceso', 'login')
    } else if (authView === 'register') {
      url.searchParams.set('acceso', 'registro')
    } else {
      url.searchParams.delete('acceso')
    }

    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}

function sanitizeStack(rawStack: unknown): NavRouteEntry[] {
  if (!Array.isArray(rawStack)) return []
  const cleaned: NavRouteEntry[] = []
  for (const item of rawStack) {
    if (!item || typeof item !== 'object') continue
    const candidatePage = (item as { page?: unknown }).page
    const candidatePreview = (item as { previewCatalogId?: unknown }).previewCatalogId
    if (typeof candidatePage !== 'string' || !isValidAppPage(candidatePage)) continue
    const previewCatalogId =
      typeof candidatePreview === 'string' && isValidStoreIdentifier(candidatePreview)
        ? candidatePreview
        : null
    const entry: NavRouteEntry = { page: candidatePage, previewCatalogId }
    const prev = cleaned[cleaned.length - 1]
    if (!prev || !isSameEntry(prev, entry)) {
      cleaned.push(entry)
    }
  }
  return cleaned.slice(-MAX_STACK_LENGTH)
}

function readPersistedSession(): PersistedNavSession | null {
  try {
    const rawSession = sessionStorage.getItem(NAV_SESSION_KEY)
    if (rawSession) {
      const parsed = JSON.parse(rawSession) as Partial<PersistedNavSession>
      const stack = sanitizeStack(parsed.stack)
      if (stack.length > 0) {
        const idx =
          typeof parsed.index === 'number'
            ? Math.max(0, Math.min(stack.length - 1, parsed.index))
            : stack.length - 1
        return {
          stack,
          index: idx,
          scopeKey: typeof parsed.scopeKey === 'string' ? parsed.scopeKey : null,
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const rawBackup = localStorage.getItem(NAV_BACKUP_KEY)
    if (rawBackup) {
      const parsed = JSON.parse(rawBackup) as Partial<PersistedNavSession>
      const age = Date.now() - (typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0)
      const stack = sanitizeStack(parsed.stack)
      if (stack.length > 0 && age >= 0 && age <= BACKUP_MAX_AGE_MS) {
        const idx =
          typeof parsed.index === 'number'
            ? Math.max(0, Math.min(stack.length - 1, parsed.index))
            : stack.length - 1
        return {
          stack,
          index: idx,
          scopeKey: typeof parsed.scopeKey === 'string' ? parsed.scopeKey : null,
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        }
      }
    }
  } catch {
    /* ignore */
  }

  return null
}

function writePersistedSession(session: PersistedNavSession): void {
  const payload = JSON.stringify(session)
  try {
    sessionStorage.setItem(NAV_SESSION_KEY, payload)
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(NAV_BACKUP_KEY, payload)
  } catch {
    /* ignore */
  }
}

export function clearPersistedNavSession(): void {
  try {
    sessionStorage.removeItem(NAV_SESSION_KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(NAV_BACKUP_KEY)
  } catch {
    /* ignore */
  }
}

function buildSeedStackForEntry(entry: NavRouteEntry): {
  stack: NavRouteEntry[]
  index: number
} {
  const root: NavRouteEntry = { page: 'dashboard', previewCatalogId: null }
  if (entry.page === 'dashboard' && !entry.previewCatalogId) {
    return { stack: [root], index: 0 }
  }
  if (entry.page === 'dashboard' && entry.previewCatalogId) {
    return { stack: [root, entry], index: 1 }
  }
  if (entry.previewCatalogId) {
    const basePage: NavRouteEntry = { page: entry.page, previewCatalogId: null }
    return { stack: [root, basePage, entry], index: 2 }
  }
  return { stack: [root, entry], index: 1 }
}

function readInitialNavSession(): PersistedNavSession {
  const urlRoute = readUrlRoute()
  const histState = (
    typeof window !== 'undefined' ? window.history.state : null
  ) as IpHistoryState | null
  const persisted = readPersistedSession()

  let targetEntry: NavRouteEntry | null = null
  if (urlRoute.page || urlRoute.previewCatalogId) {
    targetEntry = {
      page: urlRoute.page || persisted?.stack[persisted.index]?.page || 'dashboard',
      previewCatalogId: urlRoute.previewCatalogId,
    }
  } else if (
    histState?.__ipNav === true &&
    histState.kind === 'app' &&
    isValidAppPage(histState.page)
  ) {
    targetEntry = {
      page: histState.page,
      previewCatalogId:
        typeof histState.previewCatalogId === 'string' && isValidStoreIdentifier(histState.previewCatalogId)
          ? histState.previewCatalogId
          : null,
    }
  } else if (persisted) {
    targetEntry = persisted.stack[persisted.index] || {
      page: 'dashboard',
      previewCatalogId: null,
    }
  }

  const finalEntry: NavRouteEntry = targetEntry || {
    page: 'dashboard',
    previewCatalogId: null,
  }

  if (persisted && persisted.stack.length > 0) {
    if (
      histState?.__ipNav === true &&
      histState.kind === 'app' &&
      typeof histState.stackIndex === 'number' &&
      histState.stackIndex >= 0 &&
      histState.stackIndex < persisted.stack.length &&
      isSameEntry(persisted.stack[histState.stackIndex], finalEntry)
    ) {
      return {
        stack: persisted.stack,
        index: histState.stackIndex,
        scopeKey: persisted.scopeKey,
        updatedAt: Date.now(),
      }
    }

    const currentPersisted = persisted.stack[persisted.index]
    if (currentPersisted && isSameEntry(currentPersisted, finalEntry)) {
      return {
        ...persisted,
        updatedAt: Date.now(),
      }
    }

    const trimmed = persisted.stack.slice(0, persisted.index + 1)
    trimmed.push(finalEntry)
    const bounded = trimmed.slice(-MAX_STACK_LENGTH)
    return {
      stack: bounded,
      index: bounded.length - 1,
      scopeKey: persisted.scopeKey,
      updatedAt: Date.now(),
    }
  }

  const seeded = buildSeedStackForEntry(finalEntry)
  return {
    stack: seeded.stack,
    index: seeded.index,
    scopeKey: null,
    updatedAt: Date.now(),
  }
}

function readInitialAuthView(): AuthViewMode {
  if (captureInviteFromUrl()) return 'register'
  const urlAuth = readUrlRoute().authView
  if (urlAuth) return urlAuth
  try {
    const hs = window.history.state as IpHistoryState | null
    if (hs?.__ipNav === true && hs.kind === 'auth' && hs.authView) {
      return hs.authView
    }
  } catch {
    /* ignore */
  }
  return 'landing'
}

function scrollWorkspaceToTop(): void {
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    const mainEl = document.querySelector('main')
    if (mainEl) {
      mainEl.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
  } catch {
    /* ignore */
  }
}

/* ============================================================================
 * Registro global ligero de capas transitorias (menú móvil, paleta, lightbox)
 * Permite que el botón físico «Atrás» en móvil/navegador cierre primero el
 * cajón o modal abierto antes de retroceder de pantalla.
 * ========================================================================== */

interface OverlayEntry {
  id: string
  onClose: () => void
}

const overlayRegistry: OverlayEntry[] = []
let ignoreOverlayBackPopCount = 0

function clearAllRegisteredOverlays(invokeClose = true): void {
  const copy = overlayRegistry.splice(0, overlayRegistry.length)
  if (invokeClose) {
    for (let i = copy.length - 1; i >= 0; i--) {
      try {
        copy[i].onClose()
      } catch {
        /* ignore */
      }
    }
  }
}

export function useBackOverlay(active: boolean, onClose: () => void): void {
  const id = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active || isStandalonePublicRoute()) return

    const wasEmpty = overlayRegistry.length === 0
    overlayRegistry.push({
      id,
      onClose: () => onCloseRef.current(),
    })

    try {
      const hs = window.history.state as IpHistoryState | null
      if (wasEmpty && hs?.__ipNav === true && !hs.overlay && !hasSupabaseAuthHash()) {
        window.history.pushState({ ...hs, overlay: true }, '', window.location.href)
      }
    } catch {
      /* ignore */
    }

    return () => {
      const idx = overlayRegistry.findIndex(item => item.id === id)
      const wasStillRegistered = idx !== -1
      if (wasStillRegistered) {
        overlayRegistry.splice(idx, 1)
      }

      if (wasStillRegistered && overlayRegistry.length === 0) {
        try {
          const hs = window.history.state as IpHistoryState | null
          if (hs?.__ipNav === true && hs.overlay === true) {
            ignoreOverlayBackPopCount += 1
            window.history.back()
          }
        } catch {
          /* ignore */
        }
      }
    }
  }, [active, id])
}

/* ============================================================================
 * Hook principal de navegación persistente e historial «Atrás»
 * ========================================================================== */

export function useAppNavigation({
  isAuthenticated,
  isLoading,
  scopeKey,
  isAllowedPage,
  defaultPage = 'dashboard',
}: {
  isAuthenticated: boolean
  isLoading: boolean
  scopeKey: string | null
  isAllowedPage: (page: string) => boolean
  defaultPage?: string
}) {
  const [session, setSession] = useState<PersistedNavSession>(() => readInitialNavSession())
  const [authView, setAuthView] = useState<AuthViewMode>(() => readInitialAuthView())
  const [exitHintVisible, setExitHintVisible] = useState(false)

  const sessionRef = useRef(session)
  sessionRef.current = session

  const isAuthenticatedRef = useRef(isAuthenticated)
  isAuthenticatedRef.current = isAuthenticated

  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey

  const isAllowedPageRef = useRef(isAllowedPage)
  isAllowedPageRef.current = isAllowedPage

  const defaultPageRef = useRef(defaultPage)
  defaultPageRef.current = defaultPage

  const allowExitUntilRef = useRef(0)
  const exitHintTimerRef = useRef<number | null>(null)
  const exitingAppRef = useRef(false)

  const showExitHint = useCallback(() => {
    setExitHintVisible(true)
    if (exitHintTimerRef.current !== null) {
      window.clearTimeout(exitHintTimerRef.current)
    }
    exitHintTimerRef.current = window.setTimeout(() => {
      setExitHintVisible(false)
      exitHintTimerRef.current = null
    }, EXIT_CONFIRM_WINDOW_MS)
  }, [])

  const hideExitHint = useCallback(() => {
    allowExitUntilRef.current = 0
    setExitHintVisible(false)
    if (exitHintTimerRef.current !== null) {
      window.clearTimeout(exitHintTimerRef.current)
      exitHintTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (exitHintTimerRef.current !== null) {
        window.clearTimeout(exitHintTimerRef.current)
      }
    }
  }, [])

  // Sincroniza y ancla el historial del navegador al cargar o cambiar de sesión/rol
  useEffect(() => {
    if (isLoading || isStandalonePublicRoute()) return

    if (isAuthenticated && scopeKey) {
      let nextSession = sessionRef.current

      // Si cambió de usuario real respecto al respaldo anterior (sin ?vista explícito en URL), iniciar limpio
      const urlHasExplicitPage = Boolean(readUrlRoute().page || readUrlRoute().previewCatalogId)
      if (
        nextSession.scopeKey &&
        nextSession.scopeKey !== scopeKey &&
        !urlHasExplicitPage
      ) {
        nextSession = {
          stack: [{ page: 'dashboard', previewCatalogId: null }],
          index: 0,
          scopeKey,
          updatedAt: Date.now(),
        }
      } else if (nextSession.scopeKey !== scopeKey) {
        nextSession = {
          ...nextSession,
          scopeKey,
          updatedAt: Date.now(),
        }
      }

      // Validar permisos del rol actual sobre la pantalla activa
      const activeEntry = nextSession.stack[nextSession.index] || {
        page: defaultPageRef.current,
        previewCatalogId: null,
      }
      if (!isAllowedPageRef.current(activeEntry.page)) {
        const safeFallback = isValidAppPage(defaultPageRef.current)
          ? defaultPageRef.current
          : 'dashboard'
        const fallbackEntry: NavRouteEntry = { page: safeFallback, previewCatalogId: null }
        const updatedStack = nextSession.stack.slice()
        updatedStack[nextSession.index] = fallbackEntry
        nextSession = {
          ...nextSession,
          stack: updatedStack,
          updatedAt: Date.now(),
        }
      }

      if (nextSession !== sessionRef.current) {
        sessionRef.current = nextSession
        setSession(nextSession)
      }
      writePersistedSession(nextSession)

      if (!hasSupabaseAuthHash()) {
        const entry = nextSession.stack[nextSession.index] || {
          page: 'dashboard',
          previewCatalogId: null,
        }
        const targetUrl = buildAppUrl(entry.page, entry.previewCatalogId)
        const hs = window.history.state as IpHistoryState | null

        if (hs?.__ipNav === true && hs.kind === 'app') {
          const currentFullUrl =
            window.location.pathname + window.location.search + window.location.hash
          if (
            hs.overlay === true ||
            hs.page !== entry.page ||
            (hs.previewCatalogId || null) !== entry.previewCatalogId ||
            hs.stackIndex !== nextSession.index ||
            currentFullUrl !== targetUrl
          ) {
            window.history.replaceState(
              {
                __ipNav: true,
                kind: 'app',
                stackIndex: nextSession.index,
                page: entry.page,
                previewCatalogId: entry.previewCatalogId,
                overlay: false,
              } satisfies IpHistoryState,
              '',
              targetUrl
            )
          }
        } else {
          // Anclar entrada centinela en la base para que «Atrás» recorra las pantallas visitadas sin cerrar la app
          window.history.replaceState(
            {
              __ipNav: true,
              kind: 'sentinel',
            } satisfies IpHistoryState,
            '',
            buildAppUrl('dashboard', null)
          )
          window.history.pushState(
            {
              __ipNav: true,
              kind: 'app',
              stackIndex: nextSession.index,
              page: entry.page,
              previewCatalogId: entry.previewCatalogId,
              overlay: false,
            } satisfies IpHistoryState,
            '',
            targetUrl
          )
        }
      }
      return
    }

    if (!isAuthenticated && !hasSupabaseAuthHash()) {
      const hs = window.history.state as IpHistoryState | null
      const urlHasAppPage = Boolean(readUrlRoute().page || readUrlRoute().previewCatalogId)
      // No borrar ?vista= si la URL traía una vista de la app hasta que el visitante interactúe en auth o cierre sesión explícitamente
      if (!urlHasAppPage && (hs?.__ipNav !== true || hs.kind !== 'auth')) {
        const targetUrl = buildAuthUrl(authView)
        window.history.replaceState(
          {
            __ipNav: true,
            kind: 'auth',
            authView,
            fromLanding: false,
          } satisfies IpHistoryState,
          '',
          targetUrl
        )
      }
    }
  }, [isAuthenticated, isLoading, scopeKey, authView, defaultPage])

  // Escucha global del botón «Atrás» / «Adelante» del navegador o teléfono
  useEffect(() => {
    if (isStandalonePublicRoute()) return

    const onPopState = (event: PopStateEvent) => {
      if (ignoreOverlayBackPopCount > 0) {
        ignoreOverlayBackPopCount -= 1
        return
      }

      if (exitingAppRef.current) {
        return
      }

      // 1. Si hay un cajón/modal/lightbox abierto, cerrarlo primero sin cambiar de pantalla
      if (overlayRegistry.length > 0) {
        const top = overlayRegistry.pop()
        if (top) {
          try {
            top.onClose()
          } catch {
            /* ignore */
          }
        }
        if (overlayRegistry.length > 0) {
          try {
            const baseState = (event.state as IpHistoryState | null) || {
              __ipNav: true as const,
              kind: 'app' as const,
            }
            window.history.pushState({ ...baseState, overlay: true }, '', window.location.href)
          } catch {
            /* ignore */
          }
        }
        return
      }

      const state = event.state as IpHistoryState | null

      // 2. Navegación dentro de la sesión autenticada
      if (isAuthenticatedRef.current) {
        if (state?.__ipNav === true && state.kind === 'app') {
          hideExitHint()
          const rawPage = isValidAppPage(state.page) ? state.page : 'dashboard'
          const safePage = isAllowedPageRef.current(rawPage) ? rawPage : 'dashboard'
          const safePreview =
            typeof state.previewCatalogId === 'string' && isValidStoreIdentifier(state.previewCatalogId)
              ? state.previewCatalogId
              : null
          const targetEntry: NavRouteEntry = {
            page: safePage,
            previewCatalogId: safePreview,
          }

          const cur = sessionRef.current
          let nextIndex = cur.index
          let nextStack = cur.stack

          if (
            typeof state.stackIndex === 'number' &&
            state.stackIndex >= 0 &&
            state.stackIndex < cur.stack.length
          ) {
            nextIndex = state.stackIndex
            if (!isSameEntry(cur.stack[nextIndex], targetEntry)) {
              nextStack = cur.stack.slice()
              nextStack[nextIndex] = targetEntry
            }
          } else {
            const foundIdx = cur.stack.findIndex(it => isSameEntry(it, targetEntry))
            if (foundIdx !== -1) {
              nextIndex = foundIdx
            } else {
              nextStack = [...cur.stack.slice(0, cur.index + 1), targetEntry].slice(
                -MAX_STACK_LENGTH
              )
              nextIndex = nextStack.length - 1
            }
          }

          const updated: PersistedNavSession = {
            stack: nextStack,
            index: nextIndex,
            scopeKey: scopeKeyRef.current,
            updatedAt: Date.now(),
          }
          sessionRef.current = updated
          setSession(updated)
          writePersistedSession(updated)
          scrollWorkspaceToTop()
          return
        }

        if (state?.__ipNav === true && state.kind === 'sentinel') {
          const cur = sessionRef.current

          // Si existen pantallas previas en la pila persistida (ej. tras recargar o abrir enlace directo), retroceder paso a paso
          if (cur.index > 0) {
            hideExitHint()
            const prevIndex = cur.index - 1
            const rawPrev = cur.stack[prevIndex] || {
              page: 'dashboard',
              previewCatalogId: null,
            }
            const safePage = isAllowedPageRef.current(rawPrev.page)
              ? rawPrev.page
              : 'dashboard'
            const prevEntry: NavRouteEntry = {
              page: safePage,
              previewCatalogId: rawPrev.previewCatalogId,
            }

            const nextStack = cur.stack.slice()
            nextStack[prevIndex] = prevEntry

            const updated: PersistedNavSession = {
              stack: nextStack,
              index: prevIndex,
              scopeKey: scopeKeyRef.current,
              updatedAt: Date.now(),
            }
            sessionRef.current = updated
            setSession(updated)
            writePersistedSession(updated)
            scrollWorkspaceToTop()

            window.history.pushState(
              {
                __ipNav: true,
                kind: 'app',
                stackIndex: prevIndex,
                page: prevEntry.page,
                previewCatalogId: prevEntry.previewCatalogId,
                overlay: false,
              } satisfies IpHistoryState,
              '',
              buildAppUrl(prevEntry.page, prevEntry.previewCatalogId)
            )
            return
          }

          // Si en índice 0 no estaba aún en dashboard, llevar a dashboard antes de salir
          const rootEntry = cur.stack[0]
          if (rootEntry && (rootEntry.page !== 'dashboard' || rootEntry.previewCatalogId)) {
            hideExitHint()
            const homeEntry: NavRouteEntry = { page: 'dashboard', previewCatalogId: null }
            const updated: PersistedNavSession = {
              stack: [homeEntry],
              index: 0,
              scopeKey: scopeKeyRef.current,
              updatedAt: Date.now(),
            }
            sessionRef.current = updated
            setSession(updated)
            writePersistedSession(updated)
            scrollWorkspaceToTop()

            window.history.pushState(
              {
                __ipNav: true,
                kind: 'app',
                stackIndex: 0,
                page: 'dashboard',
                previewCatalogId: null,
                overlay: false,
              } satisfies IpHistoryState,
              '',
              buildAppUrl('dashboard', null)
            )
            return
          }

          // Ya estamos en el inicio (dashboard): proteger contra cierre accidental con doble confirmación de Atrás
          const userInteracted =
            typeof navigator !== 'undefined' && 'userActivation' in navigator
              ? Boolean(navigator.userActivation?.hasBeenActive)
              : true

          if (!userInteracted || Date.now() < allowExitUntilRef.current) {
            hideExitHint()
            exitingAppRef.current = true
            window.history.back()
            window.setTimeout(() => {
              exitingAppRef.current = false
            }, 600)
            return
          }

          allowExitUntilRef.current = Date.now() + EXIT_CONFIRM_WINDOW_MS
          showExitHint()
          window.history.pushState(
            {
              __ipNav: true,
              kind: 'app',
              stackIndex: 0,
              page: 'dashboard',
              previewCatalogId: null,
              overlay: false,
            } satisfies IpHistoryState,
            '',
            buildAppUrl('dashboard', null)
          )
          return
        }

        // Cualquier otro estado antiguo del historial mientras sigue autenticado: mantener sincronizado con URL o inicio
        const urlRoute = readUrlRoute()
        const fallbackPage =
          urlRoute.page && isAllowedPageRef.current(urlRoute.page)
            ? urlRoute.page
            : 'dashboard'
        const fallbackEntry: NavRouteEntry = {
          page: fallbackPage,
          previewCatalogId: urlRoute.previewCatalogId,
        }
        const seeded = buildSeedStackForEntry(fallbackEntry)
        const updated: PersistedNavSession = {
          stack: seeded.stack,
          index: seeded.index,
          scopeKey: scopeKeyRef.current,
          updatedAt: Date.now(),
        }
        sessionRef.current = updated
        setSession(updated)
        writePersistedSession(updated)
        window.history.replaceState(
          {
            __ipNav: true,
            kind: 'sentinel',
          } satisfies IpHistoryState,
          '',
          buildAppUrl('dashboard', null)
        )
        window.history.pushState(
          {
            __ipNav: true,
            kind: 'app',
            stackIndex: updated.index,
            page: fallbackEntry.page,
            previewCatalogId: fallbackEntry.previewCatalogId,
            overlay: false,
          } satisfies IpHistoryState,
          '',
          buildAppUrl(fallbackEntry.page, fallbackEntry.previewCatalogId)
        )
        return
      }

      // 3. Navegación en vistas públicas de acceso (Landing <-> Login / Registro)
      if (state?.__ipNav === true && state.kind === 'auth' && state.authView) {
        setAuthView(state.authView)
        scrollWorkspaceToTop()
      } else {
        const urlAuth = readUrlRoute().authView
        setAuthView(urlAuth || 'landing')
        scrollWorkspaceToTop()
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [hideExitHint, showExitHint])

  const commitNavigation = useCallback(
    (
      nextEntry: NavRouteEntry,
      options?: { resetStack?: boolean; replaceCurrent?: boolean }
    ) => {
      hideExitHint()

      const safePage = isValidAppPage(nextEntry.page) ? nextEntry.page : 'dashboard'
      const cleanEntry: NavRouteEntry = {
        page: safePage,
        previewCatalogId: nextEntry.previewCatalogId || null,
      }

      const cur = sessionRef.current
      const curEntry = cur.stack[cur.index] || { page: 'dashboard', previewCatalogId: null }

      const hs = (
        typeof window !== 'undefined' ? window.history.state : null
      ) as IpHistoryState | null
      const hadOverlaySlot = hs?.__ipNav === true && hs.overlay === true

      // Si navega a la misma pantalla donde ya está, sólo cerrar capas abiertas
      if (!options?.resetStack && isSameEntry(curEntry, cleanEntry)) {
        if (overlayRegistry.length > 0) {
          clearAllRegisteredOverlays(true)
          if (hadOverlaySlot) {
            ignoreOverlayBackPopCount += 1
            window.history.back()
          }
        }
        return
      }

      // Al cambiar de pantalla, cerrar menús/paletas transitorias sin disparar history.back adicional
      if (overlayRegistry.length > 0) {
        clearAllRegisteredOverlays(true)
      }

      let nextStack: NavRouteEntry[]
      let nextIndex: number

      if (options?.resetStack) {
        const seeded = buildSeedStackForEntry(cleanEntry)
        nextStack = seeded.stack
        nextIndex = seeded.index
      } else if (options?.replaceCurrent) {
        nextStack = cur.stack.slice(0, cur.index + 1)
        nextStack[cur.index] = cleanEntry
        nextIndex = cur.index
      } else {
        const base = cur.stack.slice(0, cur.index + 1)
        base.push(cleanEntry)
        nextStack = base.slice(-MAX_STACK_LENGTH)
        nextIndex = nextStack.length - 1
      }

      const updated: PersistedNavSession = {
        stack: nextStack,
        index: nextIndex,
        scopeKey: scopeKeyRef.current,
        updatedAt: Date.now(),
      }

      sessionRef.current = updated
      setSession(updated)
      writePersistedSession(updated)
      scrollWorkspaceToTop()

      if (isAuthenticatedRef.current && !hasSupabaseAuthHash()) {
        const targetUrl = buildAppUrl(cleanEntry.page, cleanEntry.previewCatalogId)
        const nextHistoryState: IpHistoryState = {
          __ipNav: true,
          kind: 'app',
          stackIndex: nextIndex,
          page: cleanEntry.page,
          previewCatalogId: cleanEntry.previewCatalogId,
          overlay: false,
        }

        if (hs?.__ipNav === true && hs.kind === 'sentinel') {
          // Si estaba sobre el centinela, asegurar base e insertar pantalla
          if (cleanEntry.page !== 'dashboard' || cleanEntry.previewCatalogId) {
            window.history.pushState(
              {
                __ipNav: true,
                kind: 'app',
                stackIndex: 0,
                page: 'dashboard',
                previewCatalogId: null,
                overlay: false,
              } satisfies IpHistoryState,
              '',
              buildAppUrl('dashboard', null)
            )
          }
          window.history.pushState(nextHistoryState, '', targetUrl)
        } else if (hadOverlaySlot || options?.replaceCurrent || options?.resetStack) {
          if (options?.resetStack) {
            window.history.replaceState(
              {
                __ipNav: true,
                kind: 'sentinel',
              } satisfies IpHistoryState,
              '',
              buildAppUrl('dashboard', null)
            )
            window.history.pushState(nextHistoryState, '', targetUrl)
          } else {
            window.history.replaceState(nextHistoryState, '', targetUrl)
          }
        } else {
          window.history.pushState(nextHistoryState, '', targetUrl)
        }
      }
    },
    [hideExitHint]
  )

  const navigateToPage = useCallback(
    (nextPage: string, options?: { resetStack?: boolean }) => {
      commitNavigation({ page: nextPage, previewCatalogId: null }, options)
    },
    [commitNavigation]
  )

  const openCatalogPreview = useCallback(
    (companyId: string) => {
      const curEntry = sessionRef.current.stack[sessionRef.current.index] || {
        page: 'dashboard',
        previewCatalogId: null,
      }
      commitNavigation({ page: curEntry.page, previewCatalogId: companyId })
    },
    [commitNavigation]
  )

  const goBack = useCallback(() => {
    if (overlayRegistry.length > 0) {
      const hs = window.history.state as IpHistoryState | null
      if (hs?.__ipNav === true && hs.overlay === true) {
        window.history.back()
      } else {
        const top = overlayRegistry.pop()
        top?.onClose()
      }
      return
    }

    const cur = sessionRef.current
    const activeEntry = cur.stack[cur.index] || { page: 'dashboard', previewCatalogId: null }

    if (cur.index > 0) {
      const hs = window.history.state as IpHistoryState | null
      if (hs?.__ipNav === true && hs.kind === 'app') {
        window.history.back()
        return
      }
      // Respaldo directo si el navegador aún no tenía estado sincronizado
      const prevIndex = cur.index - 1
      const prevEntry = cur.stack[prevIndex] || { page: 'dashboard', previewCatalogId: null }
      const updated: PersistedNavSession = {
        ...cur,
        index: prevIndex,
        updatedAt: Date.now(),
      }
      sessionRef.current = updated
      setSession(updated)
      writePersistedSession(updated)
      scrollWorkspaceToTop()
      window.history.replaceState(
        {
          __ipNav: true,
          kind: 'app',
          stackIndex: prevIndex,
          page: prevEntry.page,
          previewCatalogId: prevEntry.previewCatalogId,
          overlay: false,
        } satisfies IpHistoryState,
        '',
        buildAppUrl(prevEntry.page, prevEntry.previewCatalogId)
      )
      return
    }

    if (activeEntry.previewCatalogId) {
      commitNavigation({ page: activeEntry.page, previewCatalogId: null }, { replaceCurrent: true })
      return
    }

    if (activeEntry.page !== 'dashboard') {
      commitNavigation({ page: 'dashboard', previewCatalogId: null }, { resetStack: true })
    }
  }, [commitNavigation])

  const navigateAuthView = useCallback((nextAuth: AuthViewMode) => {
    const hs = window.history.state as IpHistoryState | null
    if (nextAuth === 'landing') {
      if (hs?.__ipNav === true && hs.kind === 'auth' && hs.fromLanding) {
        window.history.back()
        return
      }
      setAuthView('landing')
      scrollWorkspaceToTop()
      if (!hasSupabaseAuthHash()) {
        window.history.replaceState(
          {
            __ipNav: true,
            kind: 'auth',
            authView: 'landing',
            fromLanding: false,
          } satisfies IpHistoryState,
          '',
          buildAuthUrl('landing')
        )
      }
      return
    }

    setAuthView(nextAuth)
    scrollWorkspaceToTop()
    if (!hasSupabaseAuthHash()) {
      const cameFromLanding = hs?.__ipNav === true && hs.kind === 'auth' && hs.authView === 'landing'
      if (cameFromLanding) {
        window.history.pushState(
          {
            __ipNav: true,
            kind: 'auth',
            authView: nextAuth,
            fromLanding: true,
          } satisfies IpHistoryState,
          '',
          buildAuthUrl(nextAuth)
        )
      } else {
        // Si ya estaba en login y cambia a registro (o viceversa), reemplazar sin apilar múltiples formularios
        window.history.replaceState(
          {
            __ipNav: true,
            kind: 'auth',
            authView: nextAuth,
            fromLanding: Boolean(hs?.__ipNav === true && hs.kind === 'auth' && hs.fromLanding),
          } satisfies IpHistoryState,
          '',
          buildAuthUrl(nextAuth)
        )
      }
    }
  }, [])

  const resetNavigationForLogout = useCallback(
    (nextAuth: AuthViewMode = 'landing') => {
      hideExitHint()
      clearAllRegisteredOverlays(false)
      clearPersistedNavSession()

      const fresh: PersistedNavSession = {
        stack: [{ page: 'dashboard', previewCatalogId: null }],
        index: 0,
        scopeKey: null,
        updatedAt: Date.now(),
      }
      sessionRef.current = fresh
      setSession(fresh)
      setAuthView(nextAuth)
      scrollWorkspaceToTop()

      if (!hasSupabaseAuthHash()) {
        window.history.replaceState(
          {
            __ipNav: true,
            kind: 'auth',
            authView: nextAuth,
            fromLanding: false,
          } satisfies IpHistoryState,
          '',
          buildAuthUrl(nextAuth)
        )
      }
    },
    [hideExitHint]
  )

  const activeEntry = session.stack[session.index] || {
    page: 'dashboard',
    previewCatalogId: null,
  }
  const previousEntry = session.index > 0 ? session.stack[session.index - 1] : null

  const canGoBack =
    session.index > 0 ||
    Boolean(activeEntry.previewCatalogId) ||
    activeEntry.page !== 'dashboard'

  const previousPageLabel = previousEntry
    ? previousEntry.previewCatalogId
      ? 'Catálogo público'
      : getPageLabel(previousEntry.page)
    : activeEntry.previewCatalogId
      ? getPageLabel(activeEntry.page)
      : activeEntry.page !== 'dashboard'
        ? getPageLabel('dashboard')
        : null

  return {
    current: activeEntry.page,
    previewCatalogId: activeEntry.previewCatalogId,
    authView,
    canGoBack,
    previousPageLabel,
    exitHintVisible,
    navigateToPage,
    openCatalogPreview,
    exitCatalogPreview: goBack,
    goBack,
    navigateAuthView,
    resetNavigationForLogout,
  }
}
