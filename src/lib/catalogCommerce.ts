import { isDemoMode, supabase } from './supabase'
import type {
  BrandThemeId,
  CatalogDeliveryMode,
  CatalogOrder,
  CatalogPaymentMethodConfig,
  CatalogPaymentMethodKey,
  ProductVariant,
} from '../types'

export interface BrandThemeSpec {
  id: BrandThemeId
  label: string
  hex: string
  hexDark: string
  swatchBg: string
  primaryBtn: string
  secondaryBtn: string
  accentText: string
  softSurface: string
  activeSegment: string
  heroBanner: string
  focusBorder: string
}

export const BRAND_THEMES: Record<BrandThemeId, BrandThemeSpec> = {
  emerald: {
    id: 'emerald',
    label: 'Esmeralda Corporativo',
    hex: '#047857',
    hexDark: '#064e3b',
    swatchBg: 'bg-emerald-700',
    primaryBtn: 'bg-emerald-700 hover:bg-emerald-800 text-white',
    secondaryBtn: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
    accentText: 'text-emerald-700',
    softSurface: 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
    activeSegment: 'bg-emerald-700 text-white shadow-sm',
    heroBanner: 'bg-emerald-950 text-white',
    focusBorder: 'focus:border-emerald-600',
  },
  slate: {
    id: 'slate',
    label: 'Carbón Ejecutivo',
    hex: '#0f172a',
    hexDark: '#020617',
    swatchBg: 'bg-slate-900',
    primaryBtn: 'bg-slate-900 hover:bg-slate-800 text-white',
    secondaryBtn: 'border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200',
    accentText: 'text-slate-900',
    softSurface: 'bg-slate-100/80 border-slate-300 text-slate-900',
    activeSegment: 'bg-slate-900 text-white shadow-sm',
    heroBanner: 'bg-slate-950 text-white',
    focusBorder: 'focus:border-slate-700',
  },
  blue: {
    id: 'blue',
    label: 'Azul Institucional',
    hex: '#1d4ed8',
    hexDark: '#1e3a8a',
    swatchBg: 'bg-blue-700',
    primaryBtn: 'bg-blue-700 hover:bg-blue-800 text-white',
    secondaryBtn: 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100',
    accentText: 'text-blue-700',
    softSurface: 'bg-blue-50/70 border-blue-200 text-blue-900',
    activeSegment: 'bg-blue-700 text-white shadow-sm',
    heroBanner: 'bg-blue-950 text-white',
    focusBorder: 'focus:border-blue-600',
  },
  indigo: {
    id: 'indigo',
    label: 'Índigo Real',
    hex: '#4338ca',
    hexDark: '#312e81',
    swatchBg: 'bg-indigo-700',
    primaryBtn: 'bg-indigo-700 hover:bg-indigo-800 text-white',
    secondaryBtn: 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100',
    accentText: 'text-indigo-700',
    softSurface: 'bg-indigo-50/70 border-indigo-200 text-indigo-900',
    activeSegment: 'bg-indigo-700 text-white shadow-sm',
    heroBanner: 'bg-indigo-950 text-white',
    focusBorder: 'focus:border-indigo-600',
  },
  rose: {
    id: 'rose',
    label: 'Borgoña Comercial',
    hex: '#be123c',
    hexDark: '#881337',
    swatchBg: 'bg-rose-700',
    primaryBtn: 'bg-rose-700 hover:bg-rose-800 text-white',
    secondaryBtn: 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100',
    accentText: 'text-rose-700',
    softSurface: 'bg-rose-50/70 border-rose-200 text-rose-900',
    activeSegment: 'bg-rose-700 text-white shadow-sm',
    heroBanner: 'bg-rose-950 text-white',
    focusBorder: 'focus:border-rose-600',
  },
  amber: {
    id: 'amber',
    label: 'Ámbar Dorado',
    hex: '#b45309',
    hexDark: '#78350f',
    swatchBg: 'bg-amber-700',
    primaryBtn: 'bg-amber-700 hover:bg-amber-800 text-white',
    secondaryBtn: 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100',
    accentText: 'text-amber-700',
    softSurface: 'bg-amber-50/80 border-amber-200 text-amber-950',
    activeSegment: 'bg-amber-700 text-white shadow-sm',
    heroBanner: 'bg-amber-950 text-white',
    focusBorder: 'focus:border-amber-600',
  },
  teal: {
    id: 'teal',
    label: 'Turquesa Industrial',
    hex: '#0f766e',
    hexDark: '#134e4a',
    swatchBg: 'bg-teal-700',
    primaryBtn: 'bg-teal-700 hover:bg-teal-800 text-white',
    secondaryBtn: 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100',
    accentText: 'text-teal-700',
    softSurface: 'bg-teal-50/70 border-teal-200 text-teal-900',
    activeSegment: 'bg-teal-700 text-white shadow-sm',
    heroBanner: 'bg-teal-950 text-white',
    focusBorder: 'focus:border-teal-600',
  },
  violet: {
    id: 'violet',
    label: 'Violeta Boutique',
    hex: '#6d28d9',
    hexDark: '#4c1d95',
    swatchBg: 'bg-violet-700',
    primaryBtn: 'bg-violet-700 hover:bg-violet-800 text-white',
    secondaryBtn: 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100',
    accentText: 'text-violet-700',
    softSurface: 'bg-violet-50/70 border-violet-200 text-violet-900',
    activeSegment: 'bg-violet-700 text-white shadow-sm',
    heroBanner: 'bg-violet-950 text-white',
    focusBorder: 'focus:border-violet-600',
  },
}

export const BRAND_THEME_LIST: BrandThemeSpec[] = Object.values(BRAND_THEMES)

export function resolveBrandTheme(raw?: string | null): BrandThemeSpec {
  const key = (raw || 'emerald').trim().toLowerCase() as BrandThemeId
  return BRAND_THEMES[key] || BRAND_THEMES.emerald
}

export const DELIVERY_MODE_LABELS: Record<CatalogDeliveryMode, string> = {
  pickup: 'Retiro en tienda o sede',
  delivery: 'Despacho a domicilio / ruta',
  shipping: 'Envío nacional por encomienda',
}

export function buildDefaultCatalogPaymentMethods(opts?: {
  companyName?: string
  rif?: string
  phone?: string
  email?: string
}): CatalogPaymentMethodConfig[] {
  const holder = opts?.companyName || 'Mi Empresa'
  const doc = opts?.rif || ''
  const phone = opts?.phone || ''
  const email = opts?.email || ''
  return [
    {
      id: 'pago_movil',
      enabled: true,
      label: 'Pago Móvil Interbancario',
      requires_proof: true,
      bank_or_platform: 'Banesco (0134)',
      account_or_phone: phone || '0412-0000000',
      holder_name: holder,
      holder_document: doc || 'J-00000000-0',
      instructions: 'Adjunta el capture con el número de referencia visible.',
    },
    {
      id: 'nequi',
      enabled: true,
      label: 'Nequi / Billetera Móvil',
      requires_proof: true,
      bank_or_platform: 'Nequi',
      account_or_phone: phone || '300 000 0000',
      holder_name: holder,
      holder_document: doc,
      instructions: 'Toma pantallazo del comprobante exitoso en Nequi.',
    },
    {
      id: 'zelle',
      enabled: true,
      label: 'Zelle / Divisas Digitales',
      requires_proof: true,
      bank_or_platform: 'Zelle',
      account_or_phone: email || 'pagos@empresa.com',
      holder_name: holder,
      holder_document: doc,
      instructions: 'Indica en notas el nombre del titular de la cuenta emisora.',
    },
    {
      id: 'transferencia',
      enabled: true,
      label: 'Transferencia Bancaria',
      requires_proof: true,
      bank_or_platform: 'Cuenta Corriente Corporativa',
      account_or_phone: '0134-0000-00-0000000000',
      holder_name: holder,
      holder_document: doc || 'J-00000000-0',
      instructions: 'Adjunta el comprobante bancario de transferencia.',
    },
    {
      id: 'efectivo_entrega',
      enabled: true,
      label: 'Pago al recibir / Punto en sede',
      requires_proof: false,
      bank_or_platform: 'Efectivo o Punto de Venta',
      account_or_phone: '',
      holder_name: holder,
      holder_document: doc,
      instructions: 'Cancela al retirar en mostrador o al recibir nuestro despacho.',
    },
  ]
}

export function normalizeCatalogPaymentMethods(
  raw: unknown,
  fallbackInfo?: { companyName?: string; rif?: string; phone?: string; email?: string }
): CatalogPaymentMethodConfig[] {
  const defaults = buildDefaultCatalogPaymentMethods(fallbackInfo)
  if (!Array.isArray(raw) || raw.length === 0) return defaults
  const byId = new Map<string, Partial<CatalogPaymentMethodConfig>>()
  for (const item of raw) {
    if (item && typeof item === 'object' && 'id' in item) {
      byId.set(String((item as { id: unknown }).id), item as Partial<CatalogPaymentMethodConfig>)
    }
  }
  return defaults.map(def => {
    const saved = byId.get(def.id)
    if (!saved) return def
    return {
      id: def.id as CatalogPaymentMethodKey,
      enabled: saved.enabled !== false,
      label: String(saved.label || def.label),
      requires_proof: saved.requires_proof ?? def.requires_proof,
      bank_or_platform: String(saved.bank_or_platform ?? def.bank_or_platform),
      account_or_phone: String(saved.account_or_phone ?? def.account_or_phone),
      holder_name: String(saved.holder_name ?? def.holder_name),
      holder_document: String(saved.holder_document ?? def.holder_document),
      instructions: String(saved.instructions ?? def.instructions ?? ''),
    }
  })
}

export function normalizeDeliveryModes(raw: unknown): CatalogDeliveryMode[] {
  if (!Array.isArray(raw) || raw.length === 0) return ['pickup', 'delivery']
  const valid = raw.filter(
    (x): x is CatalogDeliveryMode => x === 'pickup' || x === 'delivery' || x === 'shipping'
  )
  return valid.length > 0 ? valid : ['pickup', 'delivery']
}

export function normalizeProductVariants(raw: unknown): ProductVariant[] {
  if (!Array.isArray(raw)) return []
  const out: ProductVariant[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const label = String(rec.label || '').trim()
    const price = Number(rec.price)
    if (!label || !Number.isFinite(price) || price < 0) continue
    const wh = Number(rec.price_wholesale)
    const mult = Number(rec.stock_multiplier)
    out.push({
      id: String(rec.id || `var-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
      label,
      price: Math.round(price * 100) / 100,
      price_wholesale: Number.isFinite(wh) && wh > 0 ? Math.round(wh * 100) / 100 : null,
      stock_multiplier: Number.isFinite(mult) && mult > 0 ? Math.round(mult * 1000) / 1000 : 1,
      sku_suffix: rec.sku_suffix ? String(rec.sku_suffix).trim() : null,
      available: rec.available !== false,
    })
  }
  return out
}

export interface VariantPresetTemplate {
  id: string
  title: string
  groupLabel: string
  build: (basePrice: number, baseWholesale?: number | null) => ProductVariant[]
}

export const VARIANT_PRESET_TEMPLATES: VariantPresetTemplate[] = [
  {
    id: 'peso',
    title: 'Peso (g / kg)',
    groupLabel: 'Presentación por peso',
    build: (base, wh) => {
      const p = base > 0 ? base : 5
      const w = wh && wh > 0 ? wh : null
      return [
        {
          id: `v-250g-${Date.now()}`,
          label: '250 g',
          price: Math.round(p * 0.3 * 100) / 100,
          price_wholesale: w ? Math.round(w * 0.3 * 100) / 100 : null,
          stock_multiplier: 0.25,
          available: true,
        },
        {
          id: `v-500g-${Date.now() + 1}`,
          label: '500 g',
          price: Math.round(p * 0.55 * 100) / 100,
          price_wholesale: w ? Math.round(w * 0.55 * 100) / 100 : null,
          stock_multiplier: 0.5,
          available: true,
        },
        {
          id: `v-1kg-${Date.now() + 2}`,
          label: '1 kg',
          price: Math.round(p * 100) / 100,
          price_wholesale: w ? Math.round(w * 100) / 100 : null,
          stock_multiplier: 1,
          available: true,
        },
        {
          id: `v-5kg-${Date.now() + 3}`,
          label: 'Saco / Formato 5 kg',
          price: Math.round(p * 4.7 * 100) / 100,
          price_wholesale: w ? Math.round(w * 4.6 * 100) / 100 : null,
          stock_multiplier: 5,
          available: true,
        },
      ]
    },
  },
  {
    id: 'volumen',
    title: 'Volumen (ml / L)',
    groupLabel: 'Contenido neto',
    build: (base, wh) => {
      const p = base > 0 ? base : 4
      const w = wh && wh > 0 ? wh : null
      return [
        {
          id: `v-250ml-${Date.now()}`,
          label: '250 ml',
          price: Math.round(p * 0.32 * 100) / 100,
          price_wholesale: w ? Math.round(w * 0.32 * 100) / 100 : null,
          stock_multiplier: 0.25,
          available: true,
        },
        {
          id: `v-500ml-${Date.now() + 1}`,
          label: '500 ml',
          price: Math.round(p * 0.58 * 100) / 100,
          price_wholesale: w ? Math.round(w * 0.58 * 100) / 100 : null,
          stock_multiplier: 0.5,
          available: true,
        },
        {
          id: `v-1l-${Date.now() + 2}`,
          label: '1 Litro',
          price: Math.round(p * 100) / 100,
          price_wholesale: w ? Math.round(w * 100) / 100 : null,
          stock_multiplier: 1,
          available: true,
        },
        {
          id: `v-galon-${Date.now() + 3}`,
          label: 'Galón (3.78 L)',
          price: Math.round(p * 3.55 * 100) / 100,
          price_wholesale: w ? Math.round(w * 3.45 * 100) / 100 : null,
          stock_multiplier: 3.78,
          available: true,
        },
      ]
    },
  },
  {
    id: 'tallas',
    title: 'Tallas (S · M · L · XL)',
    groupLabel: 'Talla',
    build: (base, wh) => {
      const p = base > 0 ? base : 12
      const w = wh && wh > 0 ? wh : null
      return ['Talla S', 'Talla M', 'Talla L', 'Talla XL'].map((lbl, idx) => ({
        id: `v-size-${idx}-${Date.now()}`,
        label: lbl,
        price: Math.round(p * 100) / 100,
        price_wholesale: w ? Math.round(w * 100) / 100 : null,
        stock_multiplier: 1,
        available: true,
      }))
    },
  },
  {
    id: 'empaque',
    title: 'Empaque (Und / Pack / Bulto)',
    groupLabel: 'Formato comercial',
    build: (base, wh) => {
      const p = base > 0 ? base : 2
      const w = wh && wh > 0 ? wh : Math.round(p * 0.9 * 100) / 100
      return [
        {
          id: `v-und-${Date.now()}`,
          label: 'Unidad detal',
          price: Math.round(p * 100) / 100,
          price_wholesale: w,
          stock_multiplier: 1,
          available: true,
        },
        {
          id: `v-pack6-${Date.now() + 1}`,
          label: 'Media docena (×6)',
          price: Math.round(w * 6 * 100) / 100,
          price_wholesale: null,
          stock_multiplier: 6,
          available: true,
        },
        {
          id: `v-bulto12-${Date.now() + 2}`,
          label: 'Caja / Bulto (×12)',
          price: Math.round(w * 12 * 0.96 * 100) / 100,
          price_wholesale: null,
          stock_multiplier: 12,
          available: true,
        },
      ]
    },
  },
]

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mimeMatch = parts[0]?.match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const bin = atob(parts[1] || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
export async function compressImageFileToDataUrl(
  file: File,
  opts?: { maxDimension?: number; keepTransparency?: boolean; quality?: number }
): Promise<string> {
  const maxDim = opts?.maxDimension ?? 920
  const keepAlpha = opts?.keepTransparency ?? false
  const quality = opts?.quality ?? 0.84

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Formato de imagen no compatible.'))
    el.src = rawDataUrl
  })

  const rawW = img.naturalWidth || img.width
  const rawH = img.naturalHeight || img.height
  if (!rawW || !rawH) throw new Error('Dimensiones de imagen inválidas.')

  const scale = Math.min(1, maxDim / Math.max(rawW, rawH))
  const outW = Math.max(1, Math.round(rawW * scale))
  const outH = Math.max(1, Math.round(rawH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return rawDataUrl

  if (!keepAlpha) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
  } else {
    ctx.clearRect(0, 0, outW, outH)
  }

  ctx.drawImage(img, 0, 0, outW, outH)

  if (keepAlpha && /image\/(png|webp|svg)/i.test(file.type)) {
    const pngUrl = canvas.toDataURL('image/png')
    if (pngUrl.length < 360_000) return pngUrl
  }

  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * Sube logos al bucket público product-images.
 * Sube comprobantes bancarios al bucket privado payment-proofs.
 *
 * Para comprobantes devuelve la ruta interna del objeto, nunca una URL pública.
 */
export async function uploadCatalogAssetOrInline(
  file: File,
  kind: 'logo' | 'receipt',
  companyId: string
): Promise<string> {
  const compressed = await compressImageFileToDataUrl(file, {
    maxDimension: kind === 'logo' ? 420 : 980,
    keepTransparency: kind === 'logo',
    quality: kind === 'logo' ? 0.9 : 0.82,
  })

  if (isDemoMode() || (typeof navigator !== 'undefined' && !navigator.onLine) || !companyId) {
    return compressed
  }

  try {
    const isPng = compressed.startsWith('data:image/png')
    const ext = isPng ? 'png' : 'jpg'
    const folder = kind === 'logo'
      ? `logos/${companyId}`
      : `receipts/${companyId}`

    const path = `${folder}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const blob = dataUrlToBlob(compressed)

    if (kind === 'receipt') {
      const { error } = await supabase.storage
        .from('payment-proofs')
        .upload(path, blob, {
          contentType: isPng ? 'image/png' : 'image/jpeg',
          cacheControl: '0',
          upsert: false,
        })

      if (!error) return path

      console.error('No se pudo guardar el comprobante en el bucket privado:', error)
      return compressed
    }

    const { error } = await supabase.storage
      .from('product-images')
      .upload(path, blob, {
        contentType: isPng ? 'image/png' : 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      })

    if (!error) {
      const { data } = supabase.storage.from('product-images').getPublicUrl(path)
      if (data?.publicUrl) return data.publicUrl
    }
  } catch (error) {
    console.error('Error al subir imagen del catálogo:', error)
  }

  return compressed
}

/**
 * Convierte una URL pública antigua de product-images en su ruta interna.
 * Solo acepta comprobantes ubicados en receipts/<companyId>/.
 */
export function getLegacyReceiptStoragePath(
  raw: string | null | undefined,
  companyId: string
): string | null {
  if (!raw || !companyId) return null

  const value = raw.trim()
  if (!value || value.startsWith('data:')) return null

  const marker = '/storage/v1/object/public/product-images/'

  try {
    const parsed = new URL(value)
    const markerIndex = parsed.pathname.indexOf(marker)

    if (markerIndex >= 0) {
      const encodedPath = parsed.pathname.slice(markerIndex + marker.length)
      const path = decodeURIComponent(encodedPath)
      return path.startsWith(`receipts/${companyId}/`) ? path : null
    }
  } catch {
    // Puede tratarse de una ruta interna y no de una URL.
  }

  const normalized = value.replace(/^\/+/, '')
  if (normalized.startsWith(`receipts/${companyId}/`)) return normalized

  return null
}

/**
 * Migra un comprobante antiguo desde el bucket público al privado.
 *
 * Primero copia el archivo, después actualiza la orden y solo entonces
 * elimina el objeto público anterior.
 */
export async function migrateLegacyPaymentProof(
  raw: string | null | undefined,
  orderId: string,
  companyId: string
): Promise<string | null> {
  if (!raw || !orderId || !companyId) return raw || null

  const value = raw.trim()
  if (!value || value.startsWith('data:')) return value || null

  // Ya está almacenado como ruta privada.
  if (value.startsWith(`receipts/${companyId}/`)) return value

  const legacyPath = getLegacyReceiptStoragePath(value, companyId)
  if (!legacyPath) return value

  try {
    const { data: file, error: downloadError } = await supabase.storage
      .from('product-images')
      .download(legacyPath)

    if (downloadError || !file) {
      console.error('No se pudo descargar el comprobante antiguo:', downloadError)
      return value
    }

    const extension = file.type.includes('png')
      ? 'png'
      : file.type.includes('webp')
        ? 'webp'
        : 'jpg'

    const newPath = `receipts/${companyId}/migrated-${orderId}-${Date.now()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(newPath, file, {
        contentType: file.type || 'image/jpeg',
        cacheControl: '0',
        upsert: false,
      })

    if (uploadError) {
      console.error('No se pudo copiar el comprobante al bucket privado:', uploadError)
      return value
    }

    const { error: updateError } = await supabase
      .from('catalog_orders')
      .update({ payment_proof_url: newPath })
      .eq('id', orderId)
      .eq('company_id', companyId)

    if (updateError) {
      console.error('No se pudo actualizar la ruta del comprobante en la orden:', updateError)

      // La copia privada queda conservada; no se elimina el original público.
      return value
    }

    // El archivo público solo se elimina después de confirmar la actualización.
    const { error: removeError } = await supabase.storage
      .from('product-images')
      .remove([legacyPath])

    if (removeError) {
      console.warn('El comprobante ya fue migrado, pero no se pudo borrar el original:', removeError)
    }

    return newPath
  } catch (error) {
    console.error('Error durante la migración del comprobante:', error)
    return value
  }
}

/**
 * Genera una URL firmada temporal para consultar un comprobante privado.
 * La URL dura 15 minutos y requiere que la sesión tenga permiso de lectura.
 */
export async function resolvePrivatePaymentProofUrl(
  raw: string | null | undefined,
  companyId: string
): Promise<string | null> {
  if (!raw) return null

  const value = raw.trim()
  if (!value) return null

  // Compatibilidad con comprobantes de demostración o modo sin conexión.
  if (value.startsWith('data:')) return value

  // Compatibilidad temporal con URLs antiguas aún no migradas.
  if (/^https?:\/\//i.test(value)) return value

  if (!companyId || !value.startsWith(`receipts/${companyId}/`)) {
    console.warn('Ruta de comprobante no válida para esta empresa.')
    return null
  }

  const { data, error } = await supabase.storage
    .from('payment-proofs')
    .createSignedUrl(value, 60 * 15)

  if (error || !data?.signedUrl) {
    console.error('No se pudo generar el enlace privado del comprobante:', error)
    return null
  }

  return data.signedUrl
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pago_movil: 'Pago Móvil',
  nequi: 'Nequi / Billetera Móvil',
  zelle: 'Zelle / Divisas',
  transferencia: 'Transferencia Bancaria',
  efectivo_entrega: 'Pago al recibir / Punto',
}

export const PAYMENT_STATUS_META: Record<
  CatalogOrder['payment_status'],
  { label: string; toneClass: string }
> = {
  pendiente_verificacion: {
    label: 'Por verificar capture',
    toneClass: 'text-amber-700',
  },
  sin_comprobante: {
    label: 'Pago contra entrega',
    toneClass: 'text-slate-600',
  },
  verificado: {
    label: 'Pago corroborado',
    toneClass: 'text-emerald-700',
  },
  observado: {
    label: 'Con observación',
    toneClass: 'text-amber-800',
  },
  rechazado: {
    label: 'Pago rechazado',
    toneClass: 'text-red-700',
  },
}

export const ORDER_STATUS_META: Record<
  CatalogOrder['order_status'],
  { label: string; toneClass: string }
> = {
  nuevo: { label: 'Recibido', toneClass: 'text-slate-700' },
  alistando: { label: 'En alistamiento', toneClass: 'text-blue-700' },
  despachado: { label: 'En ruta / Despachado', toneClass: 'text-indigo-700' },
  entregado: { label: 'Entregado y cerrado', toneClass: 'text-emerald-700' },
  cancelado: { label: 'Anulado', toneClass: 'text-red-700' },
}

export function buildDemoReceiptSvgDataUrl(opts: {
  platform: 'PAGO MÓVIL' | 'NEQUI' | 'TRANSFERENCIA'
  reference: string
  amountLabel: string
  sender: string
  receiver: string
  dateLabel: string
  accentHex?: string
}): string {
  const accent = opts.accentHex || '#047857'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="680" viewBox="0 0 520 680">
  <rect width="520" height="680" fill="#f1f5f9"/>
  <rect x="36" y="28" width="448" height="624" rx="20" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
  <rect x="36" y="28" width="448" height="108" rx="20" fill="${accent}"/>
  <rect x="36" y="110" width="448" height="26" fill="${accent}"/>
  <text x="260" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#d1fae5" letter-spacing="1.5">COMPROBANTE DE TRANSACCIÓN</text>
  <text x="260" y="104" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="#ffffff">${opts.platform}</text>
  <circle cx="260" cy="182" r="26" fill="#ecfdf5" stroke="${accent}" stroke-width="2.5"/>
  <path d="M249 182 l8 8 l16 -17" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="260" y="232" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="600" fill="#64748b">Operación aprobada exitosamente</text>
  <text x="260" y="274" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="800" fill="#0f172a">${opts.amountLabel}</text>
  <line x1="72" y1="310" x2="448" y2="310" stroke="#e2e8f0" stroke-width="1.5" stroke-dasharray="5,5"/>
  <text x="76" y="352" font-family="Arial, sans-serif" font-size="12" fill="#64748b">Número de referencia</text>
  <text x="444" y="352" text-anchor="end" font-family="Courier New, monospace" font-size="15" font-weight="700" fill="#0f172a">#${opts.reference}</text>
  <text x="76" y="398" font-family="Arial, sans-serif" font-size="12" fill="#64748b">Fecha y hora</text>
  <text x="444" y="398" text-anchor="end" font-family="Arial, sans-serif" font-size="13" font-weight="600" fill="#0f172a">${opts.dateLabel}</text>
  <text x="76" y="444" font-family="Arial, sans-serif" font-size="12" fill="#64748b">Ordenante / Origen</text>
  <text x="444" y="444" text-anchor="end" font-family="Arial, sans-serif" font-size="13" font-weight="600" fill="#0f172a">${opts.sender}</text>
  <text x="76" y="490" font-family="Arial, sans-serif" font-size="12" fill="#64748b">Beneficiario</text>
  <text x="444" y="490" text-anchor="end" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#0f172a">${opts.receiver}</text>
  <rect x="72" y="534" width="376" height="68" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="260" y="563" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#475569">Capture adjuntado por el cliente desde el Catálogo Digital</text>
  <text x="260" y="583" text-anchor="middle" font-family="Courier New, monospace" font-size="11" font-weight="700" fill="${accent}">VERIFICACIÓN ADMINISTRATIVA INVENTARIOPRO</text>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
