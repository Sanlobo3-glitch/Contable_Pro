import { supabase } from './supabase'
import { friendlyMessage } from './errors'
import type { Customer } from '../types'

/* Cola de ventas sin conexión.
   Las ventas se guardan en el teléfono y se envían solas cuando vuelve la señal.
   Cada venta lleva un identificador único (client_id): si el envío se repite,
   el servidor reconoce la venta y NO la duplica. */

export interface PendingItem { product_id: string; product_name: string; quantity: number; price: number; subtotal: number }

export interface PendingSale {
  client_id: string
  customer_id: string | null
  customer_name: string | null
  items: PendingItem[]
  payment_method: string
  geo: any | null
  captured_at: string
  total: number
  /** Solo ventas del mostrador: canal, descuento (monto) y efectivo recibido. */
  channel?: 'ruta' | 'mostrador'
  discount?: number
  received?: number | null
  /** Pago en otra moneda: se guarda y se envía igual, también sin señal. */
  fx_currency?: string
  fx_amount?: number
  fx_rate?: number
  /** Pago mixto: parte recibida en la moneda de la empresa junto con la divisa. */
  fx_base?: number
  /** Bodega opcional de despacho (multibodega). */
  warehouse_id?: string | null
  error?: string
}

export interface PendingVisit {
  client_id: string
  customer_id: string
  customer_name: string | null
  geo: any
  captured_at: string
  error?: string
}

export interface PendingCustomer {
  client_id: string
  name: string
  document: string
  email: string
  phone: string
  address: string
  price_type?: 'detal' | 'mayor'
  captured_at: string
  error?: string
}

const EVENT = 'ip-queue-changed'
const SYNCED = 'ip-synced'
const cuKey = (uid: string) => `ip_pending_customers_${uid}`
const vKey = (uid: string) => `ip_pending_visits_${uid}`
const qKey = (uid: string) => `ip_pending_sales_${uid}`
const cKey = (uid: string, name: string) => `ip_cache_${uid}_${name}`

export function newId(): string {
  const c: any = typeof crypto !== 'undefined' ? crypto : null
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/* ------------------------------ Cola en el teléfono ----------------------------- */

export function readQueue(uid: string): PendingSale[] {
  try { return JSON.parse(localStorage.getItem(qKey(uid)) || '[]') as PendingSale[] } catch { return [] }
}
function writeQueue(uid: string, list: PendingSale[]): boolean {
  try {
    localStorage.setItem(qKey(uid), JSON.stringify(list))
    window.dispatchEvent(new Event(EVENT))
    return true
  } catch { return false }
}
/** Devuelve false si el teléfono no pudo guardar la venta (almacenamiento lleno o bloqueado). */
export function enqueueSale(uid: string, sale: PendingSale): boolean {
  const list = readQueue(uid)
  if (list.some(s => s.client_id === sale.client_id)) return true
  return writeQueue(uid, [...list, sale])
}
export function removePending(uid: string, clientId: string) {
  writeQueue(uid, readQueue(uid).filter(s => s.client_id !== clientId))
}
export function clearPendingError(uid: string, clientId: string) {
  writeQueue(uid, readQueue(uid).map(s => (s.client_id === clientId ? { ...s, error: undefined } : s)))
}
export function onQueueChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/* ---------------------------- Visitas sin compra pendientes --------------------- */

export function readVisitQueue(uid: string): PendingVisit[] {
  try { return JSON.parse(localStorage.getItem(vKey(uid)) || '[]') as PendingVisit[] } catch { return [] }
}
function writeVisitQueue(uid: string, list: PendingVisit[]): boolean {
  try {
    localStorage.setItem(vKey(uid), JSON.stringify(list))
    window.dispatchEvent(new Event(EVENT))
    return true
  } catch { return false }
}
export function enqueueVisit(uid: string, v: PendingVisit): boolean {
  const list = readVisitQueue(uid)
  if (list.some(x => x.client_id === v.client_id)) return true
  return writeVisitQueue(uid, [...list, v])
}
export function removePendingVisit(uid: string, clientId: string) {
  writeVisitQueue(uid, readVisitQueue(uid).filter(v => v.client_id !== clientId))
}
export function clearVisitError(uid: string, clientId: string) {
  writeVisitQueue(uid, readVisitQueue(uid).map(v => (v.client_id === clientId ? { ...v, error: undefined } : v)))
}

/* ---------------------------- Clientes nuevos pendientes ------------------------ */

export function readCustomerQueue(uid: string): PendingCustomer[] {
  try { return JSON.parse(localStorage.getItem(cuKey(uid)) || '[]') as PendingCustomer[] } catch { return [] }
}
function writeCustomerQueue(uid: string, list: PendingCustomer[]): boolean {
  try {
    localStorage.setItem(cuKey(uid), JSON.stringify(list))
    window.dispatchEvent(new Event(EVENT))
    return true
  } catch { return false }
}
export function enqueueCustomer(uid: string, c: PendingCustomer): boolean {
  const list = readCustomerQueue(uid)
  if (list.some(x => x.client_id === c.client_id)) return true
  return writeCustomerQueue(uid, [...list, c])
}
export function removePendingCustomer(uid: string, clientId: string) {
  writeCustomerQueue(uid, readCustomerQueue(uid).filter(c => c.client_id !== clientId))
}
export function clearCustomerError(uid: string, clientId: string) {
  writeCustomerQueue(uid, readCustomerQueue(uid).map(c => (c.client_id === clientId ? { ...c, error: undefined } : c)))
}
/** Cliente pendiente con la forma de un cliente normal (para mostrarlo en listas y poder venderle). */
export function pendingToCustomer(p: PendingCustomer): Customer {
  return { id: p.client_id, name: p.name, document: p.document || null, email: p.email || null, phone: p.phone || null, address: p.address || null, price_type: p.price_type ?? 'detal', created_at: p.captured_at }
}
/** Cuántos registros esperan envío (sin contar los rechazados). */
export function pendingCount(uid: string): number {
  return readQueue(uid).filter(x => !x.error).length
    + readVisitQueue(uid).filter(x => !x.error).length
    + readCustomerQueue(uid).filter(x => !x.error).length
}
/** Avisa cuando terminó un envío con resultados (ventas, visitas o clientes). */
export function onSynced(fn: (r: { sent: number; failed: number }) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent).detail)
  window.addEventListener(SYNCED, h)
  return () => window.removeEventListener(SYNCED, h)
}

/* ------------------------- Copia local de productos/clientes -------------------- */

export function cacheSet(uid: string, name: string, data: unknown) {
  try { localStorage.setItem(cKey(uid, name), JSON.stringify(data)) } catch { /* sin espacio: se ignora */ }
}
export function cacheGet<T>(uid: string, name: string): T | null {
  try {
    const raw = localStorage.getItem(cKey(uid, name))
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

/* ------------------------------------ Envío ------------------------------------- */

export function isNetworkError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false
  const code = String(err.code || '')
  return code === '' && /fetch|network|load failed|timeout|aborted|offline/i.test(err.message || '')
}

export type SendResult = { ok: true } | { ok: false; network: true } | { ok: false; network: false; message: string }

export async function sendSale(s: PendingSale): Promise<SendResult> {
  try {
    const args: Record<string, unknown> = {
      p_customer_id: s.customer_id,
      p_items: s.items,
      p_payment_method: s.payment_method,
      p_geo: s.geo,
      p_client_id: s.client_id,
      p_captured_at: s.captured_at,
    }
    // Solo se envían si aplican (las ventas de ruta siguen igual que antes)
    if (s.channel === 'mostrador') args.p_channel = 'mostrador'
    if (s.discount && s.discount > 0) args.p_discount = s.discount
    if (s.received != null) args.p_received = s.received
    if (s.fx_currency && Number(s.fx_amount) > 0 && Number(s.fx_rate) > 0) {
      args.p_fx_currency = s.fx_currency
      args.p_fx_amount = s.fx_amount
      args.p_fx_rate = s.fx_rate
      if (Number(s.fx_base) > 0) args.p_base_amount = s.fx_base
    }
    if (s.warehouse_id) {
      const whRes = await supabase.rpc('registrar_venta_bodega', {
        p_warehouse_id: s.warehouse_id,
        ...args,
      })
      if (!whRes.error) return { ok: true }
      if (String(whRes.error.code) === '23505') return { ok: true }
      // Si el proyecto aún no tiene instalada la función registrar_venta_bodega, usar registrar_venta estándar
      if (!/registrar_venta_bodega|does not exist|schema cache|42883/i.test(whRes.error.message || '')) {
        if (isNetworkError(whRes.error)) return { ok: false, network: true }
        return { ok: false, network: false, message: friendlyMessage(whRes.error.message) }
      }
    }
    const { error } = await supabase.rpc('registrar_venta', args)
    if (!error) return { ok: true }
    // 23505 = esa venta ya estaba registrada (reintento): se considera enviada
    if (String(error.code) === '23505') return { ok: true }
    if (isNetworkError(error)) return { ok: false, network: true }
    return { ok: false, network: false, message: friendlyMessage(error.message) }
  } catch {
    return { ok: false, network: true }
  }
}

export async function sendCustomer(c: PendingCustomer): Promise<SendResult> {
  try {
    const row: Record<string, unknown> = {
      id: c.client_id, name: c.name, document: c.document, email: c.email, phone: c.phone, address: c.address,
    }
    if (c.price_type === 'mayor') row.price_type = 'mayor'
    const { error } = await supabase.from('customers').insert(row)
    if (!error) return { ok: true }
    // Mismo identificador = ese cliente ya se había creado (reintento). Otro duplicado (ej. documento) sí es error.
    if (String(error.code) === '23505' && /pkey/i.test(`${error.message} ${(error as any).details ?? ''}`)) return { ok: true }
    if (isNetworkError(error)) return { ok: false, network: true }
    return { ok: false, network: false, message: friendlyMessage(error.message) }
  } catch {
    return { ok: false, network: true }
  }
}

export async function sendVisit(v: PendingVisit): Promise<SendResult> {
  try {
    const { error } = await supabase.rpc('registrar_visita', {
      p_customer_id: v.customer_id,
      p_geo: v.geo,
      p_client_id: v.client_id,
      p_captured_at: v.captured_at,
    })
    if (!error) return { ok: true }
    if (String(error.code) === '23505') return { ok: true }
    if (isNetworkError(error)) return { ok: false, network: true }
    return { ok: false, network: false, message: friendlyMessage(error.message) }
  } catch {
    return { ok: false, network: true }
  }
}

let syncing = false

/** Envía lo pendiente en orden: primero clientes nuevos, luego ventas y visitas. */
export async function syncQueue(uid: string): Promise<{ sent: number; failed: number; pending: number }> {
  if (syncing) return { sent: 0, failed: 0, pending: pendingCount(uid) }
  syncing = true
  let sent = 0, failed = 0, stop = false
  try {
    for (const c of readCustomerQueue(uid)) {
      if (c.error) continue
      const r = await sendCustomer(c)
      if (r.ok) { removePendingCustomer(uid, c.client_id); sent++ }
      else if (r.network) { stop = true; break }
      else {
        failed++
        writeCustomerQueue(uid, readCustomerQueue(uid).map(x => (x.client_id === c.client_id ? { ...x, error: r.message } : x)))
      }
    }
    if (!stop) for (const s of readQueue(uid)) {
      if (s.error) continue
      const r = await sendSale(s)
      if (r.ok) { removePending(uid, s.client_id); sent++ }
      else if (r.network) { stop = true; break }
      else {
        failed++
        writeQueue(uid, readQueue(uid).map(x => (x.client_id === s.client_id ? { ...x, error: r.message } : x)))
      }
    }
    if (!stop) for (const v of readVisitQueue(uid)) {
      if (v.error) continue
      const r = await sendVisit(v)
      if (r.ok) { removePendingVisit(uid, v.client_id); sent++ }
      else if (r.network) { stop = true; break }
      else {
        failed++
        writeVisitQueue(uid, readVisitQueue(uid).map(x => (x.client_id === v.client_id ? { ...x, error: r.message } : x)))
      }
    }
  } finally { syncing = false }
  if (sent > 0 || failed > 0) window.dispatchEvent(new CustomEvent(SYNCED, { detail: { sent, failed } }))
  return { sent, failed, pending: pendingCount(uid) }
}
