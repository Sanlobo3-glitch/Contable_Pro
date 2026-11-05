import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageInventory } from '../lib/auth'
import { useCurrency, formatMoney } from '../lib/currency'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import { geoPayload, type VisitCheckResult } from '../lib/geo'
import { cacheGet, cacheSet, clearPendingError, clearVisitError, enqueueSale, enqueueVisit, newId, onQueueChange, onSynced, pendingCount, pendingToCustomer, readCustomerQueue, readQueue, readVisitQueue, removePending, removePendingVisit, sendSale, sendVisit, syncQueue, type PendingCustomer, type PendingSale, type PendingVisit } from '../lib/offlineQueue'
import { calcTax, round2, taxDocFields, taxModeOf, taxRateOf, type TaxFields } from '../lib/tax'
import { priceFor, type PriceType } from '../lib/pricing'
import VisitCheck, { VISIT_QUICK } from '../components/VisitCheck'
import FxPayment, { fxResult, type FxState } from '../components/FxPayment'
import { downloadCsv } from '../lib/csv'
import { consumeRouteCustomerHandoff } from '../lib/routeHandoff'
import { useWarehouse } from '../lib/warehouseContext'
import HandwrittenSalesScannerModal from '../components/HandwrittenSalesScannerModal'
import { ProductPhotoLightbox, ProductThumb } from '../components/ProductImageCapture'
import { hydrateProductsWithImages, saveProductImageInSupabase } from '../lib/productImages'
import type { Product, Customer, Sale, CompanyConfig } from '../types'
import { Plus, X, Trash2, ShoppingCart, Lock, Ban, Printer, MessageCircle, Mail, Share2, MapPin, WifiOff, RefreshCw, Search, Download, Eye, NotebookPen } from 'lucide-react'

const PAYMENT_LABEL: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado (a crédito)' }

function buildSaleDoc(s: Sale, c: Customer | undefined): DocData {
  const fxAmount = Number(s.fx_amount), fxRate = Number(s.fx_rate)
  const fx = s.fx_currency && fxAmount > 0 && fxRate > 0
    ? (() => {
        const fxEq = round2(fxAmount * fxRate)
        const equivalent = Number(s.amount_received) || fxEq
        return { currency: s.fx_currency as string, amount: fxAmount, rate: fxRate, equivalent, baseAmount: Math.max(0, round2(equivalent - fxEq)) }
      })()
    : undefined
  return {
    title: 'COMPROBANTE DE VENTA',
    number: 'VTA-' + s.id.slice(0, 8).toUpperCase(),
    date: new Date(s.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
    badge: s.status === 'anulada' ? 'ANULADA' : undefined,
    partyName: s.customer_name || 'Cliente general',
    partyLines: [c?.document && `Documento: ${c.document}`, c?.phone && `Tel: ${c.phone}`, c?.email, c?.address],
    paymentLabel: `Pago: ${PAYMENT_LABEL[s.payment_method] ?? s.payment_method}`,
    fx,
    lines: s.items.map(i => ({ name: i.product_name, quantity: i.quantity, price: i.price, subtotal: i.subtotal })),
    ...taxDocFields(s as Sale & TaxFields),
    total: s.total,
    footer: 'Gracias por su compra. Este comprobante no constituye factura fiscal.',
  }
}

export default function Sales() {
  const { user } = useAuth()
  const { activeWarehouses, activeWarehouseId } = useWarehouse()
  const { fmt: money, currency: baseCur, fxRates } = useCurrency()
  const readOnly = isReadOnly(user)
  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [baseCustomers, setCustomers] = useState<Customer[]>([])
  const [pendingCustomers, setPendingCustomers] = useState<PendingCustomer[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [cfgReady, setCfgReady] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showNotebookScanner, setShowNotebookScanner] = useState(false)
  const [showGeo, setShowGeo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cart, setCart] = useState<{ product_id: string; product_name: string; quantity: number; price: number; subtotal: number }[]>([])
  const [selProduct, setSelProduct] = useState('')
  const [qty, setQty] = useState('1')
  const [customerId, setCustomerId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [fx, setFx] = useState<FxState | null>(null)
  const [viewTarget, setViewTarget] = useState<Sale | null>(null)
  const [showVisit, setShowVisit] = useState(false)
  const [visitCustomer, setVisitCustomer] = useState('')
  const [showVisitGeo, setShowVisitGeo] = useState(false)
  const [visitSaving, setVisitSaving] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState<PendingSale[]>([])
  const [pendingVisits, setPendingVisits] = useState<PendingVisit[]>([])
  const [notice, setNotice] = useState('')
  const [syncingNow, setSyncingNow] = useState(false)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [modalProdSearch, setModalProdSearch] = useState('')
  const [formErr, setFormErr] = useState('')
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null)
  const uid = user?.id ?? ''
  // Clientes del servidor + clientes nuevos creados sin señal (ya se les puede vender)
  const customers: Customer[] = [
    ...baseCustomers,
    ...pendingCustomers.filter(p => !baseCustomers.some(c => c.id === p.client_id)).map(pendingToCustomer),
  ]

  useEffect(() => {
    void load()
    const handoff = consumeRouteCustomerHandoff()
    if (handoff) {
      if (handoff.action === 'visit') {
        setVisitCustomer(handoff.customerId)
        setShowVisit(true)
        setNotice(`Ruta activa: registrando visita a ${handoff.customerName}.`)
      } else {
        setCustomerId(handoff.customerId)
        setShowForm(true)
        setNotice(`Ruta activa: cliente ${handoff.customerName} seleccionado para nueva venta.`)
      }
    }
  }, [])
  async function load() {
    const [rs, rp, rc, rcfg] = await Promise.all([
      supabase.from('sales').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
      supabase.from('company_config').select('*').limit(1),
    ])
    if (rs.error || rp.error || rc.error) {
      // Sin conexión: se usa la copia guardada en el teléfono
      if (uid) {
        const cs = cacheGet<Sale[]>(uid, 'sales'), cp = cacheGet<Product[]>(uid, 'products')
        const cc = cacheGet<Customer[]>(uid, 'customers'), cg = cacheGet<CompanyConfig>(uid, 'config')
        if (cs) setSales(cs)
        if (cp) setProducts(cp)
        if (cc) setCustomers(cc)
        if (cg) setConfig(cg)
      }
      setCfgReady(true)
      return
    }
    const sl = (rs.data || []) as Sale[], rawProducts = (rp.data || []) as Product[], cl = (rc.data || []) as Customer[]
    const { products: pl } = await hydrateProductsWithImages(rawProducts)
    const cfg = ((rcfg.data || [])[0] as CompanyConfig) ?? null
    setSales(sl); setProducts(pl); setCustomers(cl); setConfig(cfg)
    setCfgReady(true)
    if (uid) {
      cacheSet(uid, 'sales', sl.slice(0, 100)); cacheSet(uid, 'products', pl); cacheSet(uid, 'customers', cl)
      if (cfg) cacheSet(uid, 'config', cfg)
    }
  }

  // Ventas guardadas en el teléfono, estado de la conexión y envío automático
  useEffect(() => {
    if (!uid) return
    const refresh = () => { setPending(readQueue(uid)); setPendingVisits(readVisitQueue(uid)); setPendingCustomers(readCustomerQueue(uid)) }
    refresh()
    const off = onQueueChange(refresh)
    const offSync = onSynced(r => {
      if (r.sent > 0) { setNotice(`Se enviaron ${r.sent} registro(s) guardados sin conexión.`); load() }
      if (r.failed > 0) setNotice(`${r.failed} registro(s) fueron rechazados por el servidor. Revísalos abajo.`)
    })
    const goOnline = () => { setOnline(true); runSync() }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    const timer = window.setInterval(() => { if (navigator.onLine) runSync() }, 45000)
    if (navigator.onLine) runSync()
    return () => {
      off(); offSync()
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  async function runSync() {
    if (!uid || pendingCount(uid) === 0) return
    setSyncingNow(true)
    await syncQueue(uid)
    setSyncingNow(false)
  }
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 7000)
    return () => window.clearTimeout(t)
  }, [notice])

  // ¿Esta empresa pide ubicación al registrar ventas, y a este usuario?
  const geoMode = config?.geo_mode ?? 'off'
  const needsGeo = geoMode === 'todos' || (geoMode === 'vendedores' && user?.role === 'vendedor')

  function addProductDirect(p: Product, qNum = 1) {
    if (readOnly) return
    setFormErr('')
    const q = Math.max(1, qNum)
    const already = cart.filter(i => i.product_id === p.id).reduce((a, i) => a + i.quantity, 0)
    if (already + q > Number(p.stock)) {
      setFormErr(`Stock insuficiente para ${p.name} (disponible: ${p.stock}).`)
      return
    }
    const existingIdx = cart.findIndex(i => i.product_id === p.id)
    if (existingIdx >= 0) {
      const next = [...cart]
      const newQty = next[existingIdx].quantity + q
      next[existingIdx] = {
        ...next[existingIdx],
        quantity: newQty,
        subtotal: p.price * newQty,
      }
      setCart(next)
    } else {
      setCart([...cart, { product_id: p.id, product_name: p.name, quantity: q, price: p.price, subtotal: p.price * q }])
    }
  }

  function addToCart() {
    if (readOnly) return
    const p = products.find(x => x.id === selProduct)
    if (!p) return
    addProductDirect(p, parseInt(qty) || 1)
    setSelProduct('')
    setQty('1')
  }
  function removeFromCart(i: number) { if (readOnly) return; setCart(cart.filter((_, idx) => idx !== i)) }
  // Precio según el tipo del cliente y la cantidad total de cada producto (precio por mayor del producto)
  const customerType: PriceType = customers.find(c => c.id === customerId)?.price_type === 'mayor' ? 'mayor' : 'detal'
  const qtyByProduct = new Map<string, number>()
  for (const i of cart) qtyByProduct.set(i.product_id, (qtyByProduct.get(i.product_id) ?? 0) + i.quantity)
  const lines = cart.map(i => {
    const p = products.find(x => x.id === i.product_id)
    const pr = p ? priceFor(p, qtyByProduct.get(i.product_id) ?? i.quantity, customerType) : { price: i.price, mayor: false }
    return { product_id: i.product_id, product_name: i.product_name, quantity: i.quantity, price: pr.price, subtotal: round2(pr.price * i.quantity), mayor: pr.mayor }
  })
  const cartSum = round2(lines.reduce((s, i) => s + i.subtotal, 0))
  const taxMode = taxModeOf(config)
  const tx = calcTax(cartSum, taxMode, taxRateOf(config))
  const total = tx.total
  // Pago en otra moneda: solo con efectivo o transferencia
  const fxRes = paymentMethod === 'efectivo' || paymentMethod === 'transferencia' ? fxResult(fx) : null

  function handleSubmit() {
    if (readOnly || lines.length === 0 || saving || !cfgReady) return
    setFormErr('')
    if (fx && (paymentMethod === 'efectivo' || paymentMethod === 'transferencia')) {
      if (!fxRes) { setFormErr('Completa el monto recibido y la tasa del pago en otra moneda.'); return }
      if (fxRes.equivalent < total) { setFormErr('Lo recibido en la otra moneda no cubre el total de la venta.'); return }
    }
    if (paymentMethod === 'fiado') {
      if (!customerId) { setFormErr('El fiado requiere un cliente registrado. Elige un cliente.'); return }
      if (pendingCustomers.some(p => p.client_id === customerId)) { setFormErr('Este cliente aún no se ha sincronizado. Espera a que suba para venderle a crédito.'); return }
      if (!navigator.onLine) { setFormErr('El fiado necesita conexión a internet para revisar el cupo del cliente.'); return }
    }
    if (needsGeo) { setShowGeo(true); return }
    void registerSale(null)
  }

  async function registerSale(check: VisitCheckResult | null) {
    if (saving) return
    setSaving(true)
    const cust = customers.find(c => c.id === customerId)
    const sale: PendingSale = {
      client_id: newId(),
      customer_id: customerId || null,
      customer_name: cust?.name ?? null,
      items: lines.map(l => ({ product_id: l.product_id, product_name: l.product_name, quantity: l.quantity, price: l.price, subtotal: l.subtotal })),
      payment_method: paymentMethod,
      geo: check ? geoPayload(check) : null,
      captured_at: new Date().toISOString(),
      total,
      ...(fxRes ? { fx_currency: fxRes.currency, fx_amount: fxRes.amount, fx_rate: fxRes.rate, ...(fxRes.baseAmount > 0 ? { fx_base: fxRes.baseAmount } : {}) } : {}),
    }
    let queued = false
    if (!navigator.onLine) {
      queued = true
    } else {
      const r = await sendSale(sale)
      if (!r.ok && r.network) queued = true
      else if (!r.ok) { setSaving(false); alert('Error al registrar la venta: ' + r.message); return }
    }
    if (queued) {
      if (!enqueueSale(uid, sale)) {
        setSaving(false)
        alert('No se pudo guardar la venta en el teléfono (almacenamiento lleno o bloqueado). Conéctate a internet e inténtalo de nuevo.')
        return
      }
      // Descuenta el stock en la copia local para no vender de más sin conexión
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
    setSaving(false)
    setShowGeo(false); setShowForm(false); setCart([]); setCustomerId(''); setPaymentMethod('efectivo'); setFx(null)
    if (!queued) load()
  }

  async function registerVisitNoSale(check: VisitCheckResult) {
    if (visitSaving || !visitCustomer) return
    setVisitSaving(true)
    const visit: PendingVisit = {
      client_id: newId(),
      customer_id: visitCustomer,
      customer_name: customers.find(c => c.id === visitCustomer)?.name ?? null,
      geo: geoPayload(check),
      captured_at: new Date().toISOString(),
    }
    let queued = false
    if (!navigator.onLine) {
      queued = true
    } else {
      const r = await sendVisit(visit)
      if (!r.ok && r.network) queued = true
      else if (!r.ok) { setVisitSaving(false); alert('No se pudo registrar la visita: ' + r.message); return }
    }
    if (queued && !enqueueVisit(uid, visit)) {
      setVisitSaving(false)
      alert('No se pudo guardar la visita en el teléfono (almacenamiento lleno o bloqueado). Conéctate a internet e inténtalo de nuevo.')
      return
    }
    setVisitSaving(false)
    setShowVisitGeo(false); setShowVisit(false); setVisitCustomer('')
    setNotice(queued ? 'Sin conexión: la visita quedó guardada en el teléfono y se enviará sola cuando vuelva la señal.' : 'Visita registrada.')
  }

  async function handleAnular(id: string) {
    if (readOnly || !canManageInventory(user?.role)) return
    if (!confirm('¿Anular esta venta? Se devolverá el stock y se revertirá la caja.')) return
    const { error } = await supabase.rpc('anular_venta', { p_sale_id: id })
    if (error) { alert('Error al anular la venta: ' + error.message); return }
    load()
  }

  const viewCustomer = viewTarget ? customers.find(c => c.id === viewTarget.customer_id) : undefined
  const doc = viewTarget ? buildSaleDoc(viewTarget, viewCustomer) : null
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  function doPrint() { if (doc) printHtml(buildDocHtml(doc, config)) }
  function doWhatsApp() {
    if (doc) window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText(doc, config))}`, '_blank')
  }
  function doEmail() {
    if (!doc) return
    const subject = `${doc.title} ${doc.number}${config?.name ? ' - ' + config.name : ''}`
    window.location.href = `mailto:${viewCustomer?.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildShareText(doc, config))}`
  }
  async function doShare() {
    if (!doc) return
    try { await navigator.share({ title: `${doc.title} ${doc.number}`, text: buildShareText(doc, config) }) } catch { /* cancelado */ }
  }

  function statusBadge(s: Sale) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`text-xs font-medium px-2 py-1 rounded capitalize ${s.status === 'anulada' ? 'text-red-700 bg-red-50' : 'text-emerald-700 bg-emerald-50'}`}>{s.status}</span>
        {s.channel === 'mostrador' && <span className="text-xs font-medium px-2 py-1 rounded text-indigo-700 bg-indigo-50">Mostrador</span>}
        {s.fx_currency && <span className="text-xs font-medium px-2 py-1 rounded text-amber-700 bg-amber-50">Pagó en {s.fx_currency}</span>}
      </span>
    )
  }
  function rowActions(s: Sale) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setViewTarget(s)} className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded whitespace-nowrap">
          <Share2 className="w-3 h-3" /> Ver / Enviar
        </button>
        {!readOnly && canManageInventory(user?.role) && s.status !== 'anulada' && (
          <button onClick={() => handleAnular(s.id)} className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded whitespace-nowrap">
            <Ban className="w-3.5 h-3.5" /> Anular
          </button>
        )}
      </div>
    )
  }

  const qTerm = search.trim().toLowerCase()
  const filteredSales = sales.filter(s => {
    if (methodFilter && s.payment_method !== methodFilter) return false
    if (!qTerm) return true
    const code = ('vta-' + s.id.slice(0, 8)).toLowerCase()
    const itemsText = Array.isArray(s.items) ? s.items.map(i => i.product_name).join(' ').toLowerCase() : ''
    return (
      (s.customer_name || 'cliente general').toLowerCase().includes(qTerm) ||
      code.includes(qTerm) ||
      s.id.toLowerCase().includes(qTerm) ||
      itemsText.includes(qTerm)
    )
  })

  function exportExcel() {
    downloadCsv(
      `ventas_${new Date().toLocaleDateString('sv-SE')}.csv`,
      ['Comprobante', 'Fecha', 'Cliente', 'Canal', 'Forma de pago', 'Total', 'Estado', 'Productos'],
      filteredSales.map(s => [
        'VTA-' + s.id.slice(0, 8).toUpperCase(),
        new Date(s.created_at).toLocaleString(),
        s.customer_name || 'Cliente general',
        s.channel || 'ruta',
        s.payment_method,
        Number(s.total),
        s.status,
        Array.isArray(s.items) ? s.items.map(i => `${i.product_name} x${i.quantity}`).join(', ') : '',
      ])
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-6">
        <h1 className="text-xl font-bold text-slate-800">Ventas</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            type="button"
            onClick={() => { if (readOnly) return; setShowNotebookScanner(true) }}
            disabled={readOnly}
            title="Fotografiar o subir hojas de cuaderno escritas a mano para cargar ventas por lote"
            className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <NotebookPen className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Cuaderno sin luz</span>
          </button>
          <button
            onClick={() => { if (readOnly) return; setShowVisit(true) }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <MapPin className="w-4 h-4" /> <span className="hidden sm:inline">Visité y no compró</span><span className="sm:hidden">Sin compra</span>
          </button>
          <button
            onClick={() => { if (readOnly) return; setShowForm(true) }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Nueva venta
          </button>
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
      {notice && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">{notice}</div>}

      {(pending.length > 0 || pendingVisits.length > 0) && (
        <div className="bg-white rounded-xl border border-amber-300 overflow-hidden mb-4">
          <div className="px-4 py-2 bg-amber-50 flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-amber-800 uppercase">Pendientes de enviar ({pending.length + pendingVisits.length})</p>
            <button onClick={runSync} disabled={!online || syncingNow} className="flex items-center gap-1 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded disabled:opacity-40">
              <RefreshCw className={`w-3 h-3 ${syncingNow ? 'animate-spin' : ''}`} /> Enviar ahora
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {pending.map(ps => (
              <div key={ps.client_id} className="px-4 py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800 truncate">{ps.customer_name || 'Cliente general'} · {money(ps.total)}</p>
                  <p className="text-xs text-slate-400">{new Date(ps.captured_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · {ps.items.length} producto(s)</p>
                  {ps.error && <p className="text-xs text-red-600 mt-0.5">Rechazada: {ps.error}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {ps.error && <button onClick={() => { clearPendingError(uid, ps.client_id); runSync() }} className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded">Reintentar</button>}
                  <button onClick={() => { if (confirm('¿Descartar esta venta? No se registrará en el sistema.')) removePending(uid, ps.client_id) }} className="text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1 rounded">Descartar</button>
                </div>
              </div>
            ))}
            {pendingVisits.map(pv => (
              <div key={pv.client_id} className="px-4 py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800 truncate">Visita sin compra · {pv.customer_name || 'Cliente'}</p>
                  <p className="text-xs text-slate-400">{new Date(pv.captured_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                  {pv.error && <p className="text-xs text-red-600 mt-0.5">Rechazada: {pv.error}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {pv.error && <button onClick={() => { clearVisitError(uid, pv.client_id); runSync() }} className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded">Reintentar</button>}
                  <button onClick={() => { if (confirm('¿Descartar esta visita? No se registrará en el sistema.')) removePendingVisit(uid, pv.client_id) }} className="text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1 rounded">Descartar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por cliente, código VTA- o producto..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          />
        </div>
        <select
          value={methodFilter}
          onChange={e => setMethodFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">Todos los métodos</option>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="fiado">Fiado (a crédito)</option>
        </select>
      </div>

      {/* Móvil: tarjetas */}
      <div className="md:hidden space-y-3">
        {filteredSales.map(s => (
          <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">{s.customer_name || 'Cliente general'}</p>
                <p className="text-xs text-slate-400">{new Date(s.created_at).toLocaleDateString()} · <span className="capitalize">{s.payment_method}</span></p>
              </div>
              <p className={`font-bold whitespace-nowrap ${s.status === 'anulada' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{money(s.total)}</p>
            </div>
            <div className="mt-3">{statusBadge(s)}</div>
            <div className="mt-3">{rowActions(s)}</div>
          </div>
        ))}
        {filteredSales.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No hay ventas</p>}
      </div>

      {/* Escritorio: tabla */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase"><tr><th className="text-left px-4 py-3 font-medium">Fecha</th><th className="text-left px-4 py-3 font-medium">Cliente</th><th className="text-left px-4 py-3 font-medium">Total</th><th className="text-left px-4 py-3 font-medium">Pago</th><th className="text-left px-4 py-3 font-medium">Estado</th><th className="text-left px-4 py-3 font-medium">Acciones</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filteredSales.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{s.customer_name || '—'}</td>
                <td className={`px-4 py-3 ${s.status === 'anulada' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{money(s.total)}</td>
                <td className="px-4 py-3 text-slate-500 capitalize">{s.payment_method}</td>
                <td className="px-4 py-3">{statusBadge(s)}</td>
                <td className="px-4 py-3">{rowActions(s)}</td>
              </tr>
            ))}
            {filteredSales.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No hay ventas</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { setShowForm(false); setFx(null); setFormErr('') }}>
          <div className="bg-white rounded-xl p-6 w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="font-bold text-slate-800">Nueva venta</h2><button onClick={() => { setShowForm(false); setFx(null); setFormErr('') }} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3">
              {formErr && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formErr}
                </div>
              )}
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"><option value="">Cliente general</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.document ? ` — ${c.document}` : ''}</option>)}</select>

              {/* Selector visual con fotografía real */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={modalProdSearch}
                    onChange={e => setModalProdSearch(e.target.value)}
                    placeholder="Buscar producto con foto o código..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-0.5">
                  {products
                    .filter(
                      p =>
                        !modalProdSearch.trim() ||
                        p.name.toLowerCase().includes(modalProdSearch.trim().toLowerCase()) ||
                        (p.sku || '').toLowerCase().includes(modalProdSearch.trim().toLowerCase())
                    )
                    .slice(0, 16)
                    .map(p => {
                      const out = Number(p.stock) <= 0
                      return (
                        <div
                          key={p.id}
                          className="bg-white rounded-lg border border-slate-200 p-2 flex items-center gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => setPreviewProduct(p)}
                            title="Ver imagen real"
                            className="relative group shrink-0"
                          >
                            <ProductThumb src={p.image_url} name={p.name} size="sm" fit="contain" />
                            <span className="absolute inset-0 rounded-lg bg-slate-900/45 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Eye className="w-3.5 h-3.5" />
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={out}
                            onClick={() => addProductDirect(p, 1)}
                            className="min-w-0 flex-1 text-left disabled:opacity-45"
                          >
                            <p className="text-xs font-medium text-slate-800 truncate">{p.name}</p>
                            <p className="text-[11px] font-semibold text-slate-900 tabular-nums">
                              {money(p.price)}{' '}
                              <span className="font-normal text-slate-400">
                                · {out ? 'Agotado' : `disp. ${p.stock}`}
                              </span>
                            </p>
                          </button>
                          <button
                            type="button"
                            disabled={out}
                            onClick={() => addProductDirect(p, 1)}
                            className="p-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-30 shrink-0"
                            title="Sumar al pedido"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )
                    })}
                </div>

                <div className="flex gap-2 pt-1 border-t border-slate-200/70">
                  <select value={selProduct} onChange={e => setSelProduct(e.target.value)} className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"><option value="">Selección rápida por lista…</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} ({money(p.price)}) · stock {p.stock}</option>)}</select>
                  <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs tabular-nums" />
                  <button type="button" onClick={addToCart} className="px-3 py-1.5 bg-slate-200 rounded-lg text-xs font-medium hover:bg-slate-300"><Plus className="w-3.5 h-3.5" /></button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                {lines.map((item, i) => {
                  const prodObj = products.find(p => p.id === item.product_id)
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => prodObj && setPreviewProduct(prodObj)}
                          className="shrink-0"
                        >
                          <ProductThumb src={prodObj?.image_url} name={item.product_name} size="xs" fit="contain" />
                        </button>
                        <span className="text-slate-700 truncate">
                          {item.product_name} x{item.quantity}
                          {item.mayor && <span className="ml-1.5 text-[10px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Mayor</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 tabular-nums"><span className="text-slate-600 font-medium">{money(item.subtotal)}</span><button onClick={() => removeFromCart(i)} className="p-1 rounded hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button></div>
                    </div>
                  )
                })}
                {lines.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Carrito vacío</p>}
              </div>
              <select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); if (e.target.value === 'fiado' || e.target.value === 'tarjeta') setFx(null) }} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia</option><option value="fiado">Fiado (a crédito)</option></select>
              {paymentMethod === 'fiado' && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Fiado: el cliente queda debiendo este valor. Elige un cliente registrado; necesita conexión a internet.</p>}
              {(paymentMethod === 'efectivo' || paymentMethod === 'transferencia') && !!config && 'fx_rates' in (config as object) && (
                <FxPayment base={baseCur} total={total} rates={fxRates} value={fx} onChange={setFx} />
              )}
              {tx.tax > 0 && (
                <div className="space-y-1 pt-2 border-t border-slate-100 text-sm text-slate-500 tabular-nums">
                  <div className="flex justify-between"><span>Subtotal</span><span>{money(tx.subtotal)}</span></div>
                  <div className="flex justify-between"><span>Impuesto ({tx.rate}%){taxMode === 'incluido' ? ' incluido' : ''}</span><span>{money(tx.tax)}</span></div>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-slate-100 tabular-nums"><span className="font-bold text-slate-800">Total:</span><span className="font-bold text-slate-800 text-lg">{money(total)}</span></div>
              <button onClick={handleSubmit} disabled={lines.length === 0 || saving || !cfgReady} className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"><ShoppingCart className="w-4 h-4" /> {saving ? 'Registrando...' : needsGeo ? 'Continuar' : 'Registrar venta'}</button>
            </div>
          </div>
        </div>
      )}

      <ProductPhotoLightbox
        product={
          previewProduct
            ? {
                id: previewProduct.id,
                name: previewProduct.name,
                sku: previewProduct.sku,
                description: previewProduct.description,
                unit: previewProduct.unit,
                priceLabel: money(previewProduct.price),
                wholesaleLabel:
                  Number(previewProduct.price_wholesale) > 0
                    ? `Mayorista: ${money(Number(previewProduct.price_wholesale))}${
                        Number(previewProduct.wholesale_min_qty) > 0
                          ? ` (desde ${previewProduct.wholesale_min_qty})`
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
            ? () => addProductDirect(previewProduct, 1)
            : undefined
        }
        addLabel="Sumar al carrito"
        canEditPhoto={!readOnly && (canManageInventory(user?.role) || user?.role === 'cajero')}
        companyId={user?.company_id}
        onPhotoUpdated={
          previewProduct && !readOnly && (canManageInventory(user?.role) || user?.role === 'cajero')
            ? async nextUrl => {
                const { savedUrl } = await saveProductImageInSupabase({
                  productId: previewProduct.id,
                  companyId: user?.company_id,
                  skuOrName: previewProduct.sku || previewProduct.name,
                  imageUrl: nextUrl,
                })
                setProducts(prev => {
                  const updated = prev.map(p => (p.id === previewProduct.id ? { ...p, image_url: savedUrl } : p))
                  if (uid) cacheSet(uid, 'products', updated)
                  return updated
                })
                setPreviewProduct(prev => (prev ? { ...prev, image_url: savedUrl } : null))
                setNotice(
                  savedUrl
                    ? `Fotografía de "${previewProduct.name}" guardada en Supabase.`
                    : `Fotografía de "${previewProduct.name}" eliminada.`
                )
              }
            : undefined
        }
      />

      {showVisit && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!visitSaving) setShowVisit(false) }}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-slate-800">Visité y no compró</h2><button onClick={() => setShowVisit(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <p className="text-xs text-slate-500 mb-3">Registra la visita a un cliente que no hizo pedido. Así el supervisor sabe que fue atendido.</p>
            <select value={visitCustomer} onChange={e => setVisitCustomer(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm mb-3">
              <option value="">Selecciona el cliente</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.document ? ` — ${c.document}` : ''}</option>)}
            </select>
            <button onClick={() => setShowVisitGeo(true)} disabled={!visitCustomer || visitSaving} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">Continuar</button>
          </div>
        </div>
      )}

      <VisitCheck
        open={showVisitGeo}
        title="Ubicación de la visita"
        requireNote
        quick={VISIT_QUICK}
        noteLabel="Motivo (obligatorio)"
        placeholder="Ej: aún tiene inventario"
        confirmLabel="Registrar visita"
        onCancel={() => { if (!visitSaving) setShowVisitGeo(false) }}
        onDone={check => registerVisitNoSale(check)}
      />

      <VisitCheck
        open={showGeo}
        title="Ubicación de la venta"
        onCancel={() => { if (!saving) setShowGeo(false) }}
        onDone={check => registerSale(check)}
      />

      {viewTarget && doc && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setViewTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1"><h2 className="font-bold text-slate-800">{doc.number}</h2><button onClick={() => setViewTarget(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <p className="text-xs text-slate-500 mb-4">{doc.partyName} · {doc.date}{viewTarget.status === 'anulada' ? ' · ANULADA' : ''}</p>
            <div className="border border-slate-200 rounded-lg p-3 space-y-1 mb-3 max-h-48 overflow-y-auto">
              {viewTarget.items.map((it, i) => (
                <div key={i} className="flex justify-between text-sm"><span className="text-slate-700">{it.product_name} x{it.quantity}</span><span className="text-slate-500">{money(it.subtotal)}</span></div>
              ))}
            </div>
            {doc.taxAmount ? (
              <div className="space-y-1 mb-3 text-sm text-slate-500">
                <div className="flex justify-between"><span>Subtotal</span><span>{money(doc.subtotal ?? viewTarget.total - doc.taxAmount)}</span></div>
                <div className="flex justify-between"><span>Impuesto{doc.taxRate ? ` (${doc.taxRate}%)` : ''}</span><span>{money(doc.taxAmount)}</span></div>
              </div>
            ) : null}
            <div className="flex justify-between items-center pb-3 mb-3 border-b border-slate-100"><span className="font-bold text-slate-800">Total:</span><span className="font-bold text-slate-800 text-lg">{money(viewTarget.total)}</span></div>
            {doc.fx && (
              <div className="space-y-1 mb-3 text-sm text-slate-500">
                <div className="flex justify-between"><span>Pagó en {doc.fx.currency}</span><span>{formatMoney(doc.fx.amount, doc.fx.currency)}</span></div>
                <div className="flex justify-between"><span>Tasa</span><span>1 {doc.fx.currency} = {money(doc.fx.rate)}</span></div>
                {!!doc.fx.baseAmount && <div className="flex justify-between"><span>Además recibió</span><span>{money(doc.fx.baseAmount)}</span></div>}
                {doc.fx.equivalent - viewTarget.total > 0.004 && <div className="flex justify-between"><span>Cambio entregado</span><span>{money(doc.fx.equivalent - viewTarget.total)}</span></div>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={doPrint} className="flex items-center justify-center gap-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700"><Printer className="w-4 h-4" /> Imprimir / PDF</button>
              <button onClick={doWhatsApp} className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"><MessageCircle className="w-4 h-4" /> WhatsApp</button>
              <button onClick={doEmail} className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"><Mail className="w-4 h-4" /> Correo</button>
              {canShare && <button onClick={doShare} className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"><Share2 className="w-4 h-4" /> Compartir</button>}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Para enviar el PDF: elige "Imprimir / PDF", guarda como PDF y adjúntalo en WhatsApp o tu correo.</p>
          </div>
        </div>
      )}

      <HandwrittenSalesScannerModal
        open={showNotebookScanner}
        onClose={() => setShowNotebookScanner(false)}
        onCompleted={summaryMsg => {
          setNotice(summaryMsg)
          void load()
        }}
        products={products}
        customers={customers}
        config={config}
        userId={uid}
        sellerName={user?.full_name || 'Encargado'}
        warehouses={activeWarehouses}
        defaultWarehouseId={activeWarehouseId}
        defaultChannel="mostrador"
      />
    </div>
  )
}
