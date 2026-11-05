import { supabase } from './supabase'

export type DeviceKind = 'movil' | 'tablet' | 'pc' | 'mac'
export type DeviceStatus = 'verificando' | 'error' | 'pendiente' | 'autorizado' | 'bloqueado'

export interface DeviceState {
  status: DeviceStatus
  enforced: boolean
  message?: string
  offline?: boolean
  expiresAt?: number
}

interface CachedDeviceAuthorization {
  userId: string
  deviceKey: string
  status: 'autorizado' | 'pendiente'
  enforced: boolean
  savedAt: number
  expiresAt: number
}

const DEVICE_KEY = 'ip_device_key'
const AUTH_CACHE_PREFIX = 'ip_device_authorization_'

export const OFFLINE_AUTH_VALIDITY = 7 * 24 * 60 * 60 * 1000

export function getDeviceKey(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('No se puede acceder al almacenamiento de este navegador.')
  }

  let key = window.localStorage.getItem(DEVICE_KEY)

  if (!key) {
    if (!globalThis.crypto?.randomUUID) {
      throw new Error('Este navegador no permite generar un identificador seguro para el dispositivo.')
    }

    key = globalThis.crypto.randomUUID()
    window.localStorage.setItem(DEVICE_KEY, key)
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error('El identificador local del dispositivo no es válido.')
  }

  return key
}

function authorizationCacheKey(userId: string): string {
  return `${AUTH_CACHE_PREFIX}${userId}`
}

function saveOfflineAuthorization(
  userId: string,
  deviceKey: string,
  status: 'autorizado' | 'pendiente',
  enforced: boolean
): number {
  const now = Date.now()
  const expiresAt = now + OFFLINE_AUTH_VALIDITY

  const record: CachedDeviceAuthorization = {
    userId,
    deviceKey,
    status,
    enforced,
    savedAt: now,
    expiresAt,
  }

  localStorage.setItem(
    authorizationCacheKey(userId),
    JSON.stringify(record)
  )

  return expiresAt
}

function readOfflineAuthorization(
  userId: string,
  deviceKey: string
): DeviceState | null {
  try {
    const raw = localStorage.getItem(authorizationCacheKey(userId))

    if (!raw) return null

    const cached = JSON.parse(raw) as CachedDeviceAuthorization

    if (
      cached.userId !== userId ||
      cached.deviceKey !== deviceKey ||
      !Number.isFinite(cached.expiresAt) ||
      cached.expiresAt <= Date.now() ||
      !['autorizado', 'pendiente'].includes(cached.status) ||
      typeof cached.enforced !== 'boolean'
    ) {
      localStorage.removeItem(authorizationCacheKey(userId))
      return null
    }

    return {
      status: cached.status,
      enforced: cached.enforced,
      offline: true,
      expiresAt: cached.expiresAt,
      message: 'Trabajando sin conexión con la última autorización guardada.',
    }
  } catch {
    return null
  }
}

function clearOfflineAuthorization(userId: string): void {
  try {
    localStorage.removeItem(authorizationCacheKey(userId))
  } catch {
    // El bloqueo del servidor se mantiene aunque no pueda borrarse la caché local.
  }
}

export function detectDevice(): {
  kind: DeviceKind
  os: string
  browser: string
  name: string
} {
  const ua = navigator.userAgent

  const isIpad =
    /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)

  let kind: DeviceKind = 'pc'
  let os = 'Otro'

  if (isIpad || /Tablet|Android(?!.*Mobile)/.test(ua)) {
    kind = 'tablet'
    os = isIpad ? 'iPadOS' : 'Android'
  } else if (/iPhone|Android.*Mobile/.test(ua)) {
    kind = 'movil'
    os = /iPhone/.test(ua) ? 'iOS' : 'Android'
  } else if (/Macintosh/.test(ua)) {
    kind = 'mac'
    os = 'macOS'
  } else if (/Windows/.test(ua)) {
    os = 'Windows'
  } else if (/CrOS/.test(ua)) {
    os = 'ChromeOS'
  } else if (/Linux/.test(ua)) {
    os = 'Linux'
  }

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Navegador'

  const label = {
    movil: 'Móvil',
    tablet: 'Tablet',
    pc: 'PC',
    mac: 'Mac',
  }[kind]

  return {
    kind,
    os,
    browser,
    name: `${label} · ${browser}`,
  }
}

function isNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : String((error as any)?.message || '')

  return /fetch|network|load failed|timeout|aborted|offline|failed to connect/i.test(message)
}

export async function registerDevice(
  userId: string
): Promise<DeviceState> {
  let deviceKey = ''

  try {
    if (!userId) {
      return {
        status: 'error',
        enforced: true,
        message: 'No se pudo identificar al usuario.',
      }
    }

    deviceKey = getDeviceKey()

    // Sin cobertura: se permite continuar únicamente si existe
    // una autorización previa y todavía está dentro de su vigencia.
    if (!navigator.onLine) {
      return readOfflineAuthorization(userId, deviceKey) || {
        status: 'error',
        enforced: true,
        message: 'Este dispositivo no tiene una autorización offline vigente. Conéctate a internet para verificarlo.',
      }
    }

    const d = detectDevice()

    const { data, error } = await supabase.rpc('register_device', {
      p_key: deviceKey,
      p_name: d.name,
      p_kind: d.kind,
      p_os: d.os,
      p_browser: d.browser,
    })

    if (error) {
      if (isNetworkFailure(error)) {
        return readOfflineAuthorization(userId, deviceKey) || {
          status: 'error',
          enforced: true,
          message: 'No hay conexión y este dispositivo no tiene una autorización offline vigente.',
        }
      }

      return {
        status: 'error',
        enforced: true,
        message: error.message || 'No fue posible verificar el dispositivo.',
      }
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        status: 'error',
        enforced: true,
        message: 'El servidor devolvió una respuesta de autorización inválida.',
      }
    }

    const result = data as {
      status?: string
      enforced?: boolean
      error?: string
    }

    const allowedStatuses = [
      'pendiente',
      'autorizado',
      'bloqueado',
    ]

    if (!result.status || !allowedStatuses.includes(result.status)) {
      return {
        status: 'error',
        enforced: true,
        message: result.error || 'El servidor no confirmó la autorización de este dispositivo.',
      }
    }

    if (result.status === 'bloqueado') {
      clearOfflineAuthorization(userId)

      return {
        status: 'bloqueado',
        enforced: result.enforced === true,
      }
    }

    const status = result.status as 'autorizado' | 'pendiente'
    const enforced = result.enforced === true

    const expiresAt = saveOfflineAuthorization(
      userId,
      deviceKey,
      status,
      enforced
    )

    return {
      status,
      enforced,
      offline: false,
      expiresAt,
    }
  } catch (error) {
    if (userId && deviceKey && isNetworkFailure(error)) {
      return readOfflineAuthorization(userId, deviceKey) || {
        status: 'error',
        enforced: true,
        message: 'No hay conexión y este dispositivo no tiene una autorización offline vigente.',
      }
    }

    return {
      status: 'error',
      enforced: true,
      message: error instanceof Error
        ? error.message
        : 'Error inesperado al verificar el dispositivo.',
    }
  }
}

// Confirma periódicamente que este dispositivo autorizado sigue activo.
// null significa que no fue posible comprobarlo por falta de conexión.
export async function touchDevice(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.onLine) {
    return null
  }

  const deviceKey = getDeviceKey()

  const { data, error } = await supabase.rpc('touch_device', {
    p_key: deviceKey,
  })

  if (error) {
    if (isNetworkFailure(error)) return null

    throw error
  }

  return data === true
}
