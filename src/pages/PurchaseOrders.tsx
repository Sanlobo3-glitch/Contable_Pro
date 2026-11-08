import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  useAuth,
  isReadOnly,
  isCompanyManager,
  canManagePurchases,
  canManageInventory,
  canViewAccounting,
} from '../lib/auth'
import { useCurrency, fmtDate } from '../lib/currency'
import { useWarehouse } from '../lib/warehouseContext'
import { consumePurchaseOrderDraft } from '../lib/purchaseDraft'
import { downloadCsv } from '../lib/csv'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import type {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  Product,
  Supplier,
  CompanyConfig,
} from '../types'
import {
  ClipboardCheck,
  Plus,
  Search,
  Download,
  Printer,
  Copy,
  CheckCircle2,
  Send,
  PackageCheck,
  X,
  Ban,
  RefreshCw,
  ArrowUpRight,
  Warehouse as WarehouseIcon,
} from 'lucide-react'

type StatusFilter = 'all' | 'draft' | 'active' | 'partial' | 'received' | 'cancelled'

interface DraftLine {
  product_id: string
  product_name: string
  sku: string | null
  ordered_qty: string
  unit_cost: string
}

interface ReceiveLineInput {
  item_id: string
  product_id: string
  product_name: string
  sku: string | null
  ordered_qty: number
  already_received: number
  already_rejected: number
  received_now: string
  rejected_now: string
  unit_cost: string
  lot_code: string
  expiry_date: string
}

interface LocalPoBundle {
  orders: PurchaseOrder[]
  items: PurchaseOrderItem[]
}

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Por aprobar',
  approved: 'Aprobada',
  sent: 'Enviada al proveedor',
  partial: 'Recepción parcial',
  received: 'Recibida completa',
  cancelled: 'Cancelada',
}

const STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: 'text-amber-700',
  approved: 'text-blue-700',
  sent: 'text-indigo-700',
  partial: 'text-amber-700',
  received: 'text-emerald-700',
  cancelled: 'text-slate-400 line-through',
}

const PAYMENT_LABEL: Record<string, string> = {
  credito: 'Crédito proveedor',
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo (Caja)',
  tarjeta: 'Tarjeta corporativa',
}

const LOCAL_PO_PREFIX = 'invpro_local_pos_v1_'

function readLocalPos(companyKey: string): LocalPoBundle {
  try {
    const raw = localStorage.getItem(LOCAL_PO_PREFIX + companyKey)
    if (!raw) return { orders: [], items: [] }
    const parsed = JSON.parse(raw) as LocalPoBundle
    return {
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
    }
  } catch {
    return { orders: [], items: [] }
  }
}

function writeLocalPos(companyKey: string, bundle: LocalPoBundle) {
  try {
    localStorage.setItem(LOCAL_PO_PREFIX + companyKey, JSON.stringify(bundle))
  } catch {
    /* almacenamiento restringido */
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

const defaultExpectedIso = () => {
  const d = new Date()
  d.setDate(d.getDate() + 5)
  return d.toLocaleDateString('sv-SE')
}

export default function PurchaseOrders({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const {
    branches,
    warehouses,
    activeWarehouses,
    activeWarehouseId,
    activeBranch,
    refreshWarehouses,
  } = useWarehouse()

  const readOnly = isReadOnly(user)
  const canView =
    isCompanyManager(user?.role) ||
    canManagePurchases(user?.role) ||
    canManageInventory(user?.role) ||
    canViewAccounting(user?.role)
  const canEdit =
    !readOnly &&
    (isCompanyManager(user?.role) || canManagePurchases(user?.role) || canManageInventory(user?.role))
  const canApprove = !readOnly && (isCompanyManager(user?.role) || user?.role === 'comprador')
  const canReceive =
    !readOnly &&
    (isCompanyManager(user?.role) || canManageInventory(user?.role) || canManagePurchases(user?.role))

  const companyKey = user?.company_id || user?.id || 'default'

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [itemsByPo, setItemsByPo] = useState<Record<string, PurchaseOrderItem[]>>({})
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)

  const [loading, setLoading] = useState(true)
  const [usingLocalFallback, setUsingLocalFallback] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; actionPage?: string } | null>(null)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  // Modal: Crear Orden de Compra
  const [showCreate, setShowCreate] = useState(false)
  const [savingPo, setSavingPo] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [prodQuery, setProdQuery] = useState('')
  const [poForm, setPoForm] = useState({
    supplier_id: '',
    branch_id: '',
    target_warehouse_id: '',
    payment_terms: 'credito' as 'credito' | 'transferencia' | 'efectivo' | 'tarjeta',
    credit_days: '30',
    expected_date: defaultExpectedIso(),
    notes: '',
    auto_approve: true,
  })
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])

  // Modal: Detalle / Impresión
  const [detailPo, setDetailPo] = useState<PurchaseOrder | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)

  // Modal: Recepción Auditada en Bodega
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null)
  const [receiveWarehouseId, setReceiveWarehouseId] = useState<string>('')
  const [receiveMethod, setReceiveMethod] = useState<'credito' | 'transferencia' | 'efectivo' | 'tarjeta'>('credito')
  const [receiveCreditDays, setReceiveCreditDays] = useState<string>('30')
  const [receiveLines, setReceiveLines] = useState<ReceiveLineInput[]>([])
  const [receivingBusy, setReceivingBusy] = useState(false)
  const [receiveErr, setReceiveErr] = useState('')

  const groupItems = useCallback((rows: PurchaseOrderItem[]) => {
    const map: Record<string, PurchaseOrderItem[]> = {}
    for (const r of rows) {
      if (!map[r.po_id]) map[r.po_id] = []
      map[r.po_id].push(r)
    }
    return map
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [poRes, itemRes, prodRes, supRes, cfgRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('purchase_order_items').select('*').limit(3000),
      supabase.from('products').select('*').order('name').limit(3000),
      supabase.from('suppliers').select('*').order('name').limit(1000),
      supabase.from('company_config').select('*').limit(1).maybeSingle(),
    ])

    setProducts(((prodRes.data || []) as Product[]))
    setSuppliers(((supRes.data || []) as Supplier[]))
    if (!cfgRes.error && cfgRes.data) setConfig(cfgRes.data as CompanyConfig)

    if (poRes.error) {
      const msg = poRes.error.message || ''
      if (/purchase_orders|does not exist|schema cache|42P01/i.test(msg)) {
        setUsingLocalFallback(true)
        const local = readLocalPos(companyKey)
        setOrders(local.orders)
        setItemsByPo(groupItems(local.items))
      } else {
        setFeedback({ ok: false, text: `No se pudieron cargar las órdenes: ${msg}` })
      }
    } else {
      setUsingLocalFallback(false)
      setOrders((poRes.data || []) as PurchaseOrder[])
      setItemsByPo(groupItems(((itemRes.data || []) as PurchaseOrderItem[])))
    }

    setLoading(false)
  }, [companyKey, groupItems])

  useEffect(() => {
    if (canView) void loadData()
  }, [canView, loadData])

  // Consume borrador enviado desde Sugerencia de compras
  useEffect(() => {
    if (!canEdit) return
    const incoming = consumePurchaseOrderDraft()
    if (!incoming || incoming.items.length === 0) return

    setPoForm(prev => ({
      ...prev,
      supplier_id: incoming.supplier_id || '',
      branch_id: activeBranch?.id || branches[0]?.id || '',
      target_warehouse_id: activeWarehouseId || activeWarehouses[0]?.id || '',
      auto_approve: canApprove,
    }))
    setDraftLines(
      incoming.items.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        sku: it.sku || null,
        ordered_qty: String(Math.max(1, Number(it.quantity) || 1)),
        unit_cost: String(Math.max(0, Number(it.cost) || 0)),
      }))
    )
    setCreateErr('')
    setShowCreate(true)
  }, [canEdit, canApprove, activeBranch?.id, branches, activeWarehouseId, activeWarehouses])

  const branchNameById = useCallback(
    (id?: string | null) => {
      if (!id) return 'Corporativo / General'
      return branches.find(b => b.id === id)?.name || 'Sucursal'
    },
    [branches]
  )

  const warehouseNameById = useCallback(
    (id?: string | null) => {
      if (!id) return 'Por asignar en recepción'
      const w = warehouses.find(x => x.id === id)
      return w ? (w.code ? `${w.code} · ${w.name}` : w.name) : 'Bodega'
    },
    [warehouses]
  )

  // Métricas ejecutivas de abastecimiento
  const kpis = useMemo(() => {
    const now = new Date()
    const curMonth = now.getMonth()
    const curYear = now.getFullYear()

    let activeCount = 0
    let draftCount = 0
    let transitCount = 0
    let openCommitment = 0
    let pendingReceptionCount = 0
    let nextExpected: string | null = null
    let closedMonthTotal = 0
    let closedMonthCount = 0

    for (const o of orders) {
      const items = itemsByPo[o.id] || []
      if (o.status === 'draft' || o.status === 'approved' || o.status === 'sent' || o.status === 'partial') {
        activeCount += 1
        if (o.status === 'draft') draftCount += 1
        if (o.status === 'sent' || o.status === 'partial') transitCount += 1
        if (o.status === 'approved' || o.status === 'sent' || o.status === 'partial') {
          pendingReceptionCount += 1
          if (o.expected_date && (!nextExpected || o.expected_date < nextExpected)) {
            nextExpected = o.expected_date
          }
        }

        const pendingVal = items.reduce((acc, it) => {
          const rem = Math.max(0, (Number(it.ordered_qty) || 0) - (Number(it.received_qty) || 0) - (Number(it.rejected_qty) || 0))
          return acc + rem * (Number(it.unit_cost) || 0)
        }, 0)
        openCommitment += items.length > 0 ? pendingVal : Number(o.total) || 0
      }

      if (o.status === 'received') {
        const dt = new Date(o.received_at || o.created_at)
        if (dt.getMonth() === curMonth && dt.getFullYear() === curYear) {
          closedMonthCount += 1
          closedMonthTotal += Number(o.total) || 0
        }
      }
    }

    return {
      activeCount,
      draftCount,
      transitCount,
      openCommitment,
      pendingReceptionCount,
      nextExpected,
      closedMonthTotal,
      closedMonthCount,
    }
  }, [orders, itemsByPo])

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter(o => {
      if (statusFilter === 'draft' && o.status !== 'draft') return false
      if (statusFilter === 'active' && o.status !== 'approved' && o.status !== 'sent') return false
      if (statusFilter === 'partial' && o.status !== 'partial') return false
      if (statusFilter === 'received' && o.status !== 'received') return false
      if (statusFilter === 'cancelled' && o.status !== 'cancelled') return false
      if (branchFilter !== 'all' && (o.branch_id || 'none') !== branchFilter) return false

      if (!q) return true
      const inHeader =
        o.po_number.toLowerCase().includes(q) ||
        o.supplier_name.toLowerCase().includes(q) ||
        (o.notes || '').toLowerCase().includes(q)
      if (inHeader) return true
      const items = itemsByPo[o.id] || []
      return items.some(
        it =>
          it.product_name.toLowerCase().includes(q) ||
          (it.sku || '').toLowerCase().includes(q)
      )
    })
  }, [orders, itemsByPo, statusFilter, branchFilter, search])

  const matchingProducts = useMemo(() => {
    const q = prodQuery.trim().toLowerCase()
    const pool = products.filter(p => !draftLines.some(l => l.product_id === p.id))
    if (!q) return pool.slice(0, 8)
    return pool
      .filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q)
      )
      .slice(0, 10)
  }, [products, draftLines, prodQuery])

  const draftTotal = useMemo(
    () =>
      draftLines.reduce(
        (acc, l) => acc + Math.max(0, Number(l.ordered_qty) || 0) * Math.max(0, Number(l.unit_cost) || 0),
        0
      ),
    [draftLines]
  )

  function openNewOrderModal() {
    setCreateErr('')
    setProdQuery('')
    setPoForm({
      supplier_id: suppliers[0]?.id || '',
      branch_id: activeBranch?.id || branches[0]?.id || '',
      target_warehouse_id: activeWarehouseId || activeWarehouses[0]?.id || '',
      payment_terms: 'credito',
      credit_days: '30',
      expected_date: defaultExpectedIso(),
      notes: '',
      auto_approve: canApprove,
    })
    setDraftLines([])
    setShowCreate(true)
  }

  function addProductToDraft(p: Product) {
    setDraftLines(prev => [
      ...prev,
      {
        product_id: p.id,
        product_name: p.name,
        sku: p.sku || null,
        ordered_qty: '10',
        unit_cost: String(Number(p.cost) || 0),
      },
    ])
    setProdQuery('')
  }

  async function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || savingPo) return
    setCreateErr('')

    const validLines = draftLines
      .map(l => ({
        product_id: l.product_id,
        product_name: l.product_name,
        sku: l.sku,
        ordered_qty: Number(l.ordered_qty) || 0,
        unit_cost: Number(l.unit_cost) || 0,
      }))
      .filter(l => l.ordered_qty > 0 && l.unit_cost >= 0)

    if (validLines.length === 0) {
      setCreateErr('Agrega al menos un producto con cantidad mayor a cero.')
      return
    }

    setSavingPo(true)
    const creditDays = Math.max(1, Math.round(Number(poForm.credit_days) || 30))

    if (usingLocalFallback) {
      const bundle = readLocalPos(companyKey)
      const seq = bundle.orders.length + 1
      const poId = `po-local-${Date.now()}`
      const sup = suppliers.find(s => s.id === poForm.supplier_id)
      const total = Math.round(validLines.reduce((s, l) => s + l.ordered_qty * l.unit_cost, 0) * 100) / 100
      const autoApp = canApprove && poForm.auto_approve
      const actor = user?.full_name || user?.email || 'Usuario'
      const nowIso = new Date().toISOString()

      const newOrder: PurchaseOrder = {
        id: poId,
        company_id: user?.company_id || undefined,
        po_number: `OC-${String(seq).padStart(4, '0')}`,
        supplier_id: sup?.id || null,
        supplier_name: sup?.name || 'Proveedor general',
        branch_id: poForm.branch_id || null,
        target_warehouse_id: poForm.target_warehouse_id || null,
        status: autoApp ? 'approved' : 'draft',
        payment_terms: poForm.payment_terms,
        credit_days: creditDays,
        expected_date: poForm.expected_date || null,
        subtotal: total,
        total,
        notes: poForm.notes.trim() || null,
        linked_purchase_id: null,
        created_by_name: actor,
        approved_by_name: autoApp ? actor : null,
        approved_at: autoApp ? nowIso : null,
        received_at: null,
        created_at: nowIso,
      }

      const newItems: PurchaseOrderItem[] = validLines.map((l, idx) => ({
        id: `${poId}-item-${idx + 1}`,
        po_id: poId,
        product_id: l.product_id,
        product_name: l.product_name,
        sku: l.sku,
        ordered_qty: l.ordered_qty,
        received_qty: 0,
        rejected_qty: 0,
        unit_cost: l.unit_cost,
      }))

      bundle.orders.unshift(newOrder)
      bundle.items.push(...newItems)
      writeLocalPos(companyKey, bundle)
      setSavingPo(false)
      setShowCreate(false)
      setFeedback({ ok: true, text: `Orden ${newOrder.po_number} creada correctamente.` })
      await loadData()
      return
    }

    const { error } = await supabase.rpc('crear_orden_compra', {
      p_supplier_id: poForm.supplier_id || null,
      p_items: validLines,
      p_branch_id: poForm.branch_id || null,
      p_target_warehouse_id: poForm.target_warehouse_id || null,
      p_payment_terms: poForm.payment_terms,
      p_credit_days: creditDays,
      p_expected_date: poForm.expected_date || null,
      p_notes: poForm.notes.trim() || null,
      p_auto_approve: canApprove && poForm.auto_approve,
    })

    setSavingPo(false)

    if (error) {
      setCreateErr(error.message || 'No se pudo emitir la orden de compra.')
      return
    }

    setShowCreate(false)
    setFeedback({ ok: true, text: 'Orden de compra emitida correctamente.' })
    await loadData()
  }

  async function handleStatusTransition(po: PurchaseOrder, nextStatus: 'approved' | 'sent' | 'cancelled') {
    if (busyOrderId) return
    if (nextStatus === 'approved' && !canApprove) return
    if (nextStatus !== 'approved' && !canEdit) return

    setBusyOrderId(po.id)
    setConfirmCancelId(null)

    if (usingLocalFallback) {
      const bundle = readLocalPos(companyKey)
      const actor = user?.full_name || user?.email || 'Usuario'
      bundle.orders = bundle.orders.map(o =>
        o.id === po.id
          ? {
              ...o,
              status: nextStatus,
              approved_by_name: nextStatus === 'approved' ? actor : o.approved_by_name,
              approved_at: nextStatus === 'approved' ? new Date().toISOString() : o.approved_at,
            }
          : o
      )
      writeLocalPos(companyKey, bundle)
      setBusyOrderId(null)
      setFeedback({
        ok: true,
        text: `Orden ${po.po_number} actualizada a «${STATUS_LABEL[nextStatus]}».`,
      })
      await loadData()
      return
    }

    const { error } = await supabase.rpc('cambiar_estado_orden_compra', {
      p_po_id: po.id,
      p_status: nextStatus,
    })

    setBusyOrderId(null)

    if (error) {
      setFeedback({ ok: false, text: error.message || 'No se pudo actualizar el estado de la orden.' })
      return
    }

    setFeedback({
      ok: true,
      text: `Orden ${po.po_number} marcada como «${STATUS_LABEL[nextStatus]}».`,
    })
    await loadData()
  }

  function openReceiveModal(po: PurchaseOrder) {
    const items = itemsByPo[po.id] || []
    setReceiveTarget(po)
    setReceiveWarehouseId(po.target_warehouse_id || activeWarehouseId || activeWarehouses[0]?.id || '')
    setReceiveMethod(po.payment_terms || 'credito')
    setReceiveCreditDays(String(po.credit_days || 30))
    setReceiveErr('')
    setReceiveLines(
      items.map(it => {
        const pending = Math.max(
          0,
          (Number(it.ordered_qty) || 0) - (Number(it.received_qty) || 0) - (Number(it.rejected_qty) || 0)
        )
        return {
          item_id: it.id,
          product_id: it.product_id,
          product_name: it.product_name,
          sku: it.sku,
          ordered_qty: Number(it.ordered_qty) || 0,
          already_received: Number(it.received_qty) || 0,
          already_rejected: Number(it.rejected_qty) || 0,
          received_now: String(pending),
          rejected_now: '0',
          unit_cost: String(Number(it.unit_cost) || 0),
          lot_code: it.lot_code || '',
          expiry_date: it.expiry_date || '',
        }
      })
    )
  }

  const receiveSummary = useMemo(() => {
    let unitsNow = 0
    let rejectedNow = 0
    let invoiceTotal = 0
    let allComplete = true

    for (const l of receiveLines) {
      const rec = Math.max(0, Number(l.received_now) || 0)
      const rej = Math.max(0, Number(l.rejected_now) || 0)
      const cost = Math.max(0, Number(l.unit_cost) || 0)
      unitsNow += rec
      rejectedNow += rej
      invoiceTotal += rec * cost
      if (l.already_received + l.already_rejected + rec + rej < l.ordered_qty - 0.0001) {
        allComplete = false
      }
    }

    return {
      unitsNow,
      rejectedNow,
      invoiceTotal: Math.round(invoiceTotal * 100) / 100,
      allComplete,
    }
  }, [receiveLines])

  async function handleConfirmReception(e: React.FormEvent) {
    e.preventDefault()
    if (!receiveTarget || !canReceive || receivingBusy) return
    setReceiveErr('')

    if (receiveSummary.unitsNow <= 0) {
      setReceiveErr('Ingresa al menos una unidad recibida conforme para generar la entrada a inventario.')
      return
    }

    setReceivingBusy(true)
    const creditDays = Math.max(1, Math.round(Number(receiveCreditDays) || 30))

    if (usingLocalFallback) {
      // Respaldo transaccional contra registrar_compra + register_warehouse_movement reales
      const purchaseItems = receiveLines
        .filter(l => (Number(l.received_now) || 0) > 0)
        .map(l => {
          const qty = Math.max(0, Number(l.received_now) || 0)
          const cost = Math.max(0, Number(l.unit_cost) || 0)
          return {
            product_id: l.product_id,
            product_name: l.product_name,
            quantity: qty,
            cost,
            subtotal: Math.round(qty * cost * 100) / 100,
            ...(l.lot_code.trim() ? { lot_code: l.lot_code.trim() } : {}),
            ...(l.expiry_date.trim() ? { expiry_date: l.expiry_date.trim() } : {}),
          }
        })

      const rpcPayload: Record<string, unknown> = {
        p_supplier_id: receiveTarget.supplier_id,
        p_items: purchaseItems,
      }
      if (receiveMethod !== 'efectivo') rpcPayload.p_payment_method = receiveMethod
      if (receiveMethod === 'credito') rpcPayload.p_credit_days = creditDays

      const { data: purchaseId, error: purErr } = await supabase.rpc('registrar_compra', rpcPayload)
      if (purErr) {
        setReceivingBusy(false)
        setReceiveErr(purErr.message || 'No se pudo registrar la compra asociada.')
        return
      }

      if (receiveWarehouseId) {
        for (const it of purchaseItems) {
          await supabase.rpc('register_warehouse_movement', {
            p_warehouse_id: receiveWarehouseId,
            p_product_id: it.product_id,
            p_movement_type: 'entry',
            p_quantity: it.quantity,
            p_reference_type: 'purchase_order',
            p_notes: `Recepción ${receiveTarget.po_number}`,
          })
        }
      }

      const bundle = readLocalPos(companyKey)
      bundle.items = bundle.items.map(it => {
        const line = receiveLines.find(rl => rl.item_id === it.id)
        if (!line) return it
        return {
          ...it,
          received_qty: (Number(it.received_qty) || 0) + Math.max(0, Number(line.received_now) || 0),
          rejected_qty: (Number(it.rejected_qty) || 0) + Math.max(0, Number(line.rejected_now) || 0),
          unit_cost: Math.max(0, Number(line.unit_cost) || it.unit_cost),
          lot_code: line.lot_code.trim() || it.lot_code || null,
          expiry_date: line.expiry_date.trim() || it.expiry_date || null,
        }
      })
      bundle.orders = bundle.orders.map(o =>
        o.id === receiveTarget.id
          ? {
              ...o,
              status: receiveSummary.allComplete ? 'received' : 'partial',
              target_warehouse_id: receiveWarehouseId || o.target_warehouse_id,
              linked_purchase_id: typeof purchaseId === 'string' ? purchaseId : o.linked_purchase_id,
              received_at: new Date().toISOString(),
            }
          : o
      )
      writeLocalPos(companyKey, bundle)
      setReceivingBusy(false)
      setReceiveTarget(null)
      await refreshWarehouses()
      await loadData()
      setFeedback({
        ok: true,
        text: `Mercancía de ${receiveTarget.po_number} ingresada a inventario, Kardex y cuentas por pagar.`,
        actionPage: 'purchases',
      })
      return
    }

    const { error } = await supabase.rpc('recibir_orden_compra', {
      p_po_id: receiveTarget.id,
      p_warehouse_id: receiveWarehouseId || null,
      p_lines: receiveLines.map(l => ({
        item_id: l.item_id,
        received_now: Math.max(0, Number(l.received_now) || 0),
        rejected_now: Math.max(0, Number(l.rejected_now) || 0),
        unit_cost: Math.max(0, Number(l.unit_cost) || 0),
        lot_code: l.lot_code.trim() || null,
        expiry_date: l.expiry_date.trim() || null,
      })),
      p_payment_method: receiveMethod,
      p_credit_days: creditDays,
    })

    setReceivingBusy(false)

    if (error) {
      setReceiveErr(error.message || 'No se pudo completar la recepción en bodega.')
      return
    }

    const poNumber = receiveTarget.po_number
    setReceiveTarget(null)
    await refreshWarehouses()
    await loadData()
    setFeedback({
      ok: true,
      text: `Recepción auditada de ${poNumber} completada: existencias, costo promedio, bodega y CxP actualizados.`,
      actionPage: 'purchases',
    })
  }

  function buildPoDoc(po: PurchaseOrder): DocData {
    const items = itemsByPo[po.id] || []
    const sup = suppliers.find(s => s.id === po.supplier_id)
    return {
      title: 'ORDEN DE COMPRA',
      number: po.po_number,
      date: fmtDate(po.created_at),
      extra: po.expected_date ? `Entrega requerida: ${po.expected_date}` : undefined,
      badge: po.status === 'cancelled' ? 'CANCELADA' : po.status === 'draft' ? 'BORRADOR' : undefined,
      partyRoleLabel: 'Proveedor',
      unitColLabel: 'Costo unit.',
      partyName: po.supplier_name,
      partyLines: [
        sup?.document ? `ID fiscal: ${sup.document}` : null,
        sup?.phone ? `Tel: ${sup.phone}` : null,
        sup?.email ? `Email: ${sup.email}` : null,
        sup?.address ? `Dirección: ${sup.address}` : null,
        `Sede destino: ${branchNameById(po.branch_id)} · ${warehouseNameById(po.target_warehouse_id)}`,
      ],
      paymentLabel: `Condición acordada: ${PAYMENT_LABEL[po.payment_terms] || po.payment_terms}${
        po.payment_terms === 'credito' ? ` (${po.credit_days} días)` : ''
      }`,
      lines: items.map(it => ({
        name: `${it.product_name}${it.sku ? ` (${it.sku})` : ''}`,
        quantity: Number(it.ordered_qty) || 0,
        price: Number(it.unit_cost) || 0,
        subtotal: Math.round((Number(it.ordered_qty) || 0) * (Number(it.unit_cost) || 0) * 100) / 100,
      })),
      total: Number(po.total) || 0,
      footer: po.notes || 'Favor confirmar disponibilidad, precios y fecha de despacho con el número de Orden de Compra.',
    }
  }

  async function handleCopyPo(po: PurchaseOrder) {
    const ok = await copyToClipboard(buildShareText(buildPoDoc(po), config))
    setFeedback({
      ok,
      text: ok
        ? `Texto de ${po.po_number} copiado al portapapeles listo para enviar al proveedor.`
        : 'No se pudo copiar automáticamente.',
    })
  }

  function exportCsv() {
    if (filteredOrders.length === 0) return
    downloadCsv(
      `ordenes_compra_${new Date().toLocaleDateString('sv-SE')}.csv`,
      [
        'Número OC',
        'Fecha emisión',
        'Proveedor',
        'Sucursal / Centro de costo',
        'Bodega destino',
        'Condición de pago',
        'Entrega estimada',
        'Estado',
        'Total',
        'Aprobada por',
      ],
      filteredOrders.map(o => [
        o.po_number,
        o.created_at.slice(0, 10),
        o.supplier_name,
        branchNameById(o.branch_id),
        warehouseNameById(o.target_warehouse_id),
        o.payment_terms === 'credito' ? `Crédito ${o.credit_days}d` : o.payment_terms,
        o.expected_date || '',
        STATUS_LABEL[o.status],
        Number(o.total) || 0,
        o.approved_by_name || '',
      ])
    )
  }

  if (!canView) {
    return (
      <p className="text-sm text-slate-500">
        No tienes permisos para acceder al módulo de Órdenes de Compra.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Órdenes de Compra y Recepción Auditada</h1>
          <p className="text-xs text-slate-500 mt-1">
            Control de abastecimiento: emisión, aprobación gerencial, seguimiento en tránsito y auditoría física en bodega antes de afectar inventario y CxP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredOrders.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={openNewOrderModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Nueva orden de compra
            </button>
          )}
        </div>
      </div>

      {usingLocalFallback && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <span>
            Modo compatible activo: al recibir una orden se registrará la compra oficial en tu base de datos. Para sincronizar el historial de OC entre equipos, ejecuta en Supabase la migración <code className="font-mono">20261103000013_tesoreria_centros_costo_ordenes_compra.sql</code>.
          </span>
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs flex items-center justify-between gap-3 ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <div className="flex items-center gap-2 shrink-0">
            {feedback.actionPage && onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate(feedback.actionPage!)}
                className="font-semibold underline whitespace-nowrap"
              >
                Ver Compras registradas
              </button>
            )}
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="p-0.5 rounded hover:bg-black/5"
              aria-label="Cerrar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Banda ejecutiva de KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Órdenes activas en curso</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{kpis.activeCount}</p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {kpis.draftCount} por aprobar · {kpis.transitCount} en tránsito / parcial
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Compromiso financiero abierto</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
            {money(kpis.openCommitment)}
          </p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
            <span>Impacta flujo de caja proyectado</span>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('treasury')}
                className="inline-flex items-center gap-0.5 font-medium text-slate-700 hover:text-slate-900 underline whitespace-nowrap"
              >
                Tesorería <ArrowUpRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Pendientes de recepción en bodega</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
            {kpis.pendingReceptionCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {kpis.nextExpected ? `Próxima llegada est.: ${kpis.nextExpected}` : 'Sin entregas programadas'}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Órdenes cerradas (mes actual)</p>
          <p className="text-2xl font-bold text-emerald-700 tabular-nums mt-0.5">
            {money(kpis.closedMonthTotal)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {kpis.closedMonthCount} recepción(es) completadas este mes
          </p>
        </div>
      </div>

      {/* Controles de filtrado */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 overflow-x-auto max-w-full">
            {(
              [
                ['all', 'Todas'],
                ['draft', 'Por aprobar'],
                ['active', 'Aprobadas / Enviadas'],
                ['partial', 'Parciales (Backorder)'],
                ['received', 'Recibidas'],
                ['cancelled', 'Canceladas'],
              ] as [StatusFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  statusFilter === key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {branches.length > 0 && (
              <select
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                aria-label="Filtrar por sucursal"
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700"
              >
                <option value="all">Todas las sucursales</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="none">Corporativo / Sin sede</option>
              </select>
            )}

            <div className="relative min-w-[220px] flex-1 sm:flex-initial">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar OC, proveedor o SKU..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-500"
              />
            </div>
          </div>
        </div>

        {/* Tabla principal */}
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-400">
            Cargando órdenes de compra y recepciones…
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-12 text-center space-y-2 border-t border-slate-100">
            <ClipboardCheck className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-800">
              No hay órdenes de compra en esta vista
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Emite una orden de compra para formalizar pedidos a proveedores, comprometer presupuesto y auditar las cantidades reales cuando llegue el camión a bodega.
            </p>
            {canEdit && (
              <div className="pt-2 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openNewOrderModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" /> Crear primera orden
                </button>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('buyplan')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Ver sugerencia de reposición
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-100 pt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2.5 pr-3 font-medium">Orden</th>
                  <th className="py-2.5 px-3 font-medium">Proveedor y centro de costo</th>
                  <th className="py-2.5 px-3 font-medium">Bodega destino</th>
                  <th className="py-2.5 px-3 font-medium">Entrega / Pago</th>
                  <th className="py-2.5 px-3 font-medium text-right">Avance físico</th>
                  <th className="py-2.5 px-3 font-medium text-right">Total OC</th>
                  <th className="py-2.5 px-3 font-medium">Estado</th>
                  <th className="py-2.5 pl-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map(po => {
                  const items = itemsByPo[po.id] || []
                  const orderedUnits = items.reduce((s, i) => s + (Number(i.ordered_qty) || 0), 0)
                  const receivedUnits = items.reduce((s, i) => s + (Number(i.received_qty) || 0), 0)
                  const pct = orderedUnits > 0 ? Math.min(100, Math.round((receivedUnits / orderedUnits) * 100)) : 0
                  const isBusy = busyOrderId === po.id

                  return (
                    <tr key={po.id} className="hover:bg-slate-50/70 align-top">
                      <td className="py-3 pr-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDetailPo(po)}
                          className="font-mono font-bold text-slate-900 hover:underline text-left"
                        >
                          {po.po_number}
                        </button>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          {po.created_at.slice(0, 10)}
                        </p>
                      </td>

                      <td className="py-3 px-3">
                        <p className="font-semibold text-slate-800">{po.supplier_name}</p>
                        <p className="text-[11px] text-slate-500">
                          {branchNameById(po.branch_id)} · {items.length} renglón(es)
                        </p>
                      </td>

                      <td className="py-3 px-3 text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <WarehouseIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[170px]">
                            {warehouseNameById(po.target_warehouse_id)}
                          </span>
                        </span>
                      </td>

                      <td className="py-3 px-3 text-slate-600 tabular-nums">
                        <p>{po.expected_date ? `Est. ${po.expected_date}` : 'Sin fecha est.'}</p>
                        <p className="text-[11px] text-slate-400">
                          {po.payment_terms === 'credito'
                            ? `Crédito ${po.credit_days}d`
                            : PAYMENT_LABEL[po.payment_terms] || po.payment_terms}
                        </p>
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className="font-semibold text-slate-800">
                          {receivedUnits} / {orderedUnits}
                        </span>
                        <p className="text-[11px] text-slate-400">{pct}% recibido</p>
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {money(Number(po.total) || 0)}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={`font-semibold ${STATUS_TONE[po.status]}`}>
                          {STATUS_LABEL[po.status]}
                        </span>
                        {po.approved_by_name && (
                          <p className="text-[10px] text-slate-400 truncate max-w-[130px]">
                            Por {po.approved_by_name}
                          </p>
                        )}
                      </td>

                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                          {po.status === 'draft' && canApprove && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleStatusTransition(po, 'approved')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-medium hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Aprobar
                            </button>
                          )}

                          {po.status === 'approved' && canEdit && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleStatusTransition(po, 'sent')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-800 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                            >
                              <Send className="w-3 h-3" /> Marcar enviada
                            </button>
                          )}

                          {(po.status === 'approved' || po.status === 'sent' || po.status === 'partial') &&
                            canReceive && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => openReceiveModal(po)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold hover:bg-emerald-600 disabled:opacity-40 whitespace-nowrap shrink-0"
                              >
                                <PackageCheck className="w-3.5 h-3.5" /> Recibir
                              </button>
                            )}

                          <button
                            type="button"
                            onClick={() => setDetailPo(po)}
                            className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-[11px] font-medium whitespace-nowrap shrink-0"
                          >
                            Detalle
                          </button>

                          {po.status !== 'received' && po.status !== 'cancelled' && canEdit && (
                            confirmCancelId === po.id ? (
                              <span className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleStatusTransition(po, 'cancelled')}
                                  className="px-2 py-1 rounded-lg bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 whitespace-nowrap shrink-0"
                                >
                                  Confirmar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmCancelId(null)}
                                  className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-[11px] whitespace-nowrap shrink-0"
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmCancelId(po.id)}
                                title="Cancelar orden"
                                className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* =====================================================================
          MODAL 1: EMITIR NUEVA ORDEN DE COMPRA
         ===================================================================== */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !savingPo && setShowCreate(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-3xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Nueva Orden de Compra</h2>
                <p className="text-xs text-slate-500">
                  Formaliza cantidades y costos pactados antes de la recepción física en almacén.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              {createErr && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {createErr}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor</label>
                  <select
                    value={poForm.supplier_id}
                    onChange={e => setPoForm({ ...poForm, supplier_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="">Proveedor general</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Sucursal / Centro de costo
                  </label>
                  <select
                    value={poForm.branch_id}
                    onChange={e => setPoForm({ ...poForm, branch_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="">Corporativo / General</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Bodega destino prevista
                  </label>
                  <select
                    value={poForm.target_warehouse_id}
                    onChange={e => setPoForm({ ...poForm, target_warehouse_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="">Definir al recibir</option>
                    {activeWarehouses.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.code ? `${w.code} · ` : ''}{w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Condición de pago
                  </label>
                  <select
                    value={poForm.payment_terms}
                    onChange={e =>
                      setPoForm({
                        ...poForm,
                        payment_terms: e.target.value as 'credito' | 'transferencia' | 'efectivo' | 'tarjeta',
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="credito">Crédito con proveedor</option>
                    <option value="transferencia">Transferencia bancaria</option>
                    <option value="efectivo">Efectivo (Caja)</option>
                    <option value="tarjeta">Tarjeta</option>
                  </select>
                </div>

                {poForm.payment_terms === 'credito' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Plazo de crédito (días)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={poForm.credit_days}
                      onChange={e => setPoForm({ ...poForm, credit_days: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs tabular-nums"
                    />
                  </div>
                ) : (
                  <div />
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Fecha estimada de entrega
                  </label>
                  <input
                    type="date"
                    value={poForm.expected_date}
                    onChange={e => setPoForm({ ...poForm, expected_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs tabular-nums"
                  />
                </div>
              </div>

              {/* Buscador de productos para agregar */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Agregar productos al pedido
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={prodQuery}
                    onChange={e => setProdQuery(e.target.value)}
                    placeholder="Escribe nombre, SKU o código de barras para añadir..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>

                {matchingProducts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {matchingProducts.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProductToDraft(p)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs text-slate-700"
                      >
                        <Plus className="w-3 h-3 text-slate-500" />
                        <span className="truncate max-w-[180px]">{p.name}</span>
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                          ({money(Number(p.cost) || 0)})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tabla de renglones */}
              {draftLines.length > 0 && (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
                        <th className="py-2 px-3 font-medium">Producto</th>
                        <th className="py-2 px-3 font-medium text-right w-28">Cantidad</th>
                        <th className="py-2 px-3 font-medium text-right w-32">Costo pactado</th>
                        <th className="py-2 px-3 font-medium text-right w-32">Subtotal</th>
                        <th className="py-2 px-2 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftLines.map((l, idx) => {
                        const sub = (Number(l.ordered_qty) || 0) * (Number(l.unit_cost) || 0)
                        return (
                          <tr key={l.product_id}>
                            <td className="py-2 px-3">
                              <p className="font-medium text-slate-800">{l.product_name}</p>
                              {l.sku && <p className="font-mono text-[10px] text-slate-400">{l.sku}</p>}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                value={l.ordered_qty}
                                onChange={e =>
                                  setDraftLines(prev =>
                                    prev.map((row, i) => (i === idx ? { ...row, ordered_qty: e.target.value } : row))
                                  )
                                }
                                className="w-24 px-2 py-1 rounded border border-slate-300 text-right font-mono tabular-nums"
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={l.unit_cost}
                                onChange={e =>
                                  setDraftLines(prev =>
                                    prev.map((row, i) => (i === idx ? { ...row, unit_cost: e.target.value } : row))
                                  )
                                }
                                className="w-28 px-2 py-1 rounded border border-slate-300 text-right font-mono tabular-nums"
                              />
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-800">
                              {money(sub)}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <button
                                type="button"
                                onClick={() => setDraftLines(prev => prev.filter((_, i) => i !== idx))}
                                className="p-1 text-slate-400 hover:text-red-600"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Instrucciones de entrega / notas al proveedor
                </label>
                <input
                  type="text"
                  value={poForm.notes}
                  onChange={e => setPoForm({ ...poForm, notes: e.target.value })}
                  placeholder="Ej: Entregar en rampa norte con factura fiscal original y certificado de lote"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200">
                <div>
                  {canApprove && (
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={poForm.auto_approve}
                        onChange={e => setPoForm({ ...poForm, auto_approve: e.target.checked })}
                        className="accent-slate-900"
                      />
                      <span>Emitir ya aprobada y lista para despacho</span>
                    </label>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3">
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">Total comprometido</p>
                    <p className="text-base font-bold text-slate-900 font-mono tabular-nums">
                      {money(draftTotal)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    disabled={savingPo}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={savingPo || draftLines.length === 0}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                  >
                    {savingPo ? 'Guardando…' : 'Emitir orden de compra'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: RECEPCIÓN AUDITADA EN BODEGA
         ===================================================================== */}
      {receiveTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !receivingBusy && setReceiveTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-4xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Recepción Auditada en Bodega · {receiveTarget.po_number}
                </h2>
                <p className="text-xs text-slate-500">
                  Proveedor: <strong className="text-slate-700">{receiveTarget.supplier_name}</strong> · Solo las unidades recibidas conformes ingresarán a existencias y cuentas por pagar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReception} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              {receiveErr && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {receiveErr}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Bodega donde ingresa la mercancía
                  </label>
                  <select
                    value={receiveWarehouseId}
                    onChange={e => setReceiveWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="">Inventario general (sin bodega específica)</option>
                    {activeWarehouses.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.code ? `${w.code} · ` : ''}{w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Medio de pago / obligación
                  </label>
                  <select
                    value={receiveMethod}
                    onChange={e =>
                      setReceiveMethod(
                        e.target.value as 'credito' | 'transferencia' | 'efectivo' | 'tarjeta'
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="credito">Crédito proveedor (genera CxP)</option>
                    <option value="transferencia">Transferencia bancaria</option>
                    <option value="efectivo">Efectivo (descuenta Caja)</option>
                    <option value="tarjeta">Tarjeta</option>
                  </select>
                </div>

                {receiveMethod === 'credito' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Días de crédito factura
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={receiveCreditDays}
                      onChange={e => setReceiveCreditDays(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs tabular-nums"
                    />
                  </div>
                )}
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2.5 px-3 font-medium">Producto</th>
                      <th className="py-2.5 px-2 font-medium text-right">Pedido</th>
                      <th className="py-2.5 px-2 font-medium text-right">Previo</th>
                      <th className="py-2.5 px-2 font-medium text-right">Conforme ahora</th>
                      <th className="py-2.5 px-2 font-medium text-right">Rechazo / Avería</th>
                      <th className="py-2.5 px-2 font-medium text-right">Costo real</th>
                      <th className="py-2.5 px-2 font-medium">Lote / Vence (opc.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receiveLines.map((l, idx) => (
                      <tr key={l.item_id}>
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-slate-800">{l.product_name}</p>
                          {l.sku && <p className="font-mono text-[10px] text-slate-400">{l.sku}</p>}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600">
                          {l.ordered_qty}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-500">
                          {l.already_received}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={l.received_now}
                            onChange={e =>
                              setReceiveLines(prev =>
                                prev.map((row, i) => (i === idx ? { ...row, received_now: e.target.value } : row))
                              )
                            }
                            className="w-20 px-2 py-1 rounded border border-emerald-300 bg-emerald-50/30 text-right font-mono tabular-nums font-semibold text-slate-900"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={l.rejected_now}
                            onChange={e =>
                              setReceiveLines(prev =>
                                prev.map((row, i) => (i === idx ? { ...row, rejected_now: e.target.value } : row))
                              )
                            }
                            className="w-20 px-2 py-1 rounded border border-slate-200 text-right font-mono tabular-nums text-slate-700"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={l.unit_cost}
                            onChange={e =>
                              setReceiveLines(prev =>
                                prev.map((row, i) => (i === idx ? { ...row, unit_cost: e.target.value } : row))
                              )
                            }
                            className="w-24 px-2 py-1 rounded border border-slate-300 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={l.lot_code}
                              onChange={e =>
                                setReceiveLines(prev =>
                                  prev.map((row, i) => (i === idx ? { ...row, lot_code: e.target.value } : row))
                                )
                              }
                              placeholder="Lote"
                              className="w-20 px-2 py-1 rounded border border-slate-200 text-[11px] font-mono"
                            />
                            <input
                              type="date"
                              value={l.expiry_date}
                              onChange={e =>
                                setReceiveLines(prev =>
                                  prev.map((row, i) => (i === idx ? { ...row, expiry_date: e.target.value } : row))
                                )
                              }
                              className="w-28 px-1.5 py-1 rounded border border-slate-200 text-[11px] tabular-nums"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200">
                <div className="text-xs text-slate-600 space-y-0.5 tabular-nums">
                  <p>
                    Ingreso conforme: <strong className="text-slate-900">{receiveSummary.unitsNow} u.</strong>
                    {receiveSummary.rejectedNow > 0 && (
                      <span className="text-red-600"> · Rechazadas: {receiveSummary.rejectedNow} u.</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Resultado de la orden:{' '}
                    <strong className="text-slate-800">
                      {receiveSummary.allComplete ? 'Recepción completa (cerrada)' : 'Recepción parcial (queda saldo en backorder)'}
                    </strong>
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">Factura de compra a contabilizar</p>
                    <p className="text-base font-bold text-emerald-700 font-mono tabular-nums">
                      {money(receiveSummary.invoiceTotal)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setReceiveTarget(null)}
                    disabled={receivingBusy}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={receivingBusy || receiveSummary.unitsNow <= 0}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40 whitespace-nowrap"
                  >
                    <PackageCheck className="w-4 h-4" />
                    {receivingBusy ? 'Procesando entrada…' : 'Confirmar ingreso y compra'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: DETALLE E IMPRESIÓN DE ORDEN DE COMPRA
         ===================================================================== */}
      {detailPo && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setDetailPo(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 font-mono">
                  {detailPo.po_number} · <span className="font-sans">{detailPo.supplier_name}</span>
                </h2>
                <p className="text-xs text-slate-500">
                  {STATUS_LABEL[detailPo.status]} · {branchNameById(detailPo.branch_id)} · {warehouseNameById(detailPo.target_warehouse_id)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailPo(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">Emisión</p>
                  <p className="font-medium text-slate-800 tabular-nums">{detailPo.created_at.slice(0, 10)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Entrega estimada</p>
                  <p className="font-medium text-slate-800 tabular-nums">{detailPo.expected_date || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400">Condición</p>
                  <p className="font-medium text-slate-800">
                    {detailPo.payment_terms === 'credito'
                      ? `Crédito ${detailPo.credit_days}d`
                      : PAYMENT_LABEL[detailPo.payment_terms] || detailPo.payment_terms}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Aprobación</p>
                  <p className="font-medium text-slate-800 truncate">
                    {detailPo.approved_by_name || 'Pendiente'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 px-3 font-medium">Producto</th>
                      <th className="py-2 px-3 font-medium text-right">Pedido</th>
                      <th className="py-2 px-3 font-medium text-right">Recibido</th>
                      <th className="py-2 px-3 font-medium text-right">Rechazado</th>
                      <th className="py-2 px-3 font-medium text-right">Costo unit.</th>
                      <th className="py-2 px-3 font-medium text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(itemsByPo[detailPo.id] || []).map(it => (
                      <tr key={it.id}>
                        <td className="py-2 px-3">
                          <p className="font-medium text-slate-800">{it.product_name}</p>
                          {it.sku && <p className="font-mono text-[10px] text-slate-400">{it.sku}</p>}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{it.ordered_qty}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                          {it.received_qty}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-red-600">
                          {it.rejected_qty || 0}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {money(Number(it.unit_cost) || 0)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                          {money((Number(it.ordered_qty) || 0) * (Number(it.unit_cost) || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detailPo.notes && (
                <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <strong className="text-slate-700">Notas:</strong> {detailPo.notes}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => printHtml(buildDocHtml(buildPoDoc(detailPo), config))}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyPo(detailPo)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copiar para proveedor
                  </button>
                </div>

                <div className="text-right">
                  <span className="text-xs text-slate-500 mr-2">Total orden:</span>
                  <strong className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {money(Number(detailPo.total) || 0)}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
