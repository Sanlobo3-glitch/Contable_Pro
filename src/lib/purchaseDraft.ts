export interface PurchaseDraftItem {
  product_id: string
  product_name: string
  sku?: string | null
  quantity: number
  cost: number
}

export interface PurchaseDraft {
  supplier_id: string | null
  supplier_name: string | null
  items: PurchaseDraftItem[]
}

const KEY = 'invpro_purchase_draft_v1'
const PO_KEY = 'invpro_po_draft_v1'
let memDraft: PurchaseDraft | null = null
let memPoDraft: PurchaseDraft | null = null

export function savePurchaseDraft(draft: PurchaseDraft) {
  memDraft = draft
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    /* modo privado o almacenamiento restringido */
  }
}

export function consumePurchaseDraft(): PurchaseDraft | null {
  let out = memDraft
  memDraft = null
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    if (!out && raw) out = JSON.parse(raw) as PurchaseDraft
  } catch {
    /* ignorar */
  }
  return out
}

export function savePurchaseOrderDraft(draft: PurchaseDraft) {
  memPoDraft = draft
  try {
    sessionStorage.setItem(PO_KEY, JSON.stringify(draft))
  } catch {
    /* modo privado o almacenamiento restringido */
  }
}

export function consumePurchaseOrderDraft(): PurchaseDraft | null {
  let out = memPoDraft
  memPoDraft = null
  try {
    const raw = sessionStorage.getItem(PO_KEY)
    sessionStorage.removeItem(PO_KEY)
    if (!out && raw) out = JSON.parse(raw) as PurchaseDraft
  } catch {
    /* ignorar */
  }
  return out
}
