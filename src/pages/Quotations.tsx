import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import { calcTax, round2, taxDocFields, taxModeOf, taxRateOf, type TaxFields } from '../lib/tax'
import { priceFor, type PriceType } from '../lib/pricing'
import { downloadCsv } from '../lib/csv'
import type { Product, Customer, Quotation, CompanyConfig } from '../types'
import { Plus, X, Trash2, FileText, Lock, ShoppingCart, Printer, MessageCircle, Mail, Share2, Pencil, Download } from 'lucide-react'

type QuotationRow = Quotation & TaxFields & { sale_id?: string | null }
type CartDraftLine = { product_id: string; product_name: string; quantity: number; custom_price?: number }

const STATUS_LABEL: Record<string, string> = {
  enviada: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
}

function toDateStr(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function parseDate(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
function isExpired(q: QuotationRow) {
  if (q.status !== 'enviada' || !q.valid_until) return false
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return parseDate(q.valid_until) < today
}
const quotationNumber = (q: QuotationRow) => 'COT-' + q.id.slice(0, 8).toUpperCase()

function statusInfo(q: QuotationRow) {
  const converted = !!q.sale_id
  const expired = isExpired(q)
  const label = converted ? 'Convertida' : expired ? 'Vencida' : (STATUS_LABEL[q.status] ?? q.status)
  const color =
    converted || q.status === 'aceptada'
      ? 'text-emerald-700 bg-emerald-50'
      : q.status === 'rechazada' || expired || q.status === 'vencida'
        ? 'text-red-700 bg-red-50'
        : 'text-amber-700 bg-amber-50'
  return { converted, label, color }
}

function buildQuotationDoc(q: QuotationRow, c: Customer | undefined): DocData {
  return {
    title: 'COTIZACIÓN',
    number: quotationNumber(q),
    date: new Date(q.created_at).toLocaleDateString(),
    extra: q.valid_until ? `Válida hasta: ${parseDate(q.valid_until).toLocaleDateString()}` : undefined,
    partyName: q.customer_name || 'Cliente general',
    partyLines: [c?.document && `Documento: ${c.document}`, c?.phone && `Tel: ${c.phone}`, c?.email, c?.address],
    lines: q.items.map(i => ({ name: i.product_name, quantity: i.quantity, price: i.price, subtotal: i.subtotal })),
    ...taxDocFields(q),
    total: q.total,
    footer: 'Esta cotización es válida hasta la fecha indicada. Los precios pueden cambiar después de ese plazo.',
  }
}

export default function Quotations() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(user)
  const [quotations, setQuotations] = useState<QuotationRow[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [cart, setCart] = useState<CartDraftLine[]>([])
  const [selProduct, setSelProduct] = useState('')
  const [qty, setQty] = useState('1')
  const [customerId, setCustomerId] = useState('')
  const [priceOverride, setPriceOverride] = useState<PriceType | null>(null)
  const [discPct, setDiscPct] = useState('')
  const [validDays, setValidDays] = useState('7')
  const [convertTarget, setConvertTarget] = useState<QuotationRow | null>(null)
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [viewTarget, setViewTarget] = useState<QuotationRow | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    const [{ data: q }, { data: p }, { data: c }, { data: cfg }] = await Promise.all([
      supabase.from('quotations').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
      supabase.from('company_config').select('*').limit(1),
    ])
    setQuotations((q || []) as QuotationRow[])
    setProducts((p || []) as Product[])
    setCustomers((c || []) as Customer[])
    setConfig(((cfg || [])[0] as CompanyConfig) ?? null)
  }

  function resetForm() {
    setEditingId(null)
    setCart([])
    setSelProduct('')
    setQty('1')
    setCustomerId('')
    setPriceOverride(null)
    setDiscPct('')
    setValidDays('7')
  }

  function openNew() {
    if (readOnly) return
    resetForm()
    setShowForm(true)
  }

  function openEdit(q: QuotationRow) {
    if (readOnly || q.sale_id) return
    setEditingId(q.id)
    setCustomerId(q.customer_id || '')
    setPriceOverride(null)
    setDiscPct('')
    const remDays = q.valid_until
      ? Math.max(1, Math.round((parseDate(q.valid_until).getTime() - Date.now()) / 86400000))
      : 7
    setValidDays(String(remDays))
    setCart(
      (q.items || []).map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: Number(it.quantity) || 1,
        custom_price: Number(it.price),
      }))
    )
    setShowForm(true)
  }

  function addToCart() {
    if (readOnly) return
    const p = products.find(x => x.id === selProduct)
    if (!p) return
    const q = Math.max(1, parseInt(qty) || 1)
    setCart(prev => [...prev, { product_id: p.id, product_name: p.name, quantity: q }])
    setSelProduct('')
    setQty('1')
  }

  function removeFromCart(i: number) {
    if (readOnly) return
    setCart(cart.filter((_, idx) => idx !== i))
  }

  const autoType: PriceType = customers.find(c => c.id === customerId)?.price_type === 'mayor' ? 'mayor' : 'detal'
  const effectiveType: PriceType = priceOverride ?? autoType
  const pctNum = Math.min(100, Math.max(0, Number(discPct) || 0))
  const factor = 1 - pctNum / 100

  const qtyByProduct = new Map<string, number>()
  for (const i of cart) {
    qtyByProduct.set(i.product_id, (qtyByProduct.get(i.product_id) ?? 0) + i.quantity)
  }

  const lines = cart.map(i => {
    const p = products.find(x => x.id === i.product_id)
    const base =
      i.custom_price !== undefined && priceOverride === null
        ? { price: i.custom_price, mayor: false }
        : p
          ? priceFor(p, qtyByProduct.get(i.product_id) ?? i.quantity, effectiveType)
          : { price: i.custom_price ?? 0, mayor: false }
    const unitPrice = round2(base.price * factor)
    return {
      product_id: i.product_id,
      product_name: i.product_name,
      quantity: i.quantity,
      price: unitPrice,
      subtotal: round2(unitPrice * i.quantity),
      mayor: base.mayor,
    }
  })

  const cartSum = round2(lines.reduce((s, i) => s + i.subtotal, 0))
  const taxMode = taxModeOf(config)
  const tx = calcTax(cartSum, taxMode, taxRateOf(config))
  const total = tx.total

  async function handleSubmit() {
    if (readOnly || lines.length === 0 || saving) return
    setSaving(true)
    const customer = customers.find(c => c.id === customerId)
    const days = Math.max(1, parseInt(validDays) || 7)
    const validUntil = toDateStr(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
    const payload = {
      customer_id: customerId || null,
      customer_name: customer?.name || null,
      items: lines.map(l => ({
        product_id: l.product_id,
        product_name: l.product_name,
        quantity: l.quantity,
        price: l.price,
        subtotal: l.subtotal,
      })),
      total,
      subtotal: tx.subtotal,
      tax_rate: tx.rate,
      tax_amount: tx.tax,
      valid_until: validUntil,
    }

    const res = editingId
      ? await supabase.from('quotations').update(payload).eq('id', editingId)
      : await supabase.from('quotations').insert({ ...payload, status: 'enviada' })

    setSaving(false)
    if (res.error) {
      alert('Error al guardar la cotización: ' + res.error.message)
      return
    }
    setShowForm(false)
    const wasEdit = Boolean(editingId)
    resetForm()
    setNotice(wasEdit ? 'Cotización actualizada.' : 'Cotización creada.')
    void load()
  }

  async function updateStatus(id: string, status: string) {
    if (readOnly) return
    const { error } = await supabase.from('quotations').update({ status }).eq('id', id)
    if (error) {
      alert('Error: ' + error.message)
      return
    }
    void load()
  }

  function openConvert(q: QuotationRow) {
    if (readOnly) return
    if (isExpired(q) && !confirm('Esta cotización está vencida. ¿Convertirla en venta de todas formas?')) return
    setNotice('')
    setPaymentMethod('efectivo')
    setConvertTarget(q)
  }

  async function confirmConvert() {
    if (!convertTarget || saving) return
    setSaving(true)
    const { error } = await supabase.rpc('convertir_cotizacion', {
      p_quotation_id: convertTarget.id,
      p_payment_method: paymentMethod,
    })
    setSaving(false)
    if (error) {
      alert('No se pudo convertir: ' + error.message)
      return
    }
    setConvertTarget(null)
    setNotice('Venta registrada desde la cotización. Ya la puedes ver en Ventas.')
    void load()
  }

  function exportExcel() {
    if (quotations.length === 0) return
    downloadCsv(
      `cotizaciones_${toDateStr(new Date())}.csv`,
      ['Número', 'Fecha', 'Cliente', 'Válida hasta', 'Subtotal', 'Impuesto', 'Total', 'Estado'],
      quotations.map(q => {
        const st = statusInfo(q)
        return [
          quotationNumber(q),
          new Date(q.created_at).toLocaleDateString(),
          q.customer_name || 'Cliente general',
          q.valid_until || '',
          q.subtotal ?? q.total,
          q.tax_amount ?? 0,
          q.total,
          st.label,
        ]
      })
    )
  }

  const viewCustomer = viewTarget ? customers.find(c => c.id === viewTarget.customer_id) : undefined
  const doc = viewTarget ? buildQuotationDoc(viewTarget, viewCustomer) : null
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
    window.location.href = `mailto:${viewCustomer?.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildShareText(doc, config))}`
  }
  async function doShare() {
    if (!doc) return
    try {
      await navigator.share({ title: `${doc.title} ${doc.number}`, text: buildShareText(doc, config) })
    } catch {
      /* cancelado */
    }
  }

  function rowActions(q: QuotationRow) {
    const { converted } = statusInfo(q)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setViewTarget(q)}
          className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded whitespace-nowrap"
        >
          <Share2 className="w-3 h-3" /> Ver / Enviar
        </button>
        {!converted && !readOnly && (
          <button
            onClick={() => openEdit(q)}
            title="Editar cotización"
            className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-2.5 py-1.5 rounded whitespace-nowrap"
          >
            <Pencil className="w-3 h-3" /> Editar
          </button>
        )}
        <select
          value={q.status}
          onChange={e => void updateStatus(q.id, e.target.value)}
          disabled={readOnly || converted}
          className="text-xs px-2 py-1.5 rounded border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value="enviada">Pendiente</option>
          <option value="aceptada">Aceptada</option>
          <option value="rechazada">Rechazada</option>
          <option value="vencida">Vencida</option>
        </select>
        {!converted && q.status !== 'rechazada' && !readOnly && (
          <button
            onClick={() => openConvert(q)}
            className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded whitespace-nowrap"
          >
            <ShoppingCart className="w-3 h-3" /> A venta
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
        <h1 className="text-xl font-bold text-slate-800">Cotizaciones</h1>
        <div className="flex items-center gap-2">
          {quotations.length > 0 && (
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Download className="w-4 h-4" /> Exportar Excel
            </button>
          )}
          <button
            onClick={openNew}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Nueva cotización
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Activa tu suscripción para crear o actualizar cotizaciones.
        </div>
      )}

      {notice && (
        <div className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {notice}
        </div>
      )}

      {/* Móvil: tarjetas */}
      <div className="md:hidden space-y-3">
        {quotations.map(q => {
          const st = statusInfo(q)
          return (
            <div key={q.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">{q.customer_name || 'Cliente general'}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(q.created_at).toLocaleDateString()}
                    {q.valid_until ? ` · válida hasta ${parseDate(q.valid_until).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <p className="font-bold text-slate-800 whitespace-nowrap tabular-nums">{money(q.total)}</p>
              </div>
              <div className="mt-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${st.color}`}>{st.label}</span>
              </div>
              <div className="mt-3">{rowActions(q)}</div>
            </div>
          )
        })}
        {quotations.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No hay cotizaciones</p>}
      </div>

      {/* Escritorio: tabla */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Fecha</th>
              <th className="text-left px-4 py-3 font-medium">Cliente</th>
              <th className="text-left px-4 py-3 font-medium">Total</th>
              <th className="text-left px-4 py-3 font-medium">Válida hasta</th>
              <th className="text-left px-4 py-3 font-medium">Estado</th>
              <th className="text-left px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {quotations.map(q => {
              const st = statusInfo(q)
              return (
                <tr key={q.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{new Date(q.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{q.customer_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 tabular-nums">{money(q.total)}</td>
                  <td className="px-4 py-3 text-slate-500">{q.valid_until ? parseDate(q.valid_until).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${st.color}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3">{rowActions(q)}</td>
                </tr>
              )
            })}
            {quotations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No hay cotizaciones
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">{editingId ? 'Editar cotización' : 'Nueva cotización'}</h2>
              <button onClick={() => !saving && setShowForm(false)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Cliente</label>
                  <select
                    value={customerId}
                    onChange={e => setCustomerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  >
                    <option value="">Cliente general</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.price_type === 'mayor' ? ' (Mayor)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Válida por (días)</label>
                  <input
                    type="number"
                    min="1"
                    value={validDays}
                    onChange={e => setValidDays(e.target.value)}
                    placeholder="Días válido"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Lista de precios</label>
                  <select
                    value={priceOverride ?? 'auto'}
                    onChange={e => {
                      const v = e.target.value
                      setPriceOverride(v === 'auto' ? null : (v as PriceType))
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  >
                    <option value="auto">Automático ({autoType === 'mayor' ? 'Mayor' : 'Detal'})</option>
                    <option value="detal">Forzar Detal</option>
                    <option value="mayor">Forzar Por mayor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Descuento (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={discPct}
                    onChange={e => setDiscPct(e.target.value)}
                    placeholder="0%"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <select
                  value={selProduct}
                  onChange={e => setSelProduct(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 text-sm"
                >
                  <option value="">Seleccionar producto</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({money(effectiveType === 'mayor' && Number(p.price_wholesale) > 0 ? Number(p.price_wholesale) : p.price)})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={qty}
                  onChange={e => setQty(e.target.value)}
                  className="w-20 px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
                <button
                  onClick={addToCart}
                  className="px-3 py-2 bg-slate-100 rounded-lg text-sm font-medium hover:bg-slate-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                {lines.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700 min-w-0 truncate">
                      {item.product_name} × {item.quantity}
                      {item.mayor && <span className="text-xs text-indigo-600"> (mayor)</span>}
                      <span className="block text-[11px] text-slate-400">{money(item.price)} c/u</span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-slate-700 font-medium tabular-nums">{money(item.subtotal)}</span>
                      <button onClick={() => removeFromCart(i)} className="p-1 rounded hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
                {lines.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Carrito vacío</p>}
              </div>

              {tx.tax > 0 && (
                <div className="space-y-1 pt-2 border-t border-slate-100 text-sm text-slate-500">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{money(tx.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>
                      Impuesto ({tx.rate}%){taxMode === 'incluido' ? ' incluido' : ''}
                    </span>
                    <span className="tabular-nums">{money(tx.tax)}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-800">Total:</span>
                <span className="font-bold text-slate-800 text-lg tabular-nums">{money(total)}</span>
              </div>

              <button
                onClick={() => void handleSubmit()}
                disabled={lines.length === 0 || saving}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear cotización'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewTarget && doc && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setViewTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">{doc.number}</h2>
              <button onClick={() => setViewTarget(null)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {doc.partyName}
              {doc.extra ? ` · ${doc.extra.toLowerCase()}` : ''}
            </p>
            <div className="border border-slate-200 rounded-lg p-3 space-y-1 mb-3 max-h-48 overflow-y-auto">
              {viewTarget.items.map((it, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-700">
                    {it.product_name} × {it.quantity}
                  </span>
                  <span className="text-slate-500 tabular-nums">{money(it.subtotal)}</span>
                </div>
              ))}
            </div>
            {doc.taxAmount ? (
              <div className="space-y-1 mb-3 text-sm text-slate-500">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(doc.subtotal ?? viewTarget.total - doc.taxAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Impuesto{doc.taxRate ? ` (${doc.taxRate}%)` : ''}</span>
                  <span className="tabular-nums">{money(doc.taxAmount)}</span>
                </div>
              </div>
            ) : null}
            <div className="flex justify-between items-center pb-3 mb-3 border-b border-slate-100">
              <span className="font-bold text-slate-800">Total:</span>
              <span className="font-bold text-slate-800 text-lg tabular-nums">{money(viewTarget.total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={doPrint} className="flex items-center justify-center gap-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700">
                <Printer className="w-4 h-4" /> Imprimir / PDF
              </button>
              <button onClick={doWhatsApp} className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700">
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <button onClick={doEmail} className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">
                <Mail className="w-4 h-4" /> Correo
              </button>
              {canShare && (
                <button onClick={() => void doShare()} className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">
                  <Share2 className="w-4 h-4" /> Compartir
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">
              Para enviar el PDF: elige "Imprimir / PDF", guarda como PDF y adjúntalo en WhatsApp o tu correo.
            </p>
          </div>
        </div>
      )}

      {convertTarget && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConvertTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">Convertir en venta</h2>
              <button onClick={() => setConvertTarget(null)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {convertTarget.customer_name || 'Cliente general'} · se usarán los precios de la cotización; el impuesto se calcula con la configuración actual
            </p>
            <div className="space-y-3">
              <div className="border border-slate-200 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                {convertTarget.items.map((it, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-700">
                      {it.product_name} × {it.quantity}
                    </span>
                    <span className="text-slate-500 tabular-nums">{money(it.subtotal)}</span>
                  </div>
                ))}
              </div>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              >
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
              </select>
              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-800">Total:</span>
                <span className="font-bold text-slate-800 text-lg tabular-nums">{money(convertTarget.total)}</span>
              </div>
              <button
                onClick={() => void confirmConvert()}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                <ShoppingCart className="w-4 h-4" /> {saving ? 'Registrando...' : 'Registrar venta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
