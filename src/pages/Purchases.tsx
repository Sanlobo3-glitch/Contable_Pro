import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  useAuth,
  isReadOnly,
  canRegisterPurchases,
  canVoidPurchases,
  canClassifyPurchaseVat,
  canViewPayables,
} from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import { downloadCsv } from '../lib/csv'
import { consumePurchaseDraft } from '../lib/purchaseDraft'
import PurchaseInvoiceScannerModal from '../components/PurchaseInvoiceScannerModal'
import type {
  Product,
  Supplier,
  Purchase,
  PurchaseTaxStatus,
  PurchaseIvaAdjustment,
  CompanyConfig,
} from '../types'
import {
  Plus,
  X,
  Trash2,
  Truck,
  Lock,
  Ban,
  Receipt,
  Share2,
  Printer,
  MessageCircle,
  Mail,
  Download,
  ScanLine,
  Search,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'

type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'credito'

type CartItem = {
  product_id: string
  product_name: string
  quantity: number
  cost: number
  subtotal: number
  lot_code?: string
  expiry_date?: string
}

const TAX_STATUS_META: Record<
  PurchaseTaxStatus,
  { label: string; short: string; cls: string; hint: string }
> = {
  sin_iva: {
    label: 'Sin IVA / Excluida',
    short: 'Sin IVA',
    cls: 'text-slate-600 bg-slate-100 border-slate-200',
    hint: 'Compra sin impuesto o proveedor no responsable de IVA.',
  },
  descontable: {
    label: 'IVA Descontable',
    short: 'Descontable',
    cls: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    hint: 'El IVA va a cuenta 2408xx descontable (Casilla 74 F300) y NO entra al costo del inventario.',
  },
  pendiente: {
    label: 'IVA Pendiente por clasificar',
    short: 'Pendiente',
    cls: 'text-amber-800 bg-amber-50 border-amber-200',
    hint: 'El IVA queda temporalmente por clasificar; el contador o administrador lo define luego como descontable o al costo.',
  },
  costo: {
    label: 'IVA al Costo / Mayor valor',
    short: 'Al costo',
    cls: 'text-indigo-800 bg-indigo-50 border-indigo-200',
    hint: 'El IVA NO es descontable y se suma al costo unitario e inventario del producto.',
  },
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const PAYMENT_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito (por pagar)',
}

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const addDaysDate = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + (Number.isFinite(days) ? days : 0))
  return d.toLocaleDateString()
}

function buildPurchaseDoc(p: Purchase, s: Supplier | undefined): DocData {
  const method = p.payment_method || 'efectivo'
  const extraDue = method === 'credito' && p.due_date
    ? `Vence: ${new Date(p.due_date + 'T00:00:00').toLocaleDateString()}`
    : undefined

  return {
    title: 'COMPROBANTE DE COMPRA',
    number: 'CMP-' + p.id.slice(0, 8).toUpperCase(),
    date: p.created_at ? new Date(p.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—',
    extra: extraDue,
    badge: p.status === 'anulada' ? 'ANULADA' : undefined,
    partyRoleLabel: 'Proveedor',
    unitColLabel: 'Costo',
    partyName: p.supplier_name || 'Proveedor general',
    partyLines: [
      s?.document && `Documento: ${s.document}`,
      s?.phone && `Tel: ${s.phone}`,
      s?.email,
      s?.address,
    ],
    paymentLabel: `Condición de pago: ${PAYMENT_LABEL[method] ?? method}`,
    lines: (p.items || []).map(it => {
      const lotSuffix = it.expiry_date
        ? ` (${it.lot_code ? `Lote ${it.lot_code} · ` : ''}Vence ${new Date(it.expiry_date + 'T00:00:00').toLocaleDateString()})`
        : ''
      return {
        name: `${it.product_name}${lotSuffix}`,
        quantity: Number(it.quantity) || 0,
        price: Number(it.cost) || 0,
        subtotal: Number(it.subtotal) || (Number(it.quantity) || 0) * (Number(it.cost) || 0),
      }
    }),
    total: Number(p.total) || 0,
    footer: 'Registro interno de recepción de mercancía.',
  }
}

export default function Purchases({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()

  const baseReadOnly = isReadOnly(user)
  const canCreatePurchase = !baseReadOnly && canRegisterPurchases(user?.role)
  const canVoidPurchase = !baseReadOnly && canVoidPurchases(user?.role)
  const canOpenPayables = canViewPayables(user?.role)
  const readOnly = !canCreatePurchase
  const canClassifyVat = !baseReadOnly && canClassifyPurchaseVat(user?.role)

  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [supplierTerms, setSupplierTerms] = useState<Record<string, number>>({})
  const [showForm, setShowForm] = useState(false)
  const [showInvoiceScanner, setShowInvoiceScanner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null)
  const [cancelErr, setCancelErr] = useState('')
  const [viewTarget, setViewTarget] = useState<Purchase | null>(null)
  const [viewAdjustments, setViewAdjustments] = useState<PurchaseIvaAdjustment[]>([])
  const [loadingAdj, setLoadingAdj] = useState(false)
  const [classifyTarget, setClassifyTarget] = useState<Purchase | null>(null)
  const [classifyNewStatus, setClassifyNewStatus] = useState<'descontable' | 'costo'>('descontable')
  const [classifyReason, setClassifyReason] = useState('')
  const [classifying, setClassifying] = useState(false)
  const [classifyErr, setClassifyErr] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [taxFilter, setTaxFilter] = useState<'all' | PurchaseTaxStatus>('all')
  const [notice, setNotice] = useState('')
  const [draftNotice, setDraftNotice] = useState('')
  const [formErr, setFormErr] = useState('')

  const [cart, setCart] = useState<CartItem[]>([])
  const [selProduct, setSelProduct] = useState('')
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo')
  const [creditDays, setCreditDays] = useState('30')
  const [lotCode, setLotCode] = useState('')
  const [expiry, setExpiry] = useState('')

  const [taxStatus, setTaxStatus] = useState<PurchaseTaxStatus>('sin_iva')
  const [taxRate, setTaxRate] = useState('19')
  const [taxIncluded, setTaxIncluded] = useState(false)
  const [customTax, setCustomTax] = useState('')

  useEffect(() => {
    void load()
  }, [])

  function flash(msg: string) {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 6000)
  }

  async function load() {
    setLoading(true)

    try {
      const [
        { data: purchaseData, error: purchaseError },
        { data: productData, error: productError },
        { data: supplierData, error: supplierError },
        termsRes,
        cfgRes,
      ] = await Promise.all([
        supabase.from('purchases').select('*').order('created_at', { ascending: false }),
        supabase.from('products').select('*').order('name'),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('supplier_credit').select('supplier_id, credit_days'),
        supabase.from('company_config').select('*').limit(1),
      ])

      if (purchaseError) throw purchaseError
      if (productError) throw productError
      if (supplierError) throw supplierError

      const loadedPurchases = (purchaseData || []) as Purchase[]
      const loadedProducts = (productData || []) as Product[]
      const loadedSuppliers = (supplierData || []) as Supplier[]

      setPurchases(loadedPurchases)
      setProducts(loadedProducts)
      setSuppliers(loadedSuppliers)
      setConfig(((cfgRes.data || [])[0] as CompanyConfig) ?? null)

      const termsMap: Record<string, number> = {}
      if (!termsRes.error && Array.isArray(termsRes.data)) {
        for (const r of termsRes.data as { supplier_id: string; credit_days: number }[]) {
          if (r.supplier_id && Number.isFinite(Number(r.credit_days))) {
            termsMap[r.supplier_id] = Number(r.credit_days)
          }
        }
        setSupplierTerms(termsMap)
      }

      // Si viene un borrador desde Sugerencia de compras, cargarlo directamente
      const draft = consumePurchaseDraft()
      if (draft && !readOnly && draft.items.length > 0) {
        let matchedSupplier = draft.supplier_id || ''
        if (!matchedSupplier && draft.supplier_name) {
          const byName = loadedSuppliers.find(s => s.name.toLowerCase() === draft.supplier_name!.toLowerCase())
          if (byName) matchedSupplier = byName.id
        }
        setSupplierId(matchedSupplier)
        if (matchedSupplier && termsMap[matchedSupplier] !== undefined) {
          setCreditDays(String(termsMap[matchedSupplier]))
        }
        setCart(
          draft.items.map(it => {
            const p = loadedProducts.find(x => x.id === it.product_id)
            const q = Math.max(1, Math.round(Number(it.quantity) || 1))
            const c = Number.isFinite(Number(it.cost)) && Number(it.cost) >= 0 ? Number(it.cost) : Number(p?.cost) || 0
            return {
              product_id: it.product_id,
              product_name: p?.name || it.product_name,
              quantity: q,
              cost: c,
              subtotal: Math.round(q * c * 100) / 100,
            }
          })
        )
        setDraftNotice('Pedido cargado desde Sugerencia de compras. Verifica las cantidades y costos reales de tu factura antes de guardar.')
        setShowForm(true)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError('Error al cargar las compras: ' + message)
    } finally {
      setLoading(false)
    }
  }

  function handleSupplierChange(id: string) {
    setSupplierId(id)
    if (id && supplierTerms[id] !== undefined) {
      setCreditDays(String(supplierTerms[id]))
    }
  }

  function handleProductSelect(id: string) {
    setSelProduct(id)
    const prod = products.find(p => p.id === id)
    if (prod) {
      setCost(prod.cost > 0 ? String(prod.cost) : '0')
    } else {
      setCost('')
    }
    setLotCode('')
    setExpiry('')
  }

  function addToCart() {
    if (readOnly || saving) return
    setFormErr('')

    if (!selProduct) {
      setFormErr('Selecciona un producto.')
      return
    }

    const product = products.find(p => p.id === selProduct)
    if (!product) {
      setFormErr('No se encontró el producto seleccionado. Actualiza la página.')
      return
    }

    const quantity = Number(qty)
    const unitCost = Number(cost)

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setFormErr('La cantidad debe ser un número entero mayor que cero.')
      return
    }

    if (cost.trim() === '' || !Number.isFinite(unitCost) || unitCost < 0) {
      setFormErr('Introduce un costo válido, igual o mayor que cero.')
      return
    }

    const tracked = product.tracks_expiry === true
    if (tracked) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        setFormErr('Este producto maneja vencimiento: indica la fecha de vencimiento del lote.')
        return
      }
      if (expiry < localToday()) {
        setFormErr('La fecha de vencimiento ya pasó.')
        return
      }
    }

    setCart(previous => [
      ...previous,
      {
        product_id: product.id,
        product_name: product.name,
        quantity,
        cost: unitCost,
        subtotal: Math.round(unitCost * quantity * 100) / 100,
        ...(tracked ? { lot_code: lotCode.trim().slice(0, 40), expiry_date: expiry } : {}),
      },
    ])

    setSelProduct('')
    setQty('1')
    setCost('')
    setLotCode('')
    setExpiry('')
  }

  function updateCartItem(index: number, patch: Partial<CartItem>) {
    if (readOnly || saving) return
    setCart(prev =>
      prev.map((item, i) => {
        if (i !== index) return item
        const next = { ...item, ...patch }
        next.subtotal = Math.round(next.quantity * next.cost * 100) / 100
        return next
      })
    )
  }

  function removeFromCart(index: number) {
    if (readOnly || saving) return
    setCart(previous => previous.filter((_, i) => i !== index))
  }

  const itemsSum = round2(cart.reduce((sum, item) => sum + item.subtotal, 0))
  const parsedRate = Math.max(0, Math.min(100, Number(taxRate) || 0))
  const hasCustomTax = customTax.trim() !== ''
  const computedVat =
    taxStatus === 'sin_iva'
      ? 0
      : hasCustomTax
        ? Number.isFinite(Number(customTax)) && Number(customTax) >= 0
          ? round2(Number(customTax))
          : 0
        : parsedRate > 0 && itemsSum > 0
          ? taxIncluded
            ? round2(itemsSum - itemsSum / (1 + parsedRate / 100))
            : round2(itemsSum * (parsedRate / 100))
          : 0

  const computedTotal =
    taxStatus === 'sin_iva'
      ? itemsSum
      : taxIncluded
        ? itemsSum
        : round2(itemsSum + computedVat)

  const computedSubtotal =
    taxStatus === 'sin_iva'
      ? itemsSum
      : taxIncluded
        ? round2(Math.max(0, computedTotal - computedVat))
        : itemsSum

  const recognizedInventoryCost =
    taxStatus === 'costo' ? computedTotal : computedSubtotal

  async function handleSubmit() {
    if (readOnly || saving) return
    setFormErr('')

    if (cart.length === 0) {
      setFormErr('Agrega al menos un producto a la compra.')
      return
    }

    if (paymentMethod === 'credito') {
      if (!supplierId) {
        setFormErr('Para registrar una compra a crédito debes seleccionar un proveedor registrado.')
        return
      }
      const d = Number(creditDays)
      if (!Number.isInteger(d) || d < 0 || d > 365) {
        setFormErr('Los días de plazo deben ser un número entero entre 0 y 365.')
        return
      }
    }

    if (taxStatus !== 'sin_iva') {
      if (hasCustomTax && (!Number.isFinite(Number(customTax)) || Number(customTax) < 0)) {
        setFormErr('El valor manual del IVA debe ser un número válido mayor o igual a 0.')
        return
      }
      if (!Number.isFinite(Number(taxRate)) || Number(taxRate) < 0 || Number(taxRate) > 100) {
        setFormErr('La tarifa de IVA debe estar entre 0% y 100%.')
        return
      }
      if (computedVat <= 0) {
        setFormErr('Con tratamiento fiscal con IVA debes indicar una tarifa o monto de IVA mayor a 0 (o seleccionar Sin IVA).')
        return
      }
      if (taxIncluded && computedVat > itemsSum) {
        setFormErr('El IVA incluido no puede superar el valor total bruto de los artículos.')
        return
      }
      if (computedSubtotal <= 0) {
        setFormErr('La base gravable de la compra debe ser mayor a cero cuando existe IVA.')
        return
      }
    }

    for (const item of cart) {
      if (
        !item.product_id ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.cost) ||
        item.cost < 0
      ) {
        setFormErr(`Revisa la cantidad y el costo de "${item.product_name}".`)
        return
      }
      const prod = products.find(p => p.id === item.product_id)
      if (prod?.tracks_expiry) {
        if (!item.expiry_date || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiry_date)) {
          setFormErr(`El producto "${item.product_name}" maneja vencimiento: indica la fecha de vencimiento del lote en el carrito.`)
          return
        }
        if (item.expiry_date < localToday()) {
          setFormErr(`La fecha de vencimiento de "${item.product_name}" ya pasó.`)
          return
        }
      }
    }

    setSaving(true)

    try {
      const itemsPayload = cart.map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        cost: item.cost,
        subtotal: item.subtotal,
        ...(item.expiry_date ? { lot_code: item.lot_code || '', expiry_date: item.expiry_date } : {}),
      }))

      const { error } = await supabase.rpc('registrar_compra_con_iva', {
        p_supplier_id: supplierId || null,
        p_items: itemsPayload,
        p_payment_method: paymentMethod,
        p_credit_days: paymentMethod === 'credito' ? Math.floor(Number(creditDays)) : null,
        p_tax: taxStatus === 'sin_iva' ? 0 : computedVat,
        p_tax_status: taxStatus,
        p_tax_rate: taxStatus === 'sin_iva' ? null : parsedRate,
        p_tax_included: taxStatus === 'sin_iva' ? false : taxIncluded,
      })

      if (error) {
        setFormErr(
          error.message + (error.code ? ` (Código: ${error.code})` : '')
        )
        return
      }

      setShowForm(false)
      setCart([])
      setSupplierId('')
      setPaymentMethod('efectivo')
      setCreditDays('30')
      setSelProduct('')
      setQty('1')
      setCost('')
      setLotCode('')
      setExpiry('')
      setTaxStatus('sin_iva')
      setTaxRate('19')
      setTaxIncluded(false)
      setCustomTax('')
      setDraftNotice('')
      setFormErr('')

      await load()
      const taxSummary =
        taxStatus === 'sin_iva'
          ? ''
          : ` · IVA ${TAX_STATUS_META[taxStatus].short.toLowerCase()} (${money(computedVat)})`
      if (paymentMethod === 'credito') {
        flash(`Compra a crédito registrada${taxSummary}. Quedó en Cuentas por pagar sin descontar dinero de caja.`)
      } else if (paymentMethod === 'tarjeta' || paymentMethod === 'transferencia') {
        flash(`Compra registrada por ${PAYMENT_LABEL[paymentMethod].toLowerCase()}${taxSummary}. No descontó efectivo de Caja.`)
      } else {
        flash(`Compra en efectivo registrada correctamente${taxSummary}.`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFormErr('Error al registrar la compra: ' + message)
    } finally {
      setSaving(false)
    }
  }

  async function confirmCancelPurchase() {
    if (!cancelTarget || !canVoidPurchase || cancellingId || saving) return
    if (cancelTarget.status === 'anulada') return

    setCancellingId(cancelTarget.id)
    setCancelErr('')

    try {
      const { error } = await supabase.rpc('anular_compra', {
        p_purchase_id: cancelTarget.id,
      })

      if (error) {
        setCancelErr(
          error.message + (error.code ? ` (Código: ${error.code})` : '')
        )
        return
      }

      setCancelTarget(null)
      await load()
      flash('Compra anulada correctamente. Se revirtieron existencias, asientos contables, IVA y saldos asociados.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCancelErr('Error al anular la compra: ' + message)
    } finally {
      setCancellingId(null)
    }
  }

  async function openViewPurchase(purchase: Purchase) {
    setViewTarget(purchase)
    setViewAdjustments([])
    setLoadingAdj(true)
    const { data, error } = await supabase
      .from('purchase_iva_adjustments')
      .select('*')
      .eq('purchase_id', purchase.id)
      .order('created_at', { ascending: false })
    if (!error && Array.isArray(data)) {
      setViewAdjustments(data as PurchaseIvaAdjustment[])
    }
    setLoadingAdj(false)
  }

  function openClassifyModal(purchase: Purchase) {
    setClassifyTarget(purchase)
    setClassifyNewStatus('descontable')
    setClassifyReason('')
    setClassifyErr('')
  }

  async function handleClassifySubmit() {
    if (!classifyTarget || classifying || !canClassifyVat) return
    setClassifying(true)
    setClassifyErr('')

    const { error } = await supabase.rpc('clasificar_iva_compra', {
      p_purchase_id: classifyTarget.id,
      p_new_status: classifyNewStatus,
      p_reason: classifyReason.trim() || null,
    })

    setClassifying(false)
    if (error) {
      setClassifyErr(error.message + (error.code ? ` (Código: ${error.code})` : ''))
      return
    }

    const code = 'CMP-' + classifyTarget.id.slice(0, 8).toUpperCase()
    setClassifyTarget(null)
    await load()
    flash(`IVA de ${code} reclasificado a "${TAX_STATUS_META[classifyNewStatus].short}" y contabilizado correctamente.`)
  }

  function exportExcel() {
    if (filteredPurchases.length === 0) return
    const rows = filteredPurchases.map(p => {
      const method = p.payment_method || 'efectivo'
      const summary = (p.items || []).map(i => `${i.product_name} x${i.quantity}`).join(' | ')
      const vat = Number(p.tax || 0)
      const base = p.subtotal != null ? Number(p.subtotal) : Math.max(0, Number(p.total || 0) - vat)
      const tStatus = (p.tax_status || (vat > 0 ? 'descontable' : 'sin_iva')) as PurchaseTaxStatus
      const recCost = p.recognized_cost != null ? Number(p.recognized_cost) : (tStatus === 'costo' ? Number(p.total || 0) : base)
      return [
        'CMP-' + p.id.slice(0, 8).toUpperCase(),
        p.created_at ? new Date(p.created_at).toLocaleString() : '',
        p.supplier_name || 'Proveedor general',
        PAYMENT_LABEL[method] ?? method,
        p.due_date || '',
        base,
        vat,
        TAX_STATUS_META[tStatus]?.short ?? tStatus,
        recCost,
        Number(p.total) || 0,
        p.status,
        summary,
      ]
    })
    downloadCsv(
      `compras_${localToday()}.csv`,
      [
        'Comprobante',
        'Fecha',
        'Proveedor',
        'Condición de pago',
        'Vencimiento',
        'Base',
        'IVA',
        'Estado IVA',
        'Costo reconocido',
        'Total',
        'Estado',
        'Artículos',
      ],
      rows
    )
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setDraftNotice('')
    setFormErr('')
  }

  const filteredPurchases = purchases.filter(p => {
    const tStatus = (p.tax_status || (Number(p.tax || 0) > 0 ? 'descontable' : 'sin_iva')) as PurchaseTaxStatus
    if (taxFilter !== 'all' && tStatus !== taxFilter) return false
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    const code = 'cmp-' + p.id.slice(0, 8).toLowerCase()
    const sup = (p.supplier_name || 'proveedor general').toLowerCase()
    const itemsText = (p.items || []).map(i => i.product_name).join(' ').toLowerCase()
    return code.includes(q) || sup.includes(q) || itemsText.includes(q)
  })

  const pendingVatCount = purchases.filter(
    p => p.status === 'recibida' && p.tax_status === 'pendiente'
  ).length

  const parsedDays = Math.max(0, Math.min(365, Math.floor(Number(creditDays) || 0)))
  const viewSupplier = viewTarget ? suppliers.find(s => s.id === viewTarget.supplier_id) : undefined
  const doc = viewTarget ? buildPurchaseDoc(viewTarget, viewSupplier) : null
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  function doPrint() {
    if (doc) printHtml(buildDocHtml(doc, config))
  }
  function doWhatsApp() {
    if (doc) window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText(doc, config))}`, '_blank')
  }
  function doEmail() {
    if (!doc) return
    const subject = `${doc.title} ${doc.number}${config?.name ? ' - ' + config.name : ''}`
    window.location.href = `mailto:${viewSupplier?.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildShareText(doc, config))}`
  }
  async function doShare() {
    if (!doc) return
    try {
      await navigator.share({ title: `${doc.title} ${doc.number}`, text: buildShareText(doc, config) })
    } catch {
      /* cancelado */
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
        <h1 className="text-xl font-bold text-slate-800">Compras</h1>

        <div className="flex items-center gap-2 flex-wrap">
          {purchases.length > 0 && (
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Download className="w-4 h-4" />
              Exportar Excel
            </button>
          )}
          {onNavigate && canOpenPayables && (
            <button
              onClick={() => onNavigate('payables')}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Receipt className="w-4 h-4" />
              Cuentas por pagar
            </button>
          )}
          {canCreatePurchase && (
            <>
              <button
                type="button"
                onClick={() => setShowInvoiceScanner(true)}
                disabled={loading}
                title="Fotografiar o subir factura o ticket de compra para cargar mercancía automáticamente"
                className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 text-emerald-900 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ScanLine className="w-4 h-4 text-emerald-700" />
                Escanear factura
              </button>
              <button
                onClick={() => {
                  setDraftNotice('')
                  setShowForm(true)
                }}
                disabled={loading}
                className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                Nueva compra
              </button>
            </>
          )}
        </div>
      </div>

      {!canCreatePurchase && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {canClassifyVat
            ? 'Vista de supervisión y clasificación fiscal de IVA: puedes consultar compras y reclasificar IVA pendiente; solo Compras o Administración pueden registrar compras nuevas.'
            : 'Modo de solo lectura o sin permisos para registrar compras directas.'}
        </div>
      )}

      {loadError && (
        <div className="flex items-center justify-between gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <span>{loadError}</span>
          <button onClick={() => setLoadError('')} className="p-0.5 hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {notice && (
        <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {notice}
        </div>
      )}

      {pendingVatCount > 0 && (
        <div className="flex items-center justify-between gap-2 text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <span>
            Tienes <strong>{pendingVatCount}</strong> compra(s) recibida(s) con <strong>IVA pendiente por clasificar</strong> (descontable vs. mayor valor del costo).
          </span>
          <button
            type="button"
            onClick={() => setTaxFilter(taxFilter === 'pendiente' ? 'all' : 'pendiente')}
            className="shrink-0 font-semibold underline hover:text-amber-950"
          >
            {taxFilter === 'pendiente' ? 'Ver todas' : 'Filtrar pendientes'}
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar por #CMP, proveedor o producto..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            ['all', 'Todas'],
            ['sin_iva', 'Sin IVA'],
            ['descontable', 'Descontable'],
            ['pendiente', 'Pendiente'],
            ['costo', 'Al costo'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTaxFilter(key)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                taxFilter === key
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Fecha</th>
              <th className="text-left px-4 py-3 font-medium">Proveedor</th>
              <th className="text-left px-4 py-3 font-medium">Pago / Condición</th>
              <th className="text-left px-4 py-3 font-medium">Artículos</th>
              <th className="text-right px-4 py-3 font-medium">Base / IVA</th>
              <th className="text-left px-4 py-3 font-medium">Tratamiento IVA</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-left px-4 py-3 font-medium">Estado</th>
              <th className="text-right px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {filteredPurchases.map(purchase => {
              const annulled = purchase.status === 'anulada'
              const cancelling = cancellingId === purchase.id
              const method = purchase.payment_method || 'efectivo'
              const isCredit = method === 'credito'
              const itemCount = Array.isArray(purchase.items)
                ? purchase.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
                : 0
              const vatAmt = Number(purchase.tax || 0)
              const baseAmt =
                purchase.subtotal != null
                  ? Number(purchase.subtotal)
                  : Math.max(0, Number(purchase.total || 0) - vatAmt)
              const tStatus = (purchase.tax_status || (vatAmt > 0 ? 'descontable' : 'sin_iva')) as PurchaseTaxStatus
              const taxMeta = TAX_STATUS_META[tStatus] || TAX_STATUS_META.sin_iva

              return (
                <tr key={purchase.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    <div>{purchase.created_at ? new Date(purchase.created_at).toLocaleDateString() : '—'}</div>
                    <span className="text-[11px] font-mono text-slate-400">
                      CMP-{purchase.id.slice(0, 8).toUpperCase()}
                    </span>
                  </td>

                  <td className="px-4 py-3 font-medium text-slate-800">
                    {purchase.supplier_name || 'Proveedor general'}
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap">
                    {isCredit ? (
                      <div>
                        <span className="text-xs font-medium text-amber-800">Crédito</span>
                        {purchase.due_date && (
                          <span className="block text-[11px] text-slate-400">
                            Vence {new Date(purchase.due_date + 'T00:00:00').toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">
                        {PAYMENT_LABEL[method] ?? method}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                    {(purchase.items || []).length} prod. · {itemCount} und.
                  </td>

                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    <div className="text-xs font-medium text-slate-700">{money(baseAmt)}</div>
                    <div className="text-[11px] text-slate-500">
                      {vatAmt > 0 ? `IVA ${money(vatAmt)}` : 'Sin IVA'}
                    </div>
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded border ${taxMeta.cls}`}>
                      {taxMeta.short}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right text-slate-800 font-medium whitespace-nowrap tabular-nums">
                    {money(purchase.total)}
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={
                        'text-xs font-medium capitalize ' +
                        (annulled
                          ? 'text-red-700'
                          : purchase.status === 'recibida'
                            ? 'text-emerald-700'
                            : 'text-amber-700')
                      }
                    >
                      {purchase.status}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {canClassifyVat && !annulled && purchase.status === 'recibida' && tStatus === 'pendiente' && (
                        <button
                          onClick={() => openClassifyModal(purchase)}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-300 hover:bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-900 whitespace-nowrap"
                          title="Definir si el IVA pendiente es descontable o mayor valor del costo"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Clasificar IVA
                        </button>
                      )}

                      <button
                        onClick={() => void openViewPurchase(purchase)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 whitespace-nowrap"
                      >
                        <Share2 className="w-3 h-3" />
                        Ver / Enviar
                      </button>

                      {canVoidPurchase && !annulled && (
                        <button
                          onClick={() => {
                            setCancelErr('')
                            setCancelTarget(purchase)
                          }}
                          disabled={Boolean(cancellingId) || saving || loading}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          title="Anular compra"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          {cancelling ? 'Anulando...' : 'Anular'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}

            {!loading && filteredPurchases.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  {purchases.length === 0 ? 'No hay compras registradas' : 'No hay compras que coincidan con el filtro'}
                </td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  Cargando compras...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Ver / Imprimir / Enviar comprobante de compra */}
      {viewTarget && doc && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setViewTarget(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">{doc.number}</h2>
              <button onClick={() => setViewTarget(null)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {doc.partyName} · {doc.date}
              {doc.badge ? ` · ${doc.badge}` : ''}
            </p>
            {doc.paymentLabel && (
              <p className="text-xs text-slate-600 mb-3">
                {doc.paymentLabel}{doc.extra ? ` · ${doc.extra}` : ''}
              </p>
            )}

            <div className="border border-slate-200 rounded-lg p-3 space-y-2 mb-3 max-h-52 overflow-y-auto">
              {(viewTarget.items || []).map((it, idx) => (
                <div key={idx} className="flex justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-slate-800 truncate">{it.product_name}</p>
                    <p className="text-[11px] text-slate-500">
                      {it.quantity} × {money(it.cost)}
                      {it.expiry_date
                        ? ` · ${it.lot_code ? `Lote ${it.lot_code} · ` : ''}Vence ${new Date(it.expiry_date + 'T00:00:00').toLocaleDateString()}`
                        : ''}
                    </p>
                  </div>
                  <span className="text-slate-700 font-medium shrink-0 tabular-nums">
                    {money(it.subtotal)}
                  </span>
                </div>
              ))}
            </div>

            {(() => {
              const vat = Number(viewTarget.tax || 0)
              const base =
                viewTarget.subtotal != null
                  ? Number(viewTarget.subtotal)
                  : Math.max(0, Number(viewTarget.total || 0) - vat)
              const tStatus = (viewTarget.tax_status || (vat > 0 ? 'descontable' : 'sin_iva')) as PurchaseTaxStatus
              const recCost =
                viewTarget.recognized_cost != null
                  ? Number(viewTarget.recognized_cost)
                  : tStatus === 'costo'
                    ? Number(viewTarget.total || 0)
                    : base
              return (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tratamiento fiscal:</span>
                    <span className="font-semibold text-slate-800">{TAX_STATUS_META[tStatus]?.label || tStatus}</span>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span className="text-slate-500">Base gravable / subtotal:</span>
                    <span className="font-medium text-slate-800">{money(base)}</span>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span className="text-slate-500">
                      IVA compra{viewTarget.tax_rate ? ` (${viewTarget.tax_rate}%${viewTarget.tax_included ? ' incl.' : ''})` : ''}:
                    </span>
                    <span className="font-medium text-slate-800">{money(vat)}</span>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span className="text-slate-500">Costo reconocido en inventario:</span>
                    <span className="font-semibold text-slate-900">{money(recCost)}</span>
                  </div>
                  {(Number(viewTarget.iva_cost_inventory || 0) > 0 || Number(viewTarget.iva_cost_expense || 0) > 0) && (
                    <div className="pt-1 border-t border-slate-200 flex justify-between tabular-nums text-[11px] text-indigo-800">
                      <span>IVA capitalizado / costo ventas:</span>
                      <span>
                        Inv: {money(viewTarget.iva_cost_inventory || 0)} · Costo vtas: {money(viewTarget.iva_cost_expense || 0)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })()}

            {(loadingAdj || viewAdjustments.length > 0) && (
              <div className="border border-slate-200 rounded-lg p-3 mb-3 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Trazabilidad de reclasificaciones de IVA
                </p>
                {loadingAdj ? (
                  <p className="text-xs text-slate-400">Consultando historial...</p>
                ) : (
                  viewAdjustments.map(adj => (
                    <div key={adj.id} className="text-xs border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">
                          {adj.from_status} → {adj.to_status}
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-800">
                          {money(adj.tax_amount)} ({adj.status})
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {new Date(adj.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        {adj.created_by_name ? ` · ${adj.created_by_name}` : ''}
                        {adj.reason ? ` · "${adj.reason}"` : ''}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="flex justify-between items-center pb-3 mb-3 border-b border-slate-100">
              <span className="font-bold text-slate-800">Total compra:</span>
              <span className="font-bold text-slate-800 text-lg tabular-nums">{money(viewTarget.total)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={doPrint}
                className="flex items-center justify-center gap-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700"
              >
                <Printer className="w-4 h-4" /> Imprimir / PDF
              </button>
              <button
                onClick={doWhatsApp}
                className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
              >
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <button
                onClick={doEmail}
                className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
              >
                <Mail className="w-4 h-4" /> Correo
              </button>
              {canShare && (
                <button
                  onClick={() => void doShare()}
                  className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
                >
                  <Share2 className="w-4 h-4" /> Compartir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nueva compra */}
      {showForm && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={closeForm}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">Nueva compra</h2>
              <button
                onClick={closeForm}
                disabled={saving}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {draftNotice && (
              <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
                {draftNotice}
              </div>
            )}

            {formErr && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                {formErr}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Forma de pago
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
                  {([
                    ['efectivo', 'Efectivo'],
                    ['transferencia', 'Transferencia'],
                    ['tarjeta', 'Tarjeta'],
                    ['credito', 'Crédito'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      disabled={saving}
                      onClick={() => setPaymentMethod(key)}
                      className={`py-2 px-2 rounded-md text-xs font-medium transition-colors ${
                        paymentMethod === key ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {paymentMethod === 'efectivo' && 'Descuenta dinero del efectivo físico en Caja.'}
                  {(paymentMethod === 'transferencia' || paymentMethod === 'tarjeta') && 'Pago bancario: no mueve el efectivo de Caja (se contabiliza por Bancos).'}
                  {paymentMethod === 'credito' && 'No sale dinero hoy: queda pendiente en Cuentas por pagar.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Proveedor {paymentMethod === 'credito' && <span className="text-red-600">*</span>}
                </label>
                <select
                  value={supplierId}
                  onChange={event => handleSupplierChange(event.target.value)}
                  disabled={saving}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                >
                  <option value="">{paymentMethod === 'credito' ? 'Selecciona un proveedor…' : 'Proveedor general'}</option>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>

              {paymentMethod === 'credito' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-medium text-amber-900">
                      Días de plazo para pagar
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="365"
                      step="1"
                      value={creditDays}
                      onChange={event => setCreditDays(event.target.value)}
                      disabled={saving}
                      className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm bg-white text-right"
                    />
                  </div>
                  <p className="text-[11px] text-amber-800">
                    Vence el <strong>{addDaysDate(parsedDays)}</strong>. Quedará registrada en Cuentas por pagar.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Producto, cantidad y costo unitario
                </label>

                <div className="flex gap-2">
                  <select
                    value={selProduct}
                    onChange={event => handleProductSelect(event.target.value)}
                    disabled={saving}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  >
                    <option value="">Seleccionar producto</option>
                    {products.map(product => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={qty}
                    onChange={event => setQty(event.target.value)}
                    disabled={saving}
                    placeholder="Cant."
                    aria-label="Cantidad"
                    className="w-20 px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />

                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={cost}
                    onChange={event => setCost(event.target.value)}
                    disabled={saving}
                    placeholder="Costo"
                    aria-label="Costo unitario"
                    className="w-24 px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />

                  <button
                    onClick={addToCart}
                    disabled={saving}
                    aria-label="Agregar producto"
                    className="px-3 py-2 bg-slate-100 rounded-lg text-sm font-medium hover:bg-slate-200 disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {products.find(p => p.id === selProduct)?.tracks_expiry && (
                  <div className="mt-2 grid grid-cols-2 gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-amber-900 mb-1">Fecha de vencimiento</label>
                      <input
                        type="date"
                        value={expiry}
                        min={localToday()}
                        onChange={event => setExpiry(event.target.value)}
                        disabled={saving}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-amber-900 mb-1">Lote (opcional)</label>
                      <input
                        type="text"
                        maxLength={40}
                        value={lotCode}
                        onChange={event => setLotCode(event.target.value)}
                        disabled={saving}
                        placeholder="Ej: L-2410"
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 max-h-60 overflow-y-auto">
                {cart.map((item, index) => {
                  const prod = products.find(p => p.id === item.product_id)
                  const needsExpiry = prod?.tracks_expiry === true
                  return (
                    <div
                      key={`${item.product_id}-${index}`}
                      className="space-y-1.5 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-slate-800 font-medium min-w-0 truncate">
                          {item.product_name}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            disabled={saving}
                            onChange={e => updateCartItem(index, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                            aria-label={`Cantidad de ${item.product_name}`}
                            className="w-16 px-2 py-1 rounded border border-slate-300 text-xs text-right"
                          />
                          <span className="text-xs text-slate-400">×</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.cost}
                            disabled={saving}
                            onChange={e => updateCartItem(index, { cost: Math.max(0, Number(e.target.value) || 0) })}
                            aria-label={`Costo de ${item.product_name}`}
                            className="w-20 px-2 py-1 rounded border border-slate-300 text-xs text-right"
                          />
                          <span className="text-xs font-medium text-slate-700 w-20 text-right tabular-nums">
                            {money(item.subtotal)}
                          </span>
                          <button
                            onClick={() => removeFromCart(index)}
                            disabled={saving}
                            aria-label={`Quitar ${item.product_name}`}
                            className="p-1 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </button>
                        </div>
                      </div>

                      {needsExpiry && (
                        <div className="grid grid-cols-2 gap-2 pl-1">
                          <input
                            type="date"
                            min={localToday()}
                            value={item.expiry_date || ''}
                            disabled={saving}
                            onChange={e => updateCartItem(index, { expiry_date: e.target.value })}
                            className="px-2 py-1 rounded border border-amber-300 bg-amber-50/50 text-xs"
                          />
                          <input
                            type="text"
                            maxLength={40}
                            placeholder="Lote (opcional)"
                            value={item.lot_code || ''}
                            disabled={saving}
                            onChange={e => updateCartItem(index, { lot_code: e.target.value })}
                            className="px-2 py-1 rounded border border-slate-200 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}

                {cart.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">
                    Carrito vacío
                  </p>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Tratamiento fiscal del IVA (NIIF / DIAN)
                  </label>
                  <select
                    value={taxStatus}
                    onChange={e => {
                      const next = e.target.value as PurchaseTaxStatus
                      setTaxStatus(next)
                      if (next === 'sin_iva') {
                        setCustomTax('')
                        setTaxIncluded(false)
                      }
                    }}
                    disabled={saving}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                  >
                    <option value="sin_iva">Sin IVA / Excluida</option>
                    <option value="descontable">IVA Descontable</option>
                    <option value="pendiente">IVA Pendiente por clasificar</option>
                    <option value="costo">IVA al Costo (mayor valor)</option>
                  </select>
                </div>

                <p className="text-[11px] text-slate-500">
                  {TAX_STATUS_META[taxStatus].hint}
                </p>

                {taxStatus !== 'sin_iva' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Tarifa IVA (%)
                      </label>
                      <div className="flex gap-1">
                        {(['19', '5'] as const).map(r => (
                          <button
                            key={r}
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              setTaxRate(r)
                              setCustomTax('')
                            }}
                            className={`px-2 py-1.5 rounded border text-xs font-medium ${
                              taxRate === r && !hasCustomTax
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white text-slate-700 border-slate-300'
                            }`}
                          >
                            {r}%
                          </button>
                        ))}
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={taxRate}
                          onChange={e => {
                            setTaxRate(e.target.value)
                            setCustomTax('')
                          }}
                          disabled={saving}
                          aria-label="Tarifa IVA personalizada"
                          className="w-full min-w-0 px-2 py-1.5 rounded border border-slate-300 text-xs bg-white text-right tabular-nums"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Monto IVA (opcional)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={customTax}
                        onChange={e => setCustomTax(e.target.value)}
                        disabled={saving}
                        placeholder={String(computedVat)}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white text-right tabular-nums"
                      />
                    </div>

                    <div className="flex items-end pb-1">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={taxIncluded}
                          onChange={e => setTaxIncluded(e.target.checked)}
                          disabled={saving}
                          className="rounded border-slate-300"
                        />
                        <span>IVA incluido en precios</span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-xs tabular-nums">
                  <div>
                    <span className="block text-[10px] text-slate-400 uppercase">Base gravable</span>
                    <span className="font-semibold text-slate-800">{money(computedSubtotal)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 uppercase">IVA compra</span>
                    <span className="font-semibold text-slate-800">{money(computedVat)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 uppercase">Costo inv.</span>
                    <span className="font-semibold text-indigo-800">{money(recognizedInventoryCost)}</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] text-slate-400 uppercase">Total pagar</span>
                    <span className="font-bold text-slate-900">{money(computedTotal)}</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                El costo del producto se actualiza con promedio ponderado según el stock actual y el costo reconocido en inventario.
              </p>

              <button
                onClick={() => void handleSubmit()}
                disabled={cart.length === 0 || saving || loading}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Truck className="w-4 h-4" />
                {saving
                  ? 'Registrando...'
                  : paymentMethod === 'credito'
                    ? `Registrar compra a crédito · ${money(computedTotal)}`
                    : `Registrar compra (${PAYMENT_LABEL[paymentMethod]}) · ${money(computedTotal)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Clasificar IVA pendiente */}
      {classifyTarget && canClassifyVat && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !classifying && setClassifyTarget(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-800">
                Clasificar IVA · CMP-{classifyTarget.id.slice(0, 8).toUpperCase()}
              </h2>
              <button
                onClick={() => !classifying && setClassifyTarget(null)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1 tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-500">Proveedor:</span>
                <span className="font-medium text-slate-800">{classifyTarget.supplier_name || 'Proveedor general'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Base gravable:</span>
                <span className="font-medium text-slate-800">{money(classifyTarget.subtotal || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">IVA pendiente por clasificar:</span>
                <span className="font-bold text-amber-800">{money(classifyTarget.tax || 0)}</span>
              </div>
            </div>

            {classifyErr && (
              <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{classifyErr}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600">
                Destino fiscal definitivo del IVA
              </label>
              <label className={`block p-3 rounded-lg border cursor-pointer text-xs ${
                classifyNewStatus === 'descontable' ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200'
              }`}>
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <input
                    type="radio"
                    name="classifyStatus"
                    checked={classifyNewStatus === 'descontable'}
                    onChange={() => setClassifyNewStatus('descontable')}
                    disabled={classifying}
                  />
                  <span>IVA Descontable (DIAN Formulario 300)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 pl-5">
                  Reclasifica de IVA pendiente a IVA descontable en el período actual sin modificar el costo del inventario.
                </p>
              </label>

              <label className={`block p-3 rounded-lg border cursor-pointer text-xs ${
                classifyNewStatus === 'costo' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'
              }`}>
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <input
                    type="radio"
                    name="classifyStatus"
                    checked={classifyNewStatus === 'costo'}
                    onChange={() => setClassifyNewStatus('costo')}
                    disabled={classifying}
                  />
                  <span>Mayor valor del costo (Inventario / Costo de ventas)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 pl-5">
                  Lleva proporcionalmente el IVA a inventario (unidades disponibles) y costo de ventas (unidades ya vendidas). No es descontable en DIAN.
                </p>
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Nota o soporte de clasificación (opcional)
              </label>
              <input
                type="text"
                maxLength={240}
                value={classifyReason}
                onChange={e => setClassifyReason(e.target.value)}
                disabled={classifying}
                placeholder="Ej: Factura electrónica validada en DIAN / régimen común"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setClassifyTarget(null)}
                disabled={classifying}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleClassifySubmit()}
                disabled={classifying}
                className="flex-1 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 disabled:opacity-50"
              >
                {classifying ? 'Reclasificando...' : 'Confirmar reclasificación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar anulación de compra */}
      {cancelTarget && canVoidPurchase && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !cancellingId && setCancelTarget(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-bold text-slate-800">
              ¿Anular compra CMP-{cancelTarget.id.slice(0, 8).toUpperCase()}?
            </h2>

            <div className="text-xs text-slate-600 space-y-1.5">
              <p>
                Proveedor: <strong>{cancelTarget.supplier_name || 'Proveedor general'}</strong> · Total:{' '}
                <strong className="tabular-nums">{money(cancelTarget.total)}</strong>
                {Number(cancelTarget.tax || 0) > 0 && (
                  <> (incluye IVA {money(cancelTarget.tax || 0)} · {TAX_STATUS_META[(cancelTarget.tax_status || 'descontable') as PurchaseTaxStatus]?.short})</>
                )}
              </p>
              <p className="text-slate-500">
                {(cancelTarget.payment_method || 'efectivo') === 'credito'
                  ? 'Revertirá existencias, costo promedio, asientos contables (incluyendo reclasificaciones de IVA) y anulará la deuda pendiente si no tiene pagos aplicados.'
                  : (cancelTarget.payment_method || 'efectivo') === 'efectivo'
                    ? 'Revertirá existencias, costo promedio, asientos contables e IVA, y devolverá el monto a Caja.'
                    : 'Revertirá existencias, costo promedio, asientos contables e IVA sin tocar el efectivo de Caja.'}
              </p>
            </div>

            {cancelErr && (
              <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{cancelErr}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                disabled={Boolean(cancellingId)}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void confirmCancelPurchase()}
                disabled={Boolean(cancellingId)}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {cancellingId ? 'Anulando...' : 'Sí, anular compra'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PurchaseInvoiceScannerModal
        open={showInvoiceScanner}
        onClose={() => setShowInvoiceScanner(false)}
        onCompleted={summaryMsg => {
          flash(summaryMsg)
          void load()
        }}
        onSwitchToExpenses={onNavigate ? () => onNavigate('expenses') : undefined}
        products={products}
        suppliers={suppliers}
        supplierTerms={supplierTerms}
        config={config}
      />
    </div>
  )
}
