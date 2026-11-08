import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, formatMoney } from '../lib/currency'
import { useWarehouse } from '../lib/warehouseContext'
import { downloadCsv } from '../lib/csv'
import { buildDocHtml, printHtml, type DocData } from '../lib/documents'
import type { Customer, Product, Sale, CompanyConfig, Purchase } from '../types'
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
  ShieldAlert,
  AlertTriangle,
  History,
  ArrowUpRight,
  ArrowDownRight,
  UserCheck,
  RefreshCw,
  FolderTree,
  FileSearch,
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

export interface ForensicAuditEvent {
  id: string
  date: string
  type:
    | 'ingreso_compra'
    | 'traslado_salida'
    | 'traslado_entrada'
    | 'devolucion_cliente'
    | 'ajuste_toma_fisica'
    | 'merma_averia'
    | 'despacho_venta'
    | 'correccion_manual'
  typeLabel: string
  referenceCode: string
  userResponsible: string
  userRole?: string
  sourceLocation: string
  targetLocation?: string
  quantityDelta: number // Positivo (ingreso) o negativo (salida/merma)
  stockResulting?: number
  reasonNotes: string
  isConflictOrDiscrepancy: boolean
  discrepancyType?:
    | 'faltante_sospechoso'
    | 'sobrante_descuadre'
    | 'averia_defectuoso'
    | 'correccion_inconsistencia'
    | 'devolucion_reclamo'
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

  // Pestaña activa: 'despachos' | 'forense'
  const [activeTab, setActiveTab] = useState<'despachos' | 'forense'>('despachos')

  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [transfers, setTransfers] = useState<any[]>([])
  const [transferItems, setTransferItems] = useState<any[]>([])
  const [kardexEntries, setKardexEntries] = useState<any[]>([])
  const [devolutions, setDevolutions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros Pestaña Despachos
  const [selectedProductId, setSelectedProductId] = useState<string>('all')
  const [productSearch, setProductSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('all')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedLocation, setSelectedLocation] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState<'all' | 'completada' | 'pendiente' | 'anulada'>('all')
  const [freeSearch, setFreeSearch] = useState('')

  // Filtros Pestaña Auditoría Forense
  const [forensicProductId, setForensicProductId] = useState<string>('')
  const [forensicSearch, setForensicSearch] = useState('')
  const [forensicOnlyConflicts, setForensicOnlyConflicts] = useState(false)

  // Modal de detalle de venta
  const [detailSale, setDetailSale] = useState<Sale | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [rs, rp, rc, rcfg, rpur, rtrf, rtrfi, rkdx, rdev] = await Promise.all([
        supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('products').select('*').order('name'),
        supabase.from('customers').select('*').order('name'),
        supabase.from('company_config').select('*').limit(1),
        supabase.from('purchases').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('inventory_transfers').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('inventory_transfer_items').select('*').limit(1000),
        supabase.from('kardex').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('devolutions').select('*').order('created_at', { ascending: false }).limit(200),
      ])

      if (rs.data) setSales(rs.data as Sale[])
      if (rp.data) {
        const prods = rp.data as Product[]
        setProducts(prods)
        if (prods.length > 0 && !forensicProductId) {
          setForensicProductId(prods[0].id)
        }
      }
      if (rc.data) setCustomers(rc.data as Customer[])
      if (rcfg.data && rcfg.data.length > 0) setConfig(rcfg.data[0] as CompanyConfig)
      if (rpur.data) setPurchases(rpur.data as Purchase[])
      if (rtrf.data) setTransfers(rtrf.data)
      if (rtrfi.data) setTransferItems(rtrfi.data)
      if (rkdx.data) setKardexEntries(rkdx.data)
      if (rdev.data) setDevolutions(rdev.data)
    } catch (err) {
      console.error('Error cargando historial y auditoría forense:', err)
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

  const warehousesMap = useMemo(() => {
    const map = new Map<string, string>()
    warehouses.forEach((w) => map.set(w.id, w.name))
    return map
  }, [warehouses])

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

  // Filtrado de las filas de despachos
  const filteredRows = useMemo(() => {
    return dispatchRows.filter((row) => {
      if (selectedProductId !== 'all' && row.productId !== selectedProductId) return false
      if (productSearch.trim()) {
        const term = productSearch.toLowerCase().trim()
        const matchesName = row.productName.toLowerCase().includes(term)
        const matchesSku = row.productSku?.toLowerCase().includes(term)
        if (!matchesName && !matchesSku) return false
      }
      if (selectedCustomerId !== 'all' && row.customerId !== selectedCustomerId) return false
      if (customerSearch.trim()) {
        const term = customerSearch.toLowerCase().trim()
        const matchesCust = row.customerName.toLowerCase().includes(term)
        const matchesDoc = row.customerDocument?.toLowerCase().includes(term)
        if (!matchesCust && !matchesDoc) return false
      }
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
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (dateFrom) {
        const fromIso = `${dateFrom}T00:00:00`
        if (new Date(row.createdAt) < new Date(fromIso)) return false
      }
      if (dateTo) {
        const toIso = `${dateTo}T23:59:59`
        if (new Date(row.createdAt) > new Date(toIso)) return false
      }
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

  // ==========================================================================
  // MOTOR DE AUDITORÍA FORENSE Y CADENA DE CUSTODIA (CONFLICTOS, MERMAS, ROBOS)
  // ==========================================================================
  const forensicEvents = useMemo<ForensicAuditEvent[]>(() => {
    if (!forensicProductId) return []

    const selectedProd = productsMap.get(forensicProductId)
    const events: ForensicAuditEvent[] = []

    // 1. Ingresos por Compras
    for (const pur of purchases) {
      if (Array.isArray(pur.items)) {
        for (const item of pur.items) {
          if (item.product_id === forensicProductId) {
            events.push({
              id: `pur-${pur.id}-${item.product_id}`,
              date: pur.created_at,
              type: 'ingreso_compra',
              typeLabel: 'Entrada por Compra',
              referenceCode: 'COMP-' + pur.id.slice(0, 6).toUpperCase(),
              userResponsible: (pur as any).created_by_name || 'Comprador / Recepción',
              userRole: 'Compras y Almacén',
              sourceLocation: `Proveedor: ${pur.supplier_name || 'Proveedor General'}`,
              targetLocation: pur.branch_id ? branchesMap.get(pur.branch_id) || 'Almacén' : 'Bodega Central',
              quantityDelta: Number(item.quantity) || 0,
              reasonNotes: `Ingreso oficial al inventario con costo unitario ${formatMoney(item.cost, cur)}`,
              isConflictOrDiscrepancy: false,
            })
          }
        }
      }
    }

    // 2. Movimientos y Traslados entre Sedes / Bodegas
    const transfersMap = new Map<string, any>()
    transfers.forEach((t) => transfersMap.set(t.id, t))

    for (const tItem of transferItems) {
      if (tItem.product_id === forensicProductId) {
        const parentTrf = transfersMap.get(tItem.transfer_id)
        const srcWh = parentTrf?.source_warehouse_id ? warehousesMap.get(parentTrf.source_warehouse_id) || 'Bodega A' : 'Bodega A'
        const dstWh = parentTrf?.destination_warehouse_id ? warehousesMap.get(parentTrf.destination_warehouse_id) || 'Bodega B' : 'Bodega B'

        const damaged = Number(tItem.damaged_quantity) || 0
        const missing = Number(tItem.missing_quantity) || 0

        events.push({
          id: `trf-${tItem.id}`,
          date: parentTrf?.created_at || new Date().toISOString(),
          type: 'traslado_salida',
          typeLabel: 'Traslado Multisede',
          referenceCode: 'TRF-' + (parentTrf?.id?.slice(0, 6).toUpperCase() || '000'),
          userResponsible: parentTrf?.created_by || 'Operador de Logística',
          userRole: 'Logística / Despacho',
          sourceLocation: srcWh,
          targetLocation: dstWh,
          quantityDelta: -(Number(tItem.quantity) || 0),
          reasonNotes: parentTrf?.notes || 'Movimiento de rebalanceo entre almacenes',
          isConflictOrDiscrepancy: damaged > 0 || missing > 0,
          discrepancyType: missing > 0 ? 'faltante_sospechoso' : damaged > 0 ? 'averia_defectuoso' : undefined,
        })

        if (missing > 0 || damaged > 0) {
          events.push({
            id: `trf-incident-${tItem.id}`,
            date: parentTrf?.received_at || parentTrf?.created_at || new Date().toISOString(),
            type: 'merma_averia',
            typeLabel: missing > 0 ? '🚨 Faltante en Traslado' : '⚠️ Mercancía Dañada',
            referenceCode: 'INC-' + (parentTrf?.id?.slice(0, 6).toUpperCase() || '000'),
            userResponsible: parentTrf?.received_by || 'Receptor de Bodega',
            userRole: 'Recepción y Control',
            sourceLocation: srcWh,
            targetLocation: dstWh,
            quantityDelta: -(missing + damaged),
            reasonNotes: `Incidencia en tránsito: ${missing} uds faltantes, ${damaged} uds dañadas/defectuosas. Notas: ${tItem.receipt_notes || parentTrf?.notes || 'Sin nota explicativa'}`,
            isConflictOrDiscrepancy: true,
            discrepancyType: missing > 0 ? 'faltante_sospechoso' : 'averia_defectuoso',
          })
        }
      }
    }

    // 3. Devoluciones de Clientes / Cambios
    for (const dev of devolutions) {
      if (dev.product_id === forensicProductId) {
        events.push({
          id: `dev-${dev.id}`,
          date: dev.created_at,
          type: 'devolucion_cliente',
          typeLabel: 'Devolución de Cliente',
          referenceCode: 'DEV-' + dev.id.slice(0, 6).toUpperCase(),
          userResponsible: dev.handled_by || 'Atención al Cliente / Mostrador',
          userRole: 'Ventas y Posventa',
          sourceLocation: `Cliente: ${dev.customer_name || 'Cliente'}`,
          targetLocation: dev.reenter_stock ? 'Reingresó a Stock' : 'Separado para Baja / Garantía',
          quantityDelta: dev.reenter_stock ? Number(dev.quantity) || 0 : 0,
          reasonNotes: `Devuelto por motivo: ${dev.reason || 'Producto defectuoso / inconforme'}. Acción: ${dev.reenter_stock ? 'Apto para venta' : 'Dado de baja por defecto'}`,
          isConflictOrDiscrepancy: true,
          discrepancyType: 'devolucion_reclamo',
        })
      }
    }

    // 4. Kardex (Tomas físicas, ajustes manuales, mermas)
    for (const k of kardexEntries) {
      if (k.product_id === forensicProductId || k.product_name === selectedProd?.name) {
        if (k.reference_type === 'ajuste' || k.reference_type === 'conteo_ciego' || k.reference_type === 'merma') {
          const isNegative = k.type === 'salida'
          events.push({
            id: `kdx-${k.id}`,
            date: k.created_at,
            type: k.reference_type === 'merma' ? 'merma_averia' : 'ajuste_toma_fisica',
            typeLabel: k.reference_type === 'merma' ? 'Baja por Merma / Rotura' : 'Corrección por Conteo Físico',
            referenceCode: 'AJU-' + k.id.slice(0, 6).toUpperCase(),
            userResponsible: k.user_name || 'Auditor de Inventario',
            userRole: 'Auditoría / Control',
            sourceLocation: 'Inventario del Sistema',
            quantityDelta: isNegative ? -Math.abs(Number(k.quantity)) : Math.abs(Number(k.quantity)),
            stockResulting: Number(k.balance) || undefined,
            reasonNotes: k.notes || (isNegative ? 'Ajuste por faltante no localizado en bodega' : 'Ajuste de regularización'),
            isConflictOrDiscrepancy: isNegative,
            discrepancyType: isNegative ? 'faltante_sospechoso' : 'sobrante_descuadre',
          })
        }
      }
    }

    // 5. Ventas y Despachos Oficiales
    for (const r of dispatchRows) {
      if (r.productId === forensicProductId) {
        events.push({
          id: `sale-item-${r.saleId}-${r.productId}`,
          date: r.createdAt,
          type: 'despacho_venta',
          typeLabel: 'Salida por Venta / Despacho',
          referenceCode: r.saleNumber,
          userResponsible: (r.rawSale as any).seller_name || (r.rawSale as any).created_by_name || 'Cajero / Vendedor',
          userRole: 'Ventas y Reparto',
          sourceLocation: r.branchName,
          targetLocation: `Cliente: ${r.customerName}`,
          quantityDelta: -r.quantity,
          reasonNotes: `Despachado a ${r.customerName} (${formatMoney(r.subtotal, cur)} - ${r.paymentMethod})`,
          isConflictOrDiscrepancy: r.status === 'anulada',
          discrepancyType: r.status === 'anulada' ? 'correccion_inconsistencia' : undefined,
        })
      }
    }

    // Ordenar cronológicamente descendente
    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [
    forensicProductId,
    purchases,
    transfers,
    transferItems,
    devolutions,
    kardexEntries,
    dispatchRows,
    productsMap,
    branchesMap,
    warehousesMap,
    cur,
  ])

  // Eventos forenses filtrados por búsqueda o solo conflictos
  const filteredForensicEvents = useMemo(() => {
    return forensicEvents.filter((e) => {
      if (forensicOnlyConflicts && !e.isConflictOrDiscrepancy) return false
      if (forensicSearch.trim()) {
        const q = forensicSearch.toLowerCase().trim()
        const matchUser = e.userResponsible.toLowerCase().includes(q)
        const matchReason = e.reasonNotes.toLowerCase().includes(q)
        const matchRef = e.referenceCode.toLowerCase().includes(q)
        const matchLoc = e.sourceLocation.toLowerCase().includes(q)
        if (!matchUser && !matchReason && !matchRef && !matchLoc) return false
      }
      return true
    })
  }, [forensicEvents, forensicOnlyConflicts, forensicSearch])

  // Diagnóstico de Trazabilidad y Conflictos
  const forensicSummary = useMemo(() => {
    let totalIn = 0
    let totalOut = 0
    let totalDiscrepancies = 0
    let totalLossesQty = 0

    const usersInvolved = new Set<string>()

    for (const e of forensicEvents) {
      if (e.quantityDelta > 0) totalIn += e.quantityDelta
      if (e.quantityDelta < 0) totalOut += Math.abs(e.quantityDelta)
      if (e.userResponsible) usersInvolved.add(e.userResponsible)

      if (e.isConflictOrDiscrepancy) {
        totalDiscrepancies++
        if (e.discrepancyType === 'faltante_sospechoso' || e.discrepancyType === 'averia_defectuoso') {
          totalLossesQty += Math.abs(e.quantityDelta)
        }
      }
    }

    const currentStock = forensicProductId ? productsMap.get(forensicProductId)?.stock ?? 0 : 0

    return {
      totalIn,
      totalOut,
      totalDiscrepancies,
      totalLossesQty,
      uniqueUsersCount: usersInvolved.size,
      currentStock,
    }
  }, [forensicEvents, forensicProductId, productsMap])

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

  // Restablecer filtros de despachos
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

  // Exportar a CSV de despachos
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

  // Exportar reporte forense a CSV
  function handleExportForensicCsv() {
    const pName = productsMap.get(forensicProductId)?.name || 'producto'
    const headers = [
      'Fecha',
      'Tipo de Operacion',
      'Comprobante / Referencia',
      'Usuario Responsable',
      'Rol del Usuario',
      'Origen',
      'Destino',
      'Variacion de Cantidad',
      'Alerta / Discrepancia',
      'Detalle y Justificacion',
    ]

    const rows = filteredForensicEvents.map((e) => [
      new Date(e.date).toLocaleString(),
      e.typeLabel,
      e.referenceCode,
      e.userResponsible,
      e.userRole || '',
      e.sourceLocation,
      e.targetLocation || '',
      e.quantityDelta > 0 ? `+${e.quantityDelta}` : e.quantityDelta.toString(),
      e.isConflictOrDiscrepancy ? (e.discrepancyType || 'DISCREPANCIA').toUpperCase() : 'CONFORME',
      e.reasonNotes,
    ])

    const fileName = `auditoria_forense_${pName.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`
    downloadCsv(fileName, headers, rows)
  }

  // Imprimir Reporte de Despachos Oficial
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

  // Imprimir Acta Forense de Auditoría de Producto
  function handlePrintForensicReport() {
    const prod = productsMap.get(forensicProductId)
    const companyName = config?.name || 'INVENTARIOPRO'
    const companyNit = config?.rif ? `RIF / NIT: ${config.rif}` : ''

    const rowsHtml = filteredForensicEvents
      .map((e, idx) => {
        const isConflict = e.isConflictOrDiscrepancy
        return `
        <tr style="border-bottom: 1px solid #e2e8f0; background: ${isConflict ? '#fff1f2' : idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
          <td style="padding: 7px 8px; font-size: 11px;">${new Date(e.date).toLocaleString()}</td>
          <td style="padding: 7px 8px; font-size: 11px; font-weight: 700; color: ${isConflict ? '#b91c1c' : '#0f172a'};">${e.typeLabel}</td>
          <td style="padding: 7px 8px; font-size: 11px; font-family: monospace;">${e.referenceCode}</td>
          <td style="padding: 7px 8px; font-size: 11px;">
            <strong>${e.userResponsible}</strong><br/>
            <span style="font-size: 10px; color: #64748b;">${e.userRole || ''}</span>
          </td>
          <td style="padding: 7px 8px; font-size: 11px;">${e.sourceLocation} ${e.targetLocation ? ` &rarr; ${e.targetLocation}` : ''}</td>
          <td style="padding: 7px 8px; font-size: 11px; text-align: center; font-weight: 800; color: ${e.quantityDelta > 0 ? '#15803d' : '#b91c1c'};">
            ${e.quantityDelta > 0 ? `+${e.quantityDelta}` : e.quantityDelta} uds
          </td>
          <td style="padding: 7px 8px; font-size: 11px; color: ${isConflict ? '#991b1b' : '#334155'};">${e.reasonNotes}</td>
        </tr>
      `
      })
      .join('')

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Acta de Auditoría Forense y Trazabilidad - ${prod?.name}</title>
        <style>
          @page { size: landscape; margin: 12mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; margin: 0; padding: 12px; }
          .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-start; }
          .title { font-size: 18px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin: 0; }
          .box-summary { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; margin-bottom: 14px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th { background: #0f172a; color: #ffffff; text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; }
          .signatures { margin-top: 40px; display: flex; justify-content: space-between; page-break-inside: avoid; }
          .sig-box { width: 28%; border-top: 1px solid #0f172a; text-align: center; padding-top: 6px; font-size: 11px; color: #334155; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 class="title">Acta Oficial de Auditoría Forense de Inventario</h1>
            <div style="font-size: 12px; color: #475569; margin-top: 2px;">
              Trazabilidad de Cadena de Custodia, Mermas, Traslados y Descuadres para Resolución de Conflictos
            </div>
          </div>
          <div style="text-align: right; font-size: 11px; color: #475569;">
            <strong style="font-size: 13px; color: #0f172a;">${companyName}</strong><br/>
            ${companyNit}<br/>
            <span>Fecha de Emisión: ${new Date().toLocaleString()}</span>
          </div>
        </div>

        <div class="box-summary">
          <div><strong>Producto auditado:</strong> ${prod?.name || 'N/A'} (SKU: ${prod?.sku || 'N/A'})</div>
          <div><strong>Stock actual en sistema:</strong> ${forensicSummary.currentStock} uds</div>
          <div><strong>Total Entradas (Compras):</strong> +${forensicSummary.totalIn} uds</div>
          <div><strong>Total Salidas (Ventas/Mov):</strong> -${forensicSummary.totalOut} uds</div>
          <div style="color: ${forensicSummary.totalLossesQty > 0 ? '#b91c1c' : '#15803d'};">
            <strong>Faltantes / Mermas / Alertas:</strong> ${forensicSummary.totalLossesQty} uds (${forensicSummary.totalDiscrepancies} alertas)
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 14%;">Fecha y Hora</th>
              <th style="width: 14%;">Tipo de Operación</th>
              <th style="width: 11%;">Comprobante</th>
              <th style="width: 15%;">Usuario Responsable</th>
              <th style="width: 16%;">Ubicación / Flujo</th>
              <th style="width: 8%; text-align: center;">Cantidad</th>
              <th style="width: 22%;">Justificación / Incidencia</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #94a3b8;">No se registraron movimientos para este producto.</td></tr>'}
          </tbody>
        </table>

        <div class="signatures">
          <div class="sig-box">
            <strong>Auditor de Inventario / Control Interno</strong><br/>
            Firma y Dictamen
          </div>
          <div class="sig-box">
            <strong>Jefe de Almacén y Custodia</strong><br/>
            Revisión y Conformidad
          </div>
          <div class="sig-box">
            <strong>Gerencia General / Representante Legal</strong><br/>
            Visto Bueno Oficial
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
      {/* Encabezado Principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
              Trazabilidad, Despachos y Auditoría Forense
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Control integral de salidas a clientes, cadena de custodia, quién metió o movió mercancía, devoluciones y resolución de conflictos por pérdidas o descuadres.
          </p>
        </div>

        {/* Pestañas Superiores */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-2xl border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('despachos')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'despachos'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5 text-indigo-600" />
            Despachos a Clientes
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('forense')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'forense'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
            Auditoría Forense & Conflictos
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* PESTAÑA 1: DESPACHOS A CLIENTES Y SALIDAS */}
      {/* ==================================================================== */}
      {activeTab === 'despachos' && (
        <div className="space-y-6">
          {/* Barra de Acciones y Botones */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-slate-500">
              Filtra por producto, cliente y tienda para verificar remisiones y exportar o imprimir.
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
              <p className="text-[11px] text-slate-400 mt-1">Excluyendo ventas anuladas</p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span className="font-medium">Clientes Atendidos</span>
                <Users className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.customerCount}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Destinatarios con entregas</p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span className="font-medium">Comprobantes / Despachos</span>
                <Store className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.salesCount}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Facturas y remisiones registradas</p>
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
                <span className="text-xs font-semibold text-slate-700">Registros encontrados:</span>
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
                          <td className="px-3.5 py-3 whitespace-nowrap text-slate-600">
                            <div className="font-medium text-slate-800">
                              {d.toLocaleDateString()}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </td>

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

                          <td className="px-3.5 py-3 text-center whitespace-nowrap">
                            <span className="inline-block px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 tabular-nums">
                              {row.quantity} uds
                            </span>
                          </td>

                          <td className="px-3.5 py-3 text-right whitespace-nowrap text-slate-600 tabular-nums">
                            {formatMoney(row.price, cur)}
                          </td>

                          <td className="px-3.5 py-3 text-right whitespace-nowrap font-bold text-slate-900 tabular-nums">
                            {formatMoney(row.subtotal, cur)}
                          </td>

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
        </div>
      )}

      {/* ==================================================================== */}
      {/* PESTAÑA 2: AUDITORÍA FORENSE DE PRODUCTO (CONFLICTOS, MERMAS, ROBOS) */}
      {/* ==================================================================== */}
      {activeTab === 'forense' && (
        <div className="space-y-6">
          {/* Barra de Selección de Producto a Auditar */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-5 text-white shadow-lg border border-indigo-900/50 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-red-500/20 text-red-300 rounded-xl border border-red-500/30">
                    <ShieldAlert className="w-5 h-5" />
                  </span>
                  <h2 className="text-base sm:text-lg font-bold text-white">
                    Auditoría Forense de Producto y Resolución de Conflictos
                  </h2>
                </div>
                <p className="text-xs text-indigo-200/80 mt-1 max-w-2xl">
                  Rastrea quién ingresó la mercancía, quién la movió entre sedes, quién corrigió cantidades, devoluciones y bajas por avería para esclarecer pérdidas, mermas o errores de digitación.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handlePrintForensicReport}
                  disabled={!forensicProductId || filteredForensicEvents.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-slate-950 text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-indigo-700" />
                  Imprimir Acta de Auditoría
                </button>
                <button
                  type="button"
                  onClick={handleExportForensicCsv}
                  disabled={!forensicProductId || filteredForensicEvents.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Exportar Trazabilidad
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-indigo-900/60">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-indigo-200 mb-1">
                  Selecciona el producto a auditar forensemente:
                </label>
                <select
                  value={forensicProductId}
                  onChange={(e) => setForensicProductId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-white border border-indigo-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.sku ? `(SKU: ${p.sku})` : ''} - Stock actual: {p.stock} uds
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-indigo-200 mb-1">
                  Filtrar por responsable / notas:
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-indigo-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={forensicSearch}
                    onChange={(e) => setForensicSearch(e.target.value)}
                    placeholder="Buscar usuario o comprobante..."
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-800 text-white border border-indigo-700/60 placeholder:text-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Tarjetas Forenses de Diagnóstico de Pérdidas */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Stock Físico / Sistema
              </span>
              <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                {forensicSummary.currentStock} uds
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Saldo disponible actual</p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Entradas (Compras)
              </span>
              <div className="text-xl font-bold text-emerald-700 tabular-nums mt-0.5">
                +{forensicSummary.totalIn} uds
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Ingresadas al almacén</p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Salidas (Ventas/Mov)
              </span>
              <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                -{forensicSummary.totalOut} uds
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Despachos registrados</p>
            </div>

            <div
              className={`rounded-2xl border p-4 shadow-xs ${
                forensicSummary.totalLossesQty > 0
                  ? 'bg-red-50 border-red-200'
                  : 'bg-emerald-50 border-emerald-200'
              }`}
            >
              <span
                className={`text-[10px] uppercase font-bold block ${
                  forensicSummary.totalLossesQty > 0 ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                Faltantes / Mermas
              </span>
              <div
                className={`text-xl font-bold tabular-nums mt-0.5 ${
                  forensicSummary.totalLossesQty > 0 ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {forensicSummary.totalLossesQty} uds
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                {forensicSummary.totalLossesQty > 0
                  ? '⚠️ Presunta pérdida o merma'
                  : '✓ Sin faltantes detectados'}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs col-span-2 lg:col-span-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Cadena de Custodia
              </span>
              <div className="text-xl font-bold text-indigo-700 tabular-nums mt-0.5">
                {forensicSummary.uniqueUsersCount} usuarios
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Manipularon este ítem</p>
            </div>
          </div>

          {/* Filtro rápido: Solo conflictos */}
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={forensicOnlyConflicts}
                onChange={(e) => setForensicOnlyConflicts(e.target.checked)}
                className="w-4 h-4 rounded text-red-600 focus:ring-red-500"
              />
              <span>Mostrar únicamente eventos con sospecha de conflicto, faltante o merma</span>
            </label>

            <span className="text-xs text-slate-400">
              {filteredForensicEvents.length} eventos cronológicos
            </span>
          </div>

          {/* Timeline / Tabla Forense */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3.5 py-3">Fecha y Hora</th>
                    <th className="px-3.5 py-3">Tipo de Operación</th>
                    <th className="px-3.5 py-3">Comprobante</th>
                    <th className="px-3.5 py-3">¿Quién lo Realizó? (Responsable)</th>
                    <th className="px-3.5 py-3">Ubicación / Flujo</th>
                    <th className="px-3.5 py-3 text-center">Variación</th>
                    <th className="px-3.5 py-3">Diagnóstico y Justificación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredForensicEvents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-slate-400">
                        No hay movimientos registrados para este producto o no coinciden con el filtro.
                      </td>
                    </tr>
                  ) : (
                    filteredForensicEvents.map((evt) => {
                      const isNegative = evt.quantityDelta < 0
                      const isConflict = evt.isConflictOrDiscrepancy

                      return (
                        <tr
                          key={evt.id}
                          className={`hover:bg-slate-50 transition-colors ${
                            isConflict ? 'bg-red-50/40' : ''
                          }`}
                        >
                          {/* Fecha */}
                          <td className="px-3.5 py-3 whitespace-nowrap text-slate-600">
                            <div className="font-medium text-slate-800">
                              {new Date(evt.date).toLocaleDateString()}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {new Date(evt.date).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>

                          {/* Tipo de Operación */}
                          <td className="px-3.5 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              {evt.type === 'ingreso_compra' && (
                                <ArrowDownRight className="w-4 h-4 text-emerald-600 shrink-0" />
                              )}
                              {evt.type === 'despacho_venta' && (
                                <ArrowUpRight className="w-4 h-4 text-indigo-600 shrink-0" />
                              )}
                              {evt.type === 'traslado_salida' && (
                                <Truck className="w-4 h-4 text-amber-600 shrink-0" />
                              )}
                              {evt.type === 'devolucion_cliente' && (
                                <History className="w-4 h-4 text-purple-600 shrink-0" />
                              )}
                              {evt.type === 'merma_averia' && (
                                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                              )}
                              {evt.type === 'ajuste_toma_fisica' && (
                                <FileSearch className="w-4 h-4 text-blue-600 shrink-0" />
                              )}
                              <span>{evt.typeLabel}</span>
                            </div>
                          </td>

                          {/* Comprobante */}
                          <td className="px-3.5 py-3 whitespace-nowrap font-mono font-semibold text-slate-700">
                            {evt.referenceCode}
                          </td>

                          {/* Quién lo realizó (Responsable) */}
                          <td className="px-3.5 py-3">
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{evt.userResponsible}</span>
                            </div>
                            {evt.userRole && (
                              <div className="text-[10px] text-slate-500 pl-5">
                                Rol: {evt.userRole}
                              </div>
                            )}
                          </td>

                          {/* Ubicación / Flujo */}
                          <td className="px-3.5 py-3">
                            <div className="text-slate-800 font-medium">
                              {evt.sourceLocation}
                            </div>
                            {evt.targetLocation && (
                              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                <span>&rarr;</span> {evt.targetLocation}
                              </div>
                            )}
                          </td>

                          {/* Variación de Cantidad */}
                          <td className="px-3.5 py-3 text-center whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold tabular-nums ${
                                evt.quantityDelta > 0
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-800'
                              } ${isConflict ? '!bg-red-100 !text-red-800' : ''}`}
                            >
                              {evt.quantityDelta > 0 ? `+${evt.quantityDelta}` : evt.quantityDelta}{' '}
                              uds
                            </span>
                            {evt.stockResulting !== undefined && (
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Saldo: {evt.stockResulting}
                              </div>
                            )}
                          </td>

                          {/* Diagnóstico y Justificación */}
                          <td className="px-3.5 py-3">
                            <div className="text-slate-700 text-xs">{evt.reasonNotes}</div>
                            {evt.isConflictOrDiscrepancy && (
                              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                                <AlertTriangle className="w-3 h-3" />
                                {evt.discrepancyType === 'faltante_sospechoso'
                                  ? 'Alerta: Faltante / Sospecha de Robo'
                                  : evt.discrepancyType === 'averia_defectuoso'
                                    ? 'Avería / Producto Defectuoso'
                                    : 'Ajuste / Reclamo'}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
                        <td className="px-3 py-2 font-medium text-slate-800">{it.product_name}</td>
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
