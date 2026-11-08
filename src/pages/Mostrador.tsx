import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isCompanyManager, isReadOnly, canManageInventory, canRegisterSales } from '../lib/auth'
import { useWarehouse } from '../lib/warehouseContext'
import { useCurrency, formatMoney } from '../lib/currency'
import { esc, printHtml } from '../lib/documents'
import {
  cacheGet,
  cacheSet,
  enqueueSale,
  newId,
  onQueueChange,
  onSynced,
  pendingToCustomer,
  readCustomerQueue,
  readQueue,
  sendSale,
  syncQueue,
  type PendingCustomer,
  type PendingSale,
} from '../lib/offlineQueue'
import { calcTax, round2, taxModeOf, taxRateOf } from '../lib/tax'
import { priceFor, type PriceType } from '../lib/pricing'
import {
  consumeCatalogPosHandoff,
  hydrateProductsWithImages,
  saveProductImageInSupabase,
} from '../lib/productImages'
import BarcodeScanner from '../components/BarcodeScanner'
import FxPayment, { fxResult, type FxResult, type FxState } from '../components/FxPayment'
import { ProductPhotoLightbox, ProductThumb } from '../components/ProductImageCapture'
import SqlActivationModal from '../components/SqlActivationModal'
import HandwrittenSalesScannerModal from '../components/HandwrittenSalesScannerModal'
import type { Product, Category, Customer, CompanyConfig } from '../types'
import {
  Search,
  Camera,
  Plus,
  Minus,
  Trash2,
  Store,
  WifiOff,
  Printer,
  MessageCircle,
  X,
  Lock,
  Warehouse as WarehouseIcon,
  Eye,
  LayoutGrid,
  List,
  BookOpen,
  Database,
  AlertTriangle,
  NotebookPen,
} from 'lucide-react'

const PAYMENT_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  fiado: 'Fiado',
}

interface CartLine {
  product_id: string
  qty: string
}

interface Receipt {
  ref: string
  date: Date
  seller: string
  customer: string
  priceLabel: string
  lines: { name: string; qty: number; price: number; subtotal: number; mayor: boolean }[]
  sum: number
  discount: number
  taxRate: number
  tax: number
  total: number
  payment: string
  received: number | null
  change: number
  fx: FxResult | null
  pending: boolean
}

async function fetchAll<T>(table: string): Promise<T[] | null> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order('name').range(from, from + 999)
    if (error) return null
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

function ticketHtml(r: Receipt, cfg: CompanyConfig | null): string {
  const m = (n: number) => esc(formatMoney(n, cfg?.currency))
  const head = [cfg?.rif && `ID fiscal: ${cfg.rif}`, cfg?.address, cfg?.phone && `Tel: ${cfg.phone}`]
    .filter(Boolean)
    .map(l => `<div>${esc(l)}</div>`)
    .join('')
  const rows = r.lines
    .map(
      l =>
        `<div class="n">${esc(l.name)}${l.mayor ? ' (mayor)' : ''}</div><div class="row"><span>${esc(l.qty)} x ${m(l.price)}</span><span>${m(l.subtotal)}</span></div>`
    )
    .join('')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.ref)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0 auto;padding:12px;width:290px;font-size:12px}
h1{font-size:15px;margin:0 0 2px;text-align:center}
.c{text-align:center}
.n{margin-top:6px;font-weight:bold}
.row{display:flex;justify-content:space-between;gap:8px}
hr{border:0;border-top:1px dashed #000;margin:8px 0}
.t{font-size:15px;font-weight:bold}
@media print{body{padding:0}}
</style></head><body>
<h1>${esc(cfg?.name || 'Mi Empresa')}</h1>
<div class="c">${head}</div>
<hr>
<div>Ticket: ${esc(r.ref)}${r.pending ? ' (pendiente de envío)' : ''}</div>
<div>Fecha: ${esc(r.date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}</div>
<div>Cliente: ${esc(r.customer)}</div>
<div>Atendió: ${esc(r.seller)}</div>
<hr>
${rows}
<hr>
${r.discount > 0 ? `<div class="row"><span>Subtotal</span><span>${m(r.sum)}</span></div><div class="row"><span>Descuento</span><span>-${m(r.discount)}</span></div>` : ''}
${r.tax > 0 ? `<div class="row"><span>Impuesto${r.taxRate ? ` (${esc(r.taxRate)}%)` : ''}</span><span>${m(r.tax)}</span></div>` : ''}
<div class="row t"><span>TOTAL</span><span>${m(r.total)}</span></div>
<div class="row"><span>Pago</span><span>${esc(PAYMENT_LABEL[r.payment] ?? r.payment)}</span></div>
${r.fx ? `<div class="row"><span>Pagó en ${esc(r.fx.currency)}</span><span>${esc(formatMoney(r.fx.amount, r.fx.currency))}</span></div><div class="row"><span>Tasa</span><span>1 ${esc(r.fx.currency)} = ${m(r.fx.rate)}</span></div>${r.fx.baseAmount > 0 ? `<div class="row"><span>Además recibió</span><span>${m(r.fx.baseAmount)}</span></div>` : ''}` : ''}
${r.received != null ? `<div class="row"><span>Recibido</span><span>${m(r.received)}</span></div><div class="row"><span>Cambio</span><span>${m(r.change)}</span></div>` : ''}
<hr>
<div class="c">¡Gracias por su compra!<br>Este ticket no constituye factura fiscal.</div>
</body></html>`
}

function shareText(r: Receipt, cfg: CompanyConfig | null): string {
  const m = (n: number) => formatMoney(n, cfg?.currency)
  const L = [
    `*${cfg?.name || 'Mi Empresa'}*`,
    `Ticket ${r.ref}`,
    r.date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
    '',
  ]
  for (const l of r.lines) L.push(`${l.qty} x ${l.name} — ${m(l.subtotal)}`)
  L.push('')
  if (r.discount > 0) L.push(`Descuento: -${m(r.discount)}`)
  if (r.tax > 0) L.push(`Impuesto: ${m(r.tax)}`)
  L.push(`*Total: ${m(r.total)}*`, `Pago: ${PAYMENT_LABEL[r.payment] ?? r.payment}`)
  if (r.fx) L.push(`Pagó en ${r.fx.currency}: ${formatMoney(r.fx.amount, r.fx.currency)} (tasa: 1 ${r.fx.currency} = ${m(r.fx.rate)})`)
  if (r.fx && r.fx.baseAmount > 0) L.push(`Además recibió: ${m(r.fx.baseAmount)}`)
  if (r.fx && r.change > 0) L.push(`Cambio: ${m(r.change)}`)
  L.push('', '¡Gracias por su compra!')
  return L.join('\n')
}

export default function Mostrador({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const { user } = useAuth()
  const { activeWarehouses, activeWarehouseId, setActiveWarehouseId } = useWarehouse()
  const { fmt: money, currency: baseCur, fxRates } = useCurrency()
  const readOnly = isReadOnly(user)
  const canEditPhotos = !readOnly && (canManageInventory(user?.role) || canRegisterSales(user?.role))
  const uid = user?.id ?? ''
  const isManager = isCompanyManager(user?.role)

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [baseCustomers, setBaseCustomers] = useState<Customer[]>([])
  const [pendingCustomers, setPendingCustomers] = useState<PendingCustomer[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [ready, setReady] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pendingSales, setPendingSales] = useState(0)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [posView, setPosView] = useState<'cards' | 'compact'>('cards')
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null)
  const [imageSchemaMissing, setImageSchemaMissing] = useState(false)
  const [sqlModalOpen, setSqlModalOpen] = useState(false)

  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState('')
  const [override, setOverride] = useState<PriceType | null>(null)
  const [discMode, setDiscMode] = useState<'monto' | 'pct'>('monto')
  const [discValue, setDiscValue] = useState('')
  const [payment, setPayment] = useState('efectivo')
  const [received, setReceived] = useState('')
  const [fx, setFx] = useState<FxState | null>(null)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [showNotebookScanner, setShowNotebookScanner] = useState(false)
  const [notice, setNotice] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [today, setToday] = useState<{ n: number; total: number } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const cartRef = useRef<CartLine[]>([])
  cartRef.current = cart
  const productsRef = useRef<Product[]>([])
  productsRef.current = products
  const handoffConsumedRef = useRef(false)

  const customers: Customer[] = useMemo(
    () => [
      ...baseCustomers,
      ...pendingCustomers
        .filter(p => !baseCustomers.some(c => c.id === p.client_id))
        .map(pendingToCustomer),
    ],
    [baseCustomers, pendingCustomers]
  )

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  async function load() {
    const [pl, cl, catList, rcfg] = await Promise.all([
      fetchAll<Product>('products'),
      fetchAll<Customer>('customers'),
      fetchAll<Category>('categories'),
      supabase.from('company_config').select('*').limit(1),
    ])
    if (!pl || !cl || rcfg.error) {
      const cp = uid ? cacheGet<Product[]>(uid, 'products') : null
      const cc = uid ? cacheGet<Customer[]>(uid, 'customers') : null
      const ccat = uid ? cacheGet<Category[]>(uid, 'categories') : null
      const cg = uid ? cacheGet<CompanyConfig>(uid, 'config') : null
      if (cp) setProducts(cp)
      if (cc) setBaseCustomers(cc)
      if (ccat) setCategories(ccat)
      if (cg) setConfig(cg)
      setLoadErr(cp ? '' : 'No se pudieron cargar los productos. Conéctate a internet al menos una vez.')
      setReady(true)
      return
    }
    const hydrated = await hydrateProductsWithImages(pl)
    const cfg = ((rcfg.data || [])[0] as CompanyConfig) ?? null
    setProducts(hydrated.products)
    setImageSchemaMissing(hydrated.schemaStatus === 'missing_sql')
    setBaseCustomers(cl)
    setCategories(catList || [])
    setConfig(cfg)
    setLoadErr('')
    setReady(true)
    if (uid) {
      cacheSet(uid, 'products', hydrated.products)
      cacheSet(uid, 'customers', cl)
      if (catList) cacheSet(uid, 'categories', catList)
      if (cfg) cacheSet(uid, 'config', cfg)
    }
  }

  async function loadToday() {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    let q = supabase
      .from('sales')
      .select('total')
      .eq('channel', 'mostrador')
      .neq('status', 'anulada')
      .gte('created_at', start.toISOString())
      .limit(1000)
    if (!isManager && uid) q = q.eq('seller_id', uid)
    const { data, error } = await q
    if (error || !data) return
    setToday({
      n: data.length,
      total: (data as { total: number | string }[]).reduce((a, r) => a + (Number(r.total) || 0), 0),
    })
  }

  useEffect(() => {
    void load()
    void loadToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  // Recibir pedido precargado desde el Catálogo Comercial del vendedor
  useEffect(() => {
    if (!ready || products.length === 0 || handoffConsumedRef.current) return
    const handoff = consumeCatalogPosHandoff()
    if (!handoff) return
    handoffConsumedRef.current = true
    if (handoff.customerId) {
      setCustomerId(handoff.customerId)
    }
    const nextCart: CartLine[] = []
    for (const item of handoff.items) {
      const prod = products.find(p => p.id === item.product_id)
      if (!prod) continue
      const maxStock = Number(prod.stock) || 0
      const qty = Math.min(maxStock, Math.max(0, Number(item.quantity) || 0))
      if (qty > 0) {
        nextCart.push({ product_id: prod.id, qty: String(qty) })
      }
    }
    if (nextCart.length > 0) {
      cartRef.current = nextCart
      setCart(nextCart)
      setNotice(`Se cargaron ${nextCart.length} producto(s) desde el Catálogo Comercial.`)
    }
  }, [ready, products])

  useEffect(() => {
    if (!uid) return
    const refresh = () => {
      setPendingCustomers(readCustomerQueue(uid))
      setPendingSales(readQueue(uid).filter(s => !s.error).length)
    }
    refresh()
    const off = onQueueChange(refresh)
    const offSync = onSynced(r => {
      if (r.sent > 0) {
        void load()
        void loadToday()
      }
    })
    const goOnline = () => {
      setOnline(true)
      syncQueue(uid)
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      off()
      offSync()
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 6000)
    return () => window.clearTimeout(t)
  }, [notice])

  // ---------------------------------------------------------------- Carrito
  const customer = customers.find(c => c.id === customerId)
  const customerType: PriceType = customer?.price_type === 'mayor' ? 'mayor' : 'detal'
  const priceType: PriceType = override ?? customerType

  const lines = useMemo(() => {
    const byId = new Map<string, Product>(products.map(p => [p.id, p] as [string, Product]))
    const out: {
      product: Product
      qty: number
      qtyText: string
      price: number
      mayor: boolean
      subtotal: number
    }[] = []
    for (const l of cart) {
      const product = byId.get(l.product_id)
      if (!product) continue
      const qty = parseFloat(l.qty)
      const q = qty > 0 ? qty : 0
      const pr = priceFor(product, q, priceType)
      out.push({
        product,
        qty: q,
        qtyText: l.qty,
        price: pr.price,
        mayor: pr.mayor,
        subtotal: round2(pr.price * q),
      })
    }
    return out
  }, [cart, products, priceType])

  const sum = round2(lines.reduce((a, l) => a + l.subtotal, 0))
  const discNum = parseFloat(discValue) || 0
  const discount = round2(
    discNum <= 0
      ? 0
      : discMode === 'pct'
        ? Math.min(sum, (sum * Math.min(discNum, 100)) / 100)
        : Math.min(sum, discNum)
  )
  const taxMode = taxModeOf(config)
  const tx = calcTax(round2(sum - discount), taxMode, taxRateOf(config))
  const total = tx.total
  const fxRes = payment === 'efectivo' || payment === 'transferencia' ? fxResult(fx) : null
  const receivedNum = fxRes
    ? fxRes.equivalent
    : received.trim() === ''
      ? null
      : parseFloat(received)
  const change =
    (payment === 'efectivo' || fxRes) && receivedNum != null && !isNaN(receivedNum)
      ? round2(receivedNum - total)
      : 0

  function stockOf(id: string) {
    return Number(productsRef.current.find(p => p.id === id)?.stock) || 0
  }

  function addProduct(p: Product, amount = 1): string {
    const cur = cartRef.current
    const inCart = parseFloat(cur.find(l => l.product_id === p.id)?.qty ?? '0') || 0
    if (inCart + amount > stockOf(p.id)) {
      return `Stock insuficiente: ${p.name} (disponible: ${stockOf(p.id)})`
    }
    const next = cur.some(l => l.product_id === p.id)
      ? cur.map(l => (l.product_id === p.id ? { ...l, qty: String(inCart + amount) } : l))
      : [...cur, { product_id: p.id, qty: String(amount) }]
    cartRef.current = next
    setCart(next)
    return `Agregado: ${p.name}`
  }

  function findByCode(code: string): Product | undefined {
    const c = code.trim().toLowerCase()
    if (!c) return undefined
    return productsRef.current.find(p => (p.sku || '').trim().toLowerCase() === c)
  }

  function onScan(code: string): string {
    const p = findByCode(code)
    if (!p) return `Código no encontrado: ${code}`
    return addProduct(p)
  }

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products
      .filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .slice(0, 12)
  }, [search, products])

  const quickPicks = useMemo(() => {
    return [...products]
      .filter(p => categoryFilter === 'all' || p.category_id === categoryFilter)
      .sort(
        (a, b) =>
          Number(Number(b.stock) > 0) - Number(Number(a.stock) > 0) ||
          Number(Boolean(b.image_url)) - Number(Boolean(a.image_url)) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, 24)
  }, [products, categoryFilter])

  function pick(p: Product) {
    const msg = addProduct(p)
    if (!msg.startsWith('Agregado')) setNotice(msg)
    setSearch('')
    searchRef.current?.focus()
  }

  function onSearchEnter() {
    const exact = findByCode(search)
    if (exact) {
      pick(exact)
      return
    }
    if (results.length === 1) pick(results[0])
  }

  function setQty(id: string, text: string) {
    setCart(cart.map(l => (l.product_id === id ? { ...l, qty: text } : l)))
  }

  function step(id: string, delta: number) {
    const cur = parseFloat(cart.find(l => l.product_id === id)?.qty ?? '0') || 0
    const n = cur + delta
    if (n <= 0) {
      setCart(cart.filter(l => l.product_id !== id))
      return
    }
    if (n > stockOf(id)) {
      setNotice(`Stock insuficiente (disponible: ${stockOf(id)})`)
      return
    }
    setQty(id, String(n))
  }

  function removeLine(id: string) {
    setCart(cart.filter(l => l.product_id !== id))
  }

  function resetSale() {
    setCart([])
    setCustomerId('')
    setOverride(null)
    setDiscValue('')
    setDiscMode('monto')
    setPayment('efectivo')
    setReceived('')
    setFx(null)
    setSearch('')
  }

  async function handleQuickPhotoSave(product: Product, newUrl: string | null) {
    const { savedUrl } = await saveProductImageInSupabase({
      productId: product.id,
      companyId: user?.company_id || config?.company_id || null,
      skuOrName: product.sku || product.name,
      imageUrl: newUrl,
    })
    setImageSchemaMissing(false)
    setProducts(prev => {
      const updated = prev.map(p => (p.id === product.id ? { ...p, image_url: savedUrl } : p))
      if (uid) cacheSet(uid, 'products', updated)
      return updated
    })
    setPreviewProduct(prev => (prev && prev.id === product.id ? { ...prev, image_url: savedUrl } : prev))
    setNotice(
      savedUrl
        ? `Fotografía guardada en Supabase para ${product.name}.`
        : `Fotografía eliminada de ${product.name}.`
    )
  }

  // ----------------------------------------------------------------- Cobrar
  async function charge() {
    if (readOnly || saving || !ready) return
    if (lines.length === 0) return
    for (const l of lines) {
      if (!(l.qty > 0)) {
        setNotice(`Revisa la cantidad de ${l.product.name}.`)
        return
      }
      if (l.qty > stockOf(l.product.id)) {
        setNotice(`Stock insuficiente para ${l.product.name} (disponible: ${stockOf(l.product.id)})`)
        return
      }
    }
    if (discNum < 0) {
      setNotice('El descuento no puede ser negativo.')
      return
    }
    if (payment === 'fiado') {
      if (!customerId) {
        setNotice('El fiado requiere un cliente registrado. Elige un cliente.')
        return
      }
      if (pendingCustomers.some(p => p.client_id === customerId)) {
        setNotice('Este cliente aún no se ha sincronizado. Espera a que suba para venderle a crédito.')
        return
      }
      if (!navigator.onLine) {
        setNotice('El fiado necesita conexión a internet para revisar el cupo del cliente.')
        return
      }
    }
    if (fx && (payment === 'efectivo' || payment === 'transferencia') && !fxRes) {
      setNotice('Completa el monto recibido y la tasa del pago en otra moneda.')
      return
    }
    if (fxRes && fxRes.equivalent < total) {
      setNotice('Lo recibido en la otra moneda no cubre el total de la venta.')
      return
    }
    if (!fxRes && payment === 'efectivo' && receivedNum != null && (isNaN(receivedNum) || receivedNum < total)) {
      setNotice('El efectivo recibido es menor que el total.')
      return
    }
    setSaving(true)
    const recv = fxRes
      ? fxRes.equivalent
      : payment === 'efectivo' && receivedNum != null && !isNaN(receivedNum)
        ? receivedNum
        : null
    const sale: PendingSale = {
      client_id: newId(),
      customer_id: customerId || null,
      customer_name: customer?.name ?? null,
      items: lines.map(l => ({
        product_id: l.product.id,
        product_name: l.product.name,
        quantity: l.qty,
        price: l.price,
        subtotal: l.subtotal,
      })),
      payment_method: payment,
      geo: null,
      captured_at: new Date().toISOString(),
      total,
      channel: 'mostrador',
      discount,
      warehouse_id: activeWarehouseId || null,
      received: fxRes ? null : recv,
      ...(fxRes
        ? {
            fx_currency: fxRes.currency,
            fx_amount: fxRes.amount,
            fx_rate: fxRes.rate,
            ...(fxRes.baseAmount > 0 ? { fx_base: fxRes.baseAmount } : {}),
          }
        : {}),
    }
    let queued = false
    if (!navigator.onLine) {
      queued = true
    } else {
      const r = await sendSale(sale)
      if (!r.ok && r.network) queued = true
      else if (!r.ok) {
        setSaving(false)
        setNotice('Error al registrar la venta: ' + r.message)
        return
      }
    }
    if (queued) {
      if (!enqueueSale(uid, sale)) {
        setSaving(false)
        setNotice(
          'No se pudo guardar la venta en el teléfono (almacenamiento lleno o bloqueado). Conéctate a internet e inténtalo de nuevo.'
        )
        return
      }
      setProducts(ps => {
        const next = ps.map(p => {
          const q = sale.items.filter(i => i.product_id === p.id).reduce((a, i) => a + i.quantity, 0)
          return q ? { ...p, stock: Number(p.stock) - q } : p
        })
        cacheSet(uid, 'products', next)
        return next
      })
      setNotice('Sin conexión: la venta quedó guardada en el teléfono y se enviará sola cuando vuelva la señal.')
    }
    setReceipt({
      ref: 'MOS-' + sale.client_id.slice(0, 8).toUpperCase(),
      date: new Date(sale.captured_at),
      seller: user?.full_name || user?.email || '',
      customer: customer?.name || 'Cliente de mostrador',
      priceLabel: priceType === 'mayor' ? 'Por mayor' : 'Detal',
      lines: lines.map(l => ({
        name: l.product.name,
        qty: l.qty,
        price: l.price,
        subtotal: l.subtotal,
        mayor: l.mayor,
      })),
      sum,
      discount,
      taxRate: tx.tax > 0 ? tx.rate : 0,
      tax: tx.tax,
      total,
      payment,
      received: recv,
      change: recv != null ? round2(recv - total) : 0,
      fx: fxRes,
      pending: queued,
    })
    setSaving(false)
    resetSale()
    if (!queued) {
      void load()
      void loadToday()
    }
  }

  const canCharge = !readOnly && !saving && ready && lines.length > 0 && lines.every(l => l.qty > 0)

  const qtyInCartMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of cart) {
      const q = parseFloat(l.qty) || 0
      if (q > 0) m.set(l.product_id, q)
    }
    return m
  }, [cart])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Store className="w-5 h-5" /> Mostrador (POS)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Venta rápida con fotografías reales de productos, código de barras, detal/mayorista y multimoneda
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              if (readOnly) return
              setShowNotebookScanner(true)
            }}
            disabled={readOnly}
            title="Fotografiar o subir hojas de cuaderno escritas a mano para cargar ventas por lote"
            className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-900 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <NotebookPen className="w-3.5 h-3.5 text-amber-700 shrink-0" /> Cuaderno sin luz
          </button>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5 text-emerald-700" /> Catálogo PDF / WhatsApp
            </button>
          )}
          {activeWarehouses.length > 0 && (
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
              <WarehouseIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <select
                value={activeWarehouseId || ''}
                onChange={e => setActiveWarehouseId(e.target.value || null)}
                aria-label="Bodega de despacho en mostrador"
                className="text-xs font-medium text-slate-800 bg-transparent focus:outline-none"
              >
                {activeWarehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.code ? `${w.code} · ` : ''}
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {today && (
            <div className="text-right shrink-0 tabular-nums">
              <p className="text-[11px] text-slate-400">
                {isManager ? 'Hoy en mostrador' : 'Mis ventas de hoy'}
              </p>
              <p className="text-sm font-bold text-slate-800">{money(today.total)}</p>
              <p className="text-[11px] text-slate-400">{today.n} venta(s)</p>
            </div>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Activa tu suscripción para registrar ventas.
        </div>
      )}
      {!online && (
        <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión. Puedes seguir vendiendo: las ventas se guardan en el teléfono y se envían solas al volver la señal.
        </div>
      )}
      {pendingSales > 0 && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {pendingSales} venta(s) esperan enviarse al servidor.
        </div>
      )}
      {imageSchemaMissing && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-3.5 py-2.5 mb-4 text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Tabla de imágenes pendiente en Supabase:</strong> ejecuta el script SQL de{' '}
              <code className="font-mono">product_images</code> para que las fotos subidas en POS queden guardadas permanentemente y aparezcan en el PDF.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSqlModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Database className="w-3.5 h-3.5" /> Activar SQL de Imágenes
          </button>
        </div>
      )}
      {loadErr && (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {loadErr}
        </div>
      )}
      {notice && (
        <div className="text-slate-800 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {notice}
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-4 items-start">
        {/* Panel izquierdo (7 cols): buscador + cuadrícula visual con imagen real */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onSearchEnter()
                  }
                }}
                placeholder="Nombre o código de barras del producto"
                autoComplete="off"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => setScanning(true)}
              disabled={readOnly}
              className="flex items-center gap-2 bg-slate-800 text-white px-3 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
              title="Escanear con la cámara"
            >
              <Camera className="w-4 h-4" /> <span className="hidden sm:inline">Escanear</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            Con lector USB escanea directo aquí. Pulsa el ícono del ojo en cualquier cuadrito para ver la foto real en grande.
          </p>

          {search.trim() !== '' ? (
            <div className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {results.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">Sin resultados</p>
              )}
              {results.map(p => {
                const out = Number(p.stock) <= 0
                return (
                  <div
                    key={p.id}
                    className="px-3 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewProduct(p)}
                      title="Ver imagen real del producto"
                      className="relative group shrink-0 rounded-lg overflow-hidden focus:outline-none"
                    >
                      <ProductThumb src={p.image_url} name={p.name} size="md" fit="contain" />
                      <span className="absolute inset-0 bg-slate-900/45 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Eye className="w-4 h-4" />
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => pick(p)}
                      disabled={out || readOnly}
                      className="min-w-0 flex-1 text-left disabled:opacity-50 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          {p.sku}
                          {out ? ' · Agotado' : ` · stock ${p.stock}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <p className="text-sm font-semibold text-slate-800">{money(p.price)}</p>
                        {Number(p.price_wholesale) > 0 && (
                          <p className="text-[11px] text-emerald-700">
                            Mayor {money(Number(p.price_wholesale))}
                            {Number(p.wholesale_min_qty) > 0 ? ` (desde ${p.wholesale_min_qty})` : ''}
                          </p>
                        )}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPreviewProduct(p)}
                      title="Ver imagen real"
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 max-w-full">
                  <button
                    type="button"
                    onClick={() => setCategoryFilter('all')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      categoryFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Todos ({products.length})
                  </button>
                  {categories.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategoryFilter(c.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        categoryFilter === c.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>

                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPosView('cards')}
                    title="Tarjetas con foto real"
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap ${
                      posView === 'cards' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" /> Fotos
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosView('compact')}
                    title="Vista compacta"
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap ${
                      posView === 'compact' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" /> Compacto
                  </button>
                </div>
              </div>

              {quickPicks.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  No hay productos en esta categoría.
                </p>
              ) : posView === 'cards' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[560px] overflow-y-auto pr-0.5">
                  {quickPicks.map(p => {
                    const out = Number(p.stock) <= 0
                    const inCartQty = qtyInCartMap.get(p.id) || 0
                    const activeUnitPrice = priceFor(p, Math.max(1, inCartQty || 1), priceType)

                    return (
                      <div
                        key={p.id}
                        className={`group relative rounded-xl border bg-white overflow-hidden flex flex-col transition-colors ${
                          inCartQty > 0
                            ? 'border-emerald-500'
                            : 'border-slate-200 hover:border-slate-300'
                        } ${out ? 'opacity-65' : ''}`}
                      >
                        <div className="relative bg-white border-b border-slate-100">
                          <button
                            type="button"
                            disabled={out || readOnly}
                            onClick={() => pick(p)}
                            className="w-full block text-left focus:outline-none disabled:cursor-not-allowed"
                          >
                            <ProductThumb
                              src={p.image_url}
                              name={p.name}
                              size="card"
                              fit="contain"
                              className="border-0 rounded-none"
                            />
                          </button>

                          {/* Botón en el cuadrito para ver la imagen real del producto */}
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation()
                              setPreviewProduct(p)
                            }}
                            title="Ver imagen real del producto"
                            className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/95 hover:bg-slate-900 text-slate-700 hover:text-white border border-slate-200/90 text-[11px] font-medium shadow-sm transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="hidden xl:inline">Ver foto</span>
                          </button>

                          {inCartQty > 0 && (
                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[11px] font-bold tabular-nums">
                              {inCartQty} en venta
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={out || readOnly}
                          onClick={() => pick(p)}
                          className="p-2.5 text-left flex-1 flex flex-col justify-between gap-1.5 hover:bg-slate-50/70 disabled:cursor-not-allowed"
                        >
                          <div>
                            <p className="text-xs font-semibold text-slate-800 line-clamp-2 leading-snug">
                              {p.name}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                              {p.sku}
                            </p>
                          </div>

                          <div className="pt-1 flex items-end justify-between gap-1 tabular-nums">
                            <div>
                              <p className="text-xs sm:text-sm font-bold text-slate-900">
                                {money(activeUnitPrice.price)}
                              </p>
                              {Number(p.price_wholesale) > 0 && priceType !== 'mayor' && (
                                <p className="text-[10px] text-emerald-700">
                                  Mayor {money(Number(p.price_wholesale))}
                                </p>
                              )}
                            </div>
                            <span
                              className={`text-[10px] font-medium ${
                                out
                                  ? 'text-red-600'
                                  : Number(p.stock) <= Number(p.min_stock)
                                    ? 'text-amber-700'
                                    : 'text-slate-400'
                              }`}
                            >
                              {out ? 'Agotado' : `Disp. ${p.stock}`}
                            </span>
                          </div>
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[540px] overflow-y-auto pr-0.5">
                  {quickPicks.map(p => {
                    const out = Number(p.stock) <= 0
                    const inCartQty = qtyInCartMap.get(p.id) || 0
                    return (
                      <div
                        key={p.id}
                        className={`p-2 rounded-lg border flex items-center gap-2 transition-colors ${
                          inCartQty > 0
                            ? 'border-emerald-500 bg-emerald-50/20'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewProduct(p)}
                          title="Ver imagen real"
                          className="relative group shrink-0"
                        >
                          <ProductThumb src={p.image_url} name={p.name} size="md" fit="contain" />
                          <span className="absolute inset-0 rounded-lg bg-slate-900/45 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Eye className="w-3.5 h-3.5" />
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={out || readOnly}
                          onClick={() => pick(p)}
                          className="min-w-0 flex-1 text-left disabled:opacity-40"
                        >
                          <p className="text-xs font-medium text-slate-800 truncate">{p.name}</p>
                          <p className="text-xs font-bold text-slate-900 tabular-nums mt-0.5">
                            {money(p.price)}
                          </p>
                          <p className="text-[10px] text-slate-400 tabular-nums">
                            {out ? 'Agotado' : `Disp. ${p.stock}`}
                            {inCartQty > 0 ? ` · ${inCartQty} en venta` : ''}
                          </p>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panel derecho (5 cols): Venta actual y cobro */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Cliente</label>
              <select
                value={customerId}
                onChange={e => {
                  setCustomerId(e.target.value)
                  setOverride(null)
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              >
                <option value="">Cliente de mostrador</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.price_type === 'mayor' ? ' (mayor)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Precio</label>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
                {(['detal', 'mayor'] as PriceType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOverride(t === customerType ? null : t)}
                    className={`flex-1 py-2 font-medium whitespace-nowrap ${
                      priceType === t
                        ? 'bg-slate-800 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t === 'detal' ? 'Detal' : 'Por mayor'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              Toca cualquier producto o escanéalo para iniciar la venta
            </p>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-80 overflow-y-auto">
              {lines.map(l => (
                <div key={l.product.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => setPreviewProduct(l.product)}
                        title="Ver fotografía real"
                        className="shrink-0"
                      >
                        <ProductThumb src={l.product.image_url} name={l.product.name} size="sm" fit="contain" />
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{l.product.name}</p>
                        <p className="text-[11px] text-slate-500 tabular-nums">
                          {money(l.price)} c/u{' '}
                          {l.mayor && (
                            <span className="ml-1 text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-medium">
                              Mayor
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(l.product.id)}
                      className="p-1.5 rounded hover:bg-red-50 shrink-0"
                      aria-label="Quitar"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => step(l.product.id, -1)}
                        className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200"
                        aria-label="Menos"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={l.qtyText}
                        onChange={e => setQty(l.product.id, e.target.value)}
                        className="w-16 text-center py-1.5 rounded-lg border border-slate-300 text-sm tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => step(l.product.id, 1)}
                        className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200"
                        aria-label="Más"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm font-semibold text-slate-800 tabular-nums">
                      {money(l.subtotal)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {lines.length > 0 && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Descuento</label>
                <div className="flex gap-2">
                  <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm shrink-0">
                    <button
                      type="button"
                      onClick={() => setDiscMode('monto')}
                      className={`px-3 py-2 font-medium ${
                        discMode === 'monto' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'
                      }`}
                    >
                      $
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscMode('pct')}
                      className={`px-3 py-2 font-medium ${
                        discMode === 'pct' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'
                      }`}
                    >
                      %
                    </button>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={discValue}
                    onChange={e => setDiscValue(e.target.value)}
                    placeholder={discMode === 'pct' ? 'Ej: 10' : 'Ej: 5'}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-1 text-sm tabular-nums">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span>{money(sum)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Descuento</span>
                    <span>-{money(discount)}</span>
                  </div>
                )}
                {tx.tax > 0 && (
                  <>
                    {taxMode === 'adicional' && (
                      <div className="flex justify-between text-slate-500">
                        <span>Base</span>
                        <span>{money(tx.subtotal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-500">
                      <span>
                        Impuesto{tx.rate ? ` (${tx.rate}%)` : ''}
                        {taxMode === 'incluido' ? ' incluido' : ''}
                      </span>
                      <span>{money(tx.tax)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-lg font-bold text-slate-800 pt-1">
                  <span>Total</span>
                  <span>{money(total)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Forma de pago</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(PAYMENT_LABEL).map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setPayment(k)
                        if (k === 'fiado' || k === 'tarjeta') setFx(null)
                      }}
                      className={`py-2 rounded-lg text-sm font-medium border whitespace-nowrap ${
                        payment === k
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {payment === 'fiado' && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  {customerId
                    ? 'El cliente queda debiendo este valor y se cobra después con abonos.'
                    : 'Elige un cliente registrado para venderle a crédito.'}
                </p>
              )}

              {payment === 'efectivo' && !fx && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Efectivo recibido (opcional)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={received}
                    onChange={e => setReceived(e.target.value)}
                    placeholder="Ej: 20"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                  {receivedNum != null && !isNaN(receivedNum) && (
                    <p
                      className={`text-sm font-semibold mt-1.5 tabular-nums ${
                        change < 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {change < 0 ? `Faltan ${money(-change)}` : `Cambio: ${money(change)}`}
                    </p>
                  )}
                </div>
              )}

              {(payment === 'efectivo' || payment === 'transferencia') &&
                !!config &&
                'fx_rates' in (config as object) && (
                  <FxPayment
                    base={baseCur}
                    total={total}
                    rates={fxRates}
                    value={fx}
                    onChange={setFx}
                  />
                )}

              <button
                type="button"
                onClick={charge}
                disabled={!canCharge}
                className="w-full bg-emerald-600 text-white py-3 rounded-lg text-base font-bold hover:bg-emerald-700 disabled:opacity-40 tabular-nums"
              >
                {saving ? 'Registrando...' : `Cobrar ${money(total)}`}
              </button>
              <button
                type="button"
                onClick={resetSale}
                className="w-full text-xs text-slate-500 hover:text-red-600 py-1"
              >
                Vaciar venta
              </button>
            </div>
          )}
        </div>
      </div>

      {scanning && <BarcodeScanner onDetect={onScan} onClose={() => setScanning(false)} />}

      {/* Visor de imagen real del producto desde el cuadrito o carrito */}
      <ProductPhotoLightbox
        product={
          previewProduct
            ? {
                id: previewProduct.id,
                name: previewProduct.name,
                sku: previewProduct.sku,
                categoryName: previewProduct.category_id
                  ? catMap.get(previewProduct.category_id) || 'Catálogo'
                  : 'Catálogo',
                description: previewProduct.description,
                unit: previewProduct.unit,
                priceLabel: money(previewProduct.price),
                wholesaleLabel:
                  Number(previewProduct.price_wholesale) > 0
                    ? `Mayorista: ${money(Number(previewProduct.price_wholesale))}${
                        Number(previewProduct.wholesale_min_qty) > 0
                          ? ` (desde ${previewProduct.wholesale_min_qty} ${previewProduct.unit})`
                          : ''
                      }`
                    : null,
                stockLabel:
                  Number(previewProduct.stock) <= 0
                    ? 'Agotado'
                    : `${previewProduct.stock} ${previewProduct.unit} disponibles`,
                outOfStock: Number(previewProduct.stock) <= 0,
                image_url: previewProduct.image_url,
              }
            : null
        }
        onClose={() => setPreviewProduct(null)}
        onAddToSale={
          previewProduct && !readOnly
            ? () => {
                pick(previewProduct)
              }
            : undefined
        }
        addLabel="Agregar a la venta"
        canEditPhoto={canEditPhotos}
        companyId={user?.company_id || config?.company_id}
        onPhotoUpdated={
          previewProduct && canEditPhotos
            ? nextUrl => handleQuickPhotoSave(previewProduct, nextUrl)
            : undefined
        }
      />

      <SqlActivationModal
        open={sqlModalOpen}
        onClose={() => setSqlModalOpen(false)}
        initialBundle="images"
      />

      {receipt && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">Venta registrada</h2>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="p-1 rounded hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {receipt.ref}
              {receipt.pending ? ' · pendiente de envío (sin señal)' : ''}
            </p>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{money(receipt.total)}</p>
            {receipt.fx && (
              <p className="text-sm text-slate-600 mt-1 tabular-nums">
                Pagó en {receipt.fx.currency}:{' '}
                {formatMoney(receipt.fx.amount, receipt.fx.currency)}
                {receipt.fx.baseAmount > 0 ? ` + ${money(receipt.fx.baseAmount)}` : ''}
              </p>
            )}
            {receipt.received != null && (
              <p className="text-sm text-emerald-700 font-semibold mt-1 tabular-nums">
                Cambio: {money(receipt.change)}
              </p>
            )}
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => printHtml(ticketHtml(receipt, config))}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700"
              >
                <Printer className="w-4 h-4" /> Imprimir ticket
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(shareText(receipt, config))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-100"
              >
                <MessageCircle className="w-4 h-4" /> Enviar por WhatsApp
              </a>
              <button
                type="button"
                onClick={() => {
                  setReceipt(null)
                  searchRef.current?.focus()
                }}
                className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                Nueva venta
              </button>
            </div>
          </div>
        </div>
      )}

      <HandwrittenSalesScannerModal
        open={showNotebookScanner}
        onClose={() => setShowNotebookScanner(false)}
        onCompleted={summaryMsg => {
          setNotice(summaryMsg)
          void load()
          void loadToday()
        }}
        products={products}
        customers={customers}
        config={config}
        userId={uid}
        sellerName={user?.full_name || 'Cajero'}
        warehouses={activeWarehouses}
        defaultWarehouseId={activeWarehouseId}
        defaultChannel="mostrador"
      />
    </div>
  )
}
