import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import {
  supabase,
  isDemoMode,
  getDemoRole,
  getDemoUserId,
  activateDemoSession,
  deactivateDemoSession,
  resetDemoWorkspace,
  getRealSupabase,
  type DemoRole,
} from './supabase'
import { isNetworkError } from './offlineQueue'
import type { Role, UserProfile } from '../types'

export type PlanType =
  | 'emprendedor'
  | 'profesional'
  | 'empresarial'
  | 'corporativo'

/**
 * Cuenta maestra exclusiva del desarrollador y administrador global.
 * Única cuenta real autorizada para activar el «Paso Maestro» de cambio de rol en vivo.
 */
export const MASTER_DEV_EMAIL = 'sanlobo3@hotmail.com'

export function isMasterDeveloperEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.trim().toLowerCase() === MASTER_DEV_EMAIL)
}

const INVITE_STORAGE_KEY = 'ip_pending_invite'
const PROFILE_KEY = 'ip_profile_cache'
const MASTER_OVERRIDE_KEY = 'ip_master_dev_override_v1'

export interface MasterCompanyOverride {
  id: string
  name: string
}

interface PersistedMasterOverride {
  email: string
  role: Role | null
  company: MasterCompanyOverride | null
}

function readPersistedMasterOverride(): PersistedMasterOverride | null {
  try {
    const raw = sessionStorage.getItem(MASTER_OVERRIDE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedMasterOverride>
    if (!isMasterDeveloperEmail(parsed.email)) return null
    return {
      email: MASTER_DEV_EMAIL,
      role: (parsed.role as Role | null) ?? null,
      company:
        parsed.company &&
        typeof parsed.company.id === 'string' &&
        typeof parsed.company.name === 'string'
          ? { id: parsed.company.id, name: parsed.company.name }
          : null,
    }
  } catch {
    return null
  }
}

function writePersistedMasterOverride(
  role: Role | null,
  company: MasterCompanyOverride | null
): void {
  try {
    if (!role && !company) {
      sessionStorage.removeItem(MASTER_OVERRIDE_KEY)
      return
    }
    const payload: PersistedMasterOverride = {
      email: MASTER_DEV_EMAIL,
      role,
      company,
    }
    sessionStorage.setItem(MASTER_OVERRIDE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

function clearPersistedMasterOverride(): void {
  try {
    sessionStorage.removeItem(MASTER_OVERRIDE_KEY)
  } catch {
    /* ignore */
  }
}

type CompanySubscriptionData = {
  company_id?: string | null
  company_name?: string | null
  plan_type?: string | null
  subscription_status?: string | null
  trial_start?: string | null
  trial_end?: string | null
  subscription_end?: string | null
  platform_admin?: boolean
  access?: boolean
  subscription_access?: boolean
  unlimited_devices?: boolean
  [key: string]: unknown
}

export function captureInviteFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = (params.get('invite') || '').trim()

    if (fromUrl) {
      localStorage.setItem(INVITE_STORAGE_KEY, fromUrl)
      return fromUrl
    }

    const stored = (localStorage.getItem(INVITE_STORAGE_KEY) || '').trim()

    return stored || null
  } catch {
    return null
  }
}

export function getPendingInviteCode(): string | null {
  try {
    return (localStorage.getItem(INVITE_STORAGE_KEY) || '').trim() || null
  } catch {
    return null
  }
}

export function setPendingInviteCode(code: string | null) {
  try {
    const clean = (code || '').trim()

    if (clean) {
      localStorage.setItem(INVITE_STORAGE_KEY, clean)
    } else {
      localStorage.removeItem(INVITE_STORAGE_KEY)
    }
  } catch {
    /* sin almacenamiento disponible */
  }

  if (!code) {
    try {
      const url = new URL(window.location.href)

      if (url.searchParams.has('invite')) {
        url.searchParams.delete('invite')
        window.history.replaceState(
          {},
          '',
          url.pathname + url.search + url.hash
        )
      }
    } catch {
      /* ignorar */
    }
  }
}

interface AuthContextValue {
  user: UserProfile | null
  loading: boolean
  isDemo: boolean
  demoRole: DemoRole
  /** Verdadero únicamente cuando la sesión real autenticada pertenece a sanlobo3@hotmail.com */
  isMasterAccount: boolean
  realRole: Role | null
  masterRoleOverride: Role | null
  masterCompanyOverride: MasterCompanyOverride | null
  switchMasterRole: (role: Role | null, company?: MasterCompanyOverride | null) => void
  inviteNotice: string | null
  clearInviteNotice: () => void
  enterDemo: (role?: DemoRole) => Promise<void>
  switchDemoRole: (role: DemoRole) => Promise<void>
  resetDemo: () => Promise<void>
  exitDemo: () => void
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    fullName: string,
    inviteCode?: string | null
  ) => Promise<{ error: string | null }>
  resetPassword: (
    email: string
  ) => Promise<{ error: string | null }>
  updatePassword: (
    newPassword: string
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>(
  {} as AuthContextValue
)

export function useAuth() {
  return useContext(AuthContext)
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador de plataforma',
  super_admin: 'Administrador Central (Super Admin)',
  tecnico: 'Soporte técnico',
  dueno: 'Dueño',
  admin_empresa: 'Administrador de empresa',
  gerente: 'Gerente operativo',
  contador: 'Contador público',
  almacen: 'Jefe de almacén',
  vendedor: 'Vendedor',
  cajero: 'Cajero POS',
  comprador: 'Compras y abastecimiento',
  transportador: 'Transporte y despacho',
}

export function isSuperAdmin(role: Role | string | undefined, isMasterAccount = false): boolean {
  if (role === 'contador' || role === 'gerente' || role === 'vendedor') return false
  return role === 'admin' || role === 'super_admin' || isMasterAccount
}

export function isStrictContador(role: Role | string | undefined): boolean {
  return role === 'contador'
}

export function isStrictVendedor(role: Role | string | undefined): boolean {
  return role === 'vendedor'
}

export function isStrictGerente(role: Role | string | undefined): boolean {
  return role === 'gerente'
}

export const MASTER_SWITCHABLE_ROLES: { id: Role; shortLabel: string; fullLabel: string }[] = [
  { id: 'admin', shortLabel: 'Admin. Plataforma', fullLabel: 'Administrador de plataforma' },
  { id: 'tecnico', shortLabel: 'Soporte Técnico', fullLabel: 'Soporte técnico y sesiones' },
  { id: 'dueno', shortLabel: 'Dueño', fullLabel: 'Dueño de empresa' },
  { id: 'admin_empresa', shortLabel: 'Admin. Empresa', fullLabel: 'Administrador de empresa' },
  { id: 'gerente', shortLabel: 'Gerente', fullLabel: 'Gerente operativo' },
  { id: 'contador', shortLabel: 'Contador Público', fullLabel: 'Contador público (CPC)' },
  { id: 'vendedor', shortLabel: 'Vendedor', fullLabel: 'Vendedor comercial / ruta' },
  { id: 'cajero', shortLabel: 'Cajero POS', fullLabel: 'Cajero de mostrador (POS)' },
  { id: 'almacen', shortLabel: 'Almacén', fullLabel: 'Jefe de almacén y bodegas' },
  { id: 'comprador', shortLabel: 'Compras', fullLabel: 'Compras y abastecimiento' },
  { id: 'transportador', shortLabel: 'Transporte', fullLabel: 'Transporte y despacho' },
]

export function getRoleLabel(role: Role | string | undefined): string {
  if (!role) return 'Personal de empresa'
  return ROLE_LABELS[role as Role] || 'Personal de empresa'
}

export function canManageTechSupport(role: Role | undefined): boolean {
  return role === 'admin' || role === 'tecnico'
}

export function isCompanyManager(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'dueno' ||
    role === 'admin_empresa' ||
    role === 'gerente'
  )
}

export function canRegisterSales(role: Role | undefined): boolean {
  return (
    isCompanyManager(role) ||
    role === 'vendedor' ||
    role === 'cajero'
  )
}

export function canManageUsers(role: Role | undefined): boolean {
  return role === 'admin'
}

export function canManageTeam(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'dueno' ||
    role === 'admin_empresa' ||
    role === 'gerente'
  )
}

export function canManageSettings(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'dueno' ||
    role === 'admin_empresa'
  )
}

export function canViewStats(role: Role | undefined): boolean {
  return (
    isCompanyManager(role) ||
    role === 'contador'
  )
}

export function canManageInventory(role: Role | undefined): boolean {
  return (
    isCompanyManager(role) ||
    role === 'almacen'
  )
}

export function canManagePurchases(role: Role | undefined): boolean {
  return (
    isCompanyManager(role) ||
    role === 'almacen' ||
    role === 'comprador'
  )
}

export function canAccessCashAndAudit(role: Role | undefined): boolean {
  return (
    isCompanyManager(role) ||
    role === 'contador' ||
    role === 'cajero'
  )
}

export function canViewAccounting(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'dueno' ||
    role === 'admin_empresa' ||
    role === 'contador' ||
    role === 'gerente'
  )
}

/**
 * El «Panel ejecutivo» (indicadores de ventas, cartera, deudas, etc.) NO se muestra a los roles de
 * caja/ventas (cajero, vendedor) ni a los roles de alcance estricto (contador, gerente, transporte):
 * ellos trabajan en su propia pantalla de inicio (ver getDefaultPageForRole).
 */
export function canViewDashboard(role: Role | string | undefined): boolean {
  return (
    role !== 'cajero' &&
    role !== 'vendedor' &&
    role !== 'contador' &&
    role !== 'gerente' &&
    role !== 'transportador'
  )
}

/** Pantalla de inicio de cada rol. Fuente ÚNICA: la usan App, el menú y la simulación del Paso Maestro. */
export function getDefaultPageForRole(role: Role | string | undefined): string {
  switch (role) {
    case 'tecnico':
      return 'support'
    case 'contador':
      return 'accounting'
    case 'vendedor':
    case 'cajero':
      return 'pos'
    case 'gerente':
      return 'manager_center'
    case 'transportador':
      return 'warehouses'
    default:
      return 'dashboard'
  }
}

export function canManageTransport(role: Role | undefined): boolean {
  return (
    isCompanyManager(role) ||
    role === 'almacen' ||
    role === 'transportador' ||
    role === 'vendedor'
  )
}

export function getTrialDaysLeft(
  user: UserProfile | null
): number {
  if (!user?.trial_end) return 0

  const end = new Date(user.trial_end).getTime()
  const now = Date.now()

  return Math.max(
    0,
    Math.ceil((end - now) / (1000 * 60 * 60 * 24))
  )
}

export function isTrialActive(
  user: UserProfile | null
): boolean {
  if (!user) return false

  if (user.subscription_status === 'active') return false

  if (
    user.subscription_status === 'trial' &&
    user.trial_end
  ) {
    return new Date(user.trial_end).getTime() > Date.now()
  }

  return false
}

export function isSubscriptionActive(
  user: UserProfile | null
): boolean {
  if (!user) return false

  if (user.subscription_status === 'active') {
    if (user.subscription_end) {
      return (
        new Date(user.subscription_end).getTime() >
        Date.now()
      )
    }

    return true
  }

  return false
}

export function canAccessApp(
  user: UserProfile | null
): boolean {
  if (!user) return false
  if (isMasterDeveloperEmail(user.email)) return true
  if (!user.active) return false

  if (user.role === 'admin' || user.role === 'tecnico') return true

  return true
}

export function isReadOnly(
  user: UserProfile | null
): boolean {
  if (!user) return false

  if (isMasterDeveloperEmail(user.email)) return false
  if (user.role === 'admin' || user.role === 'tecnico') return false

  if (isSubscriptionActive(user)) return false
  if (isTrialActive(user)) return false

  return true
}

function cacheProfile(profile: UserProfile) {
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify(profile)
    )
  } catch {
    /* sin espacio */
  }
}

function clearCachedProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* nada */
  }
}

function readCachedProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)

    return raw
      ? (JSON.parse(raw) as UserProfile)
      : null
  } catch {
    return null
  }
}

async function enrichWithMemberProfile(
  base: UserProfile
): Promise<UserProfile> {
  try {
    const { data, error } = await supabase
      .from('member_profiles')
      .select(
        'avatar_url, national_id, phone, job_title, zone, address, emergency_contact, hire_date, base_salary, commission_pct, notes'
      )
      .eq('user_id', base.id)
      .maybeSingle()

    if (!error && data) {
      return {
        ...base,
        ...(data as Partial<UserProfile>),
      }
    }
  } catch {
    /* tabla opcional antes de ejecutar la migración SQL */
  }

  return base
}

async function enrichWithCompanySubscription(
  base: UserProfile
): Promise<UserProfile> {
  if (base.role === 'admin' || base.role === 'tecnico' || isMasterDeveloperEmail(base.email)) {
    return {
      ...base,
      plan_type: base.plan_type ?? null,
      subscription_status:
        'independent' as UserProfile['subscription_status'],
      trial_start: null,
      trial_end: null,
      subscription_end: null,
      paypal_order_id: null,
      platform_admin: base.role === 'admin' || isMasterDeveloperEmail(base.email),
      subscription_access: true,
      unlimited_devices: true,
    } as UserProfile
  }

  try {
    const { data, error } = await supabase.rpc(
      'my_company_subscription'
    )

    if (error || !data) {
      return base
    }

    const raw = Array.isArray(data) ? data[0] : data

    if (!raw || typeof raw !== 'object') {
      return base
    }

    const subscription =
      raw as CompanySubscriptionData

    const hasValue = (value: unknown) =>
      value !== undefined && value !== null

    const accessValue =
      typeof subscription.subscription_access === 'boolean'
        ? subscription.subscription_access
        : typeof subscription.access === 'boolean'
          ? subscription.access
          : undefined

    const merged: Record<string, unknown> = {
      ...base,
    }

    if (hasValue(subscription.company_id)) {
      merged.company_id = subscription.company_id
    }

    if (hasValue(subscription.company_name)) {
      merged.company_name = subscription.company_name
    }

    if (hasValue(subscription.plan_type)) {
      merged.plan_type = subscription.plan_type
    }

    if (hasValue(subscription.subscription_status)) {
      merged.subscription_status =
        subscription.subscription_status
    }

    if (hasValue(subscription.trial_start)) {
      merged.trial_start = subscription.trial_start
    }

    if (hasValue(subscription.trial_end)) {
      merged.trial_end = subscription.trial_end
    }

    if (hasValue(subscription.subscription_end)) {
      merged.subscription_end =
        subscription.subscription_end
    }

    if (typeof subscription.platform_admin === 'boolean') {
      merged.platform_admin =
        subscription.platform_admin
    }

    if (typeof accessValue === 'boolean') {
      merged.subscription_access = accessValue
    }

    if (
      typeof subscription.unlimited_devices === 'boolean'
    ) {
      merged.unlimited_devices =
        subscription.unlimited_devices
    }

    if (subscription.platform_admin === true) {
      merged.plan_type = null
      merged.subscription_status = 'independent'
      merged.trial_start = null
      merged.trial_end = null
      merged.subscription_end = null
      merged.subscription_access = true
      merged.unlimited_devices = true
    }

    return merged as unknown as UserProfile
  } catch {
    return base
  }
}

async function buildCompleteProfile(
  base: UserProfile
): Promise<UserProfile> {
  const memberProfile =
    await enrichWithMemberProfile(base)

  return enrichWithCompanySubscription(memberProfile)
}

export function AuthProvider({
  children,
}: {
  children: ReactNode
}) {
  const [realUser, setRealUser] =
    useState<UserProfile | null>(null)

  const [loading, setLoading] = useState(true)

  const [isDemo, setIsDemo] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('ip_demo_mode') === '1'
    } catch {
      return false
    }
  })

  const [demoRole, setDemoRoleState] = useState<DemoRole>(() => getDemoRole())

  const [masterRoleOverride, setMasterRoleOverride] = useState<Role | null>(() => {
    return readPersistedMasterOverride()?.role ?? null
  })

  const [masterCompanyOverride, setMasterCompanyOverride] = useState<MasterCompanyOverride | null>(() => {
    return readPersistedMasterOverride()?.company ?? null
  })

  const [inviteNotice, setInviteNotice] =
    useState<string | null>(null)

  const isMasterAccount = useMemo(
    () => !isDemo && isMasterDeveloperEmail(realUser?.email),
    [isDemo, realUser?.email]
  )

  const switchMasterRole = useCallback(
    (nextRole: Role | null, nextCompany?: MasterCompanyOverride | null) => {
      if (!isMasterAccount || !realUser || !isMasterDeveloperEmail(realUser.email)) {
        return
      }
      const normalizedRole =
        nextRole && nextRole !== realUser.role ? nextRole : null
      const resolvedCompany =
        nextCompany === undefined ? masterCompanyOverride : nextCompany
      setMasterRoleOverride(normalizedRole)
      setMasterCompanyOverride(resolvedCompany)
      writePersistedMasterOverride(normalizedRole, resolvedCompany)
    },
    [isMasterAccount, realUser, masterCompanyOverride]
  )

  // Construye el perfil activo: para todos los usuarios reales es idéntico a su perfil asignado en BD;
  // exclusivamente para sanlobo3@hotmail.com aplica el Paso Maestro si eligió previsualizar otro rol.
  const user: UserProfile | null = useMemo(() => {
    if (!realUser) return null
    if (!isMasterAccount) return realUser

    const effectiveRole: Role = masterRoleOverride || realUser.role
    const effectiveCompanyId = masterCompanyOverride?.id ?? realUser.company_id ?? null
    const effectiveCompanyName = masterCompanyOverride?.name ?? realUser.company_name ?? null

    return {
      ...realUser,
      role: effectiveRole,
      company_id: effectiveCompanyId,
      company_name: effectiveCompanyName,
      active: true,
      subscription_access: true,
      unlimited_devices: true,
      platform_admin: effectiveRole === 'admin',
      subscription_status:
        effectiveRole === 'admin' || effectiveRole === 'tecnico'
          ? 'independent'
          : 'active',
      subscription_end:
        effectiveRole === 'admin' || effectiveRole === 'tecnico'
          ? null
          : realUser.subscription_end || new Date(Date.now() + 365 * 86400000).toISOString(),
    }
  }, [realUser, isMasterAccount, masterRoleOverride, masterCompanyOverride])

  async function loadDemoUserProfile(role: DemoRole): Promise<void> {
    await activateDemoSession(role)
    const demoUid = getDemoUserId(role)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', demoUid)
      .single()

    if (!error && data) {
      const completeProfile = await buildCompleteProfile(data as UserProfile)
      setIsDemo(true)
      setDemoRoleState(role)
      setRealUser(completeProfile)
    }
    setLoading(false)
  }

  useEffect(() => {
    const inviteFromUrl = captureInviteFromUrl()

    if (inviteFromUrl && isDemoMode()) {
      deactivateDemoSession()
      setIsDemo(false)
    }

    let mounted = true
    let initialSessionFinished = false

    function applyCachedProfile() {
      const cached = readCachedProfile()

      if (cached && mounted) {
        setRealUser(cached)
      }

      if (mounted) {
        setLoading(false)
      }
    }

    async function claimPendingInviteIfAny(
      metaInvite?: string | null
    ) {
      if (isDemoMode()) return

      const fromUrlOrStorage = captureInviteFromUrl()

      const candidate = (
        fromUrlOrStorage ||
        metaInvite ||
        ''
      ).trim()

      if (!candidate) return

      const { data, error } = await supabase.rpc(
        'aceptar_invitacion_vendedor',
        { p_code: candidate }
      )

      if (!error && (data as { ok?: boolean })?.ok) {
        setPendingInviteCode(null)

        if (metaInvite) {
          supabase.auth
            .updateUser({
              data: {
                invite_code: null,
                invite: null,
              },
            })
            .catch(() => {})
        }

        if (
          mounted &&
          !(data as { already_member?: boolean })?.already_member
        ) {
          setInviteNotice(
            'Te uniste exitosamente al equipo como Vendedor.'
          )
        }
      } else if (
        error &&
        !/does not exist|schema cache/i.test(
          error.message || ''
        )
      ) {
        setPendingInviteCode(null)

        if (fromUrlOrStorage && mounted) {
          setInviteNotice(
            'Aviso de invitación: ' + error.message
          )
        }
      }
    }

    async function fetchProfile(
      userId: string,
      metaInvite?: string | null
    ) {
      // Hidratación inmediata desde caché local si coincide el usuario para evitar saltos al refrescar (F5)
      const cached = readCachedProfile()
      if (cached && cached.id === userId && mounted) {
        setRealUser(cached)
      }

      await claimPendingInviteIfAny(metaInvite)

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (!mounted) return

      if (data && !error) {
        const completeProfile =
          await buildCompleteProfile(
            data as UserProfile
          )

        if (!mounted) return

        // Si el usuario real NO es sanlobo3@hotmail.com, purgar cualquier estado residual del Paso Maestro
        if (!isMasterDeveloperEmail(completeProfile.email)) {
          clearPersistedMasterOverride()
          setMasterRoleOverride(null)
          setMasterCompanyOverride(null)
        }

        setRealUser(completeProfile)
        if (!isDemoMode()) {
          cacheProfile(completeProfile)
        }
      } else if (error && isNetworkError(error)) {
        if (cached && cached.id === userId) {
          setRealUser(cached)
        }
      }

      if (mounted) {
        setLoading(false)
      }
    }

    let persistedDemo = false
    try {
      persistedDemo = !inviteFromUrl && sessionStorage.getItem('ip_demo_mode') === '1'
    } catch {
      persistedDemo = false
    }

    if (persistedDemo) {
      initialSessionFinished = true
      void loadDemoUserProfile(getDemoRole())
    } else {
      const realClient = getRealSupabase()
      realClient.auth
        .getSession()
        .then(async ({ data: { session } }) => {
          if (!mounted || isDemoMode()) return

          const metaCode = (
            session?.user?.user_metadata?.invite_code ||
            session?.user?.user_metadata?.invite ||
            null
          ) as string | null

          if (session?.user) {
            await fetchProfile(
              session.user.id,
              metaCode
            )
            initialSessionFinished = true
          } else if (!navigator.onLine) {
            initialSessionFinished = true
            applyCachedProfile()
          } else {
            initialSessionFinished = true
            if (mounted) setLoading(false)
          }
        })
        .catch(() => {
          initialSessionFinished = true
          if (!isDemoMode()) applyCachedProfile()
        })
    }

    const realClient = getRealSupabase()
    const {
      data: { subscription },
    } = realClient.auth.onAuthStateChange(
      (event, session) => {
        try {
          if (sessionStorage.getItem('ip_demo_mode') === '1') return
        } catch {
          /* ignore */
        }

        // Evitar que INITIAL_SESSION con null desactive loading antes de que getSession() termine
        if (!initialSessionFinished && event === 'INITIAL_SESSION' && !session?.user) {
          return
        }

        const metaCode = (
          session?.user?.user_metadata?.invite_code ||
          session?.user?.user_metadata?.invite ||
          null
        ) as string | null

        if (session?.user) {
          void fetchProfile(
            session.user.id,
            metaCode
          )
        } else if (
          !navigator.onLine &&
          readCachedProfile()
        ) {
          applyCachedProfile()
        } else if (event === 'SIGNED_OUT' || initialSessionFinished) {
          if (mounted) {
            setRealUser(null)
            setLoading(false)
          }
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function enterDemo(role: DemoRole = 'dueno') {
    await loadDemoUserProfile(role)
  }

  async function switchDemoRole(role: DemoRole) {
    await loadDemoUserProfile(role)
  }

  async function resetDemo() {
    await resetDemoWorkspace(demoRole)
    await loadDemoUserProfile(demoRole)
  }

  function exitDemo() {
    deactivateDemoSession()
    setIsDemo(false)
    setRealUser(null)
    setLoading(false)
  }

  async function refreshUser() {
    if (!realUser) return

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', realUser.id)
      .single()

    if (error || !data) return

    const completeProfile =
      await buildCompleteProfile(
        data as UserProfile
      )

    setRealUser(completeProfile)
    if (!isDemo) {
      cacheProfile(completeProfile)
    }
  }

  async function signIn(
    email: string,
    password: string
  ) {
    if (isDemo || isDemoMode()) {
      deactivateDemoSession()
      setIsDemo(false)
    }

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    return {
      error: error?.message ?? null,
    }
  }

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    inviteCode?: string | null
  ) {
    if (isDemo || isDemoMode()) {
      deactivateDemoSession()
      setIsDemo(false)
    }

    const cleanInvite = (
      inviteCode ??
      getPendingInviteCode() ??
      ''
    ).trim()

    if (cleanInvite) {
      setPendingInviteCode(cleanInvite)
    }

    const redirectUrl = cleanInvite
      ? `${window.location.origin}/?invite=${encodeURIComponent(
          cleanInvite
        )}`
      : window.location.origin

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          ...(cleanInvite
            ? {
                invite_code: cleanInvite,
                invite: cleanInvite,
                role: 'vendedor',
              }
            : {}),
        },
      },
    })

    return {
      error: error?.message ?? null,
    }
  }

  async function resetPassword(email: string) {
    if (isDemo || isDemoMode()) {
      deactivateDemoSession()
      setIsDemo(false)
    }

    const { error } =
      await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/reset-password`,
        }
      )

    return {
      error: error?.message ?? null,
    }
  }

  async function updatePassword(
    newPassword: string
  ) {
    const { error } =
      await supabase.auth.updateUser({
        password: newPassword,
      })

    return {
      error: error?.message ?? null,
    }
  }

  async function signOut() {
    clearPersistedMasterOverride()
    setMasterRoleOverride(null)
    setMasterCompanyOverride(null)

    if (isDemo || isDemoMode()) {
      exitDemo()
      return
    }

    clearCachedProfile()

    await supabase.auth.signOut()

    setRealUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isDemo,
        demoRole,
        isMasterAccount,
        realRole: realUser?.role ?? null,
        masterRoleOverride: isMasterAccount ? masterRoleOverride : null,
        masterCompanyOverride: isMasterAccount ? masterCompanyOverride : null,
        switchMasterRole,
        inviteNotice,
        clearInviteNotice: () =>
          setInviteNotice(null),
        enterDemo,
        switchDemoRole,
        resetDemo,
        exitDemo,
        signIn,
        signUp,
        resetPassword,
        updatePassword,
        signOut,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
