import { isDemoMode, supabase } from './supabase'

export type ImageFramingMode = 'contain' | 'cover'
export type ProductImageSchemaStatus = 'ready' | 'missing_sql' | 'unknown'
export type ProductImageErrorCode = 'MISSING_SQL_SCHEMA' | 'RLS_BLOCKED' | 'DB_ERROR'

export class ProductImagePersistenceError extends Error {
  code: ProductImageErrorCode
  needsSqlActivation: boolean

  constructor(code: ProductImageErrorCode, message: string) {
    super(message)
    this.name = 'ProductImagePersistenceError'
    this.code = code
    this.needsSqlActivation = code === 'MISSING_SQL_SCHEMA' || code === 'RLS_BLOCKED'
  }
}

export interface CatalogPosHandoff {
  customerId?: string | null
  items: { product_id: string; quantity: number }[]
  ts: number
}

const CATALOG_POS_HANDOFF_KEY = 'ip_catalog_pos_handoff_v1'

export function setCatalogPosHandoff(payload: Omit<CatalogPosHandoff, 'ts'>): void {
  try {
    sessionStorage.setItem(
      CATALOG_POS_HANDOFF_KEY,
      JSON.stringify({ ...payload, ts: Date.now() })
    )
  } catch {
    // Ignorar si sessionStorage está restringido
  }
}

export function consumeCatalogPosHandoff(): CatalogPosHandoff | null {
  try {
    const raw = sessionStorage.getItem(CATALOG_POS_HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(CATALOG_POS_HANDOFF_KEY)
    const parsed = JSON.parse(raw) as CatalogPosHandoff
    if (!Array.isArray(parsed?.items) || parsed.items.length === 0) return null
    if (Date.now() - (parsed.ts || 0) > 10 * 60 * 1000) return null
    return parsed
  } catch {
    return null
  }
}

export function getProductMonogram(name?: string | null): string {
  const clean = (name || 'PR').trim()
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase()
}

export function resolvePrintImageUrl(src?: string | null): string | null {
  const trimmed = (src || '').trim()
  if (!trimmed) return null
  if (/^(data:|blob:|https?:\/\/)/i.test(trimmed)) return trimmed
  try {
    return new URL(trimmed, window.location.origin).href
  } catch {
    return trimmed
  }
}

export async function processProductImageSource(
  source: HTMLImageElement | HTMLVideoElement,
  framing: ImageFramingMode = 'contain',
  maxWidth = 680
): Promise<string> {
  const rawW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source.naturalWidth || source.width
  const rawH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source.naturalHeight || source.height

  if (!rawW || !rawH) {
    throw new Error('No se pudo procesar la fotografía del producto.')
  }

  const targetRatio = 4 / 3
  const outW = maxWidth
  const outH = Math.round(maxWidth / targetRatio)

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('No fue posible comprimir la imagen.')
  }

  // Fondo limpio tipo estudio comercial
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)

  if (framing === 'cover') {
    const currentRatio = rawW / rawH
    let sx = 0
    let sy = 0
    let sw = rawW
    let sh = rawH

    if (currentRatio > targetRatio) {
      sw = Math.round(rawH * targetRatio)
      sx = Math.floor((rawW - sw) / 2)
    } else if (currentRatio < targetRatio) {
      sh = Math.round(rawW / targetRatio)
      sy = Math.floor((rawH - sh) / 2)
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH)
  } else {
    // Encuadre completo ("contain"): conserva botellas, cajas o empaques altos sin recortarlos
    const pad = 16
    const availW = outW - pad * 2
    const availH = outH - pad * 2
    const scale = Math.min(availW / rawW, availH / rawH)
    const dw = Math.round(rawW * scale)
    const dh = Math.round(rawH * scale)
    const dx = Math.floor((outW - dw) / 2)
    const dy = Math.floor((outH - dh) / 2)
    ctx.drawImage(source, 0, 0, rawW, rawH, dx, dy, dw, dh)
  }

  return canvas.toDataURL('image/jpeg', 0.84)
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mimeMatch = parts[0]?.match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const bin = atob(parts[1] || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function verifyPublicImageUrlReachable(url: string, timeoutMs = 2600): Promise<boolean> {
  if (!url || typeof window === 'undefined') return false
  if (url.startsWith('data:image/')) return true

  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    window.clearTimeout(timer)
    if (res.ok) return true
  } catch {
    // Fallback con elemento Image si HEAD no está habilitado por CORS
  }

  return new Promise(resolve => {
    const img = new Image()
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    const timer = window.setTimeout(() => done(false), timeoutMs)
    img.onload = () => {
      window.clearTimeout(timer)
      done(img.naturalWidth > 0)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      done(false)
    }
    img.referrerPolicy = 'no-referrer'
    img.src = url
  })
}

/**
 * Sube la fotografía comprimida al bucket público `product-images` de Supabase Storage
 * Y verifica que la URL pública responda HTTP 200 (por si el bucket es privado o carece de política SELECT).
 * Si el bucket no existe, no es público, no hay señal o es Modo Demo, devuelve el DataURL JPEG optimizado
 * para guardarlo de forma confiable en `public.product_images` y `public.products.image_url`.
 */
export async function uploadOrInlineProductImage(
  compressedDataUrl: string,
  opts?: { companyId?: string | null; skuOrName?: string | null }
): Promise<string> {
  if (!compressedDataUrl.startsWith('data:image/')) {
    return compressedDataUrl
  }
  if (isDemoMode() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return compressedDataUrl
  }
  const companyFolder = (opts?.companyId || '').trim()
  if (!companyFolder) {
    return compressedDataUrl
  }

  try {
    const slug =
      (opts?.skuOrName || 'producto')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 36) || 'producto'
    const path = `${companyFolder}/${slug}-${Date.now()}.jpg`
    const blob = dataUrlToBlob(compressedDataUrl)

    const { error } = await supabase.storage
      .from('product-images')
      .upload(path, blob, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      })

    if (error) {
      return compressedDataUrl
    }

    const { data } = supabase.storage.from('product-images').getPublicUrl(path)
    if (data?.publicUrl) {
      const reachable = await verifyPublicImageUrlReachable(data.publicUrl)
      if (reachable) {
        return data.publicUrl
      }
    }
    return compressedDataUrl
  } catch {
    return compressedDataUrl
  }
}

function isMissingSchemaError(msg: string, code?: string): boolean {
  if (code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205') {
    return true
  }
  return /product_images|image_url|does not exist|schema cache|could not find the/i.test(msg)
}

function isPermissionOrRlsError(msg: string, code?: string): boolean {
  if (code === '42501') return true
  return /permission denied|row-level security|no tienes permisos|insufficient_privilege/i.test(msg)
}

/**
 * Conecta la carga de productos con la tabla `public.product_images` en Supabase
 * y detecta si el esquema SQL de imágenes ya está activo en la base de datos real.
 */
export async function hydrateProductsWithImages<
  T extends { id: string; image_url?: string | null }
>(products: T[]): Promise<{ products: T[]; schemaStatus: ProductImageSchemaStatus }> {
  if (isDemoMode()) {
    const { data: piRows } = await supabase
      .from('product_images')
      .select('product_id, image_url')
    const byProd = new Map<string, string>()
    for (const r of (piRows || []) as { product_id?: string; image_url?: string | null }[]) {
      if (r.product_id && r.image_url?.trim()) {
        byProd.set(r.product_id, r.image_url.trim())
      }
    }
    const merged = products.map(p => ({
      ...p,
      image_url: (p.image_url && p.image_url.trim()) || byProd.get(p.id) || null,
    }))
    return { products: merged, schemaStatus: 'ready' }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { products, schemaStatus: 'unknown' }
  }

  const piRes = await supabase
    .from('product_images')
    .select('product_id, image_url')
    .limit(5000)

  if (!piRes.error) {
    const byProd = new Map<string, string>()
    for (const r of (piRes.data || []) as { product_id?: string; image_url?: string | null }[]) {
      if (r.product_id && r.image_url?.trim()) {
        byProd.set(r.product_id, r.image_url.trim())
      }
    }
    const merged = products.map(p => ({
      ...p,
      image_url: byProd.get(p.id) || (p.image_url && p.image_url.trim()) || null,
    }))
    return { products: merged, schemaStatus: 'ready' }
  }

  // Si la tabla `product_images` aún no se ha creado, verificamos si existe `products.image_url`
  if (products.length > 0) {
    const hasImageCol = Object.prototype.hasOwnProperty.call(products[0], 'image_url')
    return {
      products,
      schemaStatus: hasImageCol ? 'ready' : 'missing_sql',
    }
  }

  const colProbe = await supabase.from('products').select('id, image_url').limit(1)
  if (colProbe.error && isMissingSchemaError(colProbe.error.message || '', colProbe.error.code)) {
    return { products, schemaStatus: 'missing_sql' }
  }

  return { products, schemaStatus: colProbe.error ? 'unknown' : 'ready' }
}

/**
 * Guarda de forma verificada la fotografía del producto en Supabase:
 * 1) Sube a Storage `product-images` (verificando acceso HTTP público) o usa DataURL optimizado.
 * 2) Ejecuta `actualizar_imagen_producto` RPC + sincroniza `public.product_images` y `public.products.image_url`.
 * 3) Comprueba con lectura real que el cambio quedó persistido en Supabase; si falta el SQL o RLS bloquea,
 *    lanza `ProductImagePersistenceError` para no simular un guardado falso que se borre al refrescar.
 */
export async function saveProductImageInSupabase(params: {
  productId: string
  companyId?: string | null
  skuOrName?: string | null
  imageUrl: string | null
}): Promise<{ savedUrl: string | null }> {
  const { productId, companyId, skuOrName, imageUrl } = params
  const trimmedInput = (imageUrl || '').trim()

  const finalUrl = trimmedInput
    ? await uploadOrInlineProductImage(trimmedInput, { companyId, skuOrName })
    : null

  let rpcVerified = false
  let tableVerified = false
  let columnVerified = false
  const collectedErrors: { msg: string; code?: string }[] = []

  // 1. Intentar RPC `actualizar_imagen_producto` (SECURITY DEFINER)
  const rpcRes = await supabase.rpc('actualizar_imagen_producto', {
    p_product_id: productId,
    p_image_url: finalUrl,
  })

  if (!rpcRes.error) {
    const rpcPayload = rpcRes.data as { ok?: boolean } | null
    if (rpcPayload && rpcPayload.ok === true) {
      rpcVerified = true
    } else {
      // Si es la versión previa que devolvía void, comprobamos lectura real en `products`
      const checkProd = await supabase
        .from('products')
        .select('id, image_url')
        .eq('id', productId)
        .maybeSingle()
      if (!checkProd.error && checkProd.data) {
        const stored = ((checkProd.data as { image_url?: string | null }).image_url || '').trim() || null
        if (stored === finalUrl) {
          rpcVerified = true
        }
      }
    }
  } else {
    collectedErrors.push({ msg: rpcRes.error.message || '', code: rpcRes.error.code })
  }

  // 2. Sincronizar también en la tabla dedicada `public.product_images`
  if (finalUrl === null) {
    const delRes = await supabase
      .from('product_images')
      .delete()
      .eq('product_id', productId)
      .select('product_id')
    if (!delRes.error) {
      tableVerified = true
    } else {
      collectedErrors.push({ msg: delRes.error.message || '', code: delRes.error.code })
    }
  } else {
    const upsertPayload: Record<string, unknown> = {
      product_id: productId,
      image_url: finalUrl,
      mime_type: finalUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
      updated_at: new Date().toISOString(),
    }
    if (companyId && companyId.trim()) {
      upsertPayload.company_id = companyId.trim()
    }
    const piUpsert = await supabase
      .from('product_images')
      .upsert(upsertPayload, { onConflict: 'product_id' })
      .select('product_id, image_url')
    if (!piUpsert.error && Array.isArray(piUpsert.data) && piUpsert.data.length > 0) {
      tableVerified = true
    } else if (piUpsert.error) {
      collectedErrors.push({ msg: piUpsert.error.message || '', code: piUpsert.error.code })
    }
  }

  // 3. Respaldo directo en `public.products.image_url` con verificación `.select()`
  if (!rpcVerified) {
    const prodUpd = await supabase
      .from('products')
      .update({ image_url: finalUrl })
      .eq('id', productId)
      .select('id, image_url')

    if (!prodUpd.error && Array.isArray(prodUpd.data) && prodUpd.data.length > 0) {
      const savedRow = prodUpd.data[0] as { image_url?: string | null }
      const stored = (savedRow.image_url || '').trim() || null
      if (stored === finalUrl) {
        columnVerified = true
      }
    } else if (prodUpd.error) {
      collectedErrors.push({ msg: prodUpd.error.message || '', code: prodUpd.error.code })
    }
  }

  if (rpcVerified || tableVerified || columnVerified) {
    return { savedUrl: finalUrl }
  }

  // Ningún mecanismo logró persistir en Supabase: diagnosticar causa exacta
  const hasMissingSchema = collectedErrors.some(e => isMissingSchemaError(e.msg, e.code))
  if (hasMissingSchema) {
    throw new ProductImagePersistenceError(
      'MISSING_SQL_SCHEMA',
      'En tu base de datos Supabase aún falta activar la tabla de imágenes de productos (product_images / products.image_url). Pulsa «Activar SQL de Imágenes» y ejecútalo en Supabase → SQL Editor.'
    )
  }

  const hasRlsBlock =
    collectedErrors.some(e => isPermissionOrRlsError(e.msg, e.code)) ||
    collectedErrors.length === 0

  if (hasRlsBlock) {
    throw new ProductImagePersistenceError(
      'RLS_BLOCKED',
      'Supabase rechazó guardar la fotografía por permisos RLS o porque falta la función actualizar_imagen_producto. Pulsa «Activar SQL de Imágenes» y ejecútalo en Supabase → SQL Editor.'
    )
  }

  const detail = collectedErrors.map(e => e.msg).filter(Boolean)[0] || 'Error desconocido al escribir en Supabase.'
  throw new ProductImagePersistenceError(
    'DB_ERROR',
    `No se pudo guardar la imagen en Supabase: ${detail}`
  )
}
