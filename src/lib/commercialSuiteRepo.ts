import { supabase } from './supabase'
import { round2 } from './tax'
import type { PreparedScanAttachment } from './handwrittenScannerClient'
import type { Expense, Product, Purchase, Sale } from '../types'

/* ============================================================================
 * 1. ALMACENAMIENTO DUAL (SUPABASE + RESPALDO LOCAL AUTOMÁTICO POR EMPRESA)
 * Garantiza que los 5 módulos operen de inmediato incluso antes de ejecutar
 * la migración SQL 000021, y sincronicen en la nube apenas las tablas existan.
 * ========================================================================== */

type SuiteTableName =
  | 'blind_inventory_sessions'
  | 'layaway_contracts'
  | 'product_exchanges'
  | 'bank_reconciliations'
  | 'price_shield_batches'

function isMissingTableError(msg?: string | null): boolean {
  if (!msg) return false
  return /relation .* does not exist|could not find the table|schema cache|42P01|PGRST205/i.test(
    msg
  )
}

function localKey(table: SuiteTableName, scopeKey: string): string {
  return `ip_suite_${table}_${scopeKey || 'default'}_v1`
}

function readLocalRows<T>(table: SuiteTableName, scopeKey: string): T[] {
  try {
    const raw = localStorage.getItem(localKey(table, scopeKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeLocalRows<T>(table: SuiteTableName, scopeKey: string, rows: T[]): void {
  try {
    localStorage.setItem(localKey(table, scopeKey), JSON.stringify(rows.slice(0, 300)))
  } catch {
    /* ignore storage quota */
  }
}

export function makeSuiteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`
}

export function makeDocumentCode(prefix: string): string {
  const d = new Date()
  const ym = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
  const seq = String(Math.floor(1000 + Math.random() * 9000))
  return `${prefix}-${ym}-${seq}`
}

export async function listSuiteRecords<T extends { id: string; created_at: string }>(
  table: SuiteTableName,
  scopeKey: string
): Promise<{ rows: T[]; cloudSynced: boolean }> {
  const local = readLocalRows<T>(table, scopeKey)
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      if (isMissingTableError(error.message)) {
        return { rows: local, cloudSynced: false }
      }
      return { rows: local, cloudSynced: false }
    }

    const cloudRows = Array.isArray(data) ? (data as T[]) : []
    const cloudIds = new Set(cloudRows.map(r => r.id))
    const merged = [...cloudRows]
    for (const item of local) {
      if (!cloudIds.has(item.id)) {
        merged.push(item)
      }
    }
    merged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    writeLocalRows(table, scopeKey, merged)
    return { rows: merged, cloudSynced: true }
  } catch {
    return { rows: local, cloudSynced: false }
  }
}

export async function upsertSuiteRecord<T extends { id: string; created_at: string }>(
  table: SuiteTableName,
  scopeKey: string,
  record: T
): Promise<{ saved: T; cloudSynced: boolean }> {
  const local = readLocalRows<T>(table, scopeKey)
  const idx = local.findIndex(r => r.id === record.id)
  const nextLocal = idx >= 0 ? local.map((r, i) => (i === idx ? record : r)) : [record, ...local]
  nextLocal.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  writeLocalRows(table, scopeKey, nextLocal)

  try {
    const { data, error } = await supabase
      .from(table)
      .upsert(record as unknown as Record<string, unknown>, { onConflict: 'id' })
      .select('*')
      .maybeSingle()

    if (error) {
      return { saved: record, cloudSynced: false }
    }
    if (data) {
      const savedCloud = data as T
      const updated = nextLocal.map(r => (r.id === savedCloud.id ? savedCloud : r))
      writeLocalRows(table, scopeKey, updated)
      return { saved: savedCloud, cloudSynced: true }
    }
    return { saved: record, cloudSynced: true }
  } catch {
    return { saved: record, cloudSynced: false }
  }
}

/* ============================================================================
 * 2. TOMA FÍSICA CIEGA DE INVENTARIO (INTERFACES)
 * ========================================================================== */

export interface BlindCountLine {
  product_id: string
  product_name: string
  sku: string
  unit: string
  category_name: string
  cost: number
  price: number
  expected_stock: number
  counted_qty: number | null
  counted_at: string | null
  note: string
}

export interface BlindInventorySession {
  id: string
  session_code: string
  warehouse_id: string | null
  title: string
  category_filter: string | null
  status: 'en_conteo' | 'revision' | 'aplicada' | 'anulada'
  items: BlindCountLine[]
  counted_by_name: string | null
  approved_by_name: string | null
  total_variance_units: number
  total_variance_cost: number
  notes: string | null
  created_at: string
  applied_at: string | null
}

/* ============================================================================
 * 3. PLAN SEPARE / APARTADOS Y ANTICIPOS (INTERFACES)
 * ========================================================================== */

export interface LayawayItem {
  product_id: string
  product_name: string
  sku: string
  variant_label: string | null
  quantity: number
  unit_price: number
  subtotal: number
}

export interface LayawayPayment {
  id: string
  amount: number
  method: 'efectivo' | 'transferencia' | 'tarjeta'
  reference: string
  paid_at: string
  recorded_by: string
}

export interface LayawayContract {
  id: string
  contract_code: string
  warehouse_id: string | null
  customer_id: string | null
  customer_name: string
  customer_document: string | null
  customer_phone: string | null
  items: LayawayItem[]
  total_amount: number
  paid_amount: number
  balance: number
  due_date: string
  payments: LayawayPayment[]
  reservation_ids: string[]
  status: 'activo' | 'completado' | 'vencido' | 'anulado'
  sale_id: string | null
  notes: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

/* ============================================================================
 * 4. CAMBIOS «MANO A MANO» Y GARANTÍAS (INTERFACES)
 * ========================================================================== */

export interface ExchangeItemLine {
  product_id: string
  product_name: string
  sku: string
  variant_label: string | null
  quantity: number
  unit_price: number
  subtotal: number
}

export type WarrantyStatus =
  | 'recibido_local'
  | 'en_revision_proveedor'
  | 'reemplazado'
  | 'resuelto'
  | 'rechazado'

export interface ProductExchangeRecord {
  id: string
  exchange_code: string
  kind: 'cambio_mano_a_mano' | 'garantia'
  original_sale_id: string | null
  customer_name: string
  customer_phone: string | null
  supplier_name: string | null
  returned_items: ExchangeItemLine[]
  delivered_items: ExchangeItemLine[]
  price_difference: number
  payment_method: 'efectivo' | 'transferencia' | 'tarjeta' | 'saldo_favor'
  warranty_status: WarrantyStatus
  reason: string
  serial_or_lot: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

/* ============================================================================
 * 5. ESCUDO DE MÁRGENES, REDONDEO COMERCIAL Y PUENTE A ETIQUETAS
 * ========================================================================== */

export type RoundingMode =
  | 'exact'
  | 'mult_50'
  | 'mult_100'
  | 'mult_500'
  | 'mult_1000'
  | 'psych_900'

export type PriceStrategy =
  | 'protect_margin'
  | 'percent_increase'
  | 'cost_hike_recalc'

export interface PriceShieldBatch {
  id: string
  batch_code: string
  strategy_label: string
  rounding_mode: RoundingMode
  updated_count: number
  avg_prev_margin: number
  avg_new_margin: number
  product_ids: string[]
  created_by_name: string | null
  created_at: string
}

const LABELS_PRESELECT_KEY = 'ip_labels_preselect_v1'

export function saveLabelsPreselection(productIds: string[]): void {
  try {
    const clean = Array.from(new Set(productIds.filter(Boolean)))
    sessionStorage.setItem(LABELS_PRESELECT_KEY, JSON.stringify(clean))
  } catch {
    /* ignore */
  }
}

export function consumeLabelsPreselection(): string[] {
  try {
    const raw = sessionStorage.getItem(LABELS_PRESELECT_KEY)
    if (!raw) return []
    sessionStorage.removeItem(LABELS_PRESELECT_KEY)
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

export function applyCommercialRounding(value: number, mode: RoundingMode): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  switch (mode) {
    case 'mult_50':
      return Math.ceil(value / 50) * 50
    case 'mult_100':
      return Math.ceil(value / 100) * 100
    case 'mult_500':
      return Math.ceil(value / 500) * 500
    case 'mult_1000':
      return Math.ceil(value / 1000) * 1000
    case 'psych_900': {
      if (value < 1000) return Math.ceil(value / 100) * 100
      const baseThousand = Math.ceil(value / 1000) * 1000
      const candidateDown = baseThousand - 100
      return candidateDown >= value * 0.96 ? candidateDown : baseThousand + 900
    }
    case 'exact':
    default:
      return round2(value)
  }
}

export function computeGrossMarginPct(price: number, cost: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0
  return round2(((price - cost) / price) * 100)
}

export function simulateProductPrice(opts: {
  product: Product
  strategy: PriceStrategy
  percentValue: number
  targetMarginPct: number
  rounding: RoundingMode
  syncWholesale: boolean
}): {
  newCost: number
  newPrice: number
  newWholesale: number | null
  prevMarginPct: number
  newMarginPct: number
  changed: boolean
} {
  const curCost = Math.max(0, Number(opts.product.cost) || 0)
  const curPrice = Math.max(0, Number(opts.product.price) || 0)
  const curWholesale =
    opts.product.price_wholesale && Number(opts.product.price_wholesale) > 0
      ? Number(opts.product.price_wholesale)
      : null

  const prevMarginPct = computeGrossMarginPct(curPrice, curCost)
  const safeTargetMargin = Math.min(85, Math.max(1, Number(opts.targetMarginPct) || 30))
  const pctFactor = 1 + (Number(opts.percentValue) || 0) / 100

  let newCost = curCost
  let rawPrice = curPrice

  if (opts.strategy === 'protect_margin') {
    if (curCost > 0) {
      const minRequiredPrice = curCost / (1 - safeTargetMargin / 100)
      rawPrice = Math.max(curPrice, minRequiredPrice)
    }
  } else if (opts.strategy === 'percent_increase') {
    rawPrice = curPrice * pctFactor
  } else if (opts.strategy === 'cost_hike_recalc') {
    newCost = round2(curCost * pctFactor)
    const effectiveMargin = Math.max(prevMarginPct, safeTargetMargin)
    if (newCost > 0 && effectiveMargin < 90) {
      rawPrice = newCost / (1 - effectiveMargin / 100)
    } else {
      rawPrice = curPrice * pctFactor
    }
  }

  const newPrice = Math.max(newCost, applyCommercialRounding(rawPrice, opts.rounding))

  let newWholesale: number | null = curWholesale
  if (opts.syncWholesale && curWholesale !== null && curPrice > 0) {
    const ratio = newPrice / curPrice
    const rawWholesale = Math.max(newCost, curWholesale * ratio)
    newWholesale = applyCommercialRounding(rawWholesale, opts.rounding)
  }

  const newMarginPct = computeGrossMarginPct(newPrice, newCost)
  const changed =
    Math.abs(newPrice - curPrice) >= 0.01 ||
    Math.abs(newCost - curCost) >= 0.01 ||
    (newWholesale !== null && curWholesale !== null && Math.abs(newWholesale - curWholesale) >= 0.01)

  return {
    newCost,
    newPrice,
    newWholesale,
    prevMarginPct,
    newMarginPct,
    changed,
  }
}

/* ============================================================================
 * 6. CONCILIACIÓN BANCARIA AUTOMÁTICA (CSV + OCR + DETECCIÓN 4x1000 / COMISIONES)
 * ========================================================================== */

export type BankFeeKind =
  | 'none'
  | 'gmf_4x1000'
  | 'comision_bancaria'
  | 'iva_comision'
  | 'igtf'

export interface BankStatementRow {
  row_id: string
  date: string
  description: string
  reference: string
  direction: 'credit' | 'debit'
  amount: number
  fee_kind: BankFeeKind
  match_status: 'matched' | 'bank_fee' | 'unmatched' | 'manual_ok'
  matched_type: 'venta' | 'pedido_catalogo' | 'compra' | 'gasto' | null
  matched_id: string | null
  matched_label: string | null
  fee_registered: boolean
}

export interface BankReconciliationSession {
  id: string
  recon_code: string
  bank_name: string
  account_hint: string | null
  period_label: string | null
  rows: BankStatementRow[]
  matched_count: number
  unmatched_count: number
  fee_count: number
  fees_registered_amount: number
  total_credits: number
  total_debits: number
  status: 'abierta' | 'cerrada'
  created_by_name: string | null
  created_at: string
}

export interface CatalogOrderLite {
  id: string
  order_code?: string | null
  customer_name?: string | null
  total: number
  payment_reference?: string | null
  status?: string | null
  created_at: string
}

function classifyBankFeeFromDescription(
  desc: string,
  direction: 'credit' | 'debit'
): BankFeeKind {
  if (direction !== 'debit') return 'none'
  const norm = (desc || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (/4\s*x\s*1000|4x1000|gmf|gravamen.*movimiento|impuesto.*4/.test(norm)) {
    return 'gmf_4x1000'
  }
  if (/igtf|grandes transacciones/.test(norm)) {
    return 'igtf'
  }
  if (/iva.*(comision|cuota|servicio|banc)/.test(norm)) {
    return 'iva_comision'
  }
  if (
    /comision|cuota de manejo|cuota manejo|costo transaccion|tarifa bancaria|redeban|credibanco|cobro servicio banc/.test(
      norm
    )
  ) {
    return 'comision_bancaria'
  }
  return 'none'
}

function parseFlexibleMoney(raw: string): number {
  const clean = (raw || '').replace(/[^\d.,-]/g, '').trim()
  if (!clean) return 0
  const neg = clean.startsWith('-') ? -1 : 1
  const unsigned = clean.replace(/-/g, '')

  const lastDot = unsigned.lastIndexOf('.')
  const lastComma = unsigned.lastIndexOf(',')

  let normalized = unsigned
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      // Ej: 1.250.000,50
      normalized = unsigned.replace(/\./g, '').replace(',', '.')
    } else {
      // Ej: 1,250,000.50
      normalized = unsigned.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    const afterComma = unsigned.slice(lastComma + 1)
    if (afterComma.length === 3 && unsigned.length > 4) {
      normalized = unsigned.replace(/,/g, '')
    } else {
      normalized = unsigned.replace(',', '.')
    }
  } else if (lastDot >= 0) {
    const parts = unsigned.split('.')
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = unsigned.replace(/\./g, '')
    }
  }

  const num = Number(normalized)
  return Number.isFinite(num) ? round2(num * neg) : 0
}

function normalizeDateString(raw: string): string {
  const s = (raw || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (dmy) {
    const d = dmy[1].padStart(2, '0')
    const m = dmy[2].padStart(2, '0')
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${y}-${m}-${d}`
  }
  return new Date().toISOString().slice(0, 10)
}

function splitCsvRow(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

export function parseBankStatementCsv(csvText: string): BankStatementRow[] {
  const lines = (csvText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const first = lines[0]
  const semiCount = (first.match(/;/g) || []).length
  const commaCount = (first.match(/,/g) || []).length
  const delimiter = semiCount > commaCount ? ';' : ','

  const headers = splitCsvRow(first, delimiter).map(h =>
    h
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  )

  const findIdx = (rx: RegExp, fallback: number) => {
    const idx = headers.findIndex(h => rx.test(h))
    return idx >= 0 ? idx : fallback
  }

  const dateIdx = findIdx(/fecha|date|dia/, 0)
  const descIdx = findIdx(/descripcion|concepto|detalle|movimiento|motivo|description/, 1)
  const refIdx = findIdx(/referencia|ref|documento|comprobante|aprobacion|id/, -1)
  const creditIdx = findIdx(/credito|abono|entrada|ingreso|credit/, -1)
  const debitIdx = findIdx(/debito|cargo|salida|egreso|retiro|debit/, -1)
  const amountIdx = findIdx(/valor|monto|importe|amount|total/, 2)
  const typeIdx = findIdx(/tipo|naturaleza|signo/, -1)

  const rows: BankStatementRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i], delimiter)
    if (cols.length < 2) continue

    const rawDate = cols[dateIdx] || ''
    const desc = cols[descIdx] || cols[1] || 'Movimiento bancario'
    const ref = refIdx >= 0 ? cols[refIdx] || '' : ''

    let direction: 'credit' | 'debit' = 'credit'
    let amount = 0

    if (creditIdx >= 0 && debitIdx >= 0) {
      const cVal = Math.abs(parseFlexibleMoney(cols[creditIdx] || ''))
      const dVal = Math.abs(parseFlexibleMoney(cols[debitIdx] || ''))
      if (cVal > 0) {
        direction = 'credit'
        amount = cVal
      } else if (dVal > 0) {
        direction = 'debit'
        amount = dVal
      }
    } else {
      const signed = parseFlexibleMoney(cols[amountIdx] ?? cols[cols.length - 1] ?? '')
      if (signed < 0) {
        direction = 'debit'
        amount = Math.abs(signed)
      } else {
        amount = Math.abs(signed)
        const tVal = (typeIdx >= 0 ? cols[typeIdx] || '' : '').toLowerCase()
        if (/deb|carg|salid|egres|retir|-/.test(tVal)) {
          direction = 'debit'
        } else {
          direction = 'credit'
        }
      }
    }

    if (amount <= 0) continue

    const feeKind = classifyBankFeeFromDescription(desc, direction)
    rows.push({
      row_id: `bk-${Date.now()}-${i}`,
      date: normalizeDateString(rawDate),
      description: desc,
      reference: ref,
      direction,
      amount,
      fee_kind: feeKind,
      match_status: feeKind !== 'none' ? 'bank_fee' : 'unmatched',
      matched_type: null,
      matched_id: null,
      matched_label: null,
      fee_registered: false,
    })
  }

  return rows
}

export async function scanBankStatementAttachment(opts: {
  files: PreparedScanAttachment[]
  currency: string
}): Promise<{
  bankName: string
  periodHint: string
  rows: BankStatementRow[]
}> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token || 'mock-jwt-token'

  const resp = await fetch('/api/document-scanner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode: 'bank_statement',
      currency: opts.currency,
      files: opts.files.map(f => ({
        mimeType: f.mimeType,
        data: f.base64Data,
        name: f.name,
      })),
    }),
  })

  const json = (await resp.json().catch(() => null)) as {
    ok?: boolean
    error?: string
    data?: {
      bank_name?: string
      period_hint?: string
      movements?: Array<{
        date?: string
        description?: string
        reference?: string
        direction?: string
        amount?: number
        fee_kind?: string
      }>
    }
  } | null

  if (!resp.ok || !json?.ok || !json.data) {
    throw new Error(json?.error || 'No se pudo analizar el extracto bancario.')
  }

  const rawMovs = Array.isArray(json.data.movements) ? json.data.movements : []
  const rows: BankStatementRow[] = rawMovs
    .map((m, idx) => {
      const direction: 'credit' | 'debit' = m.direction === 'debit' ? 'debit' : 'credit'
      const amount = Math.abs(Number(m.amount) || 0)
      const desc = String(m.description || 'Movimiento bancario').trim()
      const ref = String(m.reference || '').trim()
      const detectedFee = (m.fee_kind || 'none') as BankFeeKind
      const feeKind: BankFeeKind =
        detectedFee !== 'none'
          ? detectedFee
          : classifyBankFeeFromDescription(desc, direction)

      return {
        row_id: `bk-ocr-${Date.now()}-${idx}`,
        date: normalizeDateString(String(m.date || '')),
        description: desc,
        reference: ref,
        direction,
        amount: round2(amount),
        fee_kind: feeKind,
        match_status: (feeKind !== 'none' ? 'bank_fee' : 'unmatched') as BankStatementRow['match_status'],
        matched_type: null,
        matched_id: null,
        matched_label: null,
        fee_registered: false,
      }
    })
    .filter(r => r.amount > 0)

  return {
    bankName: String(json.data.bank_name || '').trim() || 'Extracto bancario',
    periodHint: String(json.data.period_hint || '').trim(),
    rows,
  }
}

function dayDiff(dateA: string, dateB: string): number {
  const a = Date.parse((dateA || '').slice(0, 10))
  const b = Date.parse((dateB || '').slice(0, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.abs(Math.round((a - b) / 86_400_000))
}

export function reconcileBankRowsWithSystem(
  rows: BankStatementRow[],
  system: {
    sales: Sale[]
    catalogOrders: CatalogOrderLite[]
    purchases: Purchase[]
    expenses: Expense[]
  }
): BankStatementRow[] {
  const usedSales = new Set<string>()
  const usedOrders = new Set<string>()
  const usedPurchases = new Set<string>()
  const usedExpenses = new Set<string>()

  const bankSales = system.sales.filter(
    s =>
      s.status === 'completada' &&
      (s.payment_method === 'transferencia' || s.payment_method === 'tarjeta')
  )
  const validOrders = system.catalogOrders.filter(o => o.status !== 'rechazado')
  const bankPurchases = system.purchases.filter(
    p =>
      p.status === 'recibida' &&
      (p.payment_method === 'transferencia' || p.payment_method === 'tarjeta')
  )
  const bankExpenses = system.expenses.filter(
    e =>
      e.status === 'activo' &&
      (e.method === 'transferencia' || e.method === 'tarjeta')
  )

  return rows.map(row => {
    if (row.fee_kind !== 'none') {
      return {
        ...row,
        match_status: 'bank_fee',
      }
    }

    const cleanRef = (row.reference || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    const amountTol = Math.max(1, row.amount * 0.005) // 0.5% tolerancia centavos

    if (row.direction === 'credit') {
      // 1. Buscar primero en pedidos web por referencia o monto + fecha
      let bestOrder: CatalogOrderLite | null = null
      let bestOrderScore = 0
      for (const ord of validOrders) {
        if (usedOrders.has(ord.id)) continue
        const ordRef = (ord.payment_reference || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        const refMatch =
          cleanRef.length >= 4 &&
          ordRef.length >= 4 &&
          (ordRef.includes(cleanRef) || cleanRef.includes(ordRef))
        const amtDiff = Math.abs(Number(ord.total || 0) - row.amount)
        const dDiff = dayDiff(row.date, ord.created_at)

        if (refMatch && amtDiff <= Math.max(50, row.amount * 0.02)) {
          bestOrder = ord
          bestOrderScore = 100
          break
        }
        if (amtDiff <= amountTol && dDiff <= 4) {
          const score = 60 - dDiff * 10
          if (score > bestOrderScore) {
            bestOrderScore = score
            bestOrder = ord
          }
        }
      }

      if (bestOrder && bestOrderScore >= 30) {
        usedOrders.add(bestOrder.id)
        return {
          ...row,
          match_status: 'matched',
          matched_type: 'pedido_catalogo',
          matched_id: bestOrder.id,
          matched_label: `Pedido ${bestOrder.order_code || bestOrder.id.slice(0, 8).toUpperCase()} · ${bestOrder.customer_name || 'Cliente web'}`,
        }
      }

      // 2. Buscar en Ventas por transferencia/tarjeta
      let bestSale: Sale | null = null
      let bestSaleScore = 0
      for (const s of bankSales) {
        if (usedSales.has(s.id)) continue
        const amtDiff = Math.abs(Number(s.total || 0) - row.amount)
        const dDiff = dayDiff(row.date, s.created_at)
        if (amtDiff <= amountTol && dDiff <= 4) {
          const score = 60 - dDiff * 10
          if (score > bestSaleScore) {
            bestSaleScore = score
            bestSale = s
          }
        }
      }

      if (bestSale && bestSaleScore >= 20) {
        usedSales.add(bestSale.id)
        return {
          ...row,
          match_status: 'matched',
          matched_type: 'venta',
          matched_id: bestSale.id,
          matched_label: `Venta VTA-${bestSale.id.slice(0, 8).toUpperCase()} · ${bestSale.customer_name || 'Mostrador'}`,
        }
      }
    } else {
      // Débitos: cruzar con Gastos operativos y Compras bancarias
      let bestExp: Expense | null = null
      let bestExpScore = 0
      for (const exp of bankExpenses) {
        if (usedExpenses.has(exp.id)) continue
        const expRef = (exp.reference || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        const refMatch =
          cleanRef.length >= 4 &&
          expRef.length >= 4 &&
          (expRef.includes(cleanRef) || cleanRef.includes(expRef))
        const amtDiff = Math.abs(Number(exp.amount || 0) - row.amount)
        const dDiff = dayDiff(row.date, exp.expense_date || exp.created_at)

        if (refMatch && amtDiff <= Math.max(50, row.amount * 0.02)) {
          bestExp = exp
          bestExpScore = 100
          break
        }
        if (amtDiff <= amountTol && dDiff <= 4) {
          const score = 60 - dDiff * 10
          if (score > bestExpScore) {
            bestExpScore = score
            bestExp = exp
          }
        }
      }

      if (bestExp && bestExpScore >= 20) {
        usedExpenses.add(bestExp.id)
        return {
          ...row,
          match_status: 'matched',
          matched_type: 'gasto',
          matched_id: bestExp.id,
          matched_label: `Gasto · ${bestExp.category_name} (${bestExp.beneficiary || bestExp.description})`,
        }
      }

      let bestPur: Purchase | null = null
      let bestPurScore = 0
      for (const pur of bankPurchases) {
        if (usedPurchases.has(pur.id)) continue
        const amtDiff = Math.abs(Number(pur.total || 0) - row.amount)
        const dDiff = dayDiff(row.date, pur.created_at)
        if (amtDiff <= amountTol && dDiff <= 5) {
          const score = 55 - dDiff * 8
          if (score > bestPurScore) {
            bestPurScore = score
            bestPur = pur
          }
        }
      }

      if (bestPur && bestPurScore >= 15) {
        usedPurchases.add(bestPur.id)
        return {
          ...row,
          match_status: 'matched',
          matched_type: 'compra',
          matched_id: bestPur.id,
          matched_label: `Compra CMP-${bestPur.id.slice(0, 8).toUpperCase()} · ${bestPur.supplier_name || 'Proveedor'}`,
        }
      }
    }

    return {
      ...row,
      match_status: 'unmatched',
      matched_type: null,
      matched_id: null,
      matched_label: null,
    }
  })
}
