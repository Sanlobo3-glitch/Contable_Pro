import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency, fmtDateTime } from '../lib/currency'
import { useBackOverlay } from '../lib/navigation'
import { normalizeProductVariants } from '../lib/catalogCommerce'
import { round2 } from '../lib/tax'
import { downloadCsv } from '../lib/csv'
import { esc, printHtml } from '../lib/documents'
import {
  listSuiteRecords,
  upsertSuiteRecord,
  makeSuiteId,
  makeDocumentCode,
  type ExchangeItemLine,
  type ProductExchangeRecord,
  type WarrantyStatus,
} from '../lib/commercialSuiteRepo'
import type { Product, Sale, Supplier } from '../types'
import {
  ArrowLeftRight,
  Download,
  Lock,
  MessageCircle,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'

const WARRANTY_STATUS_LABEL: Record<WarrantyStatus, string> = {
  recibido_local: 'Recibido en tienda',
  en_revision_proveedor: 'En revisión con proveedor',
  reemplazado: 'Reemplazo entregado',
  resuelto: 'Resuelto / Cerrado',
  rechazado: 'No cubierto por garantía',
}

export default function ExchangesWarranties({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user, isDemo } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(user)

  const scopeKey = useMemo(
    () => (isDemo ? 'demo' : user?.company_id || user?.id || 'default'),
    [isDemo, user?.company_id, user?.id]
  )

  const [tab, setTab] = useState<'cambio_mano_a_mano' | 'garantia'>('cambio_mano_a_mano')
  const [records, setRecords] = useState<ProductExchangeRecord[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Modal nuevo cambio mano a mano
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapSaleId, setSwapSaleId] = useState('')
  const [swapCustomerName, setSwapCustomerName] = useState('')
  const [swapCustomerPhone, setSwapCustomerPhone] = useState('')
  const [inProductId, setInProductId] = useState('')
  const [inVariantLabel, setInVariantLabel] = useState('')
  const [inQty, setInQty] = useState('1')
  const [inUnitPrice, setInUnitPrice] = useState('')
  const [outProductId, setOutProductId] = useState('')
  const [outVariantLabel, setOutVariantLabel] = useState('')
  const [outQty, setOutQty] = useState('1')
  const [outUnitPrice, setOutUnitPrice] = useState('')
  const [swapPayMethod, setSwapPayMethod] = useState<
    'efectivo' | 'transferencia' | 'tarjeta' | 'saldo_favor'
  >('efectivo')
  const [swapReason, setSwapReason] = useState('Cambio de talla / referencia')

  // Modal nueva garantía
  const [warrantyOpen, setWarrantyOpen] = useState(false)
  const [warCustomerName, setWarCustomerName] = useState('')
  const [warCustomerPhone, setWarCustomerPhone] = useState('')
  const [warSupplierName, setWarSupplierName] = useState('')
  const [warProductId, setWarProductId] = useState('')
  const [warQty, setWarQty] = useState('1')
  const [warSerial, setWarSerial] = useState('')
  const [warReason, setWarReason] = useState('')
  const [warImmediateReplace, setWarImmediateReplace] = useState(false)

  const [saving, setSaving] = useState(false)

  useBackOverlay(swapOpen || warrantyOpen, () => {
    setWarrantyOpen(false)
    setSwapOpen(false)
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: prodRows }, { data: saleRows }, { data: supRows }, exchRes] =
      await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase
          .from('sales')
          .select('*')
          .eq('status', 'completada')
          .order('created_at', { ascending: false })
          .limit(150),
        supabase.from('suppliers').select('*').order('name'),
        listSuiteRecords<ProductExchangeRecord>('product_exchanges', scopeKey),
      ])

    setProducts((prodRows || []) as Product[])
    setSales((saleRows || []) as Sale[])
    setSuppliers((supRows || []) as Supplier[])
    setRecords(exchRes.rows)
    setLoading(false)
  }, [scopeKey])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const productMap = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const inProduct = productMap.get(inProductId) || null
  const outProduct = productMap.get(outProductId) || null

  const inVariants = useMemo(
    () => (inProduct ? normalizeProductVariants(inProduct.variants) : []),
    [inProduct]
  )
  const outVariants = useMemo(
    () => (outProduct ? normalizeProductVariants(outProduct.variants) : []),
    [outProduct]
  )

  const inTotal = round2((parseFloat(inQty) || 0) * (parseFloat(inUnitPrice) || 0))
  const outTotal = round2((parseFloat(outQty) || 0) * (parseFloat(outUnitPrice) || 0))
  // Si outTotal > inTotal, el cliente paga excedente (+); si es menor, queda saldo a favor (-)
  const netDifference = round2(outTotal - inTotal)

  function handlePickSale(id: string) {
    setSwapSaleId(id)
    const found = sales.find(s => s.id === id)
    if (found) {
      setSwapCustomerName(found.customer_name || 'Cliente mostrador')
      if (found.items.length > 0) {
        const first = found.items[0]
        setInProductId(first.product_id)
        setInUnitPrice(String(first.price))
      }
    }
  }

  function handleSelectInProduct(id: string) {
    setInProductId(id)
    setInVariantLabel('')
    const p = productMap.get(id)
    if (p) {
      setInUnitPrice(String(p.price))
      if (!outProductId) {
        // Por defecto sugiere el mismo producto (caso típico de cambio de talla M -> L)
        setOutProductId(id)
        setOutUnitPrice(String(p.price))
      }
    }
  }

  function handleSelectOutProduct(id: string) {
    setOutProductId(id)
    setOutVariantLabel('')
    const p = productMap.get(id)
    if (p) {
      setOutUnitPrice(String(p.price))
    }
  }

  async function handleSubmitSwap(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving || !inProduct || !outProduct) return

    const qIn = Math.max(0.01, parseFloat(inQty) || 0)
    const qOut = Math.max(0.01, parseFloat(outQty) || 0)

    // Si es distinto producto (o requiere más unidades de las que entran), validar stock
    const effectiveNeeded =
      inProduct.id === outProduct.id ? Math.max(0, qOut - qIn) : qOut
    if (effectiveNeeded > Number(outProduct.stock || 0)) {
      setFeedback({
        ok: false,
        text: `Stock insuficiente del artículo de reemplazo (${outProduct.name}: hay ${outProduct.stock}).`,
      })
      return
    }

    setSaving(true)
    const code = makeDocumentCode('CAM')
    const nowIso = new Date().toISOString()

    // 1. Ajustar stock en Kardex
    if (inProduct.id === outProduct.id) {
      const delta = qIn - qOut
      if (Math.abs(delta) >= 0.001) {
        const nextStock = Math.max(0, Number(inProduct.stock || 0) + delta)
        const { error } = await supabase.rpc('ajustar_stock', {
          p_product_id: inProduct.id,
          p_new_stock: nextStock,
          p_reason: `Cambio mano a mano ${code} (${inVariantLabel || 'Base'} -> ${outVariantLabel || 'Base'})`,
        })
        if (error) {
          setSaving(false)
          setFeedback({ ok: false, text: `Error ajustando Kardex: ${error.message}` })
          return
        }
      }
    } else {
      // Entra prenda devuelta (+qIn) y sale prenda nueva (-qOut)
      const nextInStock = Number(inProduct.stock || 0) + qIn
      const inRes = await supabase.rpc('ajustar_stock', {
        p_product_id: inProduct.id,
        p_new_stock: nextInStock,
        p_reason: `Entrada por cambio ${code} · ${swapCustomerName.trim() || 'Mostrador'}`,
      })
      if (inRes.error) {
        setSaving(false)
        setFeedback({ ok: false, text: `Error ingresando prenda devuelta: ${inRes.error.message}` })
        return
      }

      const nextOutStock = Math.max(0, Number(outProduct.stock || 0) - qOut)
      const outRes = await supabase.rpc('ajustar_stock', {
        p_product_id: outProduct.id,
        p_new_stock: nextOutStock,
        p_reason: `Salida por cambio ${code} · ${swapCustomerName.trim() || 'Mostrador'}`,
      })
      if (outRes.error) {
        setSaving(false)
        setFeedback({ ok: false, text: `Error descargando reemplazo: ${outRes.error.message}` })
        return
      }
    }

    // 2. Si hubo diferencia en efectivo, reflejar únicamente el neto en Caja
    if (Math.abs(netDifference) >= 0.01 && swapPayMethod === 'efectivo') {
      await supabase.from('cash_entries').insert({
        type: netDifference > 0 ? 'ingreso' : 'egreso',
        amount: Math.abs(netDifference),
        description:
          netDifference > 0
            ? `Excedente cobrado en cambio ${code} · ${swapCustomerName.trim() || 'Cliente'}`
            : `Diferencia devuelta en cambio ${code} · ${swapCustomerName.trim() || 'Cliente'}`,
        reference_type: 'exchange',
      })
    }

    const returnedLine: ExchangeItemLine = {
      product_id: inProduct.id,
      product_name: inProduct.name,
      sku: inProduct.sku || '',
      variant_label: inVariantLabel.trim() || null,
      quantity: qIn,
      unit_price: parseFloat(inUnitPrice) || 0,
      subtotal: inTotal,
    }

    const deliveredLine: ExchangeItemLine = {
      product_id: outProduct.id,
      product_name: outProduct.name,
      sku: outProduct.sku || '',
      variant_label: outVariantLabel.trim() || null,
      quantity: qOut,
      unit_price: parseFloat(outUnitPrice) || 0,
      subtotal: outTotal,
    }

    const record: ProductExchangeRecord = {
      id: makeSuiteId(),
      exchange_code: code,
      kind: 'cambio_mano_a_mano',
      original_sale_id: swapSaleId || null,
      customer_name: swapCustomerName.trim() || 'Cliente mostrador',
      customer_phone: swapCustomerPhone.trim() || null,
      supplier_name: null,
      returned_items: [returnedLine],
      delivered_items: [deliveredLine],
      price_difference: netDifference,
      payment_method: swapPayMethod,
      warranty_status: 'resuelto',
      reason: swapReason.trim() || 'Cambio de talla / referencia',
      serial_or_lot: null,
      created_by_name: user?.full_name || user?.email || 'Mostrador',
      created_at: nowIso,
      updated_at: nowIso,
    }

    const { saved } = await upsertSuiteRecord('product_exchanges', scopeKey, record)
    setRecords(prev => [saved, ...prev.filter(r => r.id !== saved.id)])
    await loadData()

    setSwapOpen(false)
    setSwapSaleId('')
    setSwapCustomerName('')
    setSwapCustomerPhone('')
    setInProductId('')
    setOutProductId('')
    setSaving(false)

    setFeedback({
      ok: true,
      text:
        Math.abs(netDifference) < 0.01
          ? `Cambio paritario ${code} completado ($0 diferencia) sin anular la factura original.`
          : netDifference > 0
            ? `Cambio ${code} registrado con excedente a favor de la tienda por ${money(netDifference)}.`
            : `Cambio ${code} registrado con saldo/reembolso a favor del cliente por ${money(Math.abs(netDifference))}.`,
    })
  }

  async function handleSubmitWarranty(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    const prod = productMap.get(warProductId)
    if (!prod) return

    const qty = Math.max(1, parseFloat(warQty) || 1)
    if (warImmediateReplace && qty > Number(prod.stock || 0)) {
      setFeedback({
        ok: false,
        text: `No hay stock suficiente de ${prod.name} para entregar reemplazo inmediato.`,
      })
      return
    }

    setSaving(true)
    const code = makeDocumentCode('GAR')
    const nowIso = new Date().toISOString()

    if (warImmediateReplace) {
      const nextStock = Math.max(0, Number(prod.stock || 0) - qty)
      const { error } = await supabase.rpc('ajustar_stock', {
        p_product_id: prod.id,
        p_new_stock: nextStock,
        p_reason: `Reemplazo inmediato por garantía ${code} · ${warCustomerName.trim()}`,
      })
      if (error) {
        setSaving(false)
        setFeedback({ ok: false, text: `Error descargando reemplazo: ${error.message}` })
        return
      }
    }

    const itemLine: ExchangeItemLine = {
      product_id: prod.id,
      product_name: prod.name,
      sku: prod.sku || '',
      variant_label: null,
      quantity: qty,
      unit_price: Number(prod.price) || 0,
      subtotal: round2(qty * (Number(prod.price) || 0)),
    }

    const record: ProductExchangeRecord = {
      id: makeSuiteId(),
      exchange_code: code,
      kind: 'garantia',
      original_sale_id: null,
      customer_name: warCustomerName.trim() || 'Cliente garantía',
      customer_phone: warCustomerPhone.trim() || null,
      supplier_name: warSupplierName.trim() || null,
      returned_items: [itemLine],
      delivered_items: warImmediateReplace ? [itemLine] : [],
      price_difference: 0,
      payment_method: 'efectivo',
      warranty_status: warImmediateReplace ? 'reemplazado' : 'recibido_local',
      reason: warReason.trim() || 'Revisión por defecto de fábrica',
      serial_or_lot: warSerial.trim() || null,
      created_by_name: user?.full_name || user?.email || 'Posventa',
      created_at: nowIso,
      updated_at: nowIso,
    }

    const { saved } = await upsertSuiteRecord('product_exchanges', scopeKey, record)
    setRecords(prev => [saved, ...prev.filter(r => r.id !== saved.id)])
    await loadData()

    setWarrantyOpen(false)
    setWarCustomerName('')
    setWarCustomerPhone('')
    setWarSupplierName('')
    setWarProductId('')
    setWarSerial('')
    setWarReason('')
    setWarImmediateReplace(false)
    setSaving(false)

    setFeedback({
      ok: true,
      text: `Orden de garantía ${code} registrada correctamente.`,
    })
  }

  async function handleAdvanceWarrantyStatus(
    rec: ProductExchangeRecord,
    nextStatus: WarrantyStatus
  ) {
    if (readOnly) return
    const updated: ProductExchangeRecord = {
      ...rec,
      warranty_status: nextStatus,
      updated_at: new Date().toISOString(),
    }
    const { saved } = await upsertSuiteRecord('product_exchanges', scopeKey, updated)
    setRecords(prev => prev.map(r => (r.id === saved.id ? saved : r)))
  }

  function handlePrintSlip(r: ProductExchangeRecord) {
    const ret = r.returned_items[0]
    const del = r.delivered_items[0]
    printHtml(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(r.exchange_code)}</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#0f172a;font-size:12px;max-width:680px;margin:0 auto}
        h1{font-size:18px;margin:0 0 4px}
        .box{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:12px 0}
      </style></head><body>
      <h1>${r.kind === 'cambio_mano_a_mano' ? 'Comprobante de Cambio Mano a Mano' : 'Orden de Garantía Posventa'} · ${esc(r.exchange_code)}</h1>
      <p style="color:#475569">Fecha: ${esc(fmtDateTime(r.created_at))} · Cliente: <strong>${esc(r.customer_name)}</strong></p>
      <div class="box">
        <strong>Recibido del cliente:</strong><br/>
        ${ret ? `${ret.quantity}× ${esc(ret.product_name)} ${ret.variant_label ? `(${esc(ret.variant_label)})` : ''} — ${esc(money(ret.subtotal))}` : '—'}
        ${r.serial_or_lot ? `<br/>Serial / Lote / Talla: ${esc(r.serial_or_lot)}` : ''}
      </div>
      ${
        del
          ? `<div class="box">
              <strong>Entregado al cliente:</strong><br/>
              ${del.quantity}× ${esc(del.product_name)} ${del.variant_label ? `(${esc(del.variant_label)})` : ''} — ${esc(money(del.subtotal))}
            </div>`
          : ''
      }
      <div class="box">
        <strong>Motivo / Diagnóstico:</strong> ${esc(r.reason)}<br/>
        ${
          r.kind === 'cambio_mano_a_mano'
            ? `<strong>Diferencia liquidada:</strong> ${
                Math.abs(r.price_difference) < 0.01
                  ? 'Cambio paritario ($0 diferencia)'
                  : r.price_difference > 0
                    ? `Excedente pagado por cliente: ${esc(money(r.price_difference))} (${esc(r.payment_method)})`
                    : `Saldo a favor del cliente: ${esc(money(Math.abs(r.price_difference)))}`
              }`
            : `<strong>Estado de garantía:</strong> ${esc(WARRANTY_STATUS_LABEL[r.warranty_status])}`
        }
      </div>
    </body></html>`)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records
      .filter(r => r.kind === tab)
      .filter(r => {
        if (!q) return true
        return (
          r.exchange_code.toLowerCase().includes(q) ||
          r.customer_name.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q) ||
          r.returned_items.some(i => i.product_name.toLowerCase().includes(q))
        )
      })
  }, [records, tab, search])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Cambios «mano a mano» y garantías
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Cambia tallas o referencias en segundos liquidando solo la diferencia de precio sin anular toda la factura original, y lleva trazabilidad de garantías con clientes y proveedores.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('devolutions')}
              className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Ir a Devoluciones
            </button>
          )}
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv(
                `${tab}_historial.csv`,
                ['Código', 'Fecha', 'Cliente', 'Entró', 'Salió', 'Diferencia', 'Estado', 'Motivo'],
                filtered.map(r => [
                  r.exchange_code,
                  r.created_at,
                  r.customer_name,
                  r.returned_items.map(i => `${i.quantity}x ${i.product_name}`).join(' + '),
                  r.delivered_items.map(i => `${i.quantity}x ${i.product_name}`).join(' + '),
                  r.price_difference,
                  WARRANTY_STATUS_LABEL[r.warranty_status],
                  r.reason,
                ])
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>

          {tab === 'cambio_mano_a_mano' ? (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setSwapOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
            >
              <ArrowLeftRight className="w-4 h-4" />
              Nuevo cambio rápido
            </button>
          ) : (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setWarrantyOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              Registrar garantía
            </button>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Modo solo lectura: activa tu suscripción para procesar cambios o garantías.
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline opacity-75 hover:opacity-100"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Pestañas e historial */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 self-start">
            <button
              type="button"
              onClick={() => setTab('cambio_mano_a_mano')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'cambio_mano_a_mano'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Cambios mano a mano (Talla / Referencia)
            </button>
            <button
              type="button"
              onClick={() => setTab('garantia')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'garantia'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Control de garantías ({records.filter(r => r.kind === 'garantia').length})
            </button>
          </div>

          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por código, cliente o producto..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Comprobante / Cliente</th>
                <th className="text-left px-4 py-3 font-medium">Entró al local</th>
                <th className="text-left px-4 py-3 font-medium">
                  {tab === 'cambio_mano_a_mano' ? 'Salió de reemplazo' : 'Proveedor / Serial'}
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  {tab === 'cambio_mano_a_mano' ? 'Diferencia neta' : 'Estado garantía'}
                </th>
                <th className="text-right px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(r => {
                const ret = r.returned_items[0]
                const del = r.delivered_items[0]
                return (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{r.customer_name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <span className="font-mono">{r.exchange_code}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{fmtDateTime(r.created_at)}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-700">
                      {ret ? (
                        <div>
                          <span className="font-medium text-slate-900">
                            {ret.quantity}× {ret.product_name}
                          </span>
                          {ret.variant_label && (
                            <span className="text-slate-500"> · {ret.variant_label}</span>
                          )}
                          <div className="text-slate-500 mt-0.5">{r.reason}</div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-700">
                      {tab === 'cambio_mano_a_mano' ? (
                        del ? (
                          <div>
                            <span className="font-medium text-slate-900">
                              {del.quantity}× {del.product_name}
                            </span>
                            {del.variant_label && (
                              <span className="text-slate-500"> · {del.variant_label}</span>
                            )}
                          </div>
                        ) : (
                          '—'
                        )
                      ) : (
                        <div>
                          <div className="font-medium text-slate-800">
                            {r.supplier_name || 'Garantía directa tienda'}
                          </div>
                          {r.serial_or_lot && (
                            <div className="text-slate-500">Ref/Serial: {r.serial_or_lot}</div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {tab === 'cambio_mano_a_mano' ? (
                        <span
                          className={`font-semibold tabular-nums text-xs ${
                            Math.abs(r.price_difference) < 0.01
                              ? 'text-slate-600'
                              : r.price_difference > 0
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {Math.abs(r.price_difference) < 0.01
                            ? '$0 (Mano a mano)'
                            : r.price_difference > 0
                              ? `+${money(r.price_difference)} cobrado`
                              : `-${money(Math.abs(r.price_difference))} a favor`}
                        </span>
                      ) : (
                        <select
                          disabled={readOnly}
                          value={r.warranty_status}
                          onChange={e =>
                            void handleAdvanceWarrantyStatus(
                              r,
                              e.target.value as WarrantyStatus
                            )
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 bg-white"
                        >
                          {(Object.keys(WARRANTY_STATUS_LABEL) as WarrantyStatus[]).map(st => (
                            <option key={st} value={st}>
                              {WARRANTY_STATUS_LABEL[st]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.customer_phone && (
                          <a
                            href={`https://wa.me/${r.customer_phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                              `Hola ${r.customer_name}, actualización de tu comprobante ${r.exchange_code}: ${WARRANTY_STATUS_LABEL[r.warranty_status]}.`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50"
                            title="Avisar por WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePrintSlip(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Comprobante
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    No hay registros en esta pestaña todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Cambio rápido mano a mano */}
      {swapOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setSwapOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-2xl max-h-[92vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                Cambio rápido «mano a mano» (Talla / Referencia)
              </h2>
              <button
                type="button"
                onClick={() => setSwapOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSwap} className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Factura origen (opcional)
                  </label>
                  <select
                    value={swapSaleId}
                    onChange={e => handlePickSale(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Cambio directo de mostrador</option>
                    {sales.map(s => (
                      <option key={s.id} value={s.id}>
                        VTA-{s.id.slice(0, 8).toUpperCase()} · {s.customer_name || 'Mostrador'} ({money(s.total)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Cliente
                  </label>
                  <input
                    value={swapCustomerName}
                    onChange={e => setSwapCustomerName(e.target.value)}
                    placeholder="Cliente mostrador"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    WhatsApp (opcional)
                  </label>
                  <input
                    value={swapCustomerPhone}
                    onChange={e => setSwapCustomerPhone(e.target.value)}
                    placeholder="57300..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              {/* 1. Artículo que entra */}
              <div className="border border-slate-200 rounded-lg p-3.5 space-y-3 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-800">
                  1. Artículo que devuelve el cliente (entra a inventario)
                </p>
                <div className="grid sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <select
                      required
                      value={inProductId}
                      onChange={e => handleSelectInProduct(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="">Seleccionar producto...</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({money(p.price)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    {inVariants.length > 0 ? (
                      <select
                        value={inVariantLabel}
                        onChange={e => setInVariantLabel(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                      >
                        <option value="">Talla devuelta...</option>
                        {inVariants.map(v => (
                          <option key={v.id} value={v.label}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={inVariantLabel}
                        onChange={e => setInVariantLabel(e.target.value)}
                        placeholder="Ej. Talla M"
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                      />
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={inQty}
                      onChange={e => setInQty(e.target.value)}
                      placeholder="Cant."
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm text-center tabular-nums bg-white"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={inUnitPrice}
                      onChange={e => setInUnitPrice(e.target.value)}
                      placeholder="Valor"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm text-right tabular-nums bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Artículo que sale */}
              <div className="border border-slate-200 rounded-lg p-3.5 space-y-3 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-800">
                  2. Artículo que se lleva el cliente (sale de inventario)
                </p>
                <div className="grid sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <select
                      required
                      value={outProductId}
                      onChange={e => handleSelectOutProduct(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="">Seleccionar reemplazo...</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} — Stock: {p.stock} ({money(p.price)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    {outVariants.length > 0 ? (
                      <select
                        value={outVariantLabel}
                        onChange={e => {
                          setOutVariantLabel(e.target.value)
                          const foundVar = outVariants.find(v => v.label === e.target.value)
                          if (foundVar && Number(foundVar.price) > 0) {
                            setOutUnitPrice(String(foundVar.price))
                          }
                        }}
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                      >
                        <option value="">Talla nueva...</option>
                        {outVariants.map(v => (
                          <option key={v.id} value={v.label}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={outVariantLabel}
                        onChange={e => setOutVariantLabel(e.target.value)}
                        placeholder="Ej. Talla L"
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                      />
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={outQty}
                      onChange={e => setOutQty(e.target.value)}
                      placeholder="Cant."
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm text-center tabular-nums bg-white"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={outUnitPrice}
                      onChange={e => setOutUnitPrice(e.target.value)}
                      placeholder="Valor"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm text-right tabular-nums bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Motivo del cambio
                  </label>
                  <input
                    value={swapReason}
                    onChange={e => setSwapReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                {Math.abs(netDifference) >= 0.01 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Medio para {netDifference > 0 ? 'cobrar excedente' : 'entregar diferencia'}
                    </label>
                    <select
                      value={swapPayMethod}
                      onChange={e =>
                        setSwapPayMethod(
                          e.target.value as
                            | 'efectivo'
                            | 'transferencia'
                            | 'tarjeta'
                            | 'saldo_favor'
                        )
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="efectivo">Efectivo (actualiza Caja)</option>
                      <option value="transferencia">Transferencia / Nequi / Pago Móvil</option>
                      <option value="tarjeta">Tarjeta / Datáfono</option>
                      {netDifference < 0 && (
                        <option value="saldo_favor">Bono / Saldo a favor para próxima compra</option>
                      )}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <div className="text-sm">
                  {Math.abs(netDifference) < 0.01 ? (
                    <span className="font-semibold text-slate-800">
                      Cambio mano a mano paritario ($0 diferencia en caja)
                    </span>
                  ) : netDifference > 0 ? (
                    <span className="font-semibold text-emerald-700 tabular-nums">
                      Cliente paga excedente de {money(netDifference)}
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-700 tabular-nums">
                      Saldo a favor del cliente: {money(Math.abs(netDifference))}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSwapOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !inProductId || !outProductId}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
                  >
                    {saving ? 'Procesando...' : 'Confirmar cambio'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nueva garantía */}
      {warrantyOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setWarrantyOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-lg space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Nueva orden de garantía</h2>
              <button
                type="button"
                onClick={() => setWarrantyOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitWarranty} className="space-y-3.5">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Cliente *
                  </label>
                  <input
                    required
                    value={warCustomerName}
                    onChange={e => setWarCustomerName(e.target.value)}
                    placeholder="Nombre del cliente"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    WhatsApp
                  </label>
                  <input
                    value={warCustomerPhone}
                    onChange={e => setWarCustomerPhone(e.target.value)}
                    placeholder="57300..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Producto en garantía *
                  </label>
                  <select
                    required
                    value={warProductId}
                    onChange={e => setWarProductId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Seleccionar producto...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Stock actual: {p.stock})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={warQty}
                    onChange={e => setWarQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-center tabular-nums"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Proveedor fabricante (opcional)
                  </label>
                  <select
                    value={warSupplierName}
                    onChange={e => setWarSupplierName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Garantía directa del local</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Serial / Lote / Talla
                  </label>
                  <input
                    value={warSerial}
                    onChange={e => setWarSerial(e.target.value)}
                    placeholder="Ej. Lote 04B / Talla 40"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Falla o novedad reportada *
                </label>
                <input
                  required
                  value={warReason}
                  onChange={e => setWarReason(e.target.value)}
                  placeholder="Ej. Costura abierta en manga derecha sin uso"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={warImmediateReplace}
                  onChange={e => setWarImmediateReplace(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>
                  Entregar reemplazo nuevo de inmediato al cliente (descuenta 1 unidad buena de inventario)
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWarrantyOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !warProductId}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
                >
                  {saving ? 'Guardando...' : 'Guardar garantía'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
