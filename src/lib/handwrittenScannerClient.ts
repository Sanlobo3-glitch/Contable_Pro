import { supabase } from './supabase'
import { normalizeProductVariants } from './catalogCommerce'
import { round2 } from './tax'
import type { Customer, Product } from '../types'

export interface PreparedScanAttachment {
  id: string
  name: string
  mimeType: string
  base64Data: string
  previewUrl: string
  isPdf: boolean
  sizeKb: number
}

export interface RawScannedSaleItem {
  raw_product_text: string
  matched_product_id: string
  variant_hint: string
  quantity: number
  written_unit_price: number
  written_line_total: number
  confidence: 'alta' | 'media' | 'baja' | string
}

export interface RawScannedSale {
  source_line_text: string
  payment_method: string
  payment_detail_note: string
  raw_customer_name: string
  matched_customer_id: string
  items: RawScannedSaleItem[]
}

export interface HandwrittenScanResponseData {
  page_summary: string
  detected_date_hint: string
  skipped_notes: string[]
  sales: RawScannedSale[]
}

export interface DraftScannedSaleItem {
  lineId: string
  rawProductText: string
  productId: string
  variantId: string
  variantHint: string
  quantity: number
  unitPrice: number
  catalogUnitPrice: number
  writtenUnitPrice: number
  confidence: 'alta' | 'media' | 'baja'
}

export interface DraftScannedSale {
  rowId: string
  included: boolean
  sourceLineText: string
  paymentMethod: 'efectivo' | 'transferencia' | 'tarjeta' | 'fiado'
  paymentDetailNote: string
  rawCustomerName: string
  customerId: string
  items: DraftScannedSaleItem[]
}

function normalizeSearchToken(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Optimiza una foto del cuaderno en el navegador (máx 1600px, JPEG nítido al 85%)
 * para que la letra manuscrita se conserve clara pero suba rápido incluso con señal móvil débil.
 */
export async function prepareDocumentFileForScan(file: File): Promise<PreparedScanAttachment> {
  const mime = (file.type || '').toLowerCase()
  const isPdf = mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    if (file.size > 6.5 * 1024 * 1024) {
      throw new Error('El PDF supera los 6.5 MB. Súbelo por partes o toma foto directa a la página.')
    }
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const res = String(reader.result || '')
        resolve(res.replace(/^data:[^;]+;base64,/i, ''))
      }
      reader.onerror = () => reject(new Error('No se pudo leer el archivo PDF.'))
      reader.readAsDataURL(file)
    })
    return {
      id: makeUid('pdf'),
      name: file.name || 'hoja-cuaderno.pdf',
      mimeType: 'application/pdf',
      base64Data,
      previewUrl: URL.createObjectURL(file),
      isPdf: true,
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
    }
  }

  if (!mime.startsWith('image/')) {
    throw new Error('Formato no soportado. Sube fotografías (JPG, PNG, WebP) o un PDF.')
  }

  const bitmapUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('No se pudo abrir la imagen seleccionada.'))
      el.src = bitmapUrl
    })

    const maxDim = 1600
    let targetW = img.naturalWidth || img.width
    let targetH = img.naturalHeight || img.height
    if (targetW > maxDim || targetH > maxDim) {
      const ratio = Math.min(maxDim / targetW, maxDim / targetH)
      targetW = Math.max(1, Math.round(targetW * ratio))
      targetH = Math.max(1, Math.round(targetH * ratio))
    }

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Tu navegador no pudo preparar el lienzo de escaneo.')
    }

    // Fondo blanco limpio por si es PNG con transparencia
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.drawImage(img, 0, 0, targetW, targetH)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/i, '')
    const approxBytes = Math.round((base64Data.length * 3) / 4)

    return {
      id: makeUid('img'),
      name: file.name || 'hoja-cuaderno.jpg',
      mimeType: 'image/jpeg',
      base64Data,
      previewUrl: dataUrl,
      isPdf: false,
      sizeKb: Math.max(1, Math.round(approxBytes / 1024)),
    }
  } finally {
    URL.revokeObjectURL(bitmapUrl)
  }
}

/**
 * Búsqueda difusa de respaldo en cliente por si el texto manuscrito coincide parcialmente
 * con el nombre o SKU de un producto del inventario.
 */
export function findBestProductMatch(rawText: string, products: Product[]): Product | null {
  const norm = normalizeSearchToken(rawText)
  if (!norm) return null
  const tokens = norm.split(' ').filter(t => t.length >= 2)

  let best: Product | null = null
  let bestScore = 0

  for (const p of products) {
    const pNorm = normalizeSearchToken(p.name)
    const skuNorm = normalizeSearchToken(p.sku || '')
    if (!pNorm) continue

    if (pNorm === norm || (skuNorm && skuNorm === norm)) {
      return p
    }

    let score = 0
    if (pNorm.includes(norm) || norm.includes(pNorm)) {
      score += 4
    }
    if (skuNorm && norm.includes(skuNorm)) {
      score += 5
    }
    for (const tk of tokens) {
      if (pNorm.includes(tk)) score += 2
      else if (tk.length >= 4 && pNorm.split(' ').some(w => w.startsWith(tk.slice(0, 4)))) {
        score += 1
      }
    }

    if (score > bestScore && score >= 3) {
      bestScore = score
      best = p
    }
  }

  return best
}

export function findBestCustomerMatch(rawName: string, customers: Customer[]): Customer | null {
  const norm = normalizeSearchToken(rawName)
  if (!norm || norm.length < 2) return null
  const tokens = norm.split(' ').filter(t => t.length >= 2)

  let best: Customer | null = null
  let bestScore = 0

  for (const c of customers) {
    const cNorm = normalizeSearchToken(c.name)
    if (!cNorm) continue
    if (cNorm === norm) return c

    let score = 0
    if (cNorm.includes(norm) || norm.includes(cNorm)) score += 4
    for (const tk of tokens) {
      if (cNorm.includes(tk)) score += 2
    }
    if (score > bestScore && score >= 3) {
      bestScore = score
      best = c
    }
  }

  return best
}

function normalizePaymentMethod(
  raw: string
): 'efectivo' | 'transferencia' | 'tarjeta' | 'fiado' {
  const clean = normalizeSearchToken(raw)
  if (
    /fiado|credito comercial|a credito|debe|cartera|pendiente/.test(clean)
  ) {
    return 'fiado'
  }
  if (
    /transf|pago movil|nequi|daviplata|zelle|bancolombia|binance/.test(clean)
  ) {
    return 'transferencia'
  }
  if (/tarjeta|punto|datafono|debito/.test(clean)) {
    return 'tarjeta'
  }
  return 'efectivo'
}

/**
 * Envía las páginas del cuaderno al endpoint seguro /api/document-scanner
 * y cruza cada renglón devuelto contra el inventario y clientes reales de la empresa.
 */
export async function scanHandwrittenSalesNotebook(opts: {
  attachments: PreparedScanAttachment[]
  products: Product[]
  customers: Customer[]
  currency: string
  operatorNotes?: string
}): Promise<{
  pageSummary: string
  detectedDateHint: string
  skippedNotes: string[]
  draftSales: DraftScannedSale[]
}> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || 'mock-jwt-token'

  const compactCatalog = opts.products.slice(0, 350).map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    price: Number(p.price) || 0,
    price_wholesale: Number(p.price_wholesale) || 0,
    unit: p.unit || 'und',
    variants: normalizeProductVariants(p.variants).map(v => v.label),
  }))

  const compactCustomers = opts.customers.slice(0, 200).map(c => ({
    id: c.id,
    name: c.name,
    document: c.document || '',
  }))

  const resp = await fetch('/api/document-scanner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      mode: 'handwritten_sales',
      currency: opts.currency,
      operatorNotes: opts.operatorNotes || '',
      files: opts.attachments.map(a => ({
        mimeType: a.mimeType,
        data: a.base64Data,
        name: a.name,
      })),
      catalog: compactCatalog,
      customers: compactCustomers,
    }),
  })

  const payload = (await resp.json().catch(() => null)) as {
    ok?: boolean
    error?: string
    data?: HandwrittenScanResponseData
  } | null

  if (!resp.ok || !payload?.ok || !payload.data) {
    throw new Error(
      payload?.error || `No se pudo procesar el cuaderno (HTTP ${resp.status}).`
    )
  }

  const productById = new Map(opts.products.map(p => [p.id, p]))
  const customerById = new Map(opts.customers.map(c => [c.id, c]))

  const rawSales = Array.isArray(payload.data.sales) ? payload.data.sales : []

  const draftSales: DraftScannedSale[] = rawSales
    .map(rawSale => {
      const matchedCustomer =
        (rawSale.matched_customer_id && customerById.get(rawSale.matched_customer_id)) ||
        (rawSale.raw_customer_name
          ? findBestCustomerMatch(rawSale.raw_customer_name, opts.customers)
          : null)

      const rawItems = Array.isArray(rawSale.items) ? rawSale.items : []
      const mappedItems: DraftScannedSaleItem[] = rawItems.map(it => {
        const matchedProd =
          (it.matched_product_id && productById.get(it.matched_product_id)) ||
          findBestProductMatch(it.raw_product_text, opts.products)

        const qty = Math.max(1, Math.round(Number(it.quantity) || 1))
        const variants = matchedProd ? normalizeProductVariants(matchedProd.variants) : []
        const hintNorm = normalizeSearchToken(it.variant_hint || '')
        const matchedVariant =
          hintNorm && variants.length > 0
            ? variants.find(v => {
                const vNorm = normalizeSearchToken(v.label)
                return vNorm === hintNorm || vNorm.includes(hintNorm) || hintNorm.includes(vNorm)
              }) || null
            : null

        const catalogPrice = matchedVariant
          ? Number(matchedVariant.price) || Number(matchedProd?.price) || 0
          : Number(matchedProd?.price) || 0

        const writtenUnit =
          Number(it.written_unit_price) > 0
            ? round2(Number(it.written_unit_price))
            : Number(it.written_line_total) > 0
              ? round2(Number(it.written_line_total) / qty)
              : 0

        // Preferimos el precio oficial del catálogo; si el producto aún no fue emparejado usamos el escrito
        const effectiveUnitPrice = catalogPrice > 0 ? catalogPrice : writtenUnit

        const confRaw = String(it.confidence || '').toLowerCase()
        const confidence: 'alta' | 'media' | 'baja' = !matchedProd
          ? 'baja'
          : confRaw === 'alta'
            ? 'alta'
            : confRaw === 'baja'
              ? 'baja'
              : 'media'

        return {
          lineId: makeUid('ln'),
          rawProductText: (it.raw_product_text || '').trim() || 'Producto anotado',
          productId: matchedProd?.id || '',
          variantId: matchedVariant?.id || '',
          variantHint: (it.variant_hint || '').trim(),
          quantity: qty,
          unitPrice: effectiveUnitPrice,
          catalogUnitPrice: catalogPrice,
          writtenUnitPrice: writtenUnit,
          confidence,
        }
      })

      return {
        rowId: makeUid('sale'),
        included: mappedItems.length > 0,
        sourceLineText: (rawSale.source_line_text || '').trim(),
        paymentMethod: normalizePaymentMethod(rawSale.payment_method),
        paymentDetailNote: (rawSale.payment_detail_note || '').trim(),
        rawCustomerName: (rawSale.raw_customer_name || '').trim(),
        customerId: matchedCustomer?.id || '',
        items: mappedItems,
      }
    })
    .filter(s => s.items.length > 0)

  return {
    pageSummary: (payload.data.page_summary || '').trim(),
    detectedDateHint: (payload.data.detected_date_hint || '').trim(),
    skippedNotes: Array.isArray(payload.data.skipped_notes)
      ? payload.data.skipped_notes.filter(Boolean)
      : [],
    draftSales,
  }
}
