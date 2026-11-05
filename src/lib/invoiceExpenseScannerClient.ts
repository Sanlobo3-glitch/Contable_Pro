import { supabase } from './supabase'
import { round2 } from './tax'
import { findBestProductMatch, type PreparedScanAttachment } from './handwrittenScannerClient'
import type { ExpenseCategory, Product, Supplier } from '../types'

function normalizeToken(s: string): string {
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

export function findBestSupplierMatch(
  rawName: string,
  rawDoc: string,
  suppliers: Supplier[]
): Supplier | null {
  const cleanDoc = (rawDoc || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (cleanDoc.length >= 5) {
    const byDoc = suppliers.find(s => {
      const sDoc = (s.document || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      return sDoc && (sDoc === cleanDoc || sDoc.includes(cleanDoc) || cleanDoc.includes(sDoc))
    })
    if (byDoc) return byDoc
  }

  const norm = normalizeToken(rawName)
  if (!norm || norm.length < 2) return null
  const tokens = norm.split(' ').filter(t => t.length >= 3)

  let best: Supplier | null = null
  let bestScore = 0
  for (const s of suppliers) {
    const sNorm = normalizeToken(s.name)
    if (!sNorm) continue
    if (sNorm === norm) return s
    let score = 0
    if (sNorm.includes(norm) || norm.includes(sNorm)) score += 4
    for (const tk of tokens) {
      if (sNorm.includes(tk)) score += 2
    }
    if (score > bestScore && score >= 3) {
      bestScore = score
      best = s
    }
  }
  return best
}

export function findBestExpenseCategoryMatch(
  serviceType: string,
  suggestedName: string,
  categories: ExpenseCategory[]
): ExpenseCategory | null {
  const active = categories.filter(c => c.active)
  if (active.length === 0) return null

  const combined = normalizeToken(`${serviceType} ${suggestedName}`)

  // Reglas semánticas directas para facturas de agua, luz, gas, internet, arriendo, flete, nómina
  const keywordGroups: Array<{ rx: RegExp; catRx: RegExp }> = [
    {
      rx: /agua|acueducto|luz|energia|electric|gas|internet|telefon|aseo|servicio/,
      catRx: /servicio|publico|agua|luz|energia|internet/,
    },
    {
      rx: /arriendo|alquiler|local|canon|inmobili/,
      catRx: /arriendo|alquiler|local/,
    },
    {
      rx: /flete|transporte|envio|combustible|gasolina|peaje|domicilio/,
      catRx: /transporte|flete|logistica|combustible|envio/,
    },
    {
      rx: /nomina|salario|sueldo|honorario/,
      catRx: /nomina|personal|sueldo|honorario/,
    },
    {
      rx: /papeleria|insumo|aseo|cafeteria|oficina/,
      catRx: /papeleria|oficina|insumo|suministro|administrativ/,
    },
    {
      rx: /mantenimiento|reparacion|repuesto|tecnico/,
      catRx: /mantenimiento|reparacion/,
    },
    {
      rx: /impuesto|tasa|alcaldia|industria|comercio/,
      catRx: /impuesto|tributo|legal/,
    },
  ]

  for (const g of keywordGroups) {
    if (g.rx.test(combined)) {
      const hit = active.find(c => g.catRx.test(normalizeToken(c.name)))
      if (hit) return hit
    }
  }

  for (const c of active) {
    const cNorm = normalizeToken(c.name)
    if (cNorm && (combined.includes(cNorm) || cNorm.includes(normalizeToken(suggestedName)))) {
      return c
    }
  }

  return (
    active.find(c => /general|otro|varios|operativ/.test(normalizeToken(c.name))) || active[0]
  )
}

/* ============================================================================
 * ESCÁNER DE FACTURAS Y TICKETS DE COMPRA DE MERCANCÍA
 * ========================================================================== */

interface RawPurchaseItem {
  raw_product_text: string
  sku_hint: string
  matched_product_id: string
  quantity: number
  unit_cost: number
  line_total: number
  lot_code: string
  expiry_date: string
  confidence: string
}

interface RawPurchaseInvoiceResponse {
  document_summary: string
  is_utility_or_expense_bill: boolean
  invoice_number: string
  invoice_date: string
  supplier_name: string
  supplier_document: string
  supplier_phone: string
  matched_supplier_id: string
  payment_method: string
  credit_days: number
  items: RawPurchaseItem[]
}

export interface DraftScannedPurchaseItem {
  lineId: string
  included: boolean
  rawProductText: string
  productId: string
  createNewProduct: boolean
  newProductName: string
  newProductSku: string
  newProductSalePrice: number
  newProductUnit: string
  quantity: number
  unitCost: number
  lotCode: string
  expiryDate: string
  confidence: 'alta' | 'media' | 'baja'
}

export interface DraftScannedPurchaseInvoice {
  documentSummary: string
  isUtilityOrExpenseBill: boolean
  invoiceNumber: string
  invoiceDate: string
  supplierId: string
  createNewSupplier: boolean
  newSupplierName: string
  newSupplierDocument: string
  newSupplierPhone: string
  paymentMethod: 'efectivo' | 'transferencia' | 'tarjeta' | 'credito'
  creditDays: number
  items: DraftScannedPurchaseItem[]
}

function normalizePurchaseMethod(
  raw: string
): 'efectivo' | 'transferencia' | 'tarjeta' | 'credito' {
  const clean = normalizeToken(raw)
  if (/credito|plazo|pagar|dias|vencimiento|factura a credito/.test(clean)) return 'credito'
  if (/transf|pago movil|nequi|pse|zelle|bancolombia|banco/.test(clean)) return 'transferencia'
  if (/tarjeta|punto|datafono|debito/.test(clean)) return 'tarjeta'
  return 'efectivo'
}

function buildSuggestedSku(name: string, index: number): string {
  const letters = normalizeToken(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w.slice(0, 3).toUpperCase())
    .join('')
  const prefix = letters || 'ART'
  const suffix = String(Date.now()).slice(-3) + String(index + 1)
  return `${prefix}-${suffix}`
}

export async function scanPurchaseInvoiceDocument(opts: {
  attachments: PreparedScanAttachment[]
  products: Product[]
  suppliers: Supplier[]
  currency: string
  operatorNotes?: string
}): Promise<DraftScannedPurchaseInvoice> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || 'mock-jwt-token'

  const compactCatalog = opts.products.slice(0, 350).map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    price: Number(p.price) || 0,
    cost: Number(p.cost) || 0,
    unit: p.unit || 'unidad',
  }))

  const compactSuppliers = opts.suppliers.slice(0, 200).map(s => ({
    id: s.id,
    name: s.name,
    document: s.document || '',
  }))

  const resp = await fetch('/api/document-scanner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      mode: 'purchase_invoice',
      currency: opts.currency,
      operatorNotes: opts.operatorNotes || '',
      files: opts.attachments.map(a => ({
        mimeType: a.mimeType,
        data: a.base64Data,
        name: a.name,
      })),
      catalog: compactCatalog,
      suppliers: compactSuppliers,
    }),
  })

  const payload = (await resp.json().catch(() => null)) as {
    ok?: boolean
    error?: string
    data?: RawPurchaseInvoiceResponse
  } | null

  if (!resp.ok || !payload?.ok || !payload.data) {
    throw new Error(
      payload?.error || `No se pudo analizar la factura de compra (HTTP ${resp.status}).`
    )
  }

  const d = payload.data
  const productById = new Map(opts.products.map(p => [p.id, p]))
  const supplierById = new Map(opts.suppliers.map(s => [s.id, s]))

  const matchedSupplier =
    (d.matched_supplier_id && supplierById.get(d.matched_supplier_id)) ||
    findBestSupplierMatch(d.supplier_name || '', d.supplier_document || '', opts.suppliers)

  const hasDetectedSupplierName = Boolean((d.supplier_name || '').trim())

  const items: DraftScannedPurchaseItem[] = (Array.isArray(d.items) ? d.items : []).map(
    (it, idx) => {
      const matchedProd =
        (it.matched_product_id && productById.get(it.matched_product_id)) ||
        (it.sku_hint ? findBestProductMatch(it.sku_hint, opts.products) : null) ||
        findBestProductMatch(it.raw_product_text || '', opts.products)

      const qty = Math.max(1, Math.round(Number(it.quantity) || 1))
      const rawUnitCost =
        Number(it.unit_cost) > 0
          ? round2(Number(it.unit_cost))
          : Number(it.line_total) > 0
            ? round2(Number(it.line_total) / qty)
            : Number(matchedProd?.cost) || 0

      const cleanRawName = (it.raw_product_text || '').trim() || `Artículo ${idx + 1}`
      const suggestedSalePrice =
        rawUnitCost > 0 ? Math.ceil(rawUnitCost * 1.35) : 0

      const confRaw = String(it.confidence || '').toLowerCase()
      const confidence: 'alta' | 'media' | 'baja' =
        confRaw === 'alta' ? 'alta' : confRaw === 'baja' ? 'baja' : 'media'

      return {
        lineId: makeUid('pinv'),
        included: true,
        rawProductText: cleanRawName,
        productId: matchedProd?.id || '',
        createNewProduct: !matchedProd,
        newProductName: cleanRawName,
        newProductSku: (it.sku_hint || '').trim() || buildSuggestedSku(cleanRawName, idx),
        newProductSalePrice: suggestedSalePrice,
        newProductUnit: 'unidad',
        quantity: qty,
        unitCost: rawUnitCost,
        lotCode: (it.lot_code || '').trim(),
        expiryDate: /^\d{4}-\d{2}-\d{2}$/.test((it.expiry_date || '').trim())
          ? (it.expiry_date || '').trim()
          : '',
        confidence,
      }
    }
  )

  return {
    documentSummary: (d.document_summary || '').trim(),
    isUtilityOrExpenseBill: Boolean(d.is_utility_or_expense_bill),
    invoiceNumber: (d.invoice_number || '').trim(),
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test((d.invoice_date || '').trim())
      ? (d.invoice_date || '').trim()
      : new Date().toLocaleDateString('sv-SE'),
    supplierId: matchedSupplier?.id || '',
    createNewSupplier: !matchedSupplier && hasDetectedSupplierName,
    newSupplierName: (d.supplier_name || '').trim(),
    newSupplierDocument: (d.supplier_document || '').trim(),
    newSupplierPhone: (d.supplier_phone || '').trim(),
    paymentMethod: normalizePurchaseMethod(d.payment_method || ''),
    creditDays:
      Number(d.credit_days) > 0 && Number(d.credit_days) <= 365
        ? Math.round(Number(d.credit_days))
        : 30,
    items,
  }
}

/* ============================================================================
 * ESCÁNER DE FACTURAS DE AGUA, LUZ, SERVICIOS PÚBLICOS Y GASTOS OPERATIVOS
 * ========================================================================== */

interface RawScannedExpense {
  beneficiary: string
  service_type: string
  matched_category_id: string
  suggested_category_name: string
  reference: string
  expense_date: string
  due_date: string
  description: string
  amount: number
  payment_method: string
  confidence: string
}

interface RawExpenseReceiptResponse {
  page_summary: string
  is_merchandise_invoice: boolean
  expenses: RawScannedExpense[]
}

export interface DraftScannedExpense {
  rowId: string
  included: boolean
  beneficiary: string
  serviceType: string
  categoryId: string
  suggestedCategoryName: string
  reference: string
  expenseDate: string
  dueDate: string
  description: string
  amount: number
  method: 'efectivo' | 'transferencia' | 'tarjeta'
  branchId: string
  confidence: 'alta' | 'media' | 'baja'
}

function normalizeExpenseMethod(raw: string): 'efectivo' | 'transferencia' | 'tarjeta' {
  const clean = normalizeToken(raw)
  if (/tarjeta|punto|datafono|debito/.test(clean)) return 'tarjeta'
  if (/transf|pse|pago movil|nequi|banco|zelle|bancolombia/.test(clean)) return 'transferencia'
  return 'efectivo'
}

export async function scanExpenseReceiptsDocument(opts: {
  attachments: PreparedScanAttachment[]
  categories: ExpenseCategory[]
  currency: string
  defaultBranchId?: string
  operatorNotes?: string
}): Promise<{
  pageSummary: string
  isMerchandiseInvoice: boolean
  draftExpenses: DraftScannedExpense[]
}> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || 'mock-jwt-token'

  const activeCats = opts.categories.filter(c => c.active)
  const compactCats = activeCats.slice(0, 100).map(c => ({
    id: c.id,
    name: c.name,
  }))

  const resp = await fetch('/api/document-scanner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      mode: 'expense_receipt',
      currency: opts.currency,
      operatorNotes: opts.operatorNotes || '',
      files: opts.attachments.map(a => ({
        mimeType: a.mimeType,
        data: a.base64Data,
        name: a.name,
      })),
      expenseCategories: compactCats,
    }),
  })

  const payload = (await resp.json().catch(() => null)) as {
    ok?: boolean
    error?: string
    data?: RawExpenseReceiptResponse
  } | null

  if (!resp.ok || !payload?.ok || !payload.data) {
    throw new Error(
      payload?.error || `No se pudo leer el recibo de gasto o servicio (HTTP ${resp.status}).`
    )
  }

  const catById = new Map(activeCats.map(c => [c.id, c]))
  const todayIso = new Date().toLocaleDateString('sv-SE')

  const draftExpenses: DraftScannedExpense[] = (
    Array.isArray(payload.data.expenses) ? payload.data.expenses : []
  ).map((ex, idx) => {
    const matchedCat =
      (ex.matched_category_id && catById.get(ex.matched_category_id)) ||
      findBestExpenseCategoryMatch(
        ex.service_type || '',
        ex.suggested_category_name || '',
        activeCats
      )

    const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test((ex.expense_date || '').trim())
      ? (ex.expense_date || '').trim()
      : todayIso

    const cleanDue = /^\d{4}-\d{2}-\d{2}$/.test((ex.due_date || '').trim())
      ? (ex.due_date || '').trim()
      : ''

    const confRaw = String(ex.confidence || '').toLowerCase()
    const confidence: 'alta' | 'media' | 'baja' =
      confRaw === 'alta' ? 'alta' : confRaw === 'baja' ? 'baja' : 'media'

    const descFallback = [ex.service_type, ex.beneficiary, ex.reference && `Ref ${ex.reference}`]
      .filter(Boolean)
      .join(' · ')

    return {
      rowId: makeUid('exp'),
      included: true,
      beneficiary: (ex.beneficiary || '').trim(),
      serviceType: (ex.service_type || '').trim() || `Recibo #${idx + 1}`,
      categoryId: matchedCat?.id || activeCats[0]?.id || '',
      suggestedCategoryName: (ex.suggested_category_name || 'Servicios públicos').trim(),
      reference: (ex.reference || '').trim(),
      expenseDate: cleanDate,
      dueDate: cleanDue,
      description: (ex.description || '').trim() || descFallback || 'Pago de servicio operativo',
      amount: Math.max(0, round2(Number(ex.amount) || 0)),
      method: normalizeExpenseMethod(ex.payment_method || ''),
      branchId: opts.defaultBranchId || '',
      confidence,
    }
  })

  return {
    pageSummary: (payload.data.page_summary || '').trim(),
    isMerchandiseInvoice: Boolean(payload.data.is_merchandise_invoice),
    draftExpenses,
  }
}


/* ============================================================================
 * VERIFICADOR OCR DE COMPROBANTES DE PAGO (CAPTURES BANCARIOS) + ANTI-FRAUDE
 * ========================================================================== */

export interface PaymentReceiptAuditResult {
  bankOrPlatform: string
  referenceNumber: string
  amount: number
  currencyHint: string
  transactionDate: string
  transactionStatus: 'aprobada' | 'pendiente' | 'rechazada' | 'dudosa'
  recipientHint: string
  alertNotes: string
  confidence: 'alta' | 'media' | 'baja'
}

export async function prepareImageUrlForScan(imageUrl: string): Promise<PreparedScanAttachment> {
  const resp = await fetch(imageUrl)
  if (!resp.ok) {
    throw new Error('No se pudo descargar el capture adjunto para analizarlo.')
  }
  const blob = await resp.blob()
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('pdf') ? 'pdf' : 'jpg'
  const file = new File([blob], `comprobante.${ext}`, {
    type: blob.type || 'image/jpeg',
  })
  const { prepareDocumentFileForScan } = await import('./handwrittenScannerClient')
  return prepareDocumentFileForScan(file)
}

export async function scanPaymentProofReceipt(opts: {
  attachment: PreparedScanAttachment
  currency: string
  expectedAmount?: number
  orderContextNote?: string
}): Promise<PaymentReceiptAuditResult> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || 'mock-jwt-token'

  const resp = await fetch('/api/document-scanner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      mode: 'payment_receipt',
      currency: opts.currency,
      expectedAmount: opts.expectedAmount || 0,
      operatorNotes: opts.orderContextNote || '',
      files: [
        {
          mimeType: opts.attachment.mimeType,
          data: opts.attachment.base64Data,
          name: opts.attachment.name,
        },
      ],
    }),
  })

  const payload = (await resp.json().catch(() => null)) as {
    ok?: boolean
    error?: string
    data?: Record<string, unknown>
  } | null

  if (!resp.ok || !payload?.ok || !payload.data) {
    throw new Error(
      payload?.error || `No se pudo auditar el comprobante de pago (HTTP ${resp.status}).`
    )
  }

  const d = payload.data
  const rawStatus = String(d.transaction_status || '').toLowerCase()
  const transactionStatus: PaymentReceiptAuditResult['transactionStatus'] =
    rawStatus === 'aprobada' ||
    rawStatus === 'pendiente' ||
    rawStatus === 'rechazada' ||
    rawStatus === 'dudosa'
      ? rawStatus
      : 'dudosa'

  const rawConf = String(d.confidence || '').toLowerCase()
  const confidence: PaymentReceiptAuditResult['confidence'] =
    rawConf === 'alta' ? 'alta' : rawConf === 'baja' ? 'baja' : 'media'

  return {
    bankOrPlatform: String(d.bank_or_platform || '').trim(),
    referenceNumber: String(d.reference_number || '')
      .trim()
      .replace(/^(ref\.?|referencia|nro\.?|#)\s*/i, ''),
    amount: Math.max(0, round2(Number(d.amount) || 0)),
    currencyHint: String(d.currency_hint || '')
      .trim()
      .toUpperCase(),
    transactionDate: String(d.transaction_date || '').trim(),
    transactionStatus,
    recipientHint: String(d.recipient_hint || '').trim(),
    alertNotes: String(d.alert_notes || '').trim(),
    confidence,
  }
}
