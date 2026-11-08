import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Layers,
  MapPin,
  MessageCircle,
  Package,
  PackageCheck,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  Truck,
  UserCheck,
  AlertTriangle,
  ArrowRight,
  Plus,
  X,
  FileText,
} from 'lucide-react'
import { useCurrency, fmtDateTime } from '../lib/currency'
import { esc, printHtml } from '../lib/documents'
import {
  getOmnichannelOrders,
  updateOmnichannelStage,
  checkDuplicatePaymentReceipt,
  createOmnichannelOrder,
} from '../lib/innovationsRepo'
import EpodModal from '../components/EpodModal'
import type { OmnichannelOrder, OmnichannelSource, OmnichannelStage, EpodRecord } from '../types'

interface OmnichannelInboxProps {
  onNavigate?: (page: string) => void
}

const STAGES: { id: OmnichannelStage | 'todos'; label: string; icon: any }[] = [
  { id: 'todos', label: 'Todos los pedidos', icon: Layers },
  { id: 'recibido', label: 'Nuevos recibidos', icon: ShoppingBag },
  { id: 'alistamiento', label: 'En Alistamiento (Picking)', icon: Boxes },
  { id: 'empaque', label: 'En Empaque (Packing)', icon: Package },
  { id: 'listo_despacho', label: 'Listos para Despacho', icon: PackageCheck },
  { id: 'en_reparto', label: 'En Reparto / Ruta', icon: Truck },
  { id: 'entregado', label: 'Entregados con e-POD', icon: CheckCircle2 },
]

const CHANNELS: Record<OmnichannelSource, { label: string; bg: string; text: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: '💬' },
  catalogo: { label: 'Catálogo Web', bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', icon: '🛍️' },
  ruta: { label: 'Venta en Ruta', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: '🚚' },
  pos: { label: 'Pre-pedido POS', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: '🏪' },
  api: { label: 'API / E-commerce', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700', icon: '🔌' },
}

export default function OmnichannelInbox({ onNavigate }: OmnichannelInboxProps) {
  const { fmt } = useCurrency()
  const [orders, setOrders] = useState<OmnichannelOrder[]>([])
  const [activeStage, setActiveStage] = useState<OmnichannelStage | 'todos'>('todos')
  const [selectedChannel, setSelectedChannel] = useState<string>('todos')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<OmnichannelOrder | null>(null)
  const [epodTargetOrder, setEpodTargetOrder] = useState<OmnichannelOrder | null>(null)
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [showNewOrderModal, setShowNewOrderModal] = useState(false)

  // Formulario nuevo pedido
  const [newChannel, setNewChannel] = useState<OmnichannelSource>('whatsapp')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newCustomerDoc, setNewCustomerDoc] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newDeliveryMode, setNewDeliveryMode] = useState<'pickup' | 'delivery' | 'shipping'>('delivery')
  const [newPaymentMethod, setNewPaymentMethod] = useState('transferencia')
  const [newPaymentRef, setNewPaymentRef] = useState('')
  const [newItems, setNewItems] = useState([
    { product_name: 'Café Especial 500g', quantity: 2, unit_price: 18500 },
  ])
  const [newNotes, setNewNotes] = useState('')

  useEffect(() => {
    setOrders(getOmnichannelOrders())
  }, [])

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const matchStage = activeStage === 'todos' || o.stage === activeStage
      const matchChannel = selectedChannel === 'todos' || o.channel === selectedChannel
      const matchSearch =
        searchQuery === '' ||
        o.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.customer_phone.includes(searchQuery)
      return matchStage && matchChannel && matchSearch
    })
  }, [orders, activeStage, selectedChannel, searchQuery])

  function handleStageChange(orderId: string, newStage: OmnichannelStage) {
    const updated = updateOmnichannelStage(orderId, newStage)
    setOrders(updated)
    if (selectedOrder?.id === orderId) {
      setSelectedOrder(updated.find(o => o.id === orderId) || null)
    }
  }

  function handleEpodSuccess(epod: EpodRecord) {
    if (!epodTargetOrder) return
    const updated = updateOmnichannelStage(epodTargetOrder.id, 'entregado', {
      epod_id: epod.id,
      order_status: 'entregado',
    })
    setOrders(updated)
    setEpodTargetOrder(null)
    if (selectedOrder?.id === epodTargetOrder.id) {
      setSelectedOrder(updated.find(o => o.id === epodTargetOrder.id) || null)
    }
  }

  function sendWhatsAppStatusNotification(order: OmnichannelOrder) {
    const stageNames: Record<OmnichannelStage, string> = {
      recibido: 'recibido y confirmado',
      alistamiento: 'en preparación en nuestra bodega',
      empaque: 'empacado y listo para despacho',
      listo_despacho: 'programado para salir en ruta',
      en_reparto: 'en camino a tu dirección con nuestro repartidor',
      entregado: 'entregado con éxito',
      cancelado: 'cancelado',
    }

    const text = `¡Hola ${order.customer_name}! Tu pedido *#${order.order_number}* se encuentra actualmente *${stageNames[order.stage]}*. PIN de entrega e-POD: *${order.tracking_pin}*. Total: ${fmt(order.total)}. ¡Gracias por tu preferencia!`
    const encoded = encodeURIComponent(text)
    const cleanPhone = order.customer_phone.replace(/[^\d]/g, '')
    const url = `https://wa.me/${cleanPhone}?text=${encoded}`
    
    // Evitar window.open en iframe: copiar y abrir de forma segura
    try {
      navigator.clipboard?.writeText?.(text)
    } catch {
      /* ignore */
    }
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.click()

    setCopiedMsgId(order.id)
    setTimeout(() => setCopiedMsgId(null), 3000)
  }

  function printPickingTicket(order: OmnichannelOrder) {
    const itemsHtml = order.items
      .map(
        (it, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 4px; font-weight: bold;">${idx + 1}</td>
          <td style="padding: 8px 4px;">${esc(it.product_name)}</td>
          <td style="padding: 8px 4px; text-align: center; font-size: 16px; font-weight: 800;">${it.quantity}</td>
          <td style="padding: 8px 4px; text-align: right;">[ &nbsp; ] Verificado</td>
        </tr>
      `
      )
      .join('')

    const ticketHtml = `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <title>Ticket de Alistamiento - ${esc(order.order_number)}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; padding: 20px; max-width: 480px; margin: 0 auto; color: #1e293b; font-size: 13px; }
            h2, h3 { margin: 4px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            hr { border: 0; border-top: 1px dashed #94a3b8; margin: 12px 0; }
          </style>
        </head>
        <body>
          <h2>INVENTARIO PRO - ALISTAMIENTO (PICKING)</h2>
          <p><strong>Pedido:</strong> ${esc(order.order_number)} | <strong>Origen:</strong> ${esc(order.channel.toUpperCase())}</p>
          <p><strong>Cliente:</strong> ${esc(order.customer_name)} (${esc(order.customer_phone)})</p>
          <p><strong>Dirección:</strong> ${esc(order.delivery_address || 'Entrega en mostrador')}</p>
          <hr />
          <table>
            <thead>
              <tr style="border-bottom: 2px solid #000; text-align: left;">
                <th>#</th>
                <th>Producto</th>
                <th style="text-align: center;">Cant.</th>
                <th style="text-align: right;">Check</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <hr />
          <p><strong>PIN de Entrega (e-POD):</strong> <span style="font-size: 18px; font-weight: bold; letter-spacing: 2px;">${esc(order.tracking_pin)}</span></p>
          <p style="margin-top: 24px;">Responsable de Alistamiento: _______________________</p>
          <p>Fecha y Hora: ${new Date().toLocaleString()}</p>
        </body>
      </html>
    `
    printHtml(ticketHtml)
  }

  function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!newCustomerName.trim() || newItems.length === 0) return

    const itemsWithSubtotal = newItems.map((item, idx) => ({
      product_id: `prod-manual-${idx}`,
      product_name: item.product_name,
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unit_price) || 0,
      subtotal: (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
    }))

    const subtotal = itemsWithSubtotal.reduce((acc, it) => acc + it.subtotal, 0)

    const created = createOmnichannelOrder({
      company_id: '00000000-0000-4000-8000-000000000001',
      channel: newChannel,
      stage: 'recibido',
      customer_type: 'natural',
      customer_id: null,
      customer_name: newCustomerName.trim(),
      customer_document: newCustomerDoc.trim() || null,
      contact_person: null,
      requires_fiscal_invoice: false,
      customer_phone: newCustomerPhone.trim() || '+57 300 000 0000',
      customer_email: null,
      delivery_mode: newDeliveryMode,
      delivery_address: newAddress.trim() || 'Despacho a coordinar',
      customer_notes: newNotes.trim() || null,
      items: itemsWithSubtotal,
      subtotal,
      tax_rate: 0,
      tax_amount: 0,
      total: subtotal,
      currency: 'COP',
      payment_method: newPaymentMethod,
      payment_reference: newPaymentRef.trim() || null,
      payment_sender_bank: newPaymentMethod === 'transferencia' ? 'Bancolombia/Nequi' : null,
      payment_amount_reported: subtotal,
      payment_proof_url: null,
      payment_status: newPaymentMethod === 'contra_entrega' ? 'sin_comprobante' : 'pendiente_verificacion',
      order_status: 'nuevo',
      verified_by: null,
      verified_by_name: null,
      verified_at: null,
      admin_notes: 'Registrado desde bandeja omnicanal.',
      sale_id: null,
      quotation_id: null,
    })

    setOrders(getOmnichannelOrders())
    setSelectedOrder(created)
    setShowNewOrderModal(false)
    // Reset form
    setNewCustomerName('')
    setNewCustomerPhone('')
    setNewCustomerDoc('')
    setNewAddress('')
    setNewPaymentRef('')
    setNewNotes('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-100 text-indigo-800 rounded-xl">
              <Boxes className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-800">
                Centro Universal de Pedidos Omnicanal
              </h1>
              <p className="text-xs text-slate-500">
                Bandeja unificada de preparación: WhatsApp, Catálogo Web, Ventas en Ruta y Tienda.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewOrderModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo Pedido
          </button>
          <button
            onClick={() => setOrders(getOmnichannelOrders())}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
          {onNavigate && (
            <button
              onClick={() => onNavigate('dispatch')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              <Truck className="w-3.5 h-3.5" />
              Despacho de Rutas
            </button>
          )}
        </div>
      </div>

      {/* Filtros de Pipeline y Canales */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        {/* Pipeline por etapas */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {STAGES.map(s => {
            const Icon = s.icon
            const count =
              s.id === 'todos'
                ? orders.length
                : orders.filter(o => o.stage === s.id).length
            const active = activeStage === s.id

            return (
              <button
                key={s.id}
                onClick={() => setActiveStage(s.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200/70 text-slate-600'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{s.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    active ? 'bg-slate-800 text-emerald-400' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Buscador y filtro por canal */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between pt-2 border-t border-slate-100">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por # pedido, cliente o teléfono..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1">
            <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Canal:
            </span>
            <button
              onClick={() => setSelectedChannel('todos')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium cursor-pointer ${
                selectedChannel === 'todos'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todos
            </button>
            {(Object.keys(CHANNELS) as OmnichannelSource[]).map(ch => (
              <button
                key={ch}
                onClick={() => setSelectedChannel(ch)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium cursor-pointer flex items-center gap-1 ${
                  selectedChannel === ch
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{CHANNELS[ch].icon}</span>
                <span>{CHANNELS[ch].label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid de Pedidos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de Pedidos */}
        <div className="lg:col-span-2 space-y-3">
          {filteredOrders.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-400">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold">No hay pedidos en esta etapa o canal</p>
            </div>
          ) : (
            filteredOrders.map(order => {
              const ch = CHANNELS[order.channel]
              const duplicateWarning = checkDuplicatePaymentReceipt(
                order.order_number,
                order.payment_reference
              )
              const isSelected = selectedOrder?.id === order.id

              return (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className={`bg-white p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                    isSelected
                      ? 'border-indigo-600 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${ch.bg} ${ch.text} flex items-center gap-1`}>
                        <span>{ch.icon}</span>
                        <span>{ch.label}</span>
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-800">
                        #{order.order_number}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {fmtDateTime(order.created_at)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-black text-slate-900 block">
                        {fmt(order.total)}
                      </span>
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">
                        {order.payment_method}
                      </span>
                    </div>
                  </div>

                  {/* Advertencia de comprobante duplicado si existe */}
                  {duplicateWarning && (
                    <div className="mt-2.5 p-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        ¡Alerta! Referencia bancaria #{duplicateWarning.reference} ya usada en pedido{' '}
                        <strong>{duplicateWarning.original_order_number}</strong>.
                      </span>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                    <div>
                      <p className="font-bold text-slate-800">{order.customer_name}</p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {order.delivery_address || 'Entrega en mostrador'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px]">
                        {order.items.length} {order.items.length === 1 ? 'producto' : 'productos'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          order.stage === 'entregado'
                            ? 'bg-emerald-100 text-emerald-800'
                            : order.stage === 'en_reparto'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {order.stage.replace('_', ' ').toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Panel Lateral: Detalle de Preparación y Acciones */}
        <div className="lg:col-span-1">
          {selectedOrder ? (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 sticky top-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">
                    Gestión de Pedido #{selectedOrder.order_number}
                  </h3>
                  <p className="text-xs text-slate-500">{selectedOrder.customer_name}</p>
                </div>
                <button
                  onClick={() => printPickingTicket(selectedOrder)}
                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  title="Imprimir ticket de alistamiento para bodega"
                >
                  <Printer className="w-4 h-4" />
                </button>
              </div>

              {/* Pipeline Step Changer */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">
                  Avanzar estado del pedido:
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                  <button
                    onClick={() => handleStageChange(selectedOrder.id, 'alistamiento')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedOrder.stage === 'alistamiento'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    📦 En Alistamiento
                  </button>
                  <button
                    onClick={() => handleStageChange(selectedOrder.id, 'empaque')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedOrder.stage === 'empaque'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    🏷️ En Empaque
                  </button>
                  <button
                    onClick={() => handleStageChange(selectedOrder.id, 'listo_despacho')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedOrder.stage === 'listo_despacho'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    🚚 Listo Despacho
                  </button>
                  <button
                    onClick={() => handleStageChange(selectedOrder.id, 'en_reparto')}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedOrder.stage === 'en_reparto'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    📍 En Reparto
                  </button>
                </div>
              </div>

              {/* Botón de Firma e-POD */}
              <div className="pt-2">
                {selectedOrder.stage === 'entregado' ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold">Entrega con e-POD Verificada</p>
                      <p className="text-[11px] text-emerald-700">
                        Firma táctil y georreferenciación archivadas.
                      </p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setEpodTargetOrder(selectedOrder)}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white p-2.5 rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Capturar Firma e-POD (Entregar)
                  </button>
                )}
              </div>

              {/* Notificar por WhatsApp */}
              <div>
                <button
                  onClick={() => sendWhatsAppStatusNotification(selectedOrder)}
                  className="w-full flex items-center justify-center gap-2 border border-emerald-300 hover:bg-emerald-50 text-emerald-700 p-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  {copiedMsgId === selectedOrder.id
                    ? '¡Notificación enviada!'
                    : 'Avisar estado por WhatsApp'}
                </button>
              </div>

              {/* Resumen de Items */}
              <div className="border-t border-slate-100 pt-3">
                <span className="text-xs font-bold text-slate-700 block mb-2">
                  Productos ({selectedOrder.items.length}):
                </span>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {selectedOrder.items.map((it, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs p-2 bg-slate-50 rounded-lg"
                    >
                      <div>
                        <p className="font-semibold text-slate-800">{it.product_name}</p>
                        <p className="text-[10px] text-slate-500">
                          {it.quantity} x {fmt(it.unit_price)}
                        </p>
                      </div>
                      <span className="font-bold text-slate-700">{fmt(it.subtotal)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-200 text-center text-slate-400">
              <Boxes className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">Selecciona un pedido de la lista para ver su detalle de preparación.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal e-POD */}
      {epodTargetOrder && (
        <EpodModal
          order={epodTargetOrder}
          onClose={() => setEpodTargetOrder(null)}
          onSuccess={handleEpodSuccess}
        />
      )}

      {/* Modal Registrar Pedido Omnicanal */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 my-8 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
                  <Plus className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    Registrar Pedido Multicanal
                  </h3>
                  <p className="text-xs text-slate-500">
                    Ingresa pedidos recibidos por WhatsApp, llamadas, mostrador o mensajes directos.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewOrderModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4">
              {/* Canal de Origen */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Canal de Ingreso:
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {(['whatsapp', 'catalogo', 'ruta', 'pos', 'api'] as OmnichannelSource[]).map(ch => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setNewChannel(ch)}
                      className={`p-2 rounded-xl border text-center text-xs font-semibold cursor-pointer transition-all ${
                        newChannel === ch
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block text-base mb-0.5">{CHANNELS[ch].icon}</span>
                      {CHANNELS[ch].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Datos del Cliente */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Nombre o Empresa Cliente *:
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerName}
                    onChange={e => setNewCustomerName(e.target.value)}
                    placeholder="Ej. Autoservicio San Marcos"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    WhatsApp / Teléfono:
                  </label>
                  <input
                    type="text"
                    value={newCustomerPhone}
                    onChange={e => setNewCustomerPhone(e.target.value)}
                    placeholder="+57 310 123 4567"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Modalidad de Entrega:
                  </label>
                  <select
                    value={newDeliveryMode}
                    onChange={e => setNewDeliveryMode(e.target.value as any)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-indigo-500 bg-white"
                  >
                    <option value="delivery">Despacho con Domicilio / Repartidor</option>
                    <option value="pickup">Recogida en Tienda / Mostrador</option>
                    <option value="shipping">Envío Nacional por Transportadora</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Dirección de Entrega:
                  </label>
                  <input
                    type="text"
                    value={newAddress}
                    onChange={e => setNewAddress(e.target.value)}
                    placeholder="Calle 45 # 12-34 Local 2"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-indigo-500"
                  />
                </div>
              </div>

              {/* Items del Pedido */}
              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">Productos del Pedido:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNewItems(prev => [
                        ...prev,
                        { product_name: 'Nuevo Producto', quantity: 1, unit_price: 10000 },
                      ])
                    }
                    className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Añadir Ítem
                  </button>
                </div>

                {newItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200 text-xs">
                    <input
                      type="text"
                      value={item.product_name}
                      onChange={e => {
                        const copy = [...newItems]
                        copy[idx].product_name = e.target.value
                        setNewItems(copy)
                      }}
                      placeholder="Producto"
                      className="flex-1 p-1.5 border rounded-lg focus:outline-indigo-500"
                    />
                    <div className="w-16">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={e => {
                          const copy = [...newItems]
                          copy[idx].quantity = Number(e.target.value) || 1
                          setNewItems(copy)
                        }}
                        placeholder="Cant"
                        className="w-full p-1.5 border rounded-lg text-center focus:outline-indigo-500"
                      />
                    </div>
                    <div className="w-24">
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={item.unit_price}
                        onChange={e => {
                          const copy = [...newItems]
                          copy[idx].unit_price = Number(e.target.value) || 0
                          setNewItems(copy)
                        }}
                        placeholder="Precio"
                        className="w-full p-1.5 border rounded-lg text-right focus:outline-indigo-500"
                      />
                    </div>
                    {newItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setNewItems(prev => prev.filter((_, i) => i !== idx))}
                        className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}

                <div className="text-right text-xs font-bold text-slate-800 pt-1">
                  Total estimado: {fmt(newItems.reduce((acc, it) => acc + (it.quantity * it.unit_price), 0))}
                </div>
              </div>

              {/* Pago y Referencia Anti-Fraude */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Método de Pago:
                  </label>
                  <select
                    value={newPaymentMethod}
                    onChange={e => setNewPaymentMethod(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-indigo-500 bg-white"
                  >
                    <option value="transferencia">Transferencia Bancaria (Nequi / Bancolombia / Daviplata)</option>
                    <option value="contra_entrega">Pago Contra-Entrega (Efectivo/Datafono al repartidor)</option>
                    <option value="efectivo">Efectivo Pagado por Adelantado</option>
                    <option value="credito">Crédito Empresarial con Cartera</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Comprobante / Nro. de Referencia:
                  </label>
                  <input
                    type="text"
                    value={newPaymentRef}
                    onChange={e => setNewPaymentRef(e.target.value)}
                    placeholder="Ej. NEQ-94821 o # de transacción"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-indigo-500"
                  />
                </div>
              </div>

              {/* ALERTA DE COMPROBANTE DUPLICADO EN TIEMPO REAL */}
              {newPaymentRef.trim() && (() => {
                const warn = checkDuplicatePaymentReceipt(newPaymentRef.trim(), 'Nuevo-Temp')
                if (!warn) return null
                return (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start gap-2 animate-pulse">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">⚠️ ¡ALERTA DE SEGURIDAD! Comprobante potencialmente reutilizado</p>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        El número <strong>{warn.reference}</strong> ya fue registrado el día{' '}
                        <strong>{warn.original_date}</strong> para el cliente{' '}
                        <strong>{warn.original_customer_name}</strong> en el pedido{' '}
                        <strong>#{warn.original_order_number}</strong>. Verifica el extracto bancario antes de despachar.
                      </p>
                    </div>
                  </div>
                )
              })()}

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Notas de Despacho o Instrucciones:
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="Ej. Entregar en portería, avisar 10 min antes."
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewOrderModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-600/20 cursor-pointer"
                >
                  Crear y Enviar a Alistamiento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

