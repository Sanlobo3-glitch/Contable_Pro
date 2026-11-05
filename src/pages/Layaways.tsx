import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency, fmtDate, fmtDateTime } from '../lib/currency'
import { useWarehouse } from '../lib/warehouseContext'
import { useBackOverlay } from '../lib/navigation'
import { newId, sendSale } from '../lib/offlineQueue'
import { normalizeProductVariants } from '../lib/catalogCommerce'
import { round2 } from '../lib/tax'
import { downloadCsv } from '../lib/csv'
import { esc, printHtml } from '../lib/documents'
import {
  listSuiteRecords,
  upsertSuiteRecord,
  makeSuiteId,
  makeDocumentCode,
  type LayawayContract,
  type LayawayItem,
  type LayawayPayment,
} from '../lib/commercialSuiteRepo'
import type { Customer, Product } from '../types'
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  Download,
  Lock,
  MessageCircle,
  Plus,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react'

type StatusFilter = 'all' | 'activo' | 'por_vencer' | 'completado' | 'anulado'

export default function Layaways({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user, isDemo } = useAuth()
  const { fmt: money } = useCurrency()
  const { activeWarehouseId } = useWarehouse()
  const readOnly = isReadOnly(user)

  const scopeKey = useMemo(
    () => (isDemo ? 'demo' : user?.company_id || user?.id || 'default'),
    [isDemo, user?.company_id, user?.id]
  )

  const [contracts, setContracts] = useState<LayawayContract[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('activo')
  const [search, setSearch] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Modal nuevo apartado
  const [createOpen, setCreateOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerDoc, setCustomerDoc] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [termDays, setTermDays] = useState('30')
  const [initialDeposit, setInitialDeposit] = useState('')
  const [depositMethod, setDepositMethod] = useState<'efectivo' | 'transferencia' | 'tarjeta'>('efectivo')
  const [depositRef, setDepositRef] = useState('')
  const [notes, setNotes] = useState('')
  const [draftItems, setDraftItems] = useState<LayawayItem[]>([])
  const [pickProductId, setPickProductId] = useState('')
  const [pickVariantId, setPickVariantId] = useState('')
  const [pickQty, setPickQty] = useState('1')

  // Modal registrar abono o liquidar entrega
  const [paymentTarget, setPaymentTarget] = useState<LayawayContract | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'efectivo' | 'transferencia' | 'tarjeta'>('efectivo')
  const [payRef, setPayRef] = useState('')
  const [saving, setSaving] = useState(false)

  useBackOverlay(createOpen || Boolean(paymentTarget), () => {
    setPaymentTarget(null)
    setCreateOpen(false)
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: prodRows }, { data: custRows }, contractRes] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
      listSuiteRecords<LayawayContract>('layaway_contracts', scopeKey),
    ])
    setProducts((prodRows || []) as Product[])
    setCustomers((custRows || []) as Customer[])
    setContracts(contractRes.rows)
    setLoading(false)
  }, [scopeKey])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Unidades actualmente apartadas en contratos activos (para mostrar stock libre real)
  const reservedByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contracts) {
      if (c.status !== 'activo') continue
      for (const it of c.items) {
        map.set(it.product_id, (map.get(it.product_id) || 0) + Number(it.quantity || 0))
      }
    }
    return map
  }, [contracts])

  const selectedProduct = useMemo(
    () => products.find(p => p.id === pickProductId) || null,
    [products, pickProductId]
  )

  const selectedProductVariants = useMemo(
    () => (selectedProduct ? normalizeProductVariants(selectedProduct.variants) : []),
    [selectedProduct]
  )

  function handleSelectCustomer(id: string) {
    setCustomerId(id)
    const found = customers.find(c => c.id === id)
    if (found) {
      setCustomerName(found.name)
      setCustomerDoc(found.document || '')
      setCustomerPhone(found.phone || '')
    }
  }

  function addDraftItem() {
    if (!selectedProduct) return
    const qty = Math.max(1, parseFloat(pickQty) || 1)
    const variant = selectedProductVariants.find(v => v.id === pickVariantId) || null
    const unitPrice =
      variant && Number(variant.price) > 0
        ? Number(variant.price)
        : Number(selectedProduct.price) || 0

    const alreadyReserved = reservedByProduct.get(selectedProduct.id) || 0
    const freeStock = Math.max(0, Number(selectedProduct.stock || 0) - alreadyReserved)
    if (qty > freeStock) {
      setFeedback({
        ok: false,
        text: `Stock libre insuficiente de ${selectedProduct.name}: hay ${selectedProduct.stock} en bodega y ${alreadyReserved} ya apartados.`,
      })
      return
    }

    setDraftItems(prev => {
      const existingIdx = prev.findIndex(
        x =>
          x.product_id === selectedProduct.id &&
          (x.variant_label || '') === (variant?.label || '')
      )
      if (existingIdx >= 0) {
        return prev.map((x, idx) =>
          idx === existingIdx
            ? {
                ...x,
                quantity: x.quantity + qty,
                subtotal: round2((x.quantity + qty) * x.unit_price),
              }
            : x
        )
      }
      return [
        ...prev,
        {
          product_id: selectedProduct.id,
          product_name: selectedProduct.name,
          sku: selectedProduct.sku || '',
          variant_label: variant?.label || null,
          quantity: qty,
          unit_price: unitPrice,
          subtotal: round2(qty * unitPrice),
        },
      ]
    })
    setPickQty('1')
  }

  const draftTotal = useMemo(
    () => round2(draftItems.reduce((acc, it) => acc + it.subtotal, 0)),
    [draftItems]
  )

  async function recordCashMovement(
    type: 'ingreso' | 'egreso',
    amount: number,
    description: string
  ) {
    if (amount <= 0) return
    await supabase.from('cash_entries').insert({
      type,
      amount: round2(amount),
      description,
      reference_type: 'layaway',
    })
  }

  async function handleCreateContract(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    if (!customerName.trim()) {
      setFeedback({ ok: false, text: 'Indica el nombre del cliente para el Plan Separe.' })
      return
    }
    if (draftItems.length === 0) {
      setFeedback({ ok: false, text: 'Agrega al menos un producto al apartado.' })
      return
    }

    const dep = round2(Math.max(0, parseFloat(initialDeposit) || 0))
    if (dep > draftTotal) {
      setFeedback({
        ok: false,
        text: 'El abono inicial no puede superar el total del apartado.',
      })
      return
    }

    setSaving(true)
    const code = makeDocumentCode('SEP')
    const days = Math.max(1, parseInt(termDays, 10) || 30)
    const due = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
    const nowIso = new Date().toISOString()

    // Intentar reserva formal en warehouse_stock_reservations si hay bodega activa
    const reservationIds: string[] = []
    if (activeWarehouseId) {
      for (const item of draftItems) {
        const { data: resId } = await supabase.rpc('reserve_warehouse_stock', {
          p_warehouse_id: activeWarehouseId,
          p_product_id: item.product_id,
          p_quantity: item.quantity,
          p_reference_type: 'plan_separe',
          p_expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
          p_notes: `Apartado ${code} · ${customerName.trim()}`,
        })
        if (typeof resId === 'string' && resId) {
          reservationIds.push(resId)
        }
      }
    }

    const payments: LayawayPayment[] =
      dep > 0
        ? [
            {
              id: makeSuiteId(),
              amount: dep,
              method: depositMethod,
              reference: depositRef.trim(),
              paid_at: nowIso,
              recorded_by: user?.full_name || user?.email || 'Cajero',
            },
          ]
        : []

    if (dep > 0 && depositMethod === 'efectivo') {
      await recordCashMovement(
        'ingreso',
        dep,
        `Abono inicial Plan Separe ${code} · ${customerName.trim()}`
      )
    }

    const record: LayawayContract = {
      id: makeSuiteId(),
      contract_code: code,
      warehouse_id: activeWarehouseId || null,
      customer_id: customerId || null,
      customer_name: customerName.trim(),
      customer_document: customerDoc.trim() || null,
      customer_phone: customerPhone.trim() || null,
      items: draftItems,
      total_amount: draftTotal,
      paid_amount: dep,
      balance: round2(draftTotal - dep),
      due_date: due,
      payments,
      reservation_ids: reservationIds,
      status: 'activo',
      sale_id: null,
      notes: notes.trim() || null,
      created_by_name: user?.full_name || user?.email || 'Ventas',
      created_at: nowIso,
      updated_at: nowIso,
    }

    const { saved } = await upsertSuiteRecord('layaway_contracts', scopeKey, record)
    setContracts(prev => [saved, ...prev.filter(c => c.id !== saved.id)])
    setCreateOpen(false)
    setCustomerId('')
    setCustomerName('')
    setCustomerDoc('')
    setCustomerPhone('')
    setInitialDeposit('')
    setDepositRef('')
    setNotes('')
    setDraftItems([])
    setSaving(false)

    setFeedback({
      ok: true,
      text: `Plan Separe ${code} creado para ${saved.customer_name}. Saldo pendiente: ${money(saved.balance)}.`,
    })
  }

  async function releaseReservations(contract: LayawayContract) {
    for (const resId of contract.reservation_ids || []) {
      await supabase.rpc('release_warehouse_reservation', {
        p_reservation_id: resId,
        p_status: 'released',
      })
    }
  }

  async function handleRegisterInstallment(e: React.FormEvent) {
    e.preventDefault()
    if (!paymentTarget || readOnly || saving) return

    const amount = round2(parseFloat(payAmount) || 0)
    if (amount <= 0 || amount > paymentTarget.balance + 0.01) {
      setFeedback({
        ok: false,
        text: `Ingresa un abono válido entre 0.01 y ${money(paymentTarget.balance)}.`,
      })
      return
    }

    setSaving(true)
    const nowIso = new Date().toISOString()
    const newPayment: LayawayPayment = {
      id: makeSuiteId(),
      amount,
      method: payMethod,
      reference: payRef.trim(),
      paid_at: nowIso,
      recorded_by: user?.full_name || user?.email || 'Cajero',
    }

    if (payMethod === 'efectivo') {
      await recordCashMovement(
        'ingreso',
        amount,
        `Cuota Plan Separe ${paymentTarget.contract_code} · ${paymentTarget.customer_name}`
      )
    }

    const nextPaid = round2(paymentTarget.paid_amount + amount)
    const nextBalance = Math.max(0, round2(paymentTarget.total_amount - nextPaid))

    const updated: LayawayContract = {
      ...paymentTarget,
      paid_amount: nextPaid,
      balance: nextBalance,
      payments: [...paymentTarget.payments, newPayment],
      updated_at: nowIso,
    }

    const { saved } = await upsertSuiteRecord('layaway_contracts', scopeKey, updated)
    setContracts(prev => prev.map(c => (c.id === saved.id ? saved : c)))
    setPaymentTarget(null)
    setPayAmount('')
    setPayRef('')
    setSaving(false)

    setFeedback({
      ok: true,
      text:
        nextBalance === 0
          ? `¡Saldo completado en ${saved.contract_code}! Ya puedes pulsar «Entregar y facturar» para emitir la venta oficial.`
          : `Abono de ${money(amount)} registrado en ${saved.contract_code}. Nuevo saldo: ${money(nextBalance)}.`,
    })
  }

  async function handleDeliverAndInvoice(contract: LayawayContract) {
    if (readOnly || saving || contract.status !== 'activo') return
    if (contract.balance > 0.01) {
      setPaymentTarget(contract)
      setPayAmount(String(contract.balance))
      return
    }

    setSaving(true)
    await releaseReservations(contract)

    // Determinar medio predominante y evitar duplicar efectivo ya ingresado en cuotas previas
    const priorCashDeposits = contract.payments
      .filter(p => p.method === 'efectivo')
      .reduce((acc, p) => acc + Number(p.amount || 0), 0)

    const salePaymentMethod = priorCashDeposits > 0 ? 'efectivo' : 'transferencia'
    const clientSaleId = newId()

    const saleRes = await sendSale({
      client_id: clientSaleId,
      customer_id: contract.customer_id,
      customer_name: contract.customer_name,
      items: contract.items.map(it => ({
        product_id: it.product_id,
        product_name: it.variant_label
          ? `${it.product_name} (${it.variant_label})`
          : it.product_name,
        quantity: it.quantity,
        price: it.unit_price,
        subtotal: it.subtotal,
      })),
      payment_method: salePaymentMethod,
      geo: null,
      captured_at: new Date().toISOString(),
      total: contract.total_amount,
      channel: 'mostrador',
      warehouse_id: contract.warehouse_id,
    })

    if (!saleRes.ok) {
      setSaving(false)
      setFeedback({
        ok: false,
        text: saleRes.network
          ? 'Sin conexión temporal con el servidor. Intenta nuevamente en unos segundos.'
          : saleRes.message ||
            'No se pudo facturar la entrega. Verifica el stock disponible en bodega.',
      })
      return
    }

    // Como registrar_venta con 'efectivo' ingresa el total de la venta a caja, compensamos los anticipos previos en efectivo ya contabilizados en sus fechas reales
    if (priorCashDeposits > 0) {
      await recordCashMovement(
        'egreso',
        priorCashDeposits,
        `Cruce anticipos previos ya ingresados · Facturación ${contract.contract_code}`
      )
    }

    const updated: LayawayContract = {
      ...contract,
      status: 'completado',
      sale_id: clientSaleId,
      updated_at: new Date().toISOString(),
    }
    const { saved } = await upsertSuiteRecord('layaway_contracts', scopeKey, updated)
    setContracts(prev => prev.map(c => (c.id === saved.id ? saved : c)))
    await loadData()
    setSaving(false)

    setFeedback({
      ok: true,
      text: `Plan Separe ${contract.contract_code} liquidado y entregado: la factura quedó emitida en Ventas y el inventario fue descargado.`,
    })
  }

  async function handleCancelContract(contract: LayawayContract) {
    if (readOnly || saving || contract.status !== 'activo') return
    setSaving(true)
    await releaseReservations(contract)
    const updated: LayawayContract = {
      ...contract,
      status: 'anulado',
      updated_at: new Date().toISOString(),
    }
    const { saved } = await upsertSuiteRecord('layaway_contracts', scopeKey, updated)
    setContracts(prev => prev.map(c => (c.id === saved.id ? saved : c)))
    setSaving(false)
    setFeedback({
      ok: true,
      text: `Apartado ${contract.contract_code} anulado. Las unidades reservadas volvieron a quedar disponibles para la venta.`,
    })
  }

  function buildWhatsappReminderUrl(c: LayawayContract): string {
    const cleanPhone = (c.customer_phone || '').replace(/[^\d]/g, '')
    const itemSummary = c.items
      .map(
        it =>
          `• ${it.quantity}x ${it.product_name}${it.variant_label ? ` (${it.variant_label})` : ''}`
      )
      .join('\n')
    const msg = [
      `Hola ${c.customer_name}, te escribimos para recordar el estado de tu *Plan Separe ${c.contract_code}*:`,
      '',
      itemSummary,
      '',
      `Total apartado: *${money(c.total_amount)}*`,
      `Abonado a la fecha: *${money(c.paid_amount)}*`,
      `Saldo pendiente: *${money(c.balance)}*`,
      `Fecha límite: *${fmtDate(c.due_date)}*`,
    ].join('\n')
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
  }

  function handlePrintLayawayTicket(c: LayawayContract) {
    const itemsHtml = c.items
      .map(
        it => `<tr>
          <td>${esc(it.product_name)}${it.variant_label ? ` (${esc(it.variant_label)})` : ''}</td>
          <td style="text-align:center">${it.quantity}</td>
          <td style="text-align:right">${esc(money(it.unit_price))}</td>
          <td style="text-align:right">${esc(money(it.subtotal))}</td>
        </tr>`
      )
      .join('')

    const paysHtml = c.payments
      .map(
        p => `<tr>
          <td>${esc(fmtDateTime(p.paid_at))}</td>
          <td>${esc(p.method.toUpperCase())}${p.reference ? ` · Ref ${esc(p.reference)}` : ''}</td>
          <td style="text-align:right">${esc(money(p.amount))}</td>
        </tr>`
      )
      .join('')

    printHtml(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Plan Separe ${esc(c.contract_code)}</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#0f172a;font-size:12px;max-width:720px;margin:0 auto}
        h1{font-size:18px;margin:0 0 4px}
        table{width:100%;border-collapse:collapse;margin:12px 0}
        th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left}
        th{background:#f8fafc;font-size:11px;text-transform:uppercase;color:#475569}
        .totals{margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px}
      </style></head><body>
      <h1>Comprobante de Plan Separe · ${esc(c.contract_code)}</h1>
      <p style="color:#475569;margin:0 0 12px">Cliente: <strong>${esc(c.customer_name)}</strong> ${c.customer_document ? `(${esc(c.customer_document)})` : ''} · Vence: <strong>${esc(fmtDate(c.due_date))}</strong></p>
      <table>
        <thead><tr><th>Artículo apartado</th><th style="text-align:center">Cant.</th><th style="text-align:right">Unitario</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <h3 style="font-size:13px;margin:16px 0 6px">Historial de abonos</h3>
      <table>
        <thead><tr><th>Fecha</th><th>Medio</th><th style="text-align:right">Monto</th></tr></thead>
        <tbody>${paysHtml || '<tr><td colspan="3">Sin abonos registrados</td></tr>'}</tbody>
      </table>
      <div class="totals">
        <div>Total mercancía apartada: <strong>${esc(money(c.total_amount))}</strong></div>
        <div>Total abonado: <strong>${esc(money(c.paid_amount))}</strong></div>
        <div style="font-size:14px;margin-top:4px">Saldo pendiente para retiro: <strong>${esc(money(c.balance))}</strong></div>
      </div>
    </body></html>`)
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const soonIso = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)

  const kpis = useMemo(() => {
    const active = contracts.filter(c => c.status === 'activo')
    const totalReservedValue = active.reduce((s, c) => s + c.total_amount, 0)
    const pendingReceivable = active.reduce((s, c) => s + c.balance, 0)
    const expiringSoon = active.filter(c => c.due_date <= soonIso).length
    return {
      activeCount: active.length,
      totalReservedValue,
      pendingReceivable,
      expiringSoon,
    }
  }, [contracts, soonIso])

  const filteredContracts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contracts.filter(c => {
      if (
        q &&
        !c.contract_code.toLowerCase().includes(q) &&
        !c.customer_name.toLowerCase().includes(q) &&
        !(c.customer_document || '').toLowerCase().includes(q)
      ) {
        return false
      }
      if (statusFilter === 'activo') return c.status === 'activo'
      if (statusFilter === 'por_vencer') return c.status === 'activo' && c.due_date <= soonIso
      if (statusFilter === 'completado') return c.status === 'completado'
      if (statusFilter === 'anulado') return c.status === 'anulado'
      return true
    })
  }, [contracts, search, statusFilter, soonIso])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Plan Separe y sistema de apartados
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Reserva prendas o mercancía con abono inicial, controla cuotas en caja, envía recordatorios por WhatsApp y emite la factura oficial al liquidar el saldo.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={contracts.length === 0}
            onClick={() =>
              downloadCsv(
                'plan_separe_apartados.csv',
                ['Código', 'Cliente', 'Teléfono', 'Total', 'Abonado', 'Saldo', 'Vencimiento', 'Estado'],
                contracts.map(c => [
                  c.contract_code,
                  c.customer_name,
                  c.customer_phone || '',
                  c.total_amount,
                  c.paid_amount,
                  c.balance,
                  c.due_date,
                  c.status,
                ])
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Nuevo Plan Separe
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Modo solo lectura: activa tu suscripción para abrir apartados o registrar abonos.
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

      {/* Resumen operativo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Apartados vigentes</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{kpis.activeCount}</p>
          <p className="text-xs text-slate-500 mt-1">Mercancía reservada para clientes</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Valor total comprometido</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {money(kpis.totalReservedValue)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Ventas aseguradas en proceso</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Saldo pendiente por recaudar</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
            {money(kpis.pendingReceivable)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Ingresará al liquidar entregas</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Por vencer (próximos 5 días o vencidos)</p>
          <p
            className={`text-2xl font-bold mt-1 tabular-nums ${
              kpis.expiringSoon > 0 ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {kpis.expiringSoon}
          </p>
          <p className="text-xs text-slate-500 mt-1">Envía recordatorio en 1 clic</p>
        </div>
      </div>

      {/* Filtros y tabla */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por código SEP-..., cliente o documento..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 overflow-x-auto">
            {(
              [
                { id: 'activo', label: 'Activos' },
                { id: 'por_vencer', label: 'Por vencer / Vencidos' },
                { id: 'completado', label: 'Facturados y entregados' },
                { id: 'anulado', label: 'Anulados' },
                { id: 'all', label: 'Todos' },
              ] as const
            ).map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  statusFilter === f.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Contrato / Cliente</th>
                <th className="text-left px-4 py-3 font-medium">Mercancía apartada</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-right px-4 py-3 font-medium">Abonado</th>
                <th className="text-right px-4 py-3 font-medium">Saldo</th>
                <th className="text-left px-4 py-3 font-medium">Vencimiento</th>
                <th className="text-right px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredContracts.map(c => {
                const isExpired = c.status === 'activo' && c.due_date < todayIso
                return (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{c.customer_name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <span className="font-mono">{c.contract_code}</span>
                        <span aria-hidden="true"> · </span>
                        <span>
                          {c.status === 'completado'
                            ? 'Entregado y facturado'
                            : c.status === 'anulado'
                              ? 'Liberado'
                              : isExpired
                                ? 'Plazo vencido'
                                : 'Vigente'}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-700 max-w-xs">
                      {c.items.map((it, idx) => (
                        <div key={idx} className="truncate">
                          {it.quantity}× {it.product_name}
                          {it.variant_label ? ` (${it.variant_label})` : ''}
                        </div>
                      ))}
                    </td>

                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {money(c.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-medium">
                      {money(c.paid_amount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                      {money(c.balance)}
                    </td>

                    <td className="px-4 py-3 text-xs">
                      <div className={isExpired ? 'text-red-700 font-semibold' : 'text-slate-700'}>
                        {fmtDate(c.due_date)}
                      </div>
                      <div className="text-slate-400">{c.payments.length} abono(s)</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handlePrintLayawayTicket(c)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          title="Imprimir comprobante"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>

                        {c.status === 'activo' && (
                          <>
                            <a
                              href={buildWhatsappReminderUrl(c)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                              title="Enviar recordatorio por WhatsApp"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              WhatsApp
                            </a>

                            {c.balance > 0.01 ? (
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => {
                                  setPaymentTarget(c)
                                  setPayAmount(String(c.balance))
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-40"
                              >
                                <Banknote className="w-3.5 h-3.5" />
                                Abonar
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={readOnly || saving}
                                onClick={() => void handleDeliverAndInvoice(c)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Entregar y facturar
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={readOnly || saving}
                              onClick={() => void handleCancelContract(c)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              Liberar
                            </button>
                          </>
                        )}

                        {c.status === 'completado' && onNavigate && (
                          <button
                            type="button"
                            onClick={() => onNavigate('sales')}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Ver venta
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}

              {!loading && filteredContracts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    No hay contratos de Plan Separe en esta vista.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal crear Plan Separe */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-2xl max-h-[92vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Nuevo contrato de Plan Separe</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateContract} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Seleccionar cliente registrado (opcional)
                  </label>
                  <select
                    value={customerId}
                    onChange={e => handleSelectCustomer(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Escribir datos manualmente...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.document ? `(${c.document})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Nombre completo del cliente *
                  </label>
                  <input
                    required
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="Ej. María Fernanda Gómez"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Documento / Cédula / NIT
                  </label>
                  <input
                    value={customerDoc}
                    onChange={e => setCustomerDoc(e.target.value)}
                    placeholder="Ej. 1020304050"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    WhatsApp del cliente (con indicativo país)
                  </label>
                  <input
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="Ej. 573001234567"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              {/* Selector de productos a apartar */}
              <div className="border border-slate-200 rounded-lg p-3.5 space-y-3 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-700">
                  Agregar productos a reservar
                </p>
                <div className="grid sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-6">
                    <select
                      value={pickProductId}
                      onChange={e => {
                        setPickProductId(e.target.value)
                        setPickVariantId('')
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="">Elegir producto...</option>
                      {products.map(p => {
                        const res = reservedByProduct.get(p.id) || 0
                        const libre = Math.max(0, Number(p.stock || 0) - res)
                        return (
                          <option key={p.id} value={p.id} disabled={libre <= 0}>
                            {p.name} — {money(p.price)} (Libre: {libre})
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  {selectedProductVariants.length > 0 ? (
                    <div className="sm:col-span-3">
                      <select
                        value={pickVariantId}
                        onChange={e => setPickVariantId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                      >
                        <option value="">Talla / cualidad...</option>
                        {selectedProductVariants.map(v => (
                          <option key={v.id} value={v.id}>
                            {v.label} ({money(v.price)})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className={selectedProductVariants.length > 0 ? 'sm:col-span-1' : 'sm:col-span-3'}>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={pickQty}
                      onChange={e => setPickQty(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm text-center tabular-nums bg-white"
                    />
                  </div>

                  <div className={selectedProductVariants.length > 0 ? 'sm:col-span-2' : 'sm:col-span-3'}>
                    <button
                      type="button"
                      disabled={!pickProductId}
                      onClick={addDraftItem}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
                    >
                      Añadir
                    </button>
                  </div>
                </div>

                {draftItems.length > 0 && (
                  <div className="divide-y divide-slate-200 bg-white rounded-lg border border-slate-200">
                    {draftItems.map((it, idx) => (
                      <div key={idx} className="px-3 py-2 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-medium text-slate-900">
                            {it.quantity}× {it.product_name}
                          </span>
                          {it.variant_label && (
                            <span className="text-slate-500"> · {it.variant_label}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-slate-900 tabular-nums">
                            {money(it.subtotal)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setDraftItems(prev => prev.filter((_, i) => i !== idx))
                            }
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Plazo del apartado
                  </label>
                  <select
                    value={termDays}
                    onChange={e => setTermDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="15">15 días</option>
                    <option value="30">30 días</option>
                    <option value="45">45 días</option>
                    <option value="60">60 días</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Abono inicial recibido
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={initialDeposit}
                    onChange={e => setInitialDeposit(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Medio del abono inicial
                  </label>
                  <select
                    value={depositMethod}
                    onChange={e =>
                      setDepositMethod(e.target.value as 'efectivo' | 'transferencia' | 'tarjeta')
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="efectivo">Efectivo (entra a Caja)</option>
                    <option value="transferencia">Transferencia / Nequi / Pago Móvil</option>
                    <option value="tarjeta">Tarjeta / Datáfono</option>
                  </select>
                </div>
              </div>

              {depositMethod !== 'efectivo' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Referencia del comprobante bancario (opcional)
                  </label>
                  <input
                    value={depositRef}
                    onChange={e => setDepositRef(e.target.value)}
                    placeholder="Ej. #849201"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <div className="text-sm">
                  <span className="text-slate-500">Total apartado: </span>
                  <strong className="text-slate-900 tabular-nums">{money(draftTotal)}</strong>
                  <span className="text-slate-400 mx-2">·</span>
                  <span className="text-slate-500">Saldo restante: </span>
                  <strong className="text-emerald-700 tabular-nums">
                    {money(Math.max(0, draftTotal - (parseFloat(initialDeposit) || 0)))}
                  </strong>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || draftItems.length === 0}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
                  >
                    {saving ? 'Guardando...' : 'Confirmar Plan Separe'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal registrar cuota / abono */}
      {paymentTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setPaymentTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Registrar abono · {paymentTarget.contract_code}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {paymentTarget.customer_name} · Saldo actual: {money(paymentTarget.balance)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterInstallment} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Monto del abono
                </label>
                <input
                  required
                  type="number"
                  min="0.01"
                  max={paymentTarget.balance}
                  step="any"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Medio de pago
                </label>
                <select
                  value={payMethod}
                  onChange={e =>
                    setPayMethod(e.target.value as 'efectivo' | 'transferencia' | 'tarjeta')
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="efectivo">Efectivo (ingresa a Caja)</option>
                  <option value="transferencia">Transferencia / Nequi / Pago Móvil</option>
                  <option value="tarjeta">Tarjeta / Datáfono</option>
                </select>
              </div>

              {payMethod !== 'efectivo' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Referencia de transferencia (opcional)
                  </label>
                  <input
                    value={payRef}
                    onChange={e => setPayRef(e.target.value)}
                    placeholder="Ej. #992014"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40"
                >
                  <CalendarClock className="w-4 h-4" />
                  {saving ? 'Registrando...' : 'Guardar abono'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
