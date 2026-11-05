import { supabase } from './supabase'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function b64ToU8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function tz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' } catch { return 'America/Bogota' }
}

/** Dirección de esta suscripción en este teléfono (o null si no hay). */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? sub.endpoint : null
  } catch { return null }
}

export async function enablePush(hour: number): Promise<{ ok: boolean; message?: string }> {
  if (!pushSupported()) return { ok: false, message: 'Este navegador no permite notificaciones.' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, message: 'No diste permiso para notificaciones. Actívalo en los ajustes del sitio en tu navegador.' }
  const { data: key, error: e1 } = await supabase.rpc('push_public_key')
  if (e1 || !key) return { ok: false, message: 'Falta instalar el SQL del aviso diario en Supabase.' }
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(String(key)) })
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return { ok: false, message: 'No se pudo crear la suscripción.' }
    const { error } = await supabase.rpc('push_subscribe', {
      p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_tz: tz(), p_hour: hour, p_ua: navigator.userAgent.slice(0, 200),
    })
    if (error) return { ok: false, message: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
  } catch { /* si falla, no pasa nada */ }
}

export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`
