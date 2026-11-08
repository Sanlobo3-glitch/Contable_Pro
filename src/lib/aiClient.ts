/**
 * Plan 2 · Etapa 2C · Cliente de la IA (Gemini).
 * Habla con la pasarela /api/copilot usando la sesión del usuario. Nunca maneja claves del proveedor.
 */
import { supabase } from './supabase'
import type { AiConfig } from './aiTools'

export interface IaAnswer {
  ok: true
  answer: string
  model: string
  provider: string
  cached: boolean
  tools: string[]
  usage: { in: number; out: number }
  remaining: number
}
export interface IaFail { ok: false; fallback: boolean; code: string; error: string }
export type IaResult = IaAnswer | IaFail

const MODEL_KEY = 'ia_model'

/** Modelos permitidos por el servidor. Vacío si la pasarela aún no está lista. */
export async function getIaModels(): Promise<string[]> {
  try {
    const r = await fetch('/api/copilot', { method: 'GET' })
    if (!r.ok) return []
    const j = await r.json()
    return j?.listo && Array.isArray(j.models) ? (j.models as unknown[]).filter((m): m is string => typeof m === 'string') : []
  } catch {
    return []
  }
}

export function loadModel(models: string[]): string {
  let saved: string | null = null
  try { saved = localStorage.getItem(MODEL_KEY) } catch { /* sin almacenamiento */ }
  return saved && models.includes(saved) ? saved : models[0] ?? ''
}
export function saveModel(model: string): void {
  try { localStorage.setItem(MODEL_KEY, model) } catch { /* sin almacenamiento */ }
}
/** Siguiente modelo de la lista (al tocar el logo). */
export function nextModel(models: string[], current: string): string {
  if (!models.length) return ''
  const i = models.indexOf(current)
  return models[(i + 1) % models.length]
}

/** Pregunta a la IA. Nunca lanza: siempre devuelve un resultado. */
export async function askIa(question: string, model: string): Promise<IaResult> {
  const { data } = await supabase.auth.getSession()
  const token: string | undefined = data?.session?.access_token
  if (!token) return { ok: false, fallback: false, code: 'sesion', error: 'Tu sesión expiró. Vuelve a entrar.' }
  let tz = 'America/Caracas'
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz } catch { /* usa el valor por defecto */ }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 35000)
  try {
    const r = await fetch('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question, model: model || undefined, tz }),
      signal: ctl.signal,
    })
    const j = await r.json().catch(() => null)
    if (j && typeof j === 'object' && 'ok' in j) return j as IaResult
    return { ok: false, fallback: true, code: 'respuesta', error: 'La IA devolvió una respuesta que no entendí.' }
  } catch {
    return { ok: false, fallback: true, code: 'red', error: ctl.signal.aborted ? 'La IA tardó demasiado.' : 'No pude conectar con la IA.' }
  } finally {
    clearTimeout(timer)
  }
}

const clean = (m: string) => m.replace(/^.*?(No tienes permiso|Tu plan|Indica)/, '$1')

/** El dueño acepta el aviso de uso. Devuelve la configuración nueva o un mensaje de error. */
export async function acceptTerms(tier: 'gratuito' | 'pago'): Promise<AiConfig | string> {
  const { data, error } = await supabase.rpc('ai_accept_terms', { p_tier: tier })
  if (error) return clean(error.message || 'No se pudo guardar.')
  return data as AiConfig
}

/** El dueño activa o desactiva la IA de su empresa. */
export async function setAiEnabled(enabled: boolean): Promise<AiConfig | string> {
  const { data, error } = await supabase.rpc('ai_set_enabled', { p_enabled: enabled })
  if (error) return clean(error.message || 'No se pudo cambiar.')
  return data as AiConfig
}
