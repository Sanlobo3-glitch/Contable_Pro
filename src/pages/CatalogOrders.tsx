import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  useAuth,
  canManageSettings,
  canRegisterSales,
  isCompanyManager,
  isReadOnly,
} from '../lib/auth'
import { formatMoney, useCurrency } from '../lib/currency'
import { buildDocHtml, printHtml, type DocData } from '../lib/documents'
import { taxDocFields } from '../lib/tax'
import { copyToClipboard } from '../lib/copilotShare'
import { useWarehouse } from '../lib/warehouseContext'
import { setCatalogPosHandoff } from '../lib/productImages'
import { useBackOverlay } from '../lib/navigation'
import CatalogBrandModal, { type CatalogBrandModalTab } from '../components/CatalogBrandModal'
import SqlActivationModal from '../components/SqlActivationModal'
import {
  DELIVERY_MODE_LABELS,
  ORDER_STATUS_META,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_META,
  migrateLegacyPaymentProof,
  resolvePrivatePaymentProofUrl,
  resolveBrandTheme,
  uploadCatalogAssetOrInline,
} from '../lib/catalogCommerce'
import { prepareDocumentFileForScan } from '../lib/handwrittenScannerClient'
import {
  prepareImageUrlForScan,
  scanPaymentProofReceipt,
  type PaymentReceiptAuditResult,
} from '../lib/invoiceExpenseScannerClient'
import {
  buildCompanyStoreUrl,
  renderCompanyWhatsAppMessage,
} from '../lib/whatsappStudio'
import type {
  CatalogOrder,
  CatalogOrderItem,
  CatalogOrderStatus,
  CatalogPaymentStatus,
  CompanyConfig,
} from '../types'
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Database,
  ExternalLink,
  Eye,
  FileCheck2,
  Globe,
  Loader2,
  MessageCircle,
  Palette,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  Upload,
  User,
  X,
  XCircle,
} from 'lucide-react'

type FilterTab = 'all' | 'pending_proof' | 'verified' | 'completed' | 'issues'

function cleanWaPhone(raw?: string | null): string {
  const digits = (raw || '').replace(/[^\d]/g, '')
  return digits.length >= 8 ? digits : ''
}

function normalizeRefCode(raw?: string | null): string {
  const clean = (raw || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^0+/, '')
    .toLowerCase()
  return clean.length >= 4 ? clean : ''
}

function normalizeOrderRow(raw: Record<string, unknown>): CatalogOrder {
  const rawItems = Array.isArray(raw.items) ? raw.items : []
  const items: CatalogOrderItem[] = rawItems.map(it => {
    const rec = (it || {}) as Record<string, unknown>
    const qty = Number(rec.quantity) || 1
    const unitPrice = Number(rec.unit_price ?? rec.price) || 0
    return {
      product_id: String(rec.product_id || ''),
      product_name: String(rec.product_name || 'Producto'),
      sku: rec.sku ? String(rec.sku) : null,
      variant_id: rec.variant_id ? String(rec.variant_id) : null,
      variant_label: rec.variant_label ? String(rec.variant_label) : null,
      stock_multiplier: Number(rec.stock_multiplier) > 0 ? Number(rec.stock_multiplier) : 1,
      quantity: qty,
      unit_price: unitPrice,
      subtotal: Number(rec.subtotal) || Math.round(qty * unitPrice * 100) / 100,
      unit: rec.unit ? String(rec.unit) : null,
      image_url: rec.image_url ? String(rec.image_url) : null,
    }
  })

  return {
    id: String(raw.id || ''),
    company_id: String(raw.company_id || ''),
    order_number: String(raw.order_number || 'WEB-0000'),
    tracking_pin: String(raw.tracking_pin || '0000'),
    customer_type: raw.customer_type === 'juridica' ? 'juridica' : 'natural',
    customer_id: raw.customer_id ? String(raw.customer_id) : null,
    customer_name: String(raw.customer_name || 'Cliente'),
    customer_document: raw.customer_document ? String(raw.customer_document) : null,
    contact_person: raw.contact_person ? String(raw.contact_person) : null,
    requires_fiscal_invoice: Boolean(raw.requires_fiscal_invoice),
    customer_phone: String(raw.customer_phone || ''),
    customer_email: raw.customer_email ? String(raw.customer_email) : null,
    delivery_mode:
      raw.delivery_mode === 'pickup' || raw.delivery_mode === 'shipping'
        ? raw.delivery_mode
        : 'delivery',
    delivery_address: raw.delivery_address ? String(raw.delivery_address) : null,
    customer_notes: raw.customer_notes ? String(raw.customer_notes) : null,
    items,
    subtotal: Number(raw.subtotal) || 0,
    tax_rate: Number(raw.tax_rate) || 0,
    tax_amount: Number(raw.tax_amount) || 0,
    total: Number(raw.total) || 0,
    currency: String(raw.currency || 'USD'),
    fx_currency: raw.fx_currency ? String(raw.fx_currency) : null,
    fx_rate: raw.fx_rate ? Number(raw.fx_rate) : null,
    fx_total: raw.fx_total ? Number(raw.fx_total) : null,
    payment_method: String(raw.payment_method || 'pago_movil'),
    payment_reference: raw.payment_reference ? String(raw.payment_reference) : null,
    payment_sender_bank: raw.payment_sender_bank ? String(raw.payment_sender_bank) : null,
    payment_amount_reported:
      raw.payment_amount_reported !== null && raw.payment_amount_reported !== undefined
        ? Number(raw.payment_amount_reported)
        : null,
    payment_proof_url: raw.payment_proof_url ? String(raw.payment_proof_url) : null,
    payment_status: (raw.payment_status as CatalogPaymentStatus) || 'pendiente_verificacion',
    order_status: (raw.order_status as CatalogOrderStatus) || 'nuevo',
    verified_by: raw.verified_by ? String(raw.verified_by) : null,
    verified_by_name: raw.verified_by_name ? String(raw.verified_by_name) : null,
    verified_at: raw.verified_at ? String(raw.verified_at) : null,
    admin_notes: raw.admin_notes ? String(raw.admin_notes) : null,
    sale_id: raw.sale_id ? String(raw.sale_id) : null,
    quotation_id: raw.quotation_id ? String(raw.quotation_id) : null,
    created_at: String(raw.created_at || new Date().toISOString()),
    updated_at: String(raw.updated_at || new Date().toISOString()),
  }
}

export default function CatalogOrders({
  onNavigate,
  onPreviewCatalog,
}: {
  onNavigate?: (page: string) => void
  onPreviewCatalog?: (companyId: string) => void
}) {
  const { user } = useAuth()
  const { fmt: moneyBase } = useCurrency()
  const { activeWarehouses, activeWarehouseId } = useWarehouse()

  const readOnly = isReadOnly(user)
  const canProcess =
    !readOnly && (canRegisterSales(user?.role) || isCompanyManager(user?.role))
  const canConfigureBrand = !readOnly && canManageSettings(user?.role)

  const [orders, setOrders] = useState<CatalogOrder[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [brandModalOpen, setBrandModalOpen] = useState(false)
  const [brandModalTab, setBrandModalTab] = useState<CatalogBrandModalTab>('brand')

  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [zoomProofUrl, setZoomProofUrl] = useState<string | null>(null)
  const [adminNoteDraft, setAdminNoteDraft] = useState('')
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>('')
  const [processing, setProcessing] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedRef, setCopiedRef] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const [auditingOrderId, setAuditingOrderId] = useState<string | null>(null)
  const [auditByOrderId, setAuditByOrderId] = useState<Record<string, PaymentReceiptAuditResult>>({})
  const [auditErrorByOrderId, setAuditErrorByOrderId] = useState<Record<string, string>>({})
  const ocrFileInputRef = useRef<HTMLInputElement | null>(null)

  useBackOverlay(Boolean(zoomProofUrl), () => setZoomProofUrl(null))

  useEffect(() => {
    void loadAll()
  }, [])

  useEffect(() => {
    if (!targetWarehouseId && activeWarehouseId) {
      setTargetWarehouseId(activeWarehouseId)
    }
  }, [activeWarehouseId, targetWarehouseId])
  async function loadAll() {
    setLoading(true)

    const [ordRes, cfgRes] = await Promise.all([
      supabase.from('catalog_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('company_config').select('*').limit(1).maybeSingle(),
    ])

    if (cfgRes.data) {
      setConfig(cfgRes.data as CompanyConfig)
    }

    if (ordRes.error) {
      if (/catalog_orders|does not exist|schema cache/i.test(ordRes.error.message || '')) {
        setSchemaMissing(true)
      }
      setOrders([])
    } else {
      setSchemaMissing(false)

      const list = ((ordRes.data || []) as Record<string, unknown>[]).map(normalizeOrderRow)

      // Los comprobantes antiguos se migran al bucket privado.
      // Las rutas privadas se convierten en enlaces firmados temporales.
      const ordersWithPrivateProofs = await Promise.all(
        list.map(async order => {
          const rawProof = order.payment_proof_url
          if (!rawProof) return order

          try {
            const storedPath = await migrateLegacyPaymentProof(
              rawProof,
              order.id,
              order.company_id
            )

            const signedUrl = await resolvePrivatePaymentProofUrl(
              storedPath,
              order.company_id
            )

            return {
              ...order,
              payment_proof_url: signedUrl,
            }
          } catch (error) {
            console.error(
              `No se pudo preparar el comprobante del pedido ${order.order_number}:`,
              error
            )
            return {
              ...order,
              payment_proof_url: null,
            }
          }
        })
      )

      setOrders(ordersWithPrivateProofs)

      if (!selectedOrderId && ordersWithPrivateProofs.length > 0) {
        setSelectedOrderId(ordersWithPrivateProofs[0].id)
        setAdminNoteDraft(ordersWithPrivateProofs[0].admin_notes || '')
      }
    }

    setLoading(false)
  }

  const companyId = user?.company_id || config?.company_id || config?.id || ''
  const brand = resolveBrandTheme(config?.brand_theme)

  const publicStoreUrl = useMemo(
    () => buildCompanyStoreUrl(window.location.origin, companyId, config?.catalog_slug, config),
    [companyId, config]
  )

  const selectedOrder = useMemo(
    () => orders.find(o => o.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  )

  useEffect(() => {
    if (selectedOrder) {
      setAdminNoteDraft(selectedOrder.admin_notes || '')
    }
  }, [selectedOrder?.id])

  function findDuplicateOrdersForReference(
    currentOrderId: string,
    rawReference?: string | null
  ): CatalogOrder[] {
    const target = normalizeRefCode(rawReference)
    if (!target) return []
    return orders.filter(o => {
      if (o.id === currentOrderId || o.order_status === 'cancelado') return false
      const orderRef = normalizeRefCode(o.payment_reference)
      const scannedRef = normalizeRefCode(auditByOrderId[o.id]?.referenceNumber)
      return orderRef === target || (scannedRef !== '' && scannedRef === target)
    })
  }

  async function handleAuditAttachedProof(order: CatalogOrder) {
    if (!order.payment_proof_url || auditingOrderId) return
    setAuditingOrderId(order.id)
    setAuditErrorByOrderId(prev => ({ ...prev, [order.id]: '' }))

    try {
      const attachment = await prepareImageUrlForScan(order.payment_proof_url)
      const expected =
        order.fx_currency && order.fx_total ? order.fx_total : order.total
      const expectedCurr =
        order.fx_currency && order.fx_total ? order.fx_currency : order.currency

      const result = await scanPaymentProofReceipt({
        attachment,
        currency: expectedCurr,
        expectedAmount: expected,
        orderContextNote: `Pedido ${order.order_number} · Cliente ${order.customer_name} · Canal declarado: ${order.payment_method} · Total base: ${order.total} ${order.currency}`,
      })
      setAuditByOrderId(prev => ({ ...prev, [order.id]: result }))
    } catch (err) {
      setAuditErrorByOrderId(prev => ({
        ...prev,
        [order.id]:
          err instanceof Error
            ? err.message
            : 'No se pudo analizar ópticamente el comprobante.',
      }))
    } finally {
      setAuditingOrderId(null)
    }
  }

  async function handleUploadAndAuditProof(order: CatalogOrder, file: File) {
    if (auditingOrderId) return
    setAuditingOrderId(order.id)
    setAuditErrorByOrderId(prev => ({ ...prev, [order.id]: '' }))

    try {
      const attachment = await prepareDocumentFileForScan(file)
      const targetCompany = order.company_id || companyId

      // Si es imagen, archivarla también como comprobante oficial del pedido
      if (file.type.startsWith('image/') && targetCompany && canProcess) {
        const storedPath = await uploadCatalogAssetOrInline(file, 'receipt', targetCompany)
        const { error: upErr } = await supabase
          .from('catalog_orders')
          .update({ payment_proof_url: storedPath })
          .eq('id', order.id)

        if (!upErr) {
          const signedUrl = await resolvePrivatePaymentProofUrl(storedPath, targetCompany)
          setOrders(prev =>
            prev.map(o =>
              o.id === order.id ? { ...o, payment_proof_url: signedUrl || storedPath } : o
            )
          )
        }
      }

      const expected =
        order.fx_currency && order.fx_total ? order.fx_total : order.total
      const expectedCurr =
        order.fx_currency && order.fx_total ? order.fx_currency : order.currency

      const result = await scanPaymentProofReceipt({
        attachment,
        currency: expectedCurr,
        expectedAmount: expected,
        orderContextNote: `Pedido ${order.order_number} · Cliente ${order.customer_name} · Canal declarado: ${order.payment_method} · Total base: ${order.total} ${order.currency}`,
      })

      setAuditByOrderId(prev => ({ ...prev, [order.id]: result }))
      setNotice({
        text: `Comprobante digitalizado y auditado para ${order.order_number}.`,
        tone: 'ok',
      })
    } catch (err) {
      setAuditErrorByOrderId(prev => ({
        ...prev,
        [order.id]:
          err instanceof Error
            ? err.message
            : 'No se pudo subir ni auditar el comprobante.',
      }))
    } finally {
      setAuditingOrderId(null)
    }
  }

  async function handleApplyAuditToOrder(
    order: CatalogOrder,
    audit: PaymentReceiptAuditResult
  ) {
    if (!canProcess || processing) return
    setProcessing(true)

    const summaryNote = [
      `OCR ${audit.bankOrPlatform || 'Comprobante'}`,
      audit.referenceNumber ? `Ref #${audit.referenceNumber}` : '',
      audit.amount > 0 ? `Monto leído: ${audit.amount} ${audit.currencyHint || order.currency}` : '',
      `Estado: ${audit.transactionStatus}`,
    ]
      .filter(Boolean)
      .join(' · ')

    const nextNotes = adminNoteDraft.trim()
      ? `${adminNoteDraft.trim()} | ${summaryNote}`
      : summaryNote

    const updates: Record<string, unknown> = {
      admin_notes: nextNotes,
    }
    if (audit.referenceNumber) updates.payment_reference = audit.referenceNumber
    if (audit.bankOrPlatform) updates.payment_sender_bank = audit.bankOrPlatform
    if (audit.amount > 0) updates.payment_amount_reported = audit.amount

    const { error } = await supabase
      .from('catalog_orders')
      .update(updates)
      .eq('id', order.id)

    setProcessing(false)

    if (error) {
      setNotice({
        text: `No se pudieron guardar los datos del comprobante: ${error.message}`,
        tone: 'err',
      })
      return
    }

    setAdminNoteDraft(nextNotes)
    setOrders(prev =>
      prev.map(o =>
        o.id === order.id
          ? {
              ...o,
              payment_reference: audit.referenceNumber || o.payment_reference,
              payment_sender_bank: audit.bankOrPlatform || o.payment_sender_bank,
              payment_amount_reported:
                audit.amount > 0 ? audit.amount : o.payment_amount_reported,
              admin_notes: nextNotes,
            }
          : o
      )
    )
    setNotice({
      text: 'Referencia, banco y monto extraídos quedaron registrados en la orden.',
      tone: 'ok',
    })
  }

  const kpis = useMemo(() => {
    const pendingProof = orders.filter(
      o => o.payment_status === 'pendiente_verificacion' && o.order_status !== 'cancelado'
    ).length
    const readyToShip = orders.filter(
      o =>
        o.payment_status === 'verificado' &&
        (o.order_status === 'nuevo' || o.order_status === 'alistando' || o.order_status === 'despachado')
    ).length
    const verifiedRevenue = orders
      .filter(o => o.payment_status === 'verificado' && o.order_status !== 'cancelado')
      .reduce((acc, o) => acc + Number(o.total || 0), 0)
    return {
      totalCount: orders.length,
      pendingProof,
      readyToShip,
      verifiedRevenue,
    }
  }, [orders])

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter(o => {
      if (filterTab === 'pending_proof' && o.payment_status !== 'pendiente_verificacion') {
        return false
      }
      if (
        filterTab === 'verified' &&
        !(
          o.payment_status === 'verificado' &&
          (o.order_status === 'nuevo' || o.order_status === 'alistando' || o.order_status === 'despachado')
        )
      ) {
        return false
      }
      if (filterTab === 'completed' && o.order_status !== 'entregado') {
        return false
      }
      if (
        filterTab === 'issues' &&
        !(
          o.payment_status === 'observado' ||
          o.payment_status === 'rechazado' ||
          o.order_status === 'cancelado'
        )
      ) {
        return false
      }
      if (!q) return true
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.customer_document || '').toLowerCase().includes(q) ||
        o.customer_phone.toLowerCase().includes(q) ||
        (o.payment_reference || '').toLowerCase().includes(q) ||
        (o.payment_sender_bank || '').toLowerCase().includes(q)
      )
    })
  }, [orders, filterTab, search])

  async function ensureCustomerIdForOrder(order: CatalogOrder): Promise<string | null> {
    if (order.customer_id) return order.customer_id
    const { data: existing } = await supabase.from('customers').select('*')
    const list = (existing || []) as {
      id: string
      document?: string | null
      phone?: string | null
    }[]
    if (order.customer_document) {
      const byDoc = list.find(
        c =>
          (c.document || '').trim().toLowerCase() ===
          order.customer_document!.trim().toLowerCase()
      )
      if (byDoc) return byDoc.id
    }
    const cleanPhone = cleanWaPhone(order.customer_phone)
    if (cleanPhone) {
      const byPhone = list.find(c => cleanWaPhone(c.phone) === cleanPhone)
      if (byPhone) return byPhone.id
    }
    const { data: created } = await supabase
      .from('customers')
      .insert({
        name: order.customer_name,
        document: order.customer_document || null,
        phone: order.customer_phone || null,
        email: order.customer_email || null,
        address: order.delivery_address || null,
        price_type: order.customer_type === 'juridica' ? 'mayor' : 'detal',
      })
      .select('id')
      .maybeSingle()
    return (created as { id?: string } | null)?.id || null
  }

  async function updateOrderState(
    order: CatalogOrder,
    nextPaymentStatus: CatalogPaymentStatus,
    nextOrderStatus: CatalogOrderStatus,
    linkedSaleId?: string | null
  ) {
    const cleanNotes = adminNoteDraft.trim() || null
    const rpcRes = await supabase.rpc('gestionar_pedido_catalogo', {
      p_order_id: order.id,
      p_payment_status: nextPaymentStatus,
      p_order_status: nextOrderStatus,
      p_admin_notes: cleanNotes,
      p_sale_id: linkedSaleId ?? order.sale_id ?? null,
    })

    if (rpcRes.error) {
      // Fallback directo sobre tabla con RLS de empresa
      const upd = await supabase
        .from('catalog_orders')
        .update({
          payment_status: nextPaymentStatus,
          order_status: nextOrderStatus,
          admin_notes: cleanNotes,
          sale_id: linkedSaleId ?? order.sale_id ?? null,
          ...(nextPaymentStatus === 'verificado'
            ? {
                verified_by: user?.id || null,
                verified_by_name: user?.full_name || user?.email || 'Administración',
                verified_at: new Date().toISOString(),
              }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
      if (upd.error) throw new Error(upd.error.message)
    }

    await loadAll()
  }

  async function handleVerifyAndInvoice(order: CatalogOrder) {
    if (!canProcess || processing) return
    setProcessing(true)

    try {
      let saleId = order.sale_id

      // Si aún no tiene venta facturada, registrar la venta descontando stock real por presentación
      if (!saleId) {
        const custId = await ensureCustomerIdForOrder(order)
        const salePaymentMethod =
          order.payment_method === 'efectivo_entrega' ? 'efectivo' : 'transferencia'

        const saleItems = order.items.map(it => {
          const mult = it.stock_multiplier && it.stock_multiplier > 0 ? it.stock_multiplier : 1
          const baseUnitsQty = Math.round(it.quantity * mult * 1000) / 1000
          const effectiveUnitPrice =
            baseUnitsQty > 0
              ? Math.round((it.subtotal / baseUnitsQty) * 100) / 100
              : it.unit_price
          return {
            product_id: it.product_id,
            product_name: it.variant_label
              ? `${it.product_name} (${it.variant_label})`
              : it.product_name,
            quantity: baseUnitsQty,
            price: effectiveUnitPrice,
            subtotal: it.subtotal,
          }
        })

        if (targetWarehouseId && activeWarehouses.length > 0) {
          const whRes = await supabase.rpc('registrar_venta_bodega', {
            p_warehouse_id: targetWarehouseId,
            p_customer_id: custId,
            p_items: saleItems,
            p_payment_method: salePaymentMethod,
            p_total: order.total,
            p_channel: 'mostrador',
          })
          if (!whRes.error && whRes.data) {
            saleId =
              typeof whRes.data === 'string'
                ? whRes.data
                : String((whRes.data as { id?: unknown } | null)?.id || '')
          } else {
            const stdRes = await supabase.rpc('registrar_venta', {
              p_customer_id: custId,
              p_items: saleItems,
              p_payment_method: salePaymentMethod,
              p_total: order.total,
              p_channel: 'mostrador',
            })
            if (stdRes.error) throw new Error(stdRes.error.message)
            saleId =
              typeof stdRes.data === 'string'
                ? stdRes.data
                : String((stdRes.data as { id?: unknown } | null)?.id || '')
          }
        } else {
          const stdRes = await supabase.rpc('registrar_venta', {
            p_customer_id: custId,
            p_items: saleItems,
            p_payment_method: salePaymentMethod,
            p_total: order.total,
            p_channel: 'mostrador',
          })
          if (stdRes.error) throw new Error(stdRes.error.message)
          saleId =
            typeof stdRes.data === 'string'
              ? stdRes.data
              : String((stdRes.data as { id?: unknown } | null)?.id || '')
        }
      }

      const nextStatus: CatalogOrderStatus =
        order.order_status === 'nuevo' ? 'alistando' : order.order_status

      await updateOrderState(order, 'verificado', nextStatus, saleId)
      flash(
        `Pago corroborado y venta registrada para ${order.order_number}. El inventario y la caja quedaron actualizados.`
      )
    } catch (err) {
      flash(
        err instanceof Error ? err.message : 'No fue posible corroborar y facturar el pedido.',
        'err'
      )
    } finally {
      setProcessing(false)
    }
  }
  
  function flash(text: string, tone: 'ok' | 'err' = 'ok') {
    setNotice({ text, tone })
    window.setTimeout(() => {
      setNotice(prev => (prev?.text === text ? null : prev))
    }, 5000)
  }
    async function handleQuickStateChange(
    order: CatalogOrder,
    paymentStatus: CatalogPaymentStatus,
    orderStatus: CatalogOrderStatus,
    successMsg: string
  ) {
    if (!canProcess || processing) return
    setProcessing(true)
    try {
      await updateOrderState(order, paymentStatus, orderStatus)
      flash(successMsg)
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Error al actualizar el pedido.', 'err')
    } finally {
      setProcessing(false)
    }
  }

  function handleSendToPos(order: CatalogOrder) {
    setCatalogPosHandoff({
      customerId: order.customer_id,
      items: order.items.map(it => ({
        product_id: it.product_id,
        quantity: Math.max(
          1,
          Math.round(it.quantity * (it.stock_multiplier || 1))
        ),
      })),
    })
    if (onNavigate) onNavigate('pos')
  }

  function handlePrintOrderDoc(order: CatalogOrder) {
    const doc: DocData = {
      title: order.sale_id ? 'NOTA DE ENTREGA / FACTURA' : 'ORDEN DE CATÁLOGO',
      number: order.order_number,
      date: new Date(order.created_at).toLocaleDateString('es-ES'),
      extra: `${PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method}${
        order.payment_reference ? ` · Ref. #${order.payment_reference}` : ''
      } · ${PAYMENT_STATUS_META[order.payment_status]?.label || ''}`,
      partyName: order.customer_name,
      partyLines: [
        order.customer_type === 'juridica'
          ? `Persona Jurídica${order.requires_fiscal_invoice ? ' · Requiere Factura Fiscal' : ''}`
          : 'Persona Natural',
        order.customer_document && `RIF / Documento: ${order.customer_document}`,
        order.contact_person && `Contacto: ${order.contact_person}`,
        order.customer_phone && `Tel: ${order.customer_phone}`,
        order.delivery_address && `Entrega: ${order.delivery_address}`,
      ],
      lines: order.items.map(it => ({
        name: it.variant_label
          ? `${it.product_name} (${it.variant_label})`
          : it.product_name,
        quantity: it.quantity,
        price: it.unit_price,
        subtotal: it.subtotal,
      })),
      ...taxDocFields({
        subtotal: order.subtotal,
        tax_rate: order.tax_rate,
        tax_amount: order.tax_amount,
      }),
      total: order.total,
      footer:
        order.admin_notes ||
        `Orden generada desde el catálogo comercial de ${config?.name || 'la empresa'}.`,
    }
    printHtml(buildDocHtml(doc, config))
  }

  function buildBuyerWhatsAppHref(order: CatalogOrder): string | null {
    const digits = cleanWaPhone(order.customer_phone)
    if (!digits) return null
    const companyName = config?.name || user?.company_name || 'Nuestra Empresa'
    const formattedTotal = formatMoney(order.total, order.currency)
    const statusLabel = ORDER_STATUS_META[order.order_status]?.label || order.order_status

    let msg = ''
    if (order.order_status === 'despachado' || order.order_status === 'entregado') {
      msg = renderCompanyWhatsAppMessage('order_dispatched', {
        config,
        companyName,
        storeUrl: publicStoreUrl,
        customerName: order.customer_name,
        orderNumber: order.order_number,
        trackingPin: order.tracking_pin,
        orderTotalFormatted: formattedTotal,
        paymentReference: order.payment_reference,
        deliveryStatusLabel: `${statusLabel} (${DELIVERY_MODE_LABELS[order.delivery_mode] || 'Despacho'})`,
        adminNote:
          adminNoteDraft.trim() ||
          order.admin_notes ||
          'Gracias por tu preferencia. Puedes revisar tu comprobante en línea.',
      })
    } else if (order.payment_status === 'verificado') {
      msg = renderCompanyWhatsAppMessage('order_verified', {
        config,
        companyName,
        storeUrl: publicStoreUrl,
        customerName: order.customer_name,
        orderNumber: order.order_number,
        trackingPin: order.tracking_pin,
        orderTotalFormatted: formattedTotal,
        paymentReference: order.payment_reference,
        deliveryStatusLabel: statusLabel,
        adminNote: adminNoteDraft.trim() || order.admin_notes || '',
      })
    } else if (order.payment_status === 'observado') {
      msg = [
        `Hola *${order.customer_name}*, te escribimos de *${companyName}*.`,
        `Revisamos el comprobante del pedido *${order.order_number}* (${formattedTotal}) y requerimos validar un detalle: ${
          adminNoteDraft.trim() ||
          'Por favor confírmanos el número de referencia o envíanos el capture legible.'
        }`,
        `Enlace oficial de nuestra tienda:\n${publicStoreUrl}`,
      ].join('\n\n')
    } else {
      msg = [
        `Hola *${order.customer_name}*, te escribimos de *${companyName}*.`,
        `Te contactamos respecto a tu orden *${order.order_number}* por *${formattedTotal}*.`,
        order.tracking_pin
          ? `Puedes consultar el estado en vivo con tu código *${order.order_number}* y PIN *${order.tracking_pin}* en:\n${publicStoreUrl}`
          : publicStoreUrl,
      ]
        .filter(Boolean)
        .join('\n\n')
    }

    return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`
  }

  async function copyStoreLink() {
    const ok = await copyToClipboard(publicStoreUrl)
    if (ok) {
      setCopiedLink(true)
      window.setTimeout(() => setCopiedLink(false), 2400)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-16">
      {schemaMissing && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Tabla `catalog_orders` pendiente en Supabase:</strong> ejecuta el paquete SQL actualizado para recibir pedidos con presentaciones y captures de pago en tiempo real.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('sqlcenter')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 whitespace-nowrap"
              >
                <Database className="w-3.5 h-3.5" />
                Ir a Scripts SQL
              </button>
            )}
            <button
              type="button"
              onClick={() => setSqlModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-slate-800 font-medium hover:bg-amber-100 whitespace-nowrap"
            >
              Ver SQL
            </button>
          </div>
        </div>
      )}

      {/* Encabezado Ejecutivo */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span className={`font-semibold ${brand.accentText}`}>
                {config?.name || user?.company_name || 'Empresa'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Ventas Autogestionadas B2B y B2C</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Pedidos de Catálogo y Corroboración de Pagos
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Revisa los captures de Pago Móvil, Nequi, Zelle o transferencia adjuntados por tus clientes, corrobora el ingreso y factura la venta en un clic.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canConfigureBrand && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setBrandModalTab('brand')
                    setBrandModalOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                >
                  <Palette className="w-3.5 h-3.5 text-slate-600" />
                  Logo, Color y Cuentas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBrandModalTab('whatsapp')
                    setBrandModalOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                  Enlace y WhatsApp
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => void copyStoreLink()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Globe className="w-3.5 h-3.5 text-slate-500" />
              )}
              {copiedLink ? 'Enlace copiado' : 'Copiar link tienda'}
            </button>

            {onPreviewCatalog && companyId && (
              <button
                type="button"
                onClick={() => onPreviewCatalog(config?.catalog_slug || companyId)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${brand.primaryBtn}`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir tienda cliente
              </button>
            )}

            <button
              type="button"
              onClick={() => void loadAll()}
              title="Actualizar bandeja"
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
            {/* KPIs Operativos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Por corroborar capture</p>
          <p className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">
            {kpis.pendingProof}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Comprobantes esperando revisión
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Pagos corroborados / Alistando</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {kpis.readyToShip}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Listos para despacho o retiro
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Ventas verificadas por catálogo</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
            {moneyBase(kpis.verifiedRevenue)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Ingresos corroborados en bandeja
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Órdenes recibidas</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {kpis.totalCount}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Personas naturales y jurídicas
          </p>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            notice.tone === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Barra de búsqueda por referencia bancaria / cliente y filtros */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar #WEB, cliente, RIF/Cédula o N° referencia..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'all', label: `Todos (${orders.length})` },
              { id: 'pending_proof', label: `Por verificar (${kpis.pendingProof})` },
              { id: 'verified', label: `En despacho (${kpis.readyToShip})` },
              { id: 'completed', label: 'Entregados' },
              { id: 'issues', label: 'Observados' },
            ] as { id: FilterTab; label: string }[]
          ).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilterTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                filterTab === t.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mesa dividida: Cola de pedidos izquierda + Inspector de Capture derecha */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          Cargando bandeja de pedidos del catálogo...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">
            No hay pedidos en este filtro
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Comparte el enlace de tu catálogo digital con tus clientes para que elijan productos, tallas o presentaciones y adjunten su capture de pago.
          </p>
          {onPreviewCatalog && companyId && (
            <button
              type="button"
              onClick={() => onPreviewCatalog(config?.catalog_slug || companyId)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Simular compra como cliente
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Lista de Órdenes (5 columnas) */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
            {filteredOrders.map(ord => {
              const isSelected = selectedOrder?.id === ord.id
              const payMeta = PAYMENT_STATUS_META[ord.payment_status]
              const ordMeta = ORDER_STATUS_META[ord.order_status]

              return (
                <button
                  key={ord.id}
                  type="button"
                  onClick={() => setSelectedOrderId(ord.id)}
                  className={`w-full p-4 text-left transition-colors block ${
                    isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-bold text-slate-900 tabular-nums shrink-0">
                        {ord.order_number}
                      </span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500 truncate">
                        {ord.customer_type === 'juridica' ? 'Jurídica' : 'Natural'}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                      {formatMoney(ord.total, ord.currency)}
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-slate-800 truncate mt-1">
                    {ord.customer_name}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-1.5">
                    <span className={`font-semibold ${payMeta?.toneClass || 'text-slate-600'}`}>
                      {payMeta?.label || ord.payment_status}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-slate-600">
                      {PAYMENT_METHOD_LABELS[ord.payment_method] || ord.payment_method}
                    </span>
                    {ord.payment_reference && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="font-mono text-slate-500 tabular-nums">
                          #{ord.payment_reference}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 tabular-nums">
                    <span>{ordMeta?.label || ord.order_status}</span>
                    <span>
                      {new Date(ord.created_at).toLocaleString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Inspector de Orden y Capture de Pago (7 columnas) */}
          <div className="lg:col-span-7">
            {selectedOrder ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
                {/* Encabezado del expediente */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {selectedOrder.order_number}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        PIN cliente: {selectedOrder.tracking_pin}
                      </span>
                      {selectedOrder.sale_id && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 font-semibold">
                            Venta facturada
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mt-1 flex items-center gap-2">
                      {selectedOrder.customer_type === 'juridica' ? (
                        <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                      ) : (
                        <User className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <span>{selectedOrder.customer_name}</span>
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 mt-1 tabular-nums">
                      <span>
                        {selectedOrder.customer_type === 'juridica'
                          ? 'Persona Jurídica'
                          : 'Persona Natural'}
                      </span>
                      {selectedOrder.customer_document && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Doc/RIF: {selectedOrder.customer_document}</span>
                        </>
                      )}
                      {selectedOrder.requires_fiscal_invoice && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-800">
                            Solicita Factura Fiscal
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>Tel: {selectedOrder.customer_phone}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePrintOrderDoc(selectedOrder)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Imprimir orden
                    </button>
                    {buildBuyerWhatsAppHref(selectedOrder) && (
                      <a
                        href={buildBuyerWhatsAppHref(selectedOrder)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        WhatsApp cliente
                      </a>
                    )}
                  </div>
                </div>

                {/* Sección central: Visor de Capture de Pago + Conciliación de Monto */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Datos de pago reportados */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 flex items-center gap-1.5">
                        <FileCheck2 className="w-4 h-4 text-slate-600" />
                        Auditoría del pago
                      </span>
                                            <span
                        className={`font-semibold ${
                          PAYMENT_STATUS_META[selectedOrder.payment_status]?.toneClass || ''
                        }`}
                      >
                        {PAYMENT_STATUS_META[selectedOrder.payment_status]?.label}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-slate-700 tabular-nums">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">Canal elegido:</span>
                        <strong>
                          {PAYMENT_METHOD_LABELS[selectedOrder.payment_method] ||
                            selectedOrder.payment_method}
                        </strong>
                      </div>
                      {selectedOrder.payment_sender_bank && (
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-500">Banco / Origen:</span>
                          <strong>{selectedOrder.payment_sender_bank}</strong>
                        </div>
                      )}
                      {selectedOrder.payment_reference && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">N° Referencia:</span>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await copyToClipboard(
                                  selectedOrder.payment_reference || ''
                                )
                                if (ok) {
                                  setCopiedRef(true)
                                  window.setTimeout(() => setCopiedRef(false), 2000)
                                }
                              }}
                              className="inline-flex items-center gap-1 font-mono font-bold text-slate-900 hover:underline"
                            >
                              #{selectedOrder.payment_reference}
                              {copiedRef ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3 text-slate-400" />
                              )}
                            </button>
                          </div>
                          {(() => {
                            const dupes = findDuplicateOrdersForReference(
                              selectedOrder.id,
                              selectedOrder.payment_reference
                            )
                            if (dupes.length === 0) return null
                            return (
                              <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-800 flex items-start gap-1.5">
                                <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                                <span>
                                  <strong>Alerta de referencia repetida:</strong> ya aparece en{' '}
                                  {dupes.map(d => `${d.order_number} (${d.customer_name})`).join(', ')}.
                                </span>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                      <div className="flex justify-between gap-2 pt-1 border-t border-slate-200">
                        <span className="text-slate-500">Total orden:</span>
                        <strong className="text-sm text-slate-900">
                          {formatMoney(selectedOrder.total, selectedOrder.currency)}
                        </strong>
                      </div>
                      {selectedOrder.fx_currency && selectedOrder.fx_total && (
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-500">
                            Equivalente ({selectedOrder.fx_currency}):
                          </span>
                          <strong>
                            {formatMoney(selectedOrder.fx_total, selectedOrder.fx_currency)}
                          </strong>
                        </div>
                      )}
                      {selectedOrder.verified_by_name && selectedOrder.verified_at && (
                        <p className="text-[11px] text-emerald-700 pt-1">
                          Corroborado por {selectedOrder.verified_by_name} el{' '}
                          {new Date(selectedOrder.verified_at).toLocaleString('es-ES')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Miniatura / Visor del Capture + Acciones de Escaneo OCR */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900">
                        Capture / Recibo adjunto
                      </span>
                      <div className="flex items-center gap-2">
                        {selectedOrder.payment_proof_url && (
                          <button
                            type="button"
                            onClick={() => setZoomProofUrl(selectedOrder.payment_proof_url)}
                            className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:underline"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Ampliar
                          </button>
                        )}
                      </div>
                    </div>

                    {selectedOrder.payment_proof_url ? (
                      <button
                        type="button"
                        onClick={() => setZoomProofUrl(selectedOrder.payment_proof_url)}
                        className="relative group rounded-lg overflow-hidden border border-slate-300 bg-white h-40 flex items-center justify-center focus:outline-none"
                      >
                        <img
                          src={selectedOrder.payment_proof_url}
                          alt={`Capture ${selectedOrder.order_number}`}
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain"
                        />
                        <span className="absolute inset-0 bg-slate-900/45 text-white text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                          <Eye className="w-4 h-4" />
                          Inspeccionar recibo en grande
                        </span>
                      </button>
                    ) : (
                      <div className="h-40 rounded-lg border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-center p-4">
                        <p className="text-xs font-medium text-slate-600">
                          Sin capture adjunto
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {selectedOrder.payment_method === 'efectivo_entrega'
                            ? 'El comprador eligió cancelar al recibir la mercancía.'
                            : 'Puedes subir el pantallazo recibido por WhatsApp para archivarlo y auditarlo.'}
                        </p>
                      </div>
                    )}

                    {/* Botones OCR para auditar el capture actual o digitalizar uno nuevo */}
                    <input
                      ref={ocrFileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (f && selectedOrder) {
                          void handleUploadAndAuditProof(selectedOrder, f)
                        }
                      }}
                    />

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {selectedOrder.payment_proof_url && (
                        <button
                          type="button"
                          disabled={auditingOrderId === selectedOrder.id}
                          onClick={() => void handleAuditAttachedProof(selectedOrder)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          {auditingOrderId === selectedOrder.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Leyendo comprobante...
                            </>
                          ) : (
                            <>
                              <ScanLine className="w-3.5 h-3.5" />
                              Auditar capture (OCR)
                            </>
                          )}
                        </button>
                      )}

                      {canProcess && (
                        <button
                          type="button"
                          disabled={auditingOrderId === selectedOrder.id}
                          onClick={() => ocrFileInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {selectedOrder.payment_proof_url
                            ? 'Reemplazar / PDF'
                            : 'Subir y auditar capture'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Panel de Resultado OCR y Validación Anti-Fraude */}
                {(auditErrorByOrderId[selectedOrder.id] || auditByOrderId[selectedOrder.id]) && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    {auditErrorByOrderId[selectedOrder.id] && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center justify-between gap-2">
                        <span>{auditErrorByOrderId[selectedOrder.id]}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setAuditErrorByOrderId(prev => ({
                              ...prev,
                              [selectedOrder.id]: '',
                            }))
                          }
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {(() => {
                      const audit = auditByOrderId[selectedOrder.id]
                      if (!audit) return null

                      const dupes = findDuplicateOrdersForReference(
                        selectedOrder.id,
                        audit.referenceNumber
                      )
                      const compareTarget =
                        selectedOrder.fx_currency &&
                        selectedOrder.fx_total &&
                        (!audit.currencyHint ||
                          audit.currencyHint === selectedOrder.fx_currency.toUpperCase())
                          ? {
                              expected: selectedOrder.fx_total,
                              currency: selectedOrder.fx_currency,
                            }
                          : {
                              expected: selectedOrder.total,
                              currency: selectedOrder.currency,
                            }

                      const diff = Math.round((audit.amount - compareTarget.expected) * 100) / 100
                      const tolerance = Math.max(1, compareTarget.expected * 0.01)
                      const amountMatches = audit.amount > 0 && Math.abs(diff) <= tolerance

                      const isApproved = audit.transactionStatus === 'aprobada'
                      const allClear = isApproved && amountMatches && dupes.length === 0

                      return (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                            <div className="flex items-center gap-2">
                              {allClear ? (
                                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                              ) : (
                                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                              )}
                              <span className="text-xs font-bold text-slate-900">
                                Auditoría Óptica del Comprobante
                              </span>
                            </div>

                            <span
                              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md border ${
                                audit.transactionStatus === 'aprobada'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  : audit.transactionStatus === 'pendiente'
                                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                                    : 'bg-red-50 border-red-200 text-red-700'
                              }`}
                            >
                              Estado leído: {audit.transactionStatus.toUpperCase()} · Confianza{' '}
                              {audit.confidence}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                              <span className="text-[11px] text-slate-500 block">
                                Entidad / Plataforma
                              </span>
                              <strong className="text-slate-900">
                                {audit.bankOrPlatform || 'No detectado'}
                              </strong>
                            </div>

                            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                              <span className="text-[11px] text-slate-500 block">
                                Referencia leída
                              </span>
                              <strong className="font-mono text-slate-900">
                                {audit.referenceNumber ? `#${audit.referenceNumber}` : 'Sin ref.'}
                              </strong>
                            </div>

                            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                              <span className="text-[11px] text-slate-500 block">
                                Monto en capture
                              </span>
                              <strong
                                className={`tabular-nums ${
                                  amountMatches ? 'text-emerald-700' : 'text-amber-700'
                                }`}
                              >
                                {audit.amount > 0
                                  ? formatMoney(
                                      audit.amount,
                                      audit.currencyHint || compareTarget.currency
                                    )
                                  : 'No legible'}
                              </strong>
                              <span className="block text-[10px] text-slate-500 tabular-nums mt-0.5">
                                {amountMatches
                                  ? 'Coincide con el pedido'
                                  : audit.amount > 0
                                    ? `Dif: ${diff > 0 ? '+' : ''}${formatMoney(
                                        diff,
                                        compareTarget.currency
                                      )}`
                                    : 'Verifica manualmente'}
                              </span>
                            </div>

                            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                              <span className="text-[11px] text-slate-500 block">
                                Fecha / Destino
                              </span>
                              <strong className="text-slate-900">
                                {audit.transactionDate || 'Sin fecha'}
                              </strong>
                              {audit.recipientHint && (
                                <span className="block text-[10px] text-slate-500 truncate mt-0.5">
                                  A: {audit.recipientHint}
                                </span>
                              )}
                            </div>
                          </div>

                          {dupes.length > 0 ? (
                            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-800 flex items-start gap-2">
                              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold">
                                  Posible comprobante reutilizado: la referencia #
                                  {audit.referenceNumber} ya existe en otro pedido
                                </p>
                                <p className="text-[11px] mt-0.5">
                                  Pedidos con la misma referencia:{' '}
                                  {dupes
                                    .map(
                                      d =>
                                        `${d.order_number} (${d.customer_name} · ${new Date(
                                          d.created_at
                                        ).toLocaleDateString('es-ES')})`
                                    )
                                    .join(' | ')}
                                </p>
                              </div>
                            </div>
                          ) : (
                            audit.referenceNumber && (
                              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span>
                                  Referencia <strong>#{audit.referenceNumber}</strong> única: no ha
                                  sido utilizada en ningún otro pedido activo.
                                </span>
                              </div>
                            )
                          )}

                          {audit.alertNotes && (
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              <strong>Observación óptica:</strong> {audit.alertNotes}
                            </p>
                          )}

                          {canProcess && (
                            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                disabled={processing}
                                onClick={() => void handleApplyAuditToOrder(selectedOrder, audit)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold"
                              >
                                <FileCheck2 className="w-3.5 h-3.5" />
                                Aplicar referencia y datos leídos al pedido
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Detalle de Productos y Cualidades Solicitadas */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">
                      Productos y cualidades elegidas ({selectedOrder.items.length})
                    </span>
                    <span className="text-slate-500">
                      {DELIVERY_MODE_LABELS[selectedOrder.delivery_mode]}
                      {selectedOrder.delivery_address
                        ? ` · ${selectedOrder.delivery_address}`
                        : ''}
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left px-3.5 py-2.5 font-semibold">
                            Producto / Presentación
                          </th>
                          <th className="text-right px-3.5 py-2.5 font-semibold">Cant.</th>
                          <th className="text-right px-3.5 py-2.5 font-semibold">Unitario</th>
                          <th className="text-right px-3.5 py-2.5 font-semibold">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedOrder.items.map((it, idx) => (
                          <tr key={idx}>
                            <td className="px-3.5 py-2.5">
                              <p className="font-semibold text-slate-900">{it.product_name}</p>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                {it.variant_label && (
                                  <span className="font-medium text-slate-700">
                                    Cualidad: {it.variant_label}
                                  </span>
                                )}
                                {it.sku && <span className="font-mono">SKU {it.sku}</span>}
                                {it.stock_multiplier && it.stock_multiplier !== 1 && (
                                  <span className="tabular-nums">
                                    (Descuenta{' '}
                                    {Math.round(it.quantity * it.stock_multiplier * 100) / 100}{' '}
                                    und. base)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">
                              {it.quantity}
                            </td>
                            <td className="px-3.5 py-2.5 text-right text-slate-600 tabular-nums">
                              {formatMoney(it.unit_price, selectedOrder.currency)}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-bold text-slate-900 tabular-nums">
                              {formatMoney(it.subtotal, selectedOrder.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {selectedOrder.customer_notes && (
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2">
                      <strong className="text-slate-800">Nota del cliente:</strong>{' '}
                      {selectedOrder.customer_notes}
                    </p>
                  )}
                </div>
                                {/* Controles de Corroboración, Facturación y Despacho */}
                {canProcess && (
                  <div className="pt-3 border-t border-slate-200 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Nota de verificación (visible al rastrear el pedido)
                        </label>
                        <input
                          value={adminNoteDraft}
                          onChange={e => setAdminNoteDraft(e.target.value)}
                          placeholder="Ej. Pago Móvil verificado en Banesco. Despacho sale 2:00 PM."
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                        />
                      </div>

                      {!selectedOrder.sale_id && activeWarehouses.length > 0 && (
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Bodega de salida al facturar
                          </label>
                          <select
                            value={targetWarehouseId}
                            onChange={e => setTargetWarehouseId(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                          >
                            {activeWarehouses.map(w => (
                              <option key={w.id} value={w.id}>
                                {w.name} {w.code ? `(${w.code})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {selectedOrder.payment_status !== 'verificado' || !selectedOrder.sale_id ? (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleVerifyAndInvoice(selectedOrder)}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {processing
                            ? 'Procesando...'
                            : 'Corroborar pago y facturar venta'}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                          <ClipboardCheck className="w-4 h-4" />
                          Pago corroborado y venta emitida
                        </span>
                      )}

                      {selectedOrder.payment_status !== 'verificado' && (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() =>
                            void handleQuickStateChange(
                              selectedOrder,
                              'observado',
                              selectedOrder.order_status,
                              'Pedido marcado con observación en el pago.'
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold whitespace-nowrap"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Observar capture
                        </button>
                      )}

                      {selectedOrder.order_status !== 'despachado' &&
                        selectedOrder.order_status !== 'entregado' &&
                        selectedOrder.order_status !== 'cancelado' && (
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() =>
                              void handleQuickStateChange(
                                selectedOrder,
                                selectedOrder.payment_status,
                                'despachado',
                                'Orden marcada como despachada / en ruta.'
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold whitespace-nowrap"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            Marcar en ruta
                          </button>
                        )}

                      {selectedOrder.order_status !== 'entregado' &&
                        selectedOrder.order_status !== 'cancelado' && (
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() =>
                              void handleQuickStateChange(
                                selectedOrder,
                                selectedOrder.payment_status,
                                'entregado',
                                'Orden marcada como entregada al cliente.'
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold whitespace-nowrap"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Marcar entregado
                          </button>
                        )}

                      {!selectedOrder.sale_id && onNavigate && (
                        <button
                          type="button"
                          onClick={() => handleSendToPos(selectedOrder)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium whitespace-nowrap"
                        >
                          <Store className="w-3.5 h-3.5" />
                          Abrir en POS
                        </button>
                      )}

                      {!selectedOrder.sale_id && selectedOrder.order_status !== 'cancelado' && (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() =>
                            void handleQuickStateChange(
                              selectedOrder,
                              'rechazado',
                              'cancelado',
                              'Pedido rechazado y cancelado.'
                            )
                          }
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 text-xs font-medium whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Rechazar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-400">
                Selecciona una orden a la izquierda para revisar su capture de pago.
              </div>
            )}
          </div>
        </div>
      )}
            {/* Visor a pantalla completa del Capture de Pago */}
      {zoomProofUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
          onClick={() => setZoomProofUrl(null)}
        >
          <div
            className="relative max-w-2xl w-full bg-white rounded-xl overflow-hidden border border-slate-200 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">
                Inspección de comprobante de pago · {selectedOrder?.order_number}
              </span>
              <button
                type="button"
                onClick={() => setZoomProofUrl(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-900 flex items-center justify-center max-h-[80vh] overflow-auto">
              <img
                src={zoomProofUrl}
                alt="Comprobante ampliado"
                referrerPolicy="no-referrer"
                className="max-h-[74vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}

      <CatalogBrandModal
        open={brandModalOpen}
        initialTab={brandModalTab}
        onClose={() => setBrandModalOpen(false)}
        onSaved={patch => {
          setConfig(prev => (prev ? { ...prev, ...patch } : prev))
        }}
      />

      <SqlActivationModal open={sqlModalOpen} onClose={() => setSqlModalOpen(false)} />
    </div>
  )
}
