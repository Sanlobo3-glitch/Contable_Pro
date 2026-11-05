import type { CatalogDeliveryMode, ProductVariant } from '../types'

export const PUBLIC_CART_STORAGE_PREFIX = 'ip_public_cart_v1:'

export interface CartLineSnapshot {
  productName: string
  variantLabel?: string | null
  unitPrice: number
}

export interface PersistedCheckoutDraft {
  step?: 'cart' | 'checkout'
  deliveryMode?: CatalogDeliveryMode
  selectedPaymentId?: string
  paymentReference?: string
  paymentSenderBank?: string
  paymentAmountInput?: string
  notes?: string
  paymentProofUrl?: string | null
}

export interface PersistedPublicCartState {
  version: 1
  companyId: string
  updatedAt: string
  items: Record<string, number>
  selectedVariants: Record<string, string>
  snapshots: Record<string, CartLineSnapshot>
  checkoutDraft: PersistedCheckoutDraft
}

export interface ReconcilableCatalogProduct {
  id: string
  name: string
  stock: number
  in_stock: boolean
  variants?: ProductVariant[] | null
}

export function getPublicCartStorageKey(companyId: string): string {
  return `${PUBLIC_CART_STORAGE_PREFIX}${(companyId || 'default').trim()}`
}

export function cartKeyOf(productId: string, variantId?: string | null): string {
  return `${productId}::${variantId || 'base'}`
}

export function parseCartKey(key: string): { productId: string; variantId: string | null } {
  const sepIdx = key.indexOf('::')
  if (sepIdx === -1) {
    return { productId: key, variantId: null }
  }
  const productId = key.slice(0, sepIdx)
  const rawVariant = key.slice(sepIdx + 2)
  return {
    productId,
    variantId: rawVariant && rawVariant !== 'base' ? rawVariant : null,
  }
}

function roundQty(n: number): number {
  return Math.round(n * 100) / 100
}

function sanitizeItems(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const { productId } = parseCartKey(key)
    const num = Number(val)
    if (!productId || !Number.isFinite(num) || num <= 0) continue
    out[cartKeyOf(productId, parseCartKey(key).variantId)] = roundQty(num)
  }
  return out
}

function sanitizeSelectedVariants(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [pid, vid] of Object.entries(raw as Record<string, unknown>)) {
    if (pid && typeof vid === 'string' && vid.trim().length > 0) {
      out[pid] = vid.trim()
    }
  }
  return out
}

function sanitizeSnapshots(raw: unknown): Record<string, CartLineSnapshot> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, CartLineSnapshot> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue
    const rec = val as Record<string, unknown>
    const productName = String(rec.productName || '').trim()
    if (!productName) continue
    const unitPrice = Number(rec.unitPrice)
    out[key] = {
      productName,
      variantLabel: rec.variantLabel ? String(rec.variantLabel) : null,
      unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
    }
  }
  return out
}

function sanitizeCheckoutDraft(raw: unknown): PersistedCheckoutDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const step = rec.step === 'checkout' ? 'checkout' : rec.step === 'cart' ? 'cart' : undefined
  const dm = rec.deliveryMode
  const deliveryMode: CatalogDeliveryMode | undefined =
    dm === 'pickup' || dm === 'delivery' || dm === 'shipping' ? dm : undefined

  return {
    step,
    deliveryMode,
    selectedPaymentId:
      typeof rec.selectedPaymentId === 'string' && rec.selectedPaymentId
        ? rec.selectedPaymentId
        : undefined,
    paymentReference: typeof rec.paymentReference === 'string' ? rec.paymentReference : undefined,
    paymentSenderBank:
      typeof rec.paymentSenderBank === 'string' ? rec.paymentSenderBank : undefined,
    paymentAmountInput:
      typeof rec.paymentAmountInput === 'string' ? rec.paymentAmountInput : undefined,
    notes: typeof rec.notes === 'string' ? rec.notes : undefined,
    paymentProofUrl:
      typeof rec.paymentProofUrl === 'string' && rec.paymentProofUrl.length > 0
        ? rec.paymentProofUrl
        : null,
  }
}

export function buildEmptyPersistedCart(companyId: string): PersistedPublicCartState {
  return {
    version: 1,
    companyId,
    updatedAt: new Date().toISOString(),
    items: {},
    selectedVariants: {},
    snapshots: {},
    checkoutDraft: {},
  }
}

export function readPersistedCart(companyId: string): PersistedPublicCartState {
  if (!companyId || typeof window === 'undefined') {
    return buildEmptyPersistedCart(companyId || 'default')
  }
  try {
    const raw = window.localStorage.getItem(getPublicCartStorageKey(companyId))
    if (!raw) return buildEmptyPersistedCart(companyId)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      version: 1,
      companyId,
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      items: sanitizeItems(parsed.items),
      selectedVariants: sanitizeSelectedVariants(parsed.selectedVariants),
      snapshots: sanitizeSnapshots(parsed.snapshots),
      checkoutDraft: sanitizeCheckoutDraft(parsed.checkoutDraft),
    }
  } catch {
    return buildEmptyPersistedCart(companyId)
  }
}

export function writePersistedCart(
  companyId: string,
  payload: {
    items: Record<string, number>
    selectedVariants: Record<string, string>
    snapshots: Record<string, CartLineSnapshot>
    checkoutDraft: PersistedCheckoutDraft
  }
): void {
  if (!companyId || typeof window === 'undefined') return
  const key = getPublicCartStorageKey(companyId)
  const cleanItems = sanitizeItems(payload.items)

  // Conservar únicamente los snapshots de ítems presentes en el carrito actual
  const activeSnapshots: Record<string, CartLineSnapshot> = {}
  for (const itemKey of Object.keys(cleanItems)) {
    if (payload.snapshots[itemKey]) {
      activeSnapshots[itemKey] = payload.snapshots[itemKey]
    }
  }

  const record: PersistedPublicCartState = {
    version: 1,
    companyId,
    updatedAt: new Date().toISOString(),
    items: cleanItems,
    selectedVariants: sanitizeSelectedVariants(payload.selectedVariants),
    snapshots: activeSnapshots,
    checkoutDraft: sanitizeCheckoutDraft(payload.checkoutDraft),
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(record))
  } catch {
    // Si el comprobante inline excede la cuota de localStorage, garantizamos guardar el carrito y datos de pago
    try {
      const lighterRecord: PersistedPublicCartState = {
        ...record,
        checkoutDraft: {
          ...record.checkoutDraft,
          paymentProofUrl: null,
        },
      }
      window.localStorage.setItem(key, JSON.stringify(lighterRecord))
    } catch {
      /* ignore private mode / storage disabled */
    }
  }
}

export function clearPersistedCart(companyId: string): void {
  if (!companyId || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getPublicCartStorageKey(companyId))
  } catch {
    /* ignore */
  }
}

export function reconcilePersistedCartWithCatalog(opts: {
  savedItems: Record<string, number>
  savedVariants: Record<string, string>
  snapshots: Record<string, CartLineSnapshot>
  products: ReconcilableCatalogProduct[]
  showStock: boolean
}): {
  nextItems: Record<string, number>
  nextSelectedVariants: Record<string, string>
  notices: string[]
} {
  const { savedItems, savedVariants, snapshots, products, showStock } = opts
  const nextSelectedVariants: Record<string, string> = {}

  for (const p of products) {
    const availVars = (p.variants || []).filter(v => v.available !== false)
    if (availVars.length > 0) {
      const prevVarId = savedVariants[p.id]
      const stillValid = prevVarId && availVars.some(v => v.id === prevVarId)
      nextSelectedVariants[p.id] = stillValid ? prevVarId : availVars[0].id
    }
  }

  const remainingBaseStock: Record<string, number> = {}
  if (showStock) {
    for (const p of products) {
      remainingBaseStock[p.id] = Math.max(0, Number(p.stock) || 0)
    }
  }

  const nextItems: Record<string, number> = {}
  const notices: string[] = []

  for (const [rawKey, rawQty] of Object.entries(savedItems)) {
    if (!(rawQty > 0)) continue
    const { productId, variantId } = parseCartKey(rawKey)
    const product = products.find(x => x.id === productId)
    const snap = snapshots[rawKey]
    const fallbackTitle = snap
      ? `${snap.productName}${snap.variantLabel ? ` (${snap.variantLabel})` : ''}`
      : 'Un artículo guardado'

    if (!product || !product.in_stock) {
      notices.push(
        `${product ? product.name : fallbackTitle} ya no cuenta con existencias y fue retirado del carrito.`
      )
      continue
    }

    const allVars = product.variants || []
    const availVars = allVars.filter(v => v.available !== false)
    let resolvedVariant: ProductVariant | null = null

    if (allVars.length > 0) {
      if (availVars.length === 0) {
        notices.push(`${product.name} no tiene presentaciones disponibles actualmente.`)
        continue
      }
      if (variantId) {
        const matched = availVars.find(v => v.id === variantId) || null
        if (!matched) {
          notices.push(
            `La presentación ${snap?.variantLabel || 'seleccionada'} de ${product.name} ya no está disponible.`
          )
          continue
        }
        resolvedVariant = matched
      } else {
        resolvedVariant = availVars[0]
      }
    }

    const targetKey = cartKeyOf(product.id, resolvedVariant?.id)
    const mult =
      resolvedVariant?.stock_multiplier && resolvedVariant.stock_multiplier > 0
        ? resolvedVariant.stock_multiplier
        : 1

    if (showStock) {
      const availBase = remainingBaseStock[product.id] ?? 0
      const maxUnits = Math.max(0, Math.floor(availBase / mult))
      const acceptedQty = Math.min(rawQty, maxUnits)

      if (acceptedQty <= 0) {
        notices.push(
          `${product.name}${resolvedVariant ? ` (${resolvedVariant.label})` : ''} agotó su existencia disponible.`
        )
        continue
      }

      if (acceptedQty < rawQty) {
        notices.push(
          `Ajustamos ${product.name}${resolvedVariant ? ` (${resolvedVariant.label})` : ''} a ${roundQty((nextItems[targetKey] || 0) + acceptedQty)} según el inventario actual.`
        )
      }

      nextItems[targetKey] = roundQty((nextItems[targetKey] || 0) + acceptedQty)
      remainingBaseStock[product.id] = Math.max(0, availBase - acceptedQty * mult)
    } else {
      nextItems[targetKey] = roundQty((nextItems[targetKey] || 0) + rawQty)
    }
  }

  return {
    nextItems,
    nextSelectedVariants,
    notices,
  }
}
