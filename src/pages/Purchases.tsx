import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageInventory } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import { downloadCsv } from '../lib/csv'
import { consumePurchaseDraft } from '../lib/purchaseDraft'
import PurchaseInvoiceScannerModal from '../components/PurchaseInvoiceScannerModal'
import type { Product, Supplier, Purchase, CompanyConfig } from '../types'
import { Plus, X, Trash2, Truck, Lock, Ban, Receipt, Share2, Printer, MessageCircle, Mail, Download, ScanLine } from 'lucide-react'

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

  const canManage = canManageInventory(user?.role)
  const readOnly = isReadOnly(user) || !canManage

  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [supplierTerms, setSupplierTerms] = useState<Record<string, number>>({})
  const [showForm, setShowForm] = useState(false)
  const [showInvoiceScanner, setShowInvoiceScanner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [viewTarget, setViewTarget] = useState<Purchase | null>(null)
  const [notice, setNotice] = useState('')
  const [draftNotice, setDraftNotice] = useState('')

  const [cart, setCart] = useState<CartItem[]>([])
  const [selProduct, setSelProduct] = useState('')
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo')
  const [creditDays, setCreditDays] = useState('30')
  const [lotCode, setLotCode] = useState('')
  const [expiry, setExpiry] = useState('')

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
      alert('Error al cargar las compras: ' + message)
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

    if (!selProduct) {
      alert('Selecciona un producto.')
      return
    }

    const product = products.find(p => p.id === selProduct)
    if (!product) {
      alert('No se encontró el producto seleccionado. Actualiza la página.')
      return
    }

    const quantity = Number(qty)
    const unitCost = Number(cost)

    if (!Number.isInteger(quantity) || quantity <= 0) {
      alert('La cantidad debe ser un número entero mayor que cero.')
      return
    }

    if (cost.trim() === '' || !Number.isFinite(unitCost) || unitCost < 0) {
      alert('Introduce un costo válido, igual o mayor que cero.')
      return
    }

    const tracked = product.tracks_expiry === true
    if (tracked) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        alert('Este producto maneja vencimiento: indica la fecha de vencimiento del lote.')
        return
      }
      if (expiry < localToday()) {
        alert('La fecha de vencimiento ya pasó.')
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

  const total = Math.round(cart.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100

  async function handleSubmit() {
    if (readOnly || saving) return

    if (cart.length === 0) {
      alert('Agrega al menos un producto a la compra.')
      return
    }

    if (paymentMethod === 'credito') {
      if (!supplierId) {
        alert('Para registrar una compra a crédito debes seleccionar un proveedor registrado.')
        return
      }
      const d = Number(creditDays)
      if (!Number.isInteger(d) || d < 0 || d > 365) {
        alert('Los días de plazo deben ser un número entero entre 0 y 365.')
        return
      }
    }

    // Validar cantidades, costos y vencimientos requeridos
    for (const item of cart) {
      if (
        !item.product_id ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.cost) ||
        item.cost < 0
      ) {
        alert(`Revisa la cantidad y el costo de "${item.product_name}".`)
        return
      }
      const prod = products.find(p => p.id === item.product_id)
      if (prod?.tracks_expiry) {
        if (!item.expiry_date || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiry_date)) {
          alert(`El producto "${item.product_name}" maneja vencimiento: indica la fecha de vencimiento del lote en el carrito.`)
          return
        }
        if (item.expiry_date < localToday()) {
          alert(`La fecha de vencimiento de "${item.product_name}" ya pasó.`)
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

      const rpcArgs: Record<string, unknown> = {
        p_supplier_id: supplierId || null,
        p_items: itemsPayload,
      }
      if (paymentMethod !== 'efectivo') {
        rpcArgs.p_payment_method = paymentMethod
      }
      if (paymentMethod === 'credito') {
        rpcArgs.p_credit_days = Math.floor(Number(creditDays))
      }

      const { error } = await supabase.rpc('registrar_compra', rpcArgs)

      if (error) {
        if (paymentMethod !== 'efectivo' && /could not find the function|schema cache|p_payment_method|Forma de pago de compra inválida|purchases_payment_method_check/i.test(error.message || '')) {
          alert('Para usar pago por Tarjeta, Transferencia o Crédito, ejecuta primero el script SQL 20261101_mejoras_compras_costo_promedio.sql en Supabase (SQL Editor).')
          return
        }
        alert(
          'No se pudo registrar la compra.\n\n' +
          error.message +
          (error.code ? '\nCódigo: ' + error.code : '')
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
      setDraftNotice('')

      await load()
      if (paymentMethod === 'credito') {
        flash('Compra a crédito registrada. Quedó en Cuentas por pagar sin descontar dinero de caja.')
      } else if (paymentMethod === 'tarjeta' || paymentMethod === 'transferencia') {
        flash(`Compra registrada por ${PAYMENT_LABEL[paymentMethod].toLowerCase()}. No descontó efectivo de Caja.`)
      } else {
        flash('Compra en efectivo registrada correctamente.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      alert('Error al registrar la compra: ' + message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(purchase: Purchase) {
    if (readOnly || cancellingId || saving) return
    if (purchase.status === 'anulada') return

    const method = purchase.payment_method || 'efectivo'
    const impactText =
      method === 'credito'
        ? 'Esta acción revertirá las existencias, el costo promedio y anulará la deuda pendiente con el proveedor (si no tiene pagos aplicados).'
        : method === 'efectivo'
          ? 'Esta acción revertirá las existencias, el costo promedio y devolverá el monto a Caja.'
          : `Esta acción revertirá las existencias, el costo promedio y el asiento contable de bancos (${PAYMENT_LABEL[method] ?? method}), sin tocar el efectivo de Caja.`

    const confirmed = window.confirm(
      '¿Estás seguro de anular esta compra?\n\n' +
      'Proveedor: ' + (purchase.supplier_name || 'Proveedor general') + '\n' +
      'Total: ' + money(purchase.total) + '\n\n' +
      impactText
    )

    if (!confirmed) return

    setCancellingId(purchase.id)

    try {
      const { error } = await supabase.rpc('anular_compra', {
        p_purchase_id: purchase.id,
      })

      if (error) {
        alert(
          'No se pudo anular la compra.\n\n' +
          error.message +
          (error.code ? '\nCódigo: ' + error.code : '')
        )
        return
      }

      await load()
      flash('Compra anulada correctamente. Se revirtieron las existencias y los saldos asociados.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      alert('Error al anular la compra: ' + message)
    } finally {
      setCancellingId(null)
    }
  }

  function exportExcel() {
    if (purchases.length === 0) return
    const rows = purchases.map(p => {
      const method = p.payment_method || 'efectivo'
      const summary = (p.items || []).map(i => `${i.product_name} x${i.quantity}`).join(' | ')
      return [
        'CMP-' + p.id.slice(0, 8).toUpperCase(),
        p.created_at ? new Date(p.created_at).toLocaleString() : '',
        p.supplier_name || 'Proveedor general',
        PAYMENT_LABEL[method] ?? method,
        p.due_date || '',
        Number(p.total) || 0,
        p.status,
        summary,
      ]
    })
    downloadCsv(
      `compras_${localToday()}.csv`,
      ['Comprobante', 'Fecha', 'Proveedor', 'Condición de pago', 'Vencimiento', 'Total', 'Estado', 'Artículos'],
      rows
    )
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setDraftNotice('')
  }

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
          {onNavigate && (
            <button
              onClick={() => onNavigate('payables')}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Receipt className="w-4 h-4" />
              Cuentas por pagar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!readOnly) setShowInvoiceScanner(true)
            }}
            disabled={readOnly || loading}
            title="Fotografiar o subir factura o ticket de compra para cargar mercancía automáticamente"
            className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 text-emerald-900 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ScanLine className="w-4 h-4 text-emerald-700" />
            Escanear factura
          </button>
          <button
            onClick={() => {
              if (!readOnly) {
                setDraftNotice('')
                setShowForm(true)
              }
            }}
            disabled={readOnly || loading}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Nueva compra
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Modo de solo lectura o sin permisos para gestionar compras.
        </div>
      )}

      {notice && (
        <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {notice}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Fecha</th>
              <th className="text-left px-4 py-3 font-medium">Proveedor</th>
              <th className="text-left px-4 py-3 font-medium">Pago / Condición</th>
              <th className="text-left px-4 py-3 font-medium">Artículos</th>
              <th className="text-left px-4 py-3 font-medium">Total</th>
              <th className="text-left px-4 py-3 font-medium">Estado</th>
              <th className="text-right px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {purchases.map(purchase => {
              const annulled = purchase.status === 'anulada'
              const cancelling = cancellingId === purchase.id
              const method = purchase.payment_method || 'efectivo'
              const isCredit = method === 'credito'
              const itemCount = Array.isArray(purchase.items)
                ? purchase.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
                : 0

              return (
                <tr key={purchase.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {purchase.created_at
                      ? new Date(purchase.created_at).toLocaleDateString()
                      : '—'}
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

                  <td className="px-4 py-3 text-slate-800 font-medium whitespace-nowrap tabular-nums">
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
                    <div className="inline-flex items-center justify-end gap-2">
                      <button
                        onClick={() => setViewTarget(purchase)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 whitespace-nowrap"
                      >
                        <Share2 className="w-3 h-3" />
                        Ver / Enviar
                      </button>

                      {!readOnly && !annulled && (
                        <button
                          onClick={() => void handleCancel(purchase)}
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

            {!loading && purchases.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No hay compras registradas
                </td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
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
            className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
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

            <div className="border border-slate-200 rounded-lg p-3 space-y-2 mb-3 max-h-56 overflow-y-auto">
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

              <p className="text-[11px] text-slate-400">
                El costo del producto se actualiza con promedio ponderado según el stock actual.
              </p>

              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-800">Total:</span>
                <span className="font-bold text-slate-800 text-lg tabular-nums">
                  {money(total)}
                </span>
              </div>

              <button
                onClick={() => void handleSubmit()}
                disabled={cart.length === 0 || saving || loading}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Truck className="w-4 h-4" />
                {saving
                  ? 'Registrando...'
                  : paymentMethod === 'credito'
                    ? 'Registrar compra a crédito'
                    : `Registrar compra (${PAYMENT_LABEL[paymentMethod]})`}
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
