import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageInventory } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import type { Devolution, PurchaseDevolution, Sale, Purchase, Product, CompanyConfig } from '../types'
import {
  Plus, X, Undo2, Lock, Search, Download, Share2, Printer,
  MessageCircle, Mail, Ban, Truck, ShoppingBag, ArrowLeftRight,
} from 'lucide-react'

const SALE_REFUND_LABEL: Record<string, string> = {
  efectivo: 'Efectivo (Caja)',
  transferencia: 'Transferencia (Bancos)',
  tarjeta: 'Tarjeta (Bancos)',
  cartera: 'Descuento en Cartera',
}

const PUR_REFUND_LABEL: Record<string, string> = {
  credito: 'Descuento en Cuentas por pagar',
  efectivo: 'Efectivo (entra a Caja)',
  transferencia: 'Transferencia (Bancos)',
  tarjeta: 'Tarjeta (Bancos)',
}

const EMPTY_SALE_FORM = {
  sale_id: '',
  product_id: '',
  quantity: '1',
  reason: '',
  refund_method: 'efectivo' as 'efectivo' | 'transferencia' | 'tarjeta',
}

const EMPTY_PUR_FORM = {
  purchase_id: '',
  product_id: '',
  quantity: '1',
  reason: '',
  refund_method: 'efectivo' as 'credito' | 'efectivo' | 'transferencia' | 'tarjeta',
}

export default function Devolutions({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(user)
  const isManager = canManageInventory(user?.role)

  const [tab, setTab] = useState<'clientes' | 'proveedores'>('clientes')
  const [devolutions, setDevolutions] = useState<Devolution[]>([])
  const [purDevolutions, setPurDevolutions] = useState<PurchaseDevolution[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [purSqlMissing, setPurSqlMissing] = useState(false)

  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [showSaleForm, setShowSaleForm] = useState(false)
  const [saleQuery, setSaleQuery] = useState('')
  const [saleForm, setSaleForm] = useState(EMPTY_SALE_FORM)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  const [showPurForm, setShowPurForm] = useState(false)
  const [purQuery, setPurQuery] = useState('')
  const [purForm, setPurForm] = useState(EMPTY_PUR_FORM)

  const [docModal, setDocModal] = useState<DocData | null>(null)
  const [voidTarget, setVoidTarget] = useState<PurchaseDevolution | null>(null)
  const [voiding, setVoiding] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    const [dRes, sRes, pdRes, pRes, prRes, cfgRes] = await Promise.all([
      supabase.from('devolutions').select('*').order('created_at', { ascending: false }),
      supabase.from('sales').select('*').order('created_at', { ascending: false }),
      isManager
        ? supabase.from('purchase_devolutions').select('*').order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      isManager
        ? supabase.from('purchases').select('*').order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase.from('products').select('*'),
      supabase.from('company_config').select('*').limit(1).maybeSingle(),
    ])

    setDevolutions((dRes.data || []) as Devolution[])
    setSales((sRes.data || []) as Sale[])
    setPurchases((pRes.data || []) as Purchase[])
    setProducts((prRes.data || []) as Product[])
    if (cfgRes.data) setConfig(cfgRes.data as CompanyConfig)

    if (pdRes.error && /purchase_devolutions|does not exist|schema cache/i.test(pdRes.error.message || '')) {
      setPurSqlMissing(true)
      setPurDevolutions([])
    } else {
      setPurSqlMissing(false)
      setPurDevolutions((pdRes.data || []) as PurchaseDevolution[])
    }
  }

  const saleMap = useMemo(() => new Map(sales.map(s => [s.id, s])), [sales])
  const purchaseMap = useMemo(() => new Map(purchases.map(p => [p.id, p])), [purchases])
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  // --- Lógica Devoluciones de Ventas ---
  const openSales = useMemo(() => {
    const q = saleQuery.trim().toLowerCase()
    return sales
      .filter(s => s.status !== 'anulada')
      .filter(s => {
        if (!q) return true
        const code = 'vta-' + s.id.slice(0, 8).toLowerCase()
        return (
          code.includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.customer_name || 'cliente general').toLowerCase().includes(q)
        )
      })
  }, [sales, saleQuery])

  const selectedSale = saleMap.get(saleForm.sale_id)

  const returnableSaleItems = useMemo(() => {
    if (!selectedSale) return []
    const allItemsSub = selectedSale.items.reduce((acc, it) => acc + Number(it.subtotal || 0), 0)
    const scale = allItemsSub > 0 && Number(selectedSale.total) >= 0 ? Number(selectedSale.total) / allItemsSub : 1

    const map = new Map<string, { product_id: string; product_name: string; sold: number; amount: number }>()
    for (const it of selectedSale.items) {
      const cur = map.get(it.product_id) ?? { product_id: it.product_id, product_name: it.product_name, sold: 0, amount: 0 }
      cur.sold += Number(it.quantity)
      cur.amount += Number(it.subtotal)
      map.set(it.product_id, cur)
    }
    return Array.from(map.values())
      .map(x => {
        const returned = devolutions
          .filter(d => d.sale_id === selectedSale.id && d.product_id === x.product_id)
          .reduce((s, d) => s + Number(d.quantity), 0)
        const netUnitPrice = x.sold > 0 ? (x.amount / x.sold) * scale : 0
        return { ...x, remaining: x.sold - returned, unitPrice: netUnitPrice }
      })
      .filter(x => x.remaining > 0)
  }, [selectedSale, devolutions])

  const selectedSaleItem = returnableSaleItems.find(x => x.product_id === saleForm.product_id)
  const saleQty = parseFloat(saleForm.quantity) || 0
  const salePreview = selectedSaleItem ? Math.round(selectedSaleItem.unitPrice * saleQty * 100) / 100 : 0

  async function handleSubmitSaleReturn(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving || !selectedSale || !selectedSaleItem) return
    setFormErr('')
    setSaving(true)

    const payload: Record<string, unknown> = {
      p_sale_id: saleForm.sale_id,
      p_product_id: saleForm.product_id,
      p_quantity: saleQty,
      p_reason: saleForm.reason.trim(),
    }
    if (selectedSale.payment_method !== 'fiado') {
      payload.p_refund_method = saleForm.refund_method
    }

    let { error } = await supabase.rpc('registrar_devolucion', payload)
    // Retrocompatibilidad si el usuario aún no ejecutó el nuevo SQL de 5 argumentos
    if (error && /function public\.registrar_devolucion|schema cache/i.test(error.message || '') && 'p_refund_method' in payload) {
      const fallback = await supabase.rpc('registrar_devolucion', {
        p_sale_id: saleForm.sale_id,
        p_product_id: saleForm.product_id,
        p_quantity: saleQty,
        p_reason: saleForm.reason.trim(),
      })
      error = fallback.error
    }

    setSaving(false)
    if (error) {
      setFormErr(error.message)
      return
    }
    setShowSaleForm(false)
    setSaleForm(EMPTY_SALE_FORM)
    setSaleQuery('')
    setMsg({ ok: true, text: 'Devolución de cliente registrada correctamente.' })
    await load()
  }

  // --- Lógica Devoluciones a Proveedores ---
  const openPurchases = useMemo(() => {
    const q = purQuery.trim().toLowerCase()
    return purchases
      .filter(p => p.status === 'recibida')
      .filter(p => {
        if (!q) return true
        const code = 'cmp-' + p.id.slice(0, 8).toLowerCase()
        return (
          code.includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.supplier_name || 'proveedor general').toLowerCase().includes(q)
        )
      })
  }, [purchases, purQuery])

  const selectedPurchase = purchaseMap.get(purForm.purchase_id)

  const returnablePurchaseItems = useMemo(() => {
    if (!selectedPurchase) return []
    const map = new Map<string, { product_id: string; product_name: string; bought: number; amount: number }>()
    for (const it of selectedPurchase.items || []) {
      const cur = map.get(it.product_id) ?? { product_id: it.product_id, product_name: it.product_name, bought: 0, amount: 0 }
      const q = Number(it.quantity) || 0
      const sub = Number(it.subtotal) || q * (Number(it.cost) || 0)
      cur.bought += q
      cur.amount += sub
      map.set(it.product_id, cur)
    }
    return Array.from(map.values())
      .map(x => {
        const returned = purDevolutions
          .filter(d => d.status === 'activa' && d.purchase_id === selectedPurchase.id && d.product_id === x.product_id)
          .reduce((s, d) => s + Number(d.quantity), 0)
        const currentStock = Number(productMap.get(x.product_id)?.stock ?? 0)
        const remainingFromPurchase = x.bought - returned
        const maxReturnable = Math.min(remainingFromPurchase, Math.max(0, currentStock))
        return {
          ...x,
          remainingFromPurchase,
          currentStock,
          maxReturnable,
          unitCost: x.bought > 0 ? x.amount / x.bought : 0,
        }
      })
      .filter(x => x.remainingFromPurchase > 0)
  }, [selectedPurchase, purDevolutions, productMap])

  const selectedPurItem = returnablePurchaseItems.find(x => x.product_id === purForm.product_id)
  const purQty = parseFloat(purForm.quantity) || 0
  const purPreview = selectedPurItem ? Math.round(selectedPurItem.unitCost * purQty * 100) / 100 : 0

  async function handleSubmitPurReturn(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || !isManager || saving || !selectedPurchase || !selectedPurItem) return
    setFormErr('')
    setSaving(true)

    const { error } = await supabase.rpc('registrar_devolucion_compra', {
      p_purchase_id: purForm.purchase_id,
      p_product_id: purForm.product_id,
      p_quantity: purQty,
      p_reason: purForm.reason.trim(),
      p_refund_method: purForm.refund_method,
    })
    setSaving(false)

    if (error) {
      setFormErr(error.message)
      return
    }
    setShowPurForm(false)
    setPurForm(EMPTY_PUR_FORM)
    setPurQuery('')
    setMsg({ ok: true, text: 'Devolución a proveedor registrada correctamente.' })
    await load()
  }

  async function handleVoidPurDevolution() {
    if (!voidTarget || voiding || readOnly || !isManager) return
    setVoiding(true)
    const { error } = await supabase.rpc('anular_devolucion_compra', { p_dev_id: voidTarget.id })
    setVoiding(false)
    if (error) {
      setMsg({ ok: false, text: 'No se pudo anular: ' + error.message })
      setVoidTarget(null)
      return
    }
    setVoidTarget(null)
    setMsg({ ok: true, text: 'Devolución a proveedor anulada; stock y saldos restaurados.' })
    await load()
  }

  // --- Filtrado y exportación ---
  const filteredSaleDevs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return devolutions
    return devolutions.filter(d => {
      const s = saleMap.get(d.sale_id)
      const hay = [
        d.product_name,
        d.reason,
        s?.customer_name || 'cliente general',
        'vta-' + d.sale_id.slice(0, 8),
        'dev-' + d.id.slice(0, 8),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [devolutions, saleMap, search])

  const filteredPurDevs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return purDevolutions
    return purDevolutions.filter(d => {
      const hay = [
        d.product_name,
        d.reason,
        d.supplier_name || 'proveedor general',
        'cmp-' + d.purchase_id.slice(0, 8),
        'dvp-' + d.id.slice(0, 8),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [purDevolutions, search])

  function openSaleDevDoc(d: Devolution) {
    const s = saleMap.get(d.sale_id)
    const refMethod = d.refund_method || (s?.payment_method === 'fiado' ? 'cartera' : s?.payment_method || 'efectivo')
    const unit = Number(d.quantity) > 0 ? Number(d.amount) / Number(d.quantity) : Number(d.amount)
    setDocModal({
      title: 'NOTA DE DEVOLUCIÓN (VENTA)',
      number: 'DEV-' + d.id.slice(0, 8).toUpperCase(),
      date: new Date(d.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      partyRoleLabel: 'Cliente',
      partyName: s?.customer_name || 'Cliente general',
      partyLines: [
        `Venta origen: VTA-${d.sale_id.slice(0, 8).toUpperCase()}`,
        `Motivo: ${d.reason}`,
      ],
      paymentLabel: `Reembolso: ${SALE_REFUND_LABEL[refMethod] || refMethod}`,
      lines: [{ name: d.product_name, quantity: Number(d.quantity), price: unit, subtotal: Number(d.amount) }],
      total: Number(d.amount),
      footer: 'Comprobante de devolución de mercancía.',
    })
  }

  function openPurDevDoc(d: PurchaseDevolution) {
    setDocModal({
      title: 'DEVOLUCIÓN A PROVEEDOR',
      number: 'DVP-' + d.id.slice(0, 8).toUpperCase(),
      date: new Date(d.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      badge: d.status === 'anulada' ? 'ANULADA' : undefined,
      partyRoleLabel: 'Proveedor',
      partyName: d.supplier_name || 'Proveedor general',
      partyLines: [
        `Compra origen: CMP-${d.purchase_id.slice(0, 8).toUpperCase()}`,
        `Motivo: ${d.reason}`,
      ],
      paymentLabel: `Aplicación: ${PUR_REFUND_LABEL[d.refund_method] || d.refund_method}`,
      unitColLabel: 'Costo',
      lines: [{ name: d.product_name, quantity: Number(d.quantity), price: Number(d.unit_cost), subtotal: Number(d.amount) }],
      total: Number(d.amount),
      footer: 'Soporte de devolución de mercancía a proveedor.',
    })
  }

  function exportExcel() {
    const today = new Date().toLocaleDateString('sv-SE')
    if (tab === 'clientes') {
      downloadCsv(
        `devoluciones_clientes_${today}.csv`,
        ['Código', 'Fecha', 'Venta', 'Cliente', 'Producto', 'Cantidad', 'Monto devuelto', 'Reembolso', 'Motivo'],
        filteredSaleDevs.map(d => {
          const s = saleMap.get(d.sale_id)
          const ref = d.refund_method || (s?.payment_method === 'fiado' ? 'cartera' : s?.payment_method || 'efectivo')
          return [
            'DEV-' + d.id.slice(0, 8).toUpperCase(),
            new Date(d.created_at).toLocaleString(),
            'VTA-' + d.sale_id.slice(0, 8).toUpperCase(),
            s?.customer_name || 'Cliente general',
            d.product_name,
            Number(d.quantity),
            Number(d.amount),
            SALE_REFUND_LABEL[ref] || ref,
            d.reason,
          ]
        })
      )
    } else {
      downloadCsv(
        `devoluciones_proveedores_${today}.csv`,
        ['Código', 'Fecha', 'Compra', 'Proveedor', 'Producto', 'Cantidad', 'Costo unitario', 'Monto', 'Aplicación', 'Estado', 'Motivo'],
        filteredPurDevs.map(d => [
          'DVP-' + d.id.slice(0, 8).toUpperCase(),
          new Date(d.created_at).toLocaleString(),
          'CMP-' + d.purchase_id.slice(0, 8).toUpperCase(),
          d.supplier_name || 'Proveedor general',
          d.product_name,
          Number(d.quantity),
          Number(d.unit_cost),
          Number(d.amount),
          PUR_REFUND_LABEL[d.refund_method] || d.refund_method,
          d.status,
          d.reason,
        ])
      )
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator
  const totalSaleDevs = filteredSaleDevs.reduce((s, d) => s + Number(d.amount || 0), 0)
  const totalPurDevs = filteredPurDevs.filter(d => d.status === 'activa').reduce((s, d) => s + Number(d.amount || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Devoluciones</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Devoluciones de clientes sobre ventas y devoluciones de mercancía a proveedores.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('exchanges')}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <ArrowLeftRight className="w-4 h-4" /> Cambios y garantías
            </button>
          )}
          <button
            onClick={exportExcel}
            disabled={tab === 'clientes' ? filteredSaleDevs.length === 0 : filteredPurDevs.length === 0}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          {tab === 'clientes' ? (
            <button
              onClick={() => {
                if (readOnly) return
                setFormErr('')
                setSaleForm(EMPTY_SALE_FORM)
                setShowSaleForm(true)
              }}
              disabled={readOnly}
              className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" /> Devolución de venta
            </button>
          ) : (
            isManager && (
              <button
                onClick={() => {
                  if (readOnly || purSqlMissing) return
                  setFormErr('')
                  setPurForm(EMPTY_PUR_FORM)
                  setShowPurForm(true)
                }}
                disabled={readOnly || purSqlMissing}
                className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" /> Devolver a proveedor
              </button>
            )
          )}
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Activa tu suscripción para registrar devoluciones.
        </div>
      )}

      {msg && (
        <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="p-0.5 hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Pestañas Clientes / Proveedores */}
      {isManager && (
        <div className="flex gap-1 p-1 bg-white rounded-xl border border-slate-200 max-w-md">
          <button
            onClick={() => setTab('clientes')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              tab === 'clientes' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShoppingBag className="w-4 h-4" /> Clientes ({devolutions.length})
          </button>
          <button
            onClick={() => setTab('proveedores')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              tab === 'proveedores' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Truck className="w-4 h-4" /> Proveedores ({purDevolutions.filter(x => x.status === 'activa').length})
          </button>
        </div>
      )}

      {/* Buscador + resumen rápido */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'clientes' ? 'Buscar por producto, cliente, motivo o #VTA...' : 'Buscar por producto, proveedor, motivo o #CMP...'}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          />
        </div>
        <div className="text-xs text-slate-500">
          {tab === 'clientes' ? (
            <>Total devuelto a clientes: <strong className="text-red-600">{money(totalSaleDevs)}</strong></>
          ) : (
            <>Total devuelto a proveedores: <strong className="text-emerald-700">{money(totalPurDevs)}</strong></>
          )}
        </div>
      </div>

      {/* PESTAÑA 1: CLIENTES */}
      {tab === 'clientes' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Fecha</th>
                <th className="text-left px-4 py-3 font-medium">Venta / Cliente</th>
                <th className="text-left px-4 py-3 font-medium">Producto</th>
                <th className="text-right px-4 py-3 font-medium">Cant.</th>
                <th className="text-right px-4 py-3 font-medium">Monto</th>
                <th className="text-left px-4 py-3 font-medium">Reembolso</th>
                <th className="text-left px-4 py-3 font-medium">Motivo</th>
                <th className="text-left px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSaleDevs.map(d => {
                const s = saleMap.get(d.sale_id)
                const ref = d.refund_method || (s?.payment_method === 'fiado' ? 'cartera' : s?.payment_method || 'efectivo')
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{s?.customer_name || 'Cliente general'}</p>
                      <p className="text-xs text-slate-400 font-mono">VTA-{d.sale_id.slice(0, 8).toUpperCase()}</p>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{d.product_name}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{d.quantity}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-semibold whitespace-nowrap">{money(d.amount)}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 whitespace-nowrap">
                        {SALE_REFUND_LABEL[ref] || ref}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[14rem] truncate">{d.reason}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openSaleDevDoc(d)}
                        className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded whitespace-nowrap"
                      >
                        <Share2 className="w-3 h-3" /> Nota
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filteredSaleDevs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No hay devoluciones de clientes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* PESTAÑA 2: PROVEEDORES */}
      {tab === 'proveedores' && isManager && (
        <>
          {purSqlMissing ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
              <p className="font-semibold">Falta activar Devoluciones a proveedores en Supabase</p>
              <p className="text-xs text-amber-800">
                Ejecuta el script SQL <strong>20261101_gastos_y_devoluciones_completas.sql</strong> en el SQL Editor de Supabase y pulsa recargar.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Fecha</th>
                    <th className="text-left px-4 py-3 font-medium">Compra / Proveedor</th>
                    <th className="text-left px-4 py-3 font-medium">Producto</th>
                    <th className="text-right px-4 py-3 font-medium">Cant.</th>
                    <th className="text-right px-4 py-3 font-medium">Monto</th>
                    <th className="text-left px-4 py-3 font-medium">Aplicación</th>
                    <th className="text-left px-4 py-3 font-medium">Motivo</th>
                    <th className="text-left px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPurDevs.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{new Date(d.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <p className={`font-medium ${d.status === 'anulada' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                          {d.supplier_name || 'Proveedor general'}
                        </p>
                        <p className="text-xs text-slate-400 font-mono">CMP-{d.purchase_id.slice(0, 8).toUpperCase()}</p>
                      </td>
                      <td className={`px-4 py-3 font-medium ${d.status === 'anulada' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {d.product_name}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">{d.quantity}</td>
                      <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${d.status === 'anulada' ? 'text-slate-400 line-through' : 'text-emerald-700'}`}>
                        {money(d.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 whitespace-nowrap">
                          {PUR_REFUND_LABEL[d.refund_method] || d.refund_method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 max-w-[12rem] truncate">{d.reason}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openPurDevDoc(d)}
                            className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded whitespace-nowrap"
                          >
                            <Share2 className="w-3 h-3" /> Nota
                          </button>
                          {!readOnly && d.status === 'activa' && (
                            <button
                              onClick={() => setVoidTarget(d)}
                              className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1.5 rounded whitespace-nowrap"
                            >
                              <Ban className="w-3.5 h-3.5" /> Anular
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredPurDevs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                        No hay devoluciones a proveedores registradas
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* MODAL: Nueva devolución de cliente (Venta) */}
      {showSaleForm && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSaleForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">Nueva devolución de venta</h2>
              <button onClick={() => setShowSaleForm(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            {formErr && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{formErr}</p>}
            <form onSubmit={handleSubmitSaleReturn} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Buscar y elegir venta</label>
                <input
                  value={saleQuery}
                  onChange={e => setSaleQuery(e.target.value)}
                  placeholder="Filtrar por cliente o código VTA-..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs mb-1.5"
                />
                <select
                  required
                  value={saleForm.sale_id}
                  onChange={e => {
                    const s = saleMap.get(e.target.value)
                    const defMethod =
                      s?.payment_method === 'tarjeta' || s?.payment_method === 'transferencia'
                        ? s.payment_method
                        : 'efectivo'
                    setSaleForm({
                      ...saleForm,
                      sale_id: e.target.value,
                      product_id: '',
                      quantity: '1',
                      refund_method: defMethod,
                    })
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Seleccionar venta ({openSales.length})</option>
                  {openSales.slice(0, 120).map(s => (
                    <option key={s.id} value={s.id}>
                      VTA-{s.id.slice(0, 8).toUpperCase()} · {new Date(s.created_at).toLocaleDateString()} · {s.customer_name || 'Cliente general'} · {money(s.total)} ({s.payment_method})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Producto a devolver</label>
                <select
                  required
                  value={saleForm.product_id}
                  onChange={e => setSaleForm({ ...saleForm, product_id: e.target.value, quantity: '1' })}
                  disabled={!saleForm.sale_id}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:bg-slate-50 bg-white"
                >
                  <option value="">
                    {saleForm.sale_id && returnableSaleItems.length === 0 ? 'Ya no quedan unidades por devolver en esta venta' : 'Seleccionar producto'}
                  </option>
                  {returnableSaleItems.map(x => (
                    <option key={x.product_id} value={x.product_id}>
                      {x.product_name} (quedan {x.remaining} · {money(x.unitPrice)} c/u)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Cantidad</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    max={selectedSaleItem?.remaining}
                    step="any"
                    value={saleForm.quantity}
                    onChange={e => setSaleForm({ ...saleForm, quantity: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Monto proporcional</label>
                  <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-bold text-slate-800">
                    {money(salePreview)}
                  </div>
                </div>
              </div>

              {selectedSale && (
                selectedSale.payment_method === 'fiado' ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    Esta venta fue <strong>Fiada (a crédito)</strong>: el monto devuelto se descontará automáticamente del saldo que debe el cliente en Cartera y no tocará el efectivo de Caja.
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">¿Cómo entregaste el reembolso al cliente?</label>
                    <select
                      value={saleForm.refund_method}
                      onChange={e => setSaleForm({ ...saleForm, refund_method: e.target.value as 'efectivo' | 'transferencia' | 'tarjeta' })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="efectivo">Efectivo (sale dinero de Caja)</option>
                      <option value="transferencia">Transferencia bancaria (Bancos)</option>
                      <option value="tarjeta">Reverso a tarjeta (Bancos)</option>
                    </select>
                  </div>
                )
              )}

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Motivo de la devolución</label>
                <input
                  required
                  value={saleForm.reason}
                  onChange={e => setSaleForm({ ...saleForm, reason: e.target.value })}
                  placeholder="Ej: Producto defectuoso / cambio de presentación"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={saving || !selectedSaleItem || saleQty <= 0 || saleQty > (selectedSaleItem?.remaining ?? 0)}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                <Undo2 className="w-4 h-4" /> {saving ? 'Registrando...' : 'Confirmar devolución'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Nueva devolución a proveedor (Compra) */}
      {showPurForm && !readOnly && isManager && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowPurForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">Devolver mercancía a proveedor</h2>
              <button onClick={() => setShowPurForm(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            {formErr && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{formErr}</p>}
            <form onSubmit={handleSubmitPurReturn} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Buscar y elegir compra recibida</label>
                <input
                  value={purQuery}
                  onChange={e => setPurQuery(e.target.value)}
                  placeholder="Filtrar por proveedor o código CMP-..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs mb-1.5"
                />
                <select
                  required
                  value={purForm.purchase_id}
                  onChange={e => {
                    const p = purchaseMap.get(e.target.value)
                    const defRef = (p?.payment_method || 'efectivo') as 'credito' | 'efectivo' | 'transferencia' | 'tarjeta'
                    setPurForm({
                      ...purForm,
                      purchase_id: e.target.value,
                      product_id: '',
                      quantity: '1',
                      refund_method: defRef,
                    })
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Seleccionar compra ({openPurchases.length})</option>
                  {openPurchases.slice(0, 120).map(p => (
                    <option key={p.id} value={p.id}>
                      CMP-{p.id.slice(0, 8).toUpperCase()} · {new Date(p.created_at).toLocaleDateString()} · {p.supplier_name || 'Proveedor general'} · {money(p.total)} ({p.payment_method || 'efectivo'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Producto a devolver</label>
                <select
                  required
                  value={purForm.product_id}
                  onChange={e => setPurForm({ ...purForm, product_id: e.target.value, quantity: '1' })}
                  disabled={!purForm.purchase_id}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:bg-slate-50 bg-white"
                >
                  <option value="">
                    {purForm.purchase_id && returnablePurchaseItems.length === 0 ? 'No quedan artículos por devolver en esta compra' : 'Seleccionar producto'}
                  </option>
                  {returnablePurchaseItems.map(x => (
                    <option key={x.product_id} value={x.product_id}>
                      {x.product_name} (compradas rest.: {x.remainingFromPurchase} · en stock: {x.currentStock})
                    </option>
                  ))}
                </select>
                {selectedPurItem && selectedPurItem.maxReturnable <= 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    No tienes existencias en inventario de este producto para devolver físicamente al proveedor.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Cantidad a devolver</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    max={selectedPurItem?.maxReturnable}
                    step="any"
                    value={purForm.quantity}
                    onChange={e => setPurForm({ ...purForm, quantity: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Valor al costo</label>
                  <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-bold text-slate-800">
                    {money(purPreview)}
                  </div>
                </div>
              </div>

              {selectedPurchase && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">¿Cómo aplica el proveedor esta devolución?</label>
                  <select
                    value={purForm.refund_method}
                    onChange={e => setPurForm({ ...purForm, refund_method: e.target.value as 'credito' | 'efectivo' | 'transferencia' | 'tarjeta' })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {selectedPurchase.payment_method === 'credito' && (
                      <option value="credito">Descontar de deuda en Cuentas por pagar</option>
                    )}
                    <option value="efectivo">Reintegro en efectivo (entra a Caja)</option>
                    <option value="transferencia">Reintegro por transferencia (Bancos)</option>
                    <option value="tarjeta">Reintegro a tarjeta (Bancos)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Motivo</label>
                <input
                  required
                  value={purForm.reason}
                  onChange={e => setPurForm({ ...purForm, reason: e.target.value })}
                  placeholder="Ej: Mercancía averiada / vencimiento próximo"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={saving || !selectedPurItem || purQty <= 0 || purQty > (selectedPurItem?.maxReturnable ?? 0)}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                <Undo2 className="w-4 h-4" /> {saving ? 'Registrando...' : 'Confirmar devolución a proveedor'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Anular devolución a proveedor */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !voiding && setVoidTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-slate-800">¿Anular devolución a proveedor?</h2>
            <p className="text-sm text-slate-600">
              Las <strong>{voidTarget.quantity}</strong> unidad(es) de <strong>{voidTarget.product_name}</strong> volverán a tu stock y se revertirá el movimiento en {PUR_REFUND_LABEL[voidTarget.refund_method]}.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setVoidTarget(null)}
                disabled={voiding}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleVoidPurDevolution()}
                disabled={voiding}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {voiding ? 'Anulando...' : 'Sí, anular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Imprimir / Enviar Comprobante */}
      {docModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDocModal(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">{docModal.number}</h2>
              <button onClick={() => setDocModal(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-4">{docModal.partyName} · {docModal.date}</p>
            <div className="border border-slate-200 rounded-lg p-3 space-y-1.5 mb-3 text-sm">
              {docModal.lines.map((l, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-slate-700">{l.name} x{l.quantity}</span>
                  <span className="font-medium text-slate-800">{money(l.subtotal)}</span>
                </div>
              ))}
              {docModal.partyLines?.filter(Boolean).map((line, idx) => (
                <p key={idx} className="text-xs text-slate-500">{line}</p>
              ))}
              {docModal.paymentLabel && <p className="text-xs text-slate-500">{docModal.paymentLabel}</p>}
            </div>
            <div className="flex justify-between items-center pb-3 mb-4 border-b border-slate-100">
              <span className="font-bold text-slate-800">Total:</span>
              <span className="font-bold text-slate-800 text-lg">{money(docModal.total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => printHtml(buildDocHtml(docModal, config))}
                className="flex items-center justify-center gap-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700"
              >
                <Printer className="w-4 h-4" /> Imprimir / PDF
              </button>
              <button
                onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText(docModal, config))}`, '_blank', 'noopener')}
                className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
              >
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <button
                onClick={() => {
                  const subject = `${docModal.title} ${docModal.number}${config?.name ? ' - ' + config.name : ''}`
                  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildShareText(docModal, config))}`
                }}
                className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
              >
                <Mail className="w-4 h-4" /> Correo
              </button>
              {canShare && (
                <button
                  onClick={async () => {
                    try { await navigator.share({ title: `${docModal.title} ${docModal.number}`, text: buildShareText(docModal, config) }) } catch { /* cancelado */ }
                  }}
                  className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
                >
                  <Share2 className="w-4 h-4" /> Compartir
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
