import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, formatMoney } from '../lib/currency'
import { useWarehouse } from '../lib/warehouseContext'
import { downloadCsv } from '../lib/csv'
import { buildDocHtml, printHtml, type DocData } from '../lib/documents'
import type { Customer, Product, Sale, CompanyConfig } from '../types'
import {
  Search,
  Printer,
  Download,
  Filter,
  Package,
  Users,
  Store,
  Calendar,
  Truck,
  RotateCcw,
  CheckCircle2,
  Clock,
  Ban,
  Eye,
  FileSpreadsheet,
  X,
  FileText,
  ChevronDown,
  Building2,
  Receipt,
  ArrowRight,
} from 'lucide-react'

interface DispatchItemRow {
  saleId: string
  saleNumber: string
  createdAt: string
  customerId: string | null
  customerName: string
  customerDocument?: string
  customerPhone?: string
  customerAddress?: string
  branchId: string | null
  branchName: string
  warehouseId: string | null
  channel: 'ruta' | 'mostrador' | 'online' | string
  productId: string
  productName: string
  productSku?: string
  quantity: number
  price: number
  subtotal: number
  paymentMethod: string
  status: 'completada' | 'pendiente' | 'anulada'
  rawSale: Sale
}

const PAYMENT_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  fiado: 'Fiado (Crédito)',
}

export default function DispatchHistory({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const cur = useCurrency()
  const { branches, warehouses } = useWarehouse()

  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // Filtros
  const [selectedProductId, setSelectedProductId] = useState<string>('all')
  const [productSearch, setProductSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('all')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedLocation, setSelectedLocation] = useState<string>('all') // 'all' | 'branch:ID' | 'channel:mostrador' | 'channel:ruta'
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState<'all' | 'completada' | 'pendiente' | 'anulada'>('all')
  const [freeSearch, setFreeSearch] = useState('')

  // Modal de detalle de venta
  const [detailSale, setDetailSale] = useState<Sale | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [rs, rp, rc, rcfg] = await Promise.all([
        supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('products').select('*').order('name'),
        supabase.from('customers').select('*').order('name'),
        supabase.from('company_config').select('*').limit(1),
      ])

      if (rs.data) setSales(rs.data as Sale[])
      if (rp.data) setProducts(rp.data as Product[])
      if (rc.data) setCustomers(rc.data as Customer[])
      if (rcfg.data && rcfg.data.length > 0) setConfig(rcfg.data[0] as CompanyConfig)
    } catch (err) {
      console.error('Error cargando historial de despachos:', err)
    } finally {
      setLoading(false)
    }
  }

  // Mapas para enriquecer
  const customersMap = useMemo(() => {
    const map = new Map<string, Customer>()
    customers.forEach((c) => map.set(c.id, c))
    return map
  }, [customers])

  const productsMap = useMemo(() => {
    const map = new Map<string, Product>()
    products.forEach((p) => map.set(p.id, p))
    return map
  }, [products])

  const branchesMap = useMemo(() => {
    const map = new Map<string, string>()
    branches.forEach((b) => map.set(b.id, b.name))
    return map
  }, [branches])

  // Desglosar ventas en filas individuales por producto despachado
  const dispatchRows = useMemo<DispatchItemRow[]>(() => {
    const rows: DispatchItemRow[] = []

    for (const sale of sales) {
      const cust = sale.customer_id ? customersMap.get(sale.customer_id) : undefined
      const bName = sale.branch_id
        ? branchesMap.get(sale.branch_id) || 'Sucursal'
        : sale.channel === 'ruta'
          ? 'Ruta de Despacho'
          : 'Tienda Principal'

      const saleNumber = 'VTA-' + (sale.id?.slice(0, 8).toUpperCase() || '0000')

      if (Array.isArray(sale.items) && sale.items.length > 0) {
        for (const it of sale.items) {
          const prod = it.product_id ? productsMap.get(it.product_id) : undefined
          rows.push({
            saleId: sale.id,
            saleNumber,
            createdAt: sale.created_at,
            customerId: sale.customer_id,
            customerName: sale.customer_name || cust?.name || 'Cliente general',
            customerDocument: cust?.document || undefined,
            customerPhone: cust?.phone || undefined,
            customerAddress: cust?.address || undefined,
            branchId: sale.branch_id || null,
            branchName: bName,
            warehouseId: sale.warehouse_id || null,
            channel: sale.channel || 'mostrador',
            productId: it.product_id,
            productName: it.product_name || prod?.name || 'Producto sin nombre',
            productSku: prod?.sku || undefined,
            quantity: Number(it.quantity) || 0,
            price: Number(it.price) || 0,
            subtotal: Number(it.subtotal) || (Number(it.quantity) * Number(it.price)) || 0,
            paymentMethod: sale.payment_method || 'efectivo',
            status: sale.status || 'completada',
            rawSale: sale,
          })
        }
      }
    }

    return rows
  }, [sales, customersMap, productsMap, branchesMap])

  // Filtrado de las filas
  const filteredRows = useMemo(() => {
    return dispatchRows.filter((row) => {
      // 1. Filtro de producto
      if (selectedProductId !== 'all' && row.productId !== selectedProductId) {
        return false
      }
      if (productSearch.trim()) {
        const term = productSearch.toLowerCase().trim()
        const matchesName = row.productName.toLowerCase().includes(term)
        const matchesSku = row.productSku?.toLowerCase().includes(term)
        if (!matchesName && !matchesSku) return false
      }

      // 2. Filtro de cliente
      if (selectedCustomerId !== 'all' && row.customerId !== selectedCustomerId) {
        return false
      }
      if (customerSearch.trim()) {
        const term = customerSearch.toLowerCase().trim()
        const matchesCust = row.customerName.toLowerCase().includes(term)
        const matchesDoc = row.customerDocument?.toLowerCase().includes(term)
        if (!matchesCust && !matchesDoc) return false
      }

      // 3. Filtro de tienda / sede / canal
      if (selectedLocation !== 'all') {
        if (selectedLocation.startsWith('branch:')) {
          const bId = selectedLocation.replace('branch:', '')
          if (row.branchId !== bId) return false
        } else if (selectedLocation === 'channel:ruta') {
          if (row.channel !== 'ruta') return false
        } else if (selectedLocation === 'channel:mostrador') {
          if (row.channel !== 'mostrador' && row.channel !== null) return false
        }
      }

      // 4. Filtro de estado
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false
      }

      // 5. Filtro de fechas
      if (dateFrom) {
        const fromIso = `${dateFrom}T00:00:00`
        if (new Date(row.createdAt) < new Date(fromIso)) return false
      }
      if (dateTo) {
        const toIso = `${dateTo}T23:59:59`
        if (new Date(row.createdAt) > new Date(toIso)) return false
      }

      // 6. Buscador libre
      if (freeSearch.trim()) {
        const term = freeSearch.toLowerCase().trim()
        const matchesDoc = row.saleNumber.toLowerCase().includes(term)
        const matchesProd = row.productName.toLowerCase().includes(term)
        const matchesCust = row.customerName.toLowerCase().includes(term)
        const matchesBranch = row.branchName.toLowerCase().includes(term)
        if (!matchesDoc && !matchesProd && !matchesCust && !matchesBranch) return false
      }

      return true
    })
  }, [
    dispatchRows,
    selectedProductId,
    productSearch,
    selectedCustomerId,
    customerSearch,
    selectedLocation,
    statusFilter,
    dateFrom,
    dateTo,
    freeSearch,
  ])

  // Métricas acumuladas del resultado filtrado
  const metrics = useMemo(() => {
    let totalQty = 0
    let totalAmount = 0
    const uniqueCustomers = new Set<string>()
    const uniqueSales = new Set<string>()

    for (const r of filteredRows) {
      if (r.status !== 'anulada') {
        totalQty += r.quantity
        totalAmount += r.subtotal
      }
      if (r.customerName) uniqueCustomers.add(r.customerName)
      uniqueSales.add(r.saleId)
    }

    return {
      totalQty,
      totalAmount,
      customerCount: uniqueCustomers.size,
      salesCount: uniqueSales.size,
      itemsCount: filteredRows.length,
    }
  }, [filteredRows])

  // Restablecer filtros
  function handleResetFilters() {
    setSelectedProductId('all')
    setProductSearch('')
    setSelectedCustomerId('all')
    setCustomerSearch('')
    setSelectedLocation('all')
    setStatusFilter('all')
    setFreeSearch('')
    const d = new Date()
    d.setDate(d.getDate() - 30)
    setDateFrom(d.toISOString().split('T')[0])
    setDateTo(new Date().toISOString().split('T')[0])
  }

  // Preajustes rápidos de fecha
  function setDatePreset(type: 'today' | '7days' | 'month' | '30days' | 'all') {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    setDateTo(todayStr)

    if (type === 'today') {
      setDateFrom(todayStr)
    } else if (type === '7days') {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      setDateFrom(d.toISOString().split('T')[0])
    } else if (type === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      setDateFrom(firstDay.toISOString().split('T')[0])
    } else if (type === '30days') {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      setDateFrom(d.toISOString().split('T')[0])
    } else if (type === 'all') {
      setDateFrom('')
      setDateTo('')
    }
  }

  // Exportar a CSV
  function handleExportCsv() {
    const headers = [
      'Fecha',
      'Hora',
      'Nro Comprobante',
      'Cliente',
      'Documento',
      'Telefono',
      'Tienda / Sede',
      'Canal',
      'Producto',
      'Cantidad',
      'Precio Unitario',
      'Subtotal',
      'Metodo de Pago',
      'Estado',
    ]

    const rows = filteredRows.map((r) => {
      const dateObj = new Date(r.createdAt)
      return [
        dateObj.toLocaleDateString(),
        dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        r.saleNumber,
        r.customerName,
        r.customerDocument || '',
        r.customerPhone || '',
        r.branchName,
        r.channel === 'ruta' ? 'Ruta de Despacho' : 'Mostrador / Tienda',
        r.productName,
        r.quantity.toString(),
        r.price.toFixed(2),
        r.subtotal.toFixed(2),
        PAYMENT_LABEL[r.paymentMethod] || r.paymentMethod,
        r.status.toUpperCase(),
      ]
    })

    const prodName = selectedProductId !== 'all' ? productsMap.get(selectedProductId)?.name || 'producto' : 'todos'
    const fileName = `reporte_despachos_${prodName.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`
    downloadCsv(fileName, headers, rows)
  }

  // Generar reporte formal imprimible
  function handlePrintReport() {
    const activeProdLabel =
      selectedProductId !== 'all'
        ? productsMap.get(selectedProductId)?.name || 'Producto seleccionado'
        : productSearch
          ? `Búsqueda: "${productSearch}"`
          : 'Todos los productos'

    const activeCustLabel =
      selectedCustomerId !== 'all'
        ? customersMap.get(selectedCustomerId)?.name || 'Cliente seleccionado'
        : customerSearch
          ? `Búsqueda: "${customerSearch}"`
          : 'Todos los clientes'

    const activeLocationLabel =
      selectedLocation !== 'all'
        ? selectedLocation.startsWith('branch:')
          ? branchesMap.get(selectedLocation.replace('branch:', '')) || 'Sucursal'
          : selectedLocation === 'channel:ruta'
            ? 'Ruta de Despacho'
            : 'Mostrador / Tienda'
        : 'Todas las tiendas y sedes'

    const periodLabel =
      dateFrom && dateTo
        ? `Del ${new Date(dateFrom).toLocaleDateString()} al ${new Date(dateTo).toLocaleDateString()}`
        : 'Histórico completo'

    const companyName = config?.name || 'INVENTARIOPRO'
    const companyNit = config?.rif ? `RIF / NIT: ${config.rif}` : ''
    const companyPhone = config?.phone ? `Tel: ${config.phone}` : ''
    const companyAddress = config?.address || ''

    const rowsHtml = filteredRows
      .map((r, i) => {
        const d = new Date(r.createdAt)
        const dateStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        const isAnulada = r.status === 'anulada'
        return `
        <tr style="border-bottom: 1px solid #e2e8f0; background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'}; ${isAnulada ? 'color: #94a3b8; text-decoration: line-through;' : ''}">
          <td style="padding: 6px 8px; font-size: 11px;">${dateStr}</td>
          <td style="padding: 6px 8px; font-size: 11px; font-weight: 600;">${r.saleNumber}</td>
          <td style="padding: 6px 8px; font-size: 11px;">
            <strong>${r.customerName}</strong>
            ${r.customerDocument ? `<br/><span style="color: #64748b; font-size: 10px;">Doc: ${r.customerDocument}</span>` : ''}
          </td>
          <td style="padding: 6px 8px; font-size: 11px;">${r.branchName}</td>
          <td style="padding: 6px 8px; font-size: 11px; font-weight: 600;">${r.productName}</td>
          <td style="padding: 6px 8px; font-size: 11px; text-align: center; font-weight: 700;">${r.quantity}</td>
          <td style="padding: 6px 8px; font-size: 11px; text-align: right;">${formatMoney(r.price, cur)}</td>
          <td style="padding: 6px 8px; font-size: 11px; text-align: right; font-weight: 700;">${formatMoney(r.subtotal, cur)}</td>
          <td style="padding: 6px 8px; font-size: 10px; text-transform: uppercase;">${r.status}</td>
        </tr>
      `
      })
      .join('')

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Reporte de Despachos y Trazabilidad - ${companyName}</title>
        <style>
          @page { size: portrait; margin: 12mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; margin: 0; padding: 12px; }
          .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
          .title { font-size: 18px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin: 0; }
          .subtitle { font-size: 12px; color: #64748b; margin-top: 3px; }
          .criteria-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; margin-bottom: 16px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 11px; }
          .criteria-item strong { display: block; color: #475569; font-size: 10px; text-transform: uppercase; margin-bottom: 2px; }
          .kpi-container { display: flex; gap: 12px; margin-bottom: 16px; }
          .kpi-card { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; background: #fff; }
          .kpi-label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; }
          .kpi-val { font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th { background: #0f172a; color: #ffffff; text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
          .signatures { margin-top: 40px; display: flex; justify-content: space-between; page-break-inside: avoid; }
          .sig-box { width: 30%; border-top: 1px solid #0f172a; text-align: center; padding-top: 6px; font-size: 11px; color: #334155; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 class="title">Reporte Oficial de Despachos y Trazabilidad</h1>
            <div class="subtitle">Auditoría cruzada por Producto, Cliente y Tienda/Sucursal</div>
          </div>
          <div style="text-align: right; font-size: 11px; color: #475569;">
            <strong style="font-size: 13px; color: #0f172a;">${companyName}</strong><br/>
            ${companyNit ? `${companyNit}<br/>` : ''}
            ${companyPhone ? `${companyPhone}<br/>` : ''}
            ${companyAddress ? `${companyAddress}<br/>` : ''}
            <span>Emisión: ${new Date().toLocaleString()}</span>
          </div>
        </div>

        <div class="criteria-box">
          <div class="criteria-item">
            <strong>Producto:</strong>
            ${activeProdLabel}
          </div>
          <div class="criteria-item">
            <strong>Cliente:</strong>
            ${activeCustLabel}
          </div>
          <div class="criteria-item">
            <strong>Tienda / Sede:</strong>
            ${activeLocationLabel}
          </div>
          <div class="criteria-item">
            <strong>Período evaluado:</strong>
            ${periodLabel}
          </div>
        </div>

        <div class="kpi-container">
          <div class="kpi-card">
            <div class="kpi-label">Unidades Despachadas</div>
            <div class="kpi-val">${metrics.totalQty.toLocaleString()} uds</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Importe Facturado</div>
            <div class="kpi-val">${formatMoney(metrics.totalAmount, cur)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Clientes Atendidos</div>
            <div class="kpi-val">${metrics.customerCount}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Transacciones / Despachos</div>
            <div class="kpi-val">${metrics.salesCount}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 14%;">Fecha / Hora</th>
              <th style="width: 11%;">Comprobante</th>
              <th style="width: 20%;">Cliente</th>
              <th style="width: 15%;">Tienda / Sede</th>
              <th style="width: 18%;">Producto</th>
              <th style="width: 6%; text-align: center;">Cant.</th>
              <th style="width: 8%; text-align: right;">P. Unit</th>
              <th style="width: 8%; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #94a3b8;">No se encontraron despachos con los filtros especificados.</td></tr>'}
          </tbody>
        </table>

        <div class="signatures">
          <div class="sig-box">
            <strong>Responsable de Despacho</strong><br/>
            Firma y Cédula
          </div>
          <div class="sig-box">
            <strong>Auditoría / Control Stock</strong><br/>
            Verificación de Salida
          </div>
          <div class="sig-box">
            <strong>Recibido Conforme</strong><br/>
            Cliente / Destinatario
          </div>
        </div>
      </body>
      </html>
    `

    printHtml(htmlContent)
  }

  // Imprimir comprobante individual de venta
  function handlePrintSaleDoc(sale: Sale) {
    const cust = sale.customer_id ? customersMap.get(sale.customer_id) : undefined
    const doc: DocData = {
      title: 'COMPROBANTE DE DESPACHO Y VENTA',
      number: 'VTA-' + sale.id.slice(0, 8).toUpperCase(),
      date: new Date(sale.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      badge: sale.status === 'anulada' ? 'ANULADA' : undefined,
      partyName: sale.customer_name || cust?.name || 'Cliente general',
      partyLines: [
        cust?.document && `Documento: ${cust.document}`,
        cust?.phone && `Tel: ${cust.phone}`,
        cust?.email,
        cust?.address,
      ],
      paymentLabel: `Pago: ${PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method}`,
      lines: (sale.items || []).map((it) => ({
        name: it.product_name,
        quantity: it.quantity,
        price: it.price,
        subtotal: it.subtotal || it.quantity * it.price,
      })),
      total: sale.total,
    }
    const html = buildDocHtml(doc, config)
    printHtml(html)
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Encabezado y Acciones Principales */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
              Historial de Despachos y Trazabilidad
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Búsqueda cruzada por <strong>Producto</strong>, <strong>Cliente</strong> y <strong>Tienda/Sucursal</strong> para auditar a quién y cuándo se le despachó cada artículo.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handlePrintReport}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir Reporte
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold shadow-xs disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium transition-colors cursor-pointer"
            title="Restablecer todos los filtros"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            Limpiar
          </button>
        </div>
      </div>

      {/* Tarjetas KPI de Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span className="font-medium">Unidades Despachadas</span>
            <Package className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.totalQty.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-500">uds</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            En {metrics.itemsCount} partida(s) entregada(s)
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span className="font-medium">Importe Total Despachado</span>
            <Receipt className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
            {formatMoney(metrics.totalAmount, cur)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Excluyendo ventas anuladas
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span className="font-medium">Clientes Atendidos</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.customerCount}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Destinatarios con entregas
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span className="font-medium">Comprobantes / Despachos</span>
            <Store className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.salesCount}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Facturas y remisiones registradas
          </p>
        </div>
      </div>

      {/* Panel de Filtros Cruzados */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-indigo-600" />
            Filtros Cruzados de Trazabilidad
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 mr-1 hidden sm:inline">Período rápido:</span>
            <button
              type="button"
              onClick={() => setDatePreset('today')}
              className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('7days')}
              className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              7 días
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('month')}
              className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              Este mes
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('30days')}
              className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              30 días
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('all')}
              className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              Todo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Selector de Producto */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Producto específico
            </label>
            <div className="space-y-1.5">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">-- Todos los productos --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ''} - Stock: {p.stock}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Filtrar por texto de producto..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* 2. Selector de Cliente */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Cliente destinatario
            </label>
            <div className="space-y-1.5">
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">-- Todos los clientes --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.document ? `[${c.document}]` : ''}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Filtrar por nombre o cédula..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* 3. Selector de Tienda / Sede / Canal */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Tienda / Sede de Origen
            </label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">-- Todas las tiendas y sedes --</option>
              <optgroup label="Sedes y Sucursales">
                {branches.map((b) => (
                  <option key={b.id} value={`branch:${b.id}`}>
                    {b.name} {b.is_main ? '(Principal)' : ''}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Canales Operativos">
                <option value="channel:mostrador">Mostrador / Local (POS)</option>
                <option value="channel:ruta">Ruta de Reparto (Camión / Domicilio)</option>
              </optgroup>
            </select>

            <div className="mt-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Estado del despacho
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">Todos los estados</option>
                <option value="completada">Solo Completadas</option>
                <option value="pendiente">Pendientes</option>
                <option value="anulada">Anuladas</option>
              </select>
            </div>
          </div>

          {/* 4. Rango de Fechas y Búsqueda Libre */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Rango de Fechas
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-slate-400 block">Desde</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Hasta</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="mt-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={freeSearch}
                  onChange={(e) => setFreeSearch(e.target.value)}
                  placeholder="Buscar N° VTA, nota, etc..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla Principal de Despachos */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Registros encontrados:
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
              {filteredRows.length} partidas
            </span>
          </div>
          <span className="text-xs text-slate-400">
            {metrics.salesCount} comprobantes distintos
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Cargando historial de despachos...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">
              No se encontraron despachos con los filtros seleccionados
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Intenta ampliar el rango de fechas, seleccionar "Todos los productos" o borrar el texto de búsqueda.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 px-3.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors"
            >
              Restablecer filtros
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-3.5 py-3">Fecha y Hora</th>
                  <th className="px-3.5 py-3">Comprobante</th>
                  <th className="px-3.5 py-3">Cliente Destinatario</th>
                  <th className="px-3.5 py-3">Tienda / Sede</th>
                  <th className="px-3.5 py-3">Producto Despachado</th>
                  <th className="px-3.5 py-3 text-center">Cantidad</th>
                  <th className="px-3.5 py-3 text-right">P. Unitario</th>
                  <th className="px-3.5 py-3 text-right">Subtotal</th>
                  <th className="px-3.5 py-3 text-center">Estado</th>
                  <th className="px-3.5 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row, idx) => {
                  const d = new Date(row.createdAt)
                  const isAnulada = row.status === 'anulada'

                  return (
                    <tr
                      key={`${row.saleId}-${row.productId}-${idx}`}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isAnulada ? 'bg-red-50/30 opacity-75' : ''
                      }`}
                    >
                      {/* Fecha y Hora */}
                      <td className="px-3.5 py-3 whitespace-nowrap text-slate-600">
                        <div className="font-medium text-slate-800">
                          {d.toLocaleDateString()}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Comprobante */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDetailSale(row.rawSale)}
                          className="font-mono font-semibold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                        >
                          {row.saleNumber}
                        </button>
                        <div className="text-[10px] text-slate-400 capitalize">
                          {PAYMENT_LABEL[row.paymentMethod] || row.paymentMethod}
                        </div>
                      </td>

                      {/* Cliente */}
                      <td className="px-3.5 py-3">
                        <div className="font-semibold text-slate-900 max-w-[180px] truncate">
                          {row.customerName}
                        </div>
                        {row.customerDocument && (
                          <div className="text-[10px] text-slate-500">
                            Doc: {row.customerDocument}
                          </div>
                        )}
                        {row.customerPhone && (
                          <div className="text-[10px] text-slate-400">
                            Tel: {row.customerPhone}
                          </div>
                        )}
                      </td>

                      {/* Tienda / Sede */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
                          {row.channel === 'ruta' ? (
                            <Truck className="w-3 h-3 text-amber-600 shrink-0" />
                          ) : (
                            <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
                          )}
                          {row.branchName}
                        </span>
                      </td>

                      {/* Producto */}
                      <td className="px-3.5 py-3">
                        <div className="font-semibold text-slate-800 max-w-[200px] truncate">
                          {row.productName}
                        </div>
                        {row.productSku && (
                          <div className="text-[10px] font-mono text-slate-400">
                            SKU: {row.productSku}
                          </div>
                        )}
                      </td>

                      {/* Cantidad */}
                      <td className="px-3.5 py-3 text-center whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 tabular-nums">
                          {row.quantity} uds
                        </span>
                      </td>

                      {/* Precio Unitario */}
                      <td className="px-3.5 py-3 text-right whitespace-nowrap text-slate-600 tabular-nums">
                        {formatMoney(row.price, cur)}
                      </td>

                      {/* Subtotal */}
                      <td className="px-3.5 py-3 text-right whitespace-nowrap font-bold text-slate-900 tabular-nums">
                        {formatMoney(row.subtotal, cur)}
                      </td>

                      {/* Estado */}
                      <td className="px-3.5 py-3 text-center whitespace-nowrap">
                        {row.status === 'completada' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Completada
                          </span>
                        ) : row.status === 'anulada' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                            <Ban className="w-2.5 h-2.5" />
                            Anulada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-2.5 h-2.5" />
                            Pendiente
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="px-3.5 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailSale(row.rawSale)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="Ver factura completa"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrintSaleDoc(row.rawSale)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                            title="Imprimir comprobante individual"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Detalle Completo de la Venta */}
      {detailSale && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-base">
                  Comprobante VTA-{detailSale.id.slice(0, 8).toUpperCase()}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailSale(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Datos del Cliente y Despacho */}
            <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Cliente</span>
                <span className="font-semibold text-slate-800">
                  {detailSale.customer_name || 'Cliente general'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Fecha y Hora</span>
                <span className="text-slate-700">
                  {new Date(detailSale.created_at).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Método de Pago</span>
                <span className="text-slate-700 capitalize">
                  {PAYMENT_LABEL[detailSale.payment_method] || detailSale.payment_method}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Estado</span>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    detailSale.status === 'completada'
                      ? 'bg-emerald-100 text-emerald-800'
                      : detailSale.status === 'anulada'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {detailSale.status.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Listado de Productos de este Despacho */}
            <div>
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Mercancía Despachada
              </h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-center">Cant.</th>
                      <th className="px-3 py-2 text-right">P. Unit</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(detailSale.items || []).map((it, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {it.product_name}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-indigo-700">
                          {it.quantity}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {formatMoney(it.price, cur)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {formatMoney(it.subtotal || it.quantity * it.price, cur)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200 font-bold">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-slate-700">
                        Total Facturado:
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-700 text-sm">
                        {formatMoney(detailSale.total, cur)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Acciones del Modal */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handlePrintSaleDoc(detailSale)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                <Printer className="w-4 h-4" />
                Imprimir Comprobante
              </button>
              <button
                type="button"
                onClick={() => setDetailSale(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
