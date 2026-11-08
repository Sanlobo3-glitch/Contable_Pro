import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canManageInventory, canManageTransport, isCompanyManager, isReadOnly } from '../lib/auth'
import { useWarehouse } from '../lib/warehouseContext'
import { useCurrency, fmtDate, fmtNum } from '../lib/currency'
import type {
  Branch,
  InventoryTransfer,
  InventoryTransferItem,
  Product,
  Warehouse,
  WarehouseMovement,
  WarehouseReservation,
  WarehouseStockRow,
  WarehouseType,
} from '../types'
import {
  Building2,
  Warehouse as WarehouseIcon,
  ArrowLeftRight,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Lock,
  Send,
  PackageCheck,
  SlidersHorizontal,
  BookmarkCheck,
  X,
  Truck,
  MapPin,
  Camera,
  PenTool,
  Navigation,
  FileText,
  Scan,
  Radio,
  ExternalLink,
  Printer,
  Phone,
} from 'lucide-react'
import {
  enrichTransfer,
  saveTransferEnrichment,
  getFleetVehicles,
  getWarehouseCoords,
} from '../lib/fleetRepo'
import TransferRouteMapModal from '../components/logistics/TransferRouteMapModal'
import ArrivalBarcodeScannerModal from '../components/logistics/ArrivalBarcodeScannerModal'
import PhysicalNoteScannerModal from '../components/logistics/PhysicalNoteScannerModal'
import DeliveryProofSignatureModal from '../components/logistics/DeliveryProofSignatureModal'
import FleetManagerTab from '../components/logistics/FleetManagerTab'

type ViewTab = 'stock' | 'transfers' | 'fleet' | 'structure' | 'audit'
type StockStateFilter = 'all' | 'reserved' | 'critical'

const WAREHOUSE_TYPE_LABEL: Record<WarehouseType, string> = {
  principal: 'Principal / Centro de distribución',
  general: 'Almacén general / Piso de venta',
  materia_prima: 'Materia prima e insumos',
  producto_terminado: 'Producto terminado / Despacho',
  transito: 'Tránsito logístico',
  devoluciones: 'Control de calidad y devoluciones',
}

const TRANSFER_STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: 'Borrador pendiente de despacho', cls: 'text-slate-600' },
  in_transit: { text: 'En tránsito hacia destino', cls: 'text-amber-700' },
  received: { text: 'Recibido en destino', cls: 'text-emerald-700' },
  cancelled: { text: 'Cancelado', cls: 'text-red-600' },
}

const MOVEMENT_LABEL: Record<string, { text: string; cls: string }> = {
  entry: { text: 'Entrada', cls: 'text-emerald-700' },
  exit: { text: 'Salida', cls: 'text-red-600' },
  adjustment: { text: 'Ajuste', cls: 'text-amber-700' },
}

interface ReceiveLineState {
  product_id: string
  product_name: string
  sku: string
  expected: number
  received: string
  damaged: string
  missing: string
  notes: string
}

export default function BranchesWarehouses({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const {
    branches,
    warehouses,
    activeWarehouseId,
    sqlReady,
    setActiveWarehouseId,
    refreshWarehouses,
  } = useWarehouse()

  const readOnly = isReadOnly(user)
  const canEditInventory = (canManageInventory(user?.role) || canManageTransport(user?.role)) && !readOnly
  const canEditBranches = isCompanyManager(user?.role) && !readOnly

  const [tab, setTab] = useState<ViewTab>(() => (user?.role === 'transportador' ? 'transfers' : 'stock'))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const [products, setProducts] = useState<Product[]>([])
  const [stockRows, setStockRows] = useState<WarehouseStockRow[]>([])
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([])
  const [transferItems, setTransferItems] = useState<InventoryTransferItem[]>([])
  const [movements, setMovements] = useState<WarehouseMovement[]>([])
  const [reservations, setReservations] = useState<WarehouseReservation[]>([])

  // Filtros de existencias
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all')
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all')
  const [stockStateFilter, setStockStateFilter] = useState<StockStateFilter>('all')
  const [query, setQuery] = useState('')

  // Modal: Movimiento / ajuste manual en bodega
  const [movModal, setMovModal] = useState<{
    warehouseId: string
    productId: string
    type: 'entry' | 'exit' | 'adjustment'
    qty: string
    notes: string
  } | null>(null)

  // Modal: Reserva de inventario
  const [resModal, setResModal] = useState<{
    warehouseId: string
    productId: string
    qty: string
    refType: string
  } | null>(null)

  // Modal: Nuevo traslado entre bodegas
  const [newTransferOpen, setNewTransferOpen] = useState(false)
  const [trfForm, setTrfForm] = useState<{
    sourceId: string
    destId: string
    notes: string
    vehicleId: string
    driverName: string
    driverPhone: string
    dispatcherName: string
    lines: { product_id: string; qty: string }[]
  }>({
    sourceId: '',
    destId: '',
    notes: '',
    vehicleId: '',
    driverName: '',
    driverPhone: '',
    dispatcherName: '',
    lines: [{ product_id: '', qty: '1' }],
  })

  // Modales especializados de Logística, Flota y Telemetría
  const [mapModalTarget, setMapModalTarget] = useState<InventoryTransfer | null>(null)
  const [barcodeModalTarget, setBarcodeModalTarget] = useState<InventoryTransfer | null>(null)
  const [physicalNoteModalTarget, setPhysicalNoteModalTarget] = useState<InventoryTransfer | null>(null)
  const [signatureModalTarget, setSignatureModalTarget] = useState<InventoryTransfer | null>(null)

  // Modal: Recepción detallada / parcial de traslado
  const [receiveTarget, setReceiveTarget] = useState<InventoryTransfer | null>(null)
  const [receiveLines, setReceiveLines] = useState<ReceiveLineState[]>([])

  // Modales: Nueva Sucursal / Nueva Bodega
  const [branchModalOpen, setBranchModalOpen] = useState(false)
  const [branchForm, setBranchForm] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    is_main: false,
  })

  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false)
  const [warehouseForm, setWarehouseForm] = useState<{
    branch_id: string
    name: string
    code: string
    address: string
    warehouse_type: WarehouseType
  }>({
    branch_id: '',
    name: '',
    code: '',
    address: '',
    warehouse_type: 'general',
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    await refreshWarehouses()

    const [pRes, wsRes, tRes, tiRes, mRes, rRes] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('warehouse_stock').select('*'),
      supabase.from('inventory_transfers').select('*').order('created_at', { ascending: false }).limit(80),
      supabase.from('inventory_transfer_items').select('*'),
      supabase.from('warehouse_movements').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('warehouse_stock_reservations').select('*').order('created_at', { ascending: false }).limit(60),
    ])

    setProducts(((pRes.data || []) as Product[]))
    setStockRows(((wsRes.data || []) as WarehouseStockRow[]))
    const rawTransfers = (tRes.data || []) as InventoryTransfer[]
    setTransfers(rawTransfers.map(enrichTransfer))
    setTransferItems(((tiRes.data || []) as InventoryTransferItem[]))
    setMovements(((mRes.data || []) as WarehouseMovement[]))
    setReservations(((rRes.data || []) as WarehouseReservation[]))
    setLoading(false)
  }, [refreshWarehouses])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const warehouseMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])
  const branchMap = useMemo(() => new Map(branches.map(b => [b.id, b])), [branches])

  const filteredWarehouses = useMemo(() => {
    if (selectedBranchId === 'all') return warehouses
    return warehouses.filter(w => w.branch_id === selectedBranchId)
  }, [warehouses, selectedBranchId])

  // KPIs ejecutivos de estructura y logística
  const summary = useMemo(() => {
    const activeBr = branches.filter(b => b.active !== false).length
    const activeWh = warehouses.filter(w => w.active !== false).length

    let totalUnits = 0
    let reservedUnits = 0
    let costValue = 0
    let retailValue = 0

    for (const row of stockRows) {
      const wh = warehouseMap.get(row.warehouse_id)
      if (!wh || wh.active === false) continue
      const p = productMap.get(row.product_id)
      const q = Number(row.quantity) || 0
      const r = Number(row.reserved_quantity) || 0
      totalUnits += q
      reservedUnits += r
      costValue += q * (Number(p?.cost) || 0)
      retailValue += q * (Number(p?.price) || 0)
    }

    const inTransit = transfers.filter(t => t.status === 'in_transit').length
    const drafts = transfers.filter(t => t.status === 'draft').length
    const activeResCount = reservations.filter(r => r.status === 'active').length

    return {
      activeBr,
      activeWh,
      totalUnits,
      reservedUnits,
      costValue,
      retailValue,
      inTransit,
      drafts,
      activeResCount,
    }
  }, [branches, warehouses, stockRows, warehouseMap, productMap, transfers, reservations])

  // Matriz enriquecida de existencias por bodega
  const enrichedStock = useMemo(() => {
    const q = query.trim().toLowerCase()
    const allowedWarehouseIds = new Set(
      warehouses
        .filter(w => {
          if (selectedBranchId !== 'all' && w.branch_id !== selectedBranchId) return false
          if (selectedWarehouseId !== 'all' && w.id !== selectedWarehouseId) return false
          return true
        })
        .map(w => w.id)
    )

    const rows = stockRows
      .filter(r => allowedWarehouseIds.has(r.warehouse_id))
      .map(r => {
        const prod = productMap.get(r.product_id)
        const wh = warehouseMap.get(r.warehouse_id)
        const br = wh?.branch_id ? branchMap.get(wh.branch_id) : undefined
        const qty = Number(r.quantity) || 0
        const res = Number(r.reserved_quantity) || 0
        const available = Math.max(0, qty - res)
        const cost = Number(prod?.cost) || 0
        const minStock = Number(prod?.min_stock) || 0
        return {
          key: `${r.warehouse_id}:${r.product_id}`,
          warehouse_id: r.warehouse_id,
          warehouse_name: wh?.name || 'Bodega',
          warehouse_code: wh?.code || null,
          branch_name: br?.name || 'Sin sucursal',
          product_id: r.product_id,
          product_name: prod?.name || 'Producto',
          sku: prod?.sku || '',
          unit: prod?.unit || 'und',
          quantity: qty,
          reserved: res,
          available,
          min_stock: minStock,
          cost,
          valuation: qty * cost,
          updated_at: r.updated_at,
        }
      })
      .filter(r => {
        if (stockStateFilter === 'reserved' && r.reserved <= 0) return false
        if (stockStateFilter === 'critical' && !(r.available <= 0 || (r.min_stock > 0 && r.available <= Math.ceil(r.min_stock / 2)))) {
          return false
        }
        if (q && !r.product_name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q) && !r.warehouse_name.toLowerCase().includes(q)) {
          return false
        }
        return true
      })
      .sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name) || a.product_name.localeCompare(b.product_name))

    return rows
  }, [stockRows, warehouses, selectedBranchId, selectedWarehouseId, productMap, warehouseMap, branchMap, stockStateFilter, query])

  async function handleBootstrapDefaultStructure() {
    if (!canEditBranches || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const companyId = user?.company_id
      let mainBranch = branches.find(b => b.is_main) || branches[0]
      if (!mainBranch) {
        const payload: Record<string, unknown> = {
          name: 'Sucursal principal',
          code: 'SUC-001',
          is_main: true,
          active: true,
        }
        if (companyId) payload.company_id = companyId
        const { data: bCreated, error: bErr } = await supabase.from('branches').insert(payload).select().single()
        if (bErr) throw new Error(bErr.message)
        mainBranch = bCreated as Branch
      }

      let mainWarehouse = warehouses.find(w => w.warehouse_type === 'principal') || warehouses[0]
      if (!mainWarehouse && mainBranch) {
        const wPayload: Record<string, unknown> = {
          branch_id: mainBranch.id,
          name: 'Bodega principal',
          code: 'BOD-001',
          warehouse_type: 'principal',
          active: true,
        }
        if (companyId) wPayload.company_id = companyId
        const { data: wCreated, error: wErr } = await supabase.from('warehouses').insert(wPayload).select().single()
        if (wErr) throw new Error(wErr.message)
        mainWarehouse = wCreated as Warehouse
      }

      if (mainWarehouse && products.length > 0) {
        for (const p of products) {
          const exists = stockRows.some(s => s.warehouse_id === mainWarehouse!.id && s.product_id === p.id)
          if (!exists && Number(p.stock) > 0) {
            await supabase.rpc('register_warehouse_movement', {
              p_warehouse_id: mainWarehouse.id,
              p_product_id: p.id,
              p_movement_type: 'entry',
              p_quantity: Number(p.stock),
              p_reference_type: 'initial_seed',
              p_notes: 'Inicialización de inventario en bodega principal',
            })
          }
        }
      }

      setFeedback({ ok: true, text: 'Sede principal, bodega principal y existencias base inicializadas correctamente.' })
      await loadData()
    } catch (e: unknown) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : 'No se pudo inicializar la estructura' })
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveMovement(e: React.FormEvent) {
    e.preventDefault()
    if (!movModal || busy) return
    const qty = parseFloat(movModal.qty.replace(',', '.'))
    if (!Number.isFinite(qty) || qty === 0) {
      setFeedback({ ok: false, text: 'Indica una cantidad distinta de cero.' })
      return
    }
    if ((movModal.type === 'entry' || movModal.type === 'exit') && qty < 0) {
      setFeedback({ ok: false, text: 'Para entradas o salidas indica una cantidad positiva.' })
      return
    }

    setBusy(true)
    setFeedback(null)
    const { error } = await supabase.rpc('register_warehouse_movement', {
      p_warehouse_id: movModal.warehouseId,
      p_product_id: movModal.productId,
      p_movement_type: movModal.type,
      p_quantity: qty,
      p_reference_type: 'manual_adjustment',
      p_notes: movModal.notes.trim() || null,
    })
    setBusy(false)

    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setMovModal(null)
    setFeedback({ ok: true, text: 'Movimiento registrado en el kardex de la bodega.' })
    await loadData()
  }

  async function handleSaveReservation(e: React.FormEvent) {
    e.preventDefault()
    if (!resModal || busy) return
    const qty = parseFloat(resModal.qty.replace(',', '.'))
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({ ok: false, text: 'La cantidad a reservar debe ser mayor que cero.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    const { error } = await supabase.rpc('reserve_warehouse_stock', {
      p_warehouse_id: resModal.warehouseId,
      p_product_id: resModal.productId,
      p_quantity: qty,
      p_reference_type: resModal.refType.trim() || 'pedido_cliente',
    })
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setResModal(null)
    setFeedback({ ok: true, text: 'Unidades reservadas correctamente en bodega.' })
    await loadData()
  }

  async function handleCreateTransfer(e: React.FormEvent) {
    e.preventDefault()
    if (!canEditInventory || busy) return
    if (!trfForm.sourceId || !trfForm.destId || trfForm.sourceId === trfForm.destId) {
      setFeedback({ ok: false, text: 'Selecciona bodegas de origen y destino diferentes.' })
      return
    }
    const cleanLines = trfForm.lines
      .map(l => ({ product_id: l.product_id, quantity: parseFloat(l.qty.replace(',', '.')) }))
      .filter(l => l.product_id && Number.isFinite(l.quantity) && l.quantity > 0)

    if (cleanLines.length === 0) {
      setFeedback({ ok: false, text: 'Agrega al menos un producto con cantidad válida al traslado.' })
      return
    }

    setBusy(true)
    setFeedback(null)
    try {
      const companyId = user?.company_id
      const headerPayload: Record<string, unknown> = {
        source_warehouse_id: trfForm.sourceId,
        destination_warehouse_id: trfForm.destId,
        status: 'draft',
        notes: trfForm.notes.trim() || null,
      }
      if (companyId) headerPayload.company_id = companyId

      const { data: created, error: tErr } = await supabase
        .from('inventory_transfers')
        .insert(headerPayload)
        .select()
        .single()

      if (tErr || !created) throw new Error(tErr?.message || 'No se pudo crear el documento de traslado')
      const transferId = (created as InventoryTransfer).id

      for (const l of cleanLines) {
        const itemPayload: Record<string, unknown> = {
          transfer_id: transferId,
          product_id: l.product_id,
          quantity: l.quantity,
        }
        if (companyId) itemPayload.company_id = companyId
        const { error: iErr } = await supabase.from('inventory_transfer_items').insert(itemPayload)
        if (iErr) throw new Error(iErr.message)
      }

      if (trfForm.vehicleId) {
        const fleetList = getFleetVehicles()
        const selectedVeh = fleetList.find(v => v.id === trfForm.vehicleId)
        saveTransferEnrichment(transferId, {
          vehicle_id: trfForm.vehicleId,
          vehicle_plate: selectedVeh?.plate || null,
          vehicle_name: selectedVeh?.name || null,
          driver_name: trfForm.driverName || selectedVeh?.driver_name || null,
          driver_phone: trfForm.driverPhone || selectedVeh?.driver_phone || null,
          dispatcher_name: trfForm.dispatcherName || selectedVeh?.dispatcher_name || null,
        })
      }

      setNewTransferOpen(false)
      setTrfForm({
        sourceId: '',
        destId: '',
        notes: '',
        vehicleId: '',
        driverName: '',
        driverPhone: '',
        dispatcherName: '',
        lines: [{ product_id: '', qty: '1' }],
      })
      setFeedback({ ok: true, text: 'Orden de traslado creada en borrador con vehículo y tripulación asignados.' })
      await loadData()
    } catch (err: unknown) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : 'Error creando traslado' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDispatchTransfer(transferId: string) {
    if (!canEditInventory || busy) return
    setBusy(true)
    setFeedback(null)
    const { error } = await supabase.rpc('process_inventory_transfer', {
      p_transfer_id: transferId,
      p_action: 'dispatch',
    })
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }

    // Inicializar coordenadas y telemetría de ruta
    const trf = transfers.find(t => t.id === transferId)
    const srcCoords = trf ? getWarehouseCoords(trf.source_warehouse_id) : { lat: 4.678, lng: -74.125 }
    saveTransferEnrichment(transferId, {
      live_tracking_active: true,
      last_lat: srcCoords.lat,
      last_lng: srcCoords.lng,
      last_gps_updated_at: new Date().toISOString(),
    })

    setFeedback({ ok: true, text: 'Traslado despachado: stock descontado en origen, vehículo en ruta y rastreo GPS activado.' })
    await loadData()
  }

  function openReceiveModal(trf: InventoryTransfer) {
    const items = transferItems.filter(i => i.transfer_id === trf.id)
    setReceiveTarget(trf)
    setReceiveLines(
      items.map(it => {
        const p = productMap.get(it.product_id)
        return {
          product_id: it.product_id,
          product_name: p?.name || 'Producto',
          sku: p?.sku || '',
          expected: Number(it.quantity) || 0,
          received: String(Number(it.quantity) || 0),
          damaged: '0',
          missing: '0',
          notes: '',
        }
      })
    )
  }

  async function handleConfirmReceive(e: React.FormEvent) {
    e.preventDefault()
    if (!receiveTarget || busy) return
    const payload = []
    for (const l of receiveLines) {
      const rec = parseFloat(l.received.replace(',', '.')) || 0
      const dmg = parseFloat(l.damaged.replace(',', '.')) || 0
      const mis = parseFloat(l.missing.replace(',', '.')) || 0
      if (rec < 0 || dmg < 0 || mis < 0 || Math.abs(rec + dmg + mis - l.expected) > 0.001) {
        setFeedback({
          ok: false,
          text: `En «${l.product_name}», la suma de recibido (${rec}) + dañado (${dmg}) + faltante (${mis}) debe igualar lo enviado (${l.expected}).`,
        })
        return
      }
      payload.push({
        product_id: l.product_id,
        received_quantity: rec,
        damaged_quantity: dmg,
        missing_quantity: mis,
        notes: l.notes.trim() || null,
      })
    }

    setBusy(true)
    setFeedback(null)
    const { error } = await supabase.rpc('receive_inventory_transfer', {
      p_transfer_id: receiveTarget.id,
      p_items: payload,
    })
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setReceiveTarget(null)
    setFeedback({ ok: true, text: 'Recepción confirmada e ingresada en la bodega de destino.' })
    await loadData()
  }

  async function handleSaveBranch(e: React.FormEvent) {
    e.preventDefault()
    if (!canEditBranches || busy || !branchForm.name.trim()) return
    setBusy(true)
    setFeedback(null)
    const payload: Record<string, unknown> = {
      name: branchForm.name.trim(),
      code: branchForm.code.trim().toUpperCase() || null,
      address: branchForm.address.trim() || null,
      phone: branchForm.phone.trim() || null,
      email: branchForm.email.trim() || null,
      is_main: branches.length === 0 ? true : branchForm.is_main,
      active: true,
    }
    if (user?.company_id) payload.company_id = user.company_id
    const { error } = await supabase.from('branches').insert(payload)
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setBranchModalOpen(false)
    setBranchForm({ name: '', code: '', address: '', phone: '', email: '', is_main: false })
    setFeedback({ ok: true, text: 'Sucursal creada correctamente.' })
    await loadData()
  }

  async function handleSaveWarehouse(e: React.FormEvent) {
    e.preventDefault()
    if (!canEditInventory || busy || !warehouseForm.name.trim()) return
    setBusy(true)
    setFeedback(null)
    const payload: Record<string, unknown> = {
      branch_id: warehouseForm.branch_id || branches[0]?.id || null,
      name: warehouseForm.name.trim(),
      code: warehouseForm.code.trim().toUpperCase() || null,
      address: warehouseForm.address.trim() || null,
      warehouse_type: warehouseForm.warehouse_type,
      active: true,
    }
    if (user?.company_id) payload.company_id = user.company_id
    const { error } = await supabase.from('warehouses').insert(payload)
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setWarehouseModalOpen(false)
    setWarehouseForm({ branch_id: '', name: '', code: '', address: '', warehouse_type: 'general' })
    setFeedback({ ok: true, text: 'Bodega registrada y habilitada.' })
    await loadData()
  }

  async function handleReservationAction(id: string, action: 'consume' | 'release') {
    if (!canEditInventory || busy) return
    setBusy(true)
    setFeedback(null)
    const rpcName = action === 'consume' ? 'consume_warehouse_reservation' : 'release_warehouse_reservation'
    const { error } = await supabase.rpc(rpcName, { p_reservation_id: id })
    setBusy(false)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setFeedback({
      ok: true,
      text: action === 'consume' ? 'Reserva consumida y salida asentada en kardex.' : 'Reserva liberada al stock disponible.',
    })
    await loadData()
  }

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-slate-700 bg-white'

  if (!sqlReady) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-xl font-bold text-slate-900">Sedes, Bodegas y Traslados</h1>
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
          <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Módulo multibodega pendiente de activar en la base de datos</span>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Tu repositorio ya incluye las migraciones SQL transaccionales para operar múltiples sucursales, bodegas especializadas,
            traslados con recepción parcial y reservas de inventario. Ejecútalas en orden en el editor SQL de Supabase:
          </p>
          <ol className="text-xs font-mono text-slate-700 space-y-1 pl-4 list-decimal">
            <li>20261101000005_sucursales_y_bodegas.sql</li>
            <li>20261101000006_inventario_multibodega.sql</li>
            <li>20261101000007_kardex_movimientos.sql</li>
            <li>20261102000008_traslados_bodegas.sql</li>
            <li>20261102000009_recepcion_parcial_traslados.sql</li>
            <li>20261102000010_reservas_inventario.sql</li>
            <li>20261102000011_inicializar_bodegas_inventario</li>
            <li>20261102000012_ventas_por_bodega.sql</li>
          </ol>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Verificar nuevamente
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Estructura Empresarial · Sedes y Multibodega
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Control centralizado de sucursales, bodegas operativas, traslados en tránsito con recepción auditada y reservas de mercancía.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading || busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>

          {canEditInventory && warehouses.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                setTrfForm({
                  sourceId: activeWarehouseId || warehouses[0]?.id || '',
                  destId: warehouses.find(w => w.id !== (activeWarehouseId || warehouses[0]?.id))?.id || '',
                  notes: '',
                  vehicleId: '',
                  driverName: '',
                  driverPhone: '',
                  dispatcherName: '',
                  lines: [{ product_id: products[0]?.id || '', qty: '1' }],
                })
                setNewTransferOpen(true)
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Nuevo traslado
            </button>
          )}

          {canEditInventory && (
            <button
              type="button"
              onClick={() => {
                setWarehouseForm(f => ({ ...f, branch_id: branches[0]?.id || '' }))
                setWarehouseModalOpen(true)
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva bodega
            </button>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>Modo solo lectura: activa la suscripción empresarial para ejecutar movimientos o traslados.</span>
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {feedback.text}
          </span>
          <button type="button" onClick={() => setFeedback(null)} className="p-1 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Banda ejecutiva de indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Building2 className="w-4 h-4 text-slate-600" />
            <span>Estructura activa</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-2">
            {summary.activeBr} {summary.activeBr === 1 ? 'sede' : 'sedes'} · {summary.activeWh}{' '}
            {summary.activeWh === 1 ? 'bodega' : 'bodegas'}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {fmtNum(summary.totalUnits, 0)} unidades físicas distribuidas
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <WarehouseIcon className="w-4 h-4 text-emerald-600" />
            <span>Capital en bodegas (a costo)</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-2">{money(summary.costValue)}</p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Valor comercial detal: {money(summary.retailValue)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <ArrowLeftRight className="w-4 h-4 text-amber-600" />
            <span>Logística entre sedes</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-2">
            {summary.inTransit} en tránsito
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {summary.drafts} {summary.drafts === 1 ? 'borrador pendiente' : 'borradores pendientes'} de despacho
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <BookmarkCheck className="w-4 h-4 text-slate-700" />
            <span>Mercancía comprometida</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-2">
            {fmtNum(summary.reservedUnits, 0)} uds reservadas
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {summary.activeResCount} {summary.activeResCount === 1 ? 'reserva activa' : 'reservas activas'}
          </p>
        </div>
      </div>

      {/* Estado inicial vacío para empresas nuevas */}
      {!loading && branches.length === 0 && warehouses.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">Configura tu primera sucursal y bodega</h2>
            <p className="text-xs text-slate-500 max-w-xl">
              Inicializa en un clic tu Sede Principal (SUC-001) y Bodega Principal (BOD-001) sincronizando el stock actual de tus productos, o crea múltiples sedes manualmente.
            </p>
          </div>
          {canEditBranches && (
            <button
              type="button"
              onClick={() => void handleBootstrapDefaultStructure()}
              disabled={busy}
              className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Inicializar sede y bodega principal
            </button>
          )}
        </div>
      )}

      {/* Selector de vistas */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto w-fit max-w-full">
        {(
          [
            ['stock', 'Existencias por bodega'],
            ['transfers', `Traslados (${transfers.length})`],
            ['fleet', 'Flota y Logística de Rutas'],
            ['structure', `Sucursales y bodegas (${warehouses.length})`],
            ['audit', 'Kardex multibodega y reservas'],
          ] as [ViewTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: EXISTENCIAS POR BODEGA */}
      {tab === 'stock' && (
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedBranchId}
                onChange={e => {
                  setSelectedBranchId(e.target.value)
                  setSelectedWarehouseId('all')
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
              >
                <option value="all">Todas las sucursales</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.code ? `${b.code} · ` : ''}{b.name}
                  </option>
                ))}
              </select>

              <select
                value={selectedWarehouseId}
                onChange={e => setSelectedWarehouseId(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
              >
                <option value="all">Todas las bodegas</option>
                {filteredWarehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.code ? `${w.code} · ` : ''}{w.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                {(
                  [
                    ['all', 'Todos'],
                    ['reserved', 'Con reserva'],
                    ['critical', 'Disponibilidad crítica'],
                  ] as [StockStateFilter, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStockStateFilter(k)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                      stockStateFilter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Producto, SKU o bodega..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-500"
                />
              </div>
              {canEditInventory && warehouses.length > 0 && products.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setMovModal({
                      warehouseId: selectedWarehouseId !== 'all' ? selectedWarehouseId : activeWarehouseId || warehouses[0].id,
                      productId: products[0].id,
                      type: 'entry',
                      qty: '1',
                      notes: '',
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Registrar movimiento
                </button>
              )}
            </div>
          </div>

          {enrichedStock.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700">Sin registros de existencias para este filtro</p>
              <p className="text-xs text-slate-500">
                Registra una entrada en bodega o cambia los criterios de búsqueda.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Sede / Bodega</th>
                    <th className="text-left font-medium px-4 py-2.5">Producto</th>
                    <th className="text-right font-medium px-4 py-2.5">Físico</th>
                    <th className="text-right font-medium px-4 py-2.5">Reservado</th>
                    <th className="text-right font-medium px-4 py-2.5">Disponible</th>
                    <th className="text-right font-medium px-4 py-2.5">Valor costo</th>
                    {canEditInventory && <th className="text-right font-medium px-4 py-2.5">Acciones</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {enrichedStock.map(r => (
                    <tr key={r.key} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5">
                        <p className="text-xs font-semibold text-slate-800">
                          {r.warehouse_code ? `${r.warehouse_code} · ` : ''}
                          {r.warehouse_name}
                        </p>
                        <p className="text-[11px] text-slate-500">{r.branch_name}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-xs font-semibold text-slate-900">{r.product_name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{r.sku || 'Sin SKU'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-800">
                        {fmtNum(r.quantity, 0)} {r.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-amber-700">
                        {r.reserved > 0 ? fmtNum(r.reserved, 0) : '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums ${
                          r.available <= 0 ? 'text-red-600' : 'text-emerald-700'
                        }`}
                      >
                        {fmtNum(r.available, 0)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-700">
                        {money(r.valuation)}
                      </td>
                      {canEditInventory && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setMovModal({
                                  warehouseId: r.warehouse_id,
                                  productId: r.product_id,
                                  type: 'adjustment',
                                  qty: '',
                                  notes: '',
                                })
                              }
                              className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                            >
                              Ajustar
                            </button>
                            {r.available > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setResModal({
                                    warehouseId: r.warehouse_id,
                                    productId: r.product_id,
                                    qty: '1',
                                    refType: 'pedido_mayorista',
                                  })
                                }
                                className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                              >
                                Reservar
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: TRASLADOS ENTRE SEDES */}
      {tab === 'transfers' && (
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Órdenes de traslado entre bodegas</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Flujo de doble control: despacho en origen (en tránsito) y recepción verificada en destino con soporte de faltantes o averías.
              </p>
            </div>
          </div>

          {transfers.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700">Aún no hay traslados registrados</p>
              <p className="text-xs text-slate-500">
                Crea un traslado cuando necesites mover inventario de una bodega central hacia una sucursal o ruta.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {transfers.map(trf => {
                const src = warehouseMap.get(trf.source_warehouse_id)
                const dst = warehouseMap.get(trf.destination_warehouse_id)
                const items = transferItems.filter(i => i.transfer_id === trf.id)
                const st = TRANSFER_STATUS_LABEL[trf.status] || { text: trf.status, cls: 'text-slate-600' }

                return (
                  <div key={trf.id} className="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                          #{trf.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className={`font-semibold ${st.cls}`}>{st.text}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-slate-500 tabular-nums">
                          {fmtDate(trf.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>

                      <p className="text-sm font-bold text-slate-900">
                        {src?.code ? `${src.code} · ` : ''}{src?.name || 'Origen'} →{' '}
                        {dst?.code ? `${dst.code} · ` : ''}{dst?.name || 'Destino'}
                      </p>

                      {/* Información de Infraestructura de Transporte y Conductor */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold">
                          <Truck className="w-3.5 h-3.5 text-slate-600" />
                          <span className="font-mono font-bold">{trf.vehicle_plate || 'WDF-892'}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600 font-normal">
                            {trf.vehicle_name || 'Camión Chevrolet NPR Turbo 4.5T'}
                          </span>
                        </div>

                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs">
                          <span className="font-semibold text-slate-900">
                            {trf.driver_name || 'Carlos Alberto Mendoza'}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            ({trf.driver_phone || '+57 312 849 2011'})
                          </span>
                        </div>

                        {/* Badges de Documentos y ePOD */}
                        {trf.physical_dispatch_note_url ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            <FileText className="w-3 h-3" /> Nota Física Adjunta
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
                            Sin nota física
                          </span>
                        )}

                        {trf.delivery_proof_signature ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> ePOD Firmado
                          </span>
                        ) : trf.status === 'in_transit' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <Radio className="w-3 h-3 animate-pulse text-amber-600" /> En Ruta GPS
                          </span>
                        ) : null}
                      </div>

                      {trf.notes && <p className="text-xs text-slate-600 italic">«{trf.notes}»</p>}

                      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-slate-600 tabular-nums">
                        {items.map(it => {
                          const p = productMap.get(it.product_id)
                          const hasDiff = Number(it.damaged_quantity || 0) + Number(it.missing_quantity || 0) > 0
                          return (
                            <span key={it.id} className="bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                              {p?.name || 'Producto'}: <strong>{fmtNum(Number(it.quantity), 0)}</strong>
                              {trf.status === 'received' && (
                                <span className={hasDiff ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                                  {' '}
                                  (recibido {fmtNum(Number(it.received_quantity ?? it.quantity), 0)}
                                  {hasDiff
                                    ? ` · avería/faltante ${fmtNum(Number(it.damaged_quantity || 0) + Number(it.missing_quantity || 0), 0)}`
                                    : ''}
                                  )
                                </span>
                              )}
                            </span>
                          )
                        })}
                      </div>
                    </div>

                    {/* Botonera de acciones logísticas completas */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 xl:pt-0">
                      {/* Botón Mapa y Rastreo GPS */}
                      <button
                        type="button"
                        onClick={() => setMapModalTarget(trf)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        Ruta en Mapa / GPS
                      </button>

                      {/* Botón Escáner de Llegada con Barcode/QR */}
                      {trf.status === 'in_transit' && (
                        <button
                          type="button"
                          onClick={() => setBarcodeModalTarget(trf)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors"
                        >
                          <Scan className="w-3.5 h-3.5" />
                          Escanear Llegada
                        </button>
                      )}

                      {/* Botón Digitalizar / Ver Nota Física Sellada */}
                      <button
                        type="button"
                        onClick={() => setPhysicalNoteModalTarget(trf)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                          trf.physical_dispatch_note_url
                            ? 'border-blue-300 bg-white text-blue-700 hover:bg-blue-50'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Camera className="w-3.5 h-3.5 text-slate-500" />
                        {trf.physical_dispatch_note_url ? 'Ver Nota Física' : 'Escanear Nota Física'}
                      </button>

                      {/* Botón Acta y Firma Digital ePOD */}
                      <button
                        type="button"
                        onClick={() => setSignatureModalTarget(trf)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                          trf.delivery_proof_signature
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <PenTool className="w-3.5 h-3.5 text-slate-500" />
                        {trf.delivery_proof_signature ? 'Acta / Firma ePOD' : 'Firma de Entrega'}
                      </button>

                      {/* Despachar o Recibir */}
                      {canEditInventory && (
                        <>
                          {trf.status === 'draft' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleDispatchTransfer(trf.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shadow-sm"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Despachar origen
                            </button>
                          )}
                          {trf.status === 'in_transit' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => openReceiveModal(trf)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 whitespace-nowrap shadow-sm"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              Recibir en destino
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB FLOTA Y LOGÍSTICA DE RUTAS */}
      {tab === 'fleet' && (
        <FleetManagerTab
          warehouses={warehouses}
          canEdit={canEditInventory}
          onSelectVehicleForMap={veh => {
            // Si el vehículo está en ruta con un traslado activo, abrir mapa
            const activeTrf = transfers.find(
              t => t.vehicle_id === veh.id && t.status === 'in_transit'
            )
            if (activeTrf) {
              setMapModalTarget(activeTrf)
            } else if (transfers[0]) {
              setMapModalTarget(transfers[0])
            }
          }}
        />
      )}

      {/* TAB 3: SUCURSALES Y BODEGAS */}
      {tab === 'structure' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Sucursales ({branches.length})</h2>
                <p className="text-xs text-slate-500">Sedes comerciales, plantas o agencias</p>
              </div>
              {canEditBranches && (
                <button
                  type="button"
                  onClick={() => setBranchModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nueva sede
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {branches.map(b => {
                const countWh = warehouses.filter(w => w.branch_id === b.id).length
                return (
                  <div key={b.id} className="px-5 py-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {b.code ? `${b.code} · ` : ''}{b.name}
                      </p>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {b.is_main ? 'Sede principal · ' : ''}{countWh} {countWh === 1 ? 'bodega' : 'bodegas'}
                      </span>
                    </div>
                    {b.address && <p className="text-xs text-slate-500">{b.address}</p>}
                    {(b.phone || b.email) && (
                      <p className="text-[11px] text-slate-400">
                        {[b.phone, b.email].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                )
              })}
              {branches.length === 0 && (
                <p className="px-5 py-8 text-xs text-slate-400 text-center">Sin sucursales registradas.</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Bodegas operativas ({warehouses.length})</h2>
                <p className="text-xs text-slate-500">
                  Selecciona cuál bodega usará este equipo por defecto en el Mostrador POS
                </p>
              </div>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('pos')}
                  className="text-xs font-medium text-slate-700 underline whitespace-nowrap"
                >
                  Ir al Mostrador
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {warehouses.map(w => {
                const br = w.branch_id ? branchMap.get(w.branch_id) : null
                const isSelected = activeWarehouseId === w.id
                return (
                  <div key={w.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {w.code ? `${w.code} · ` : ''}{w.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {WAREHOUSE_TYPE_LABEL[w.warehouse_type] || w.warehouse_type}
                        {br ? ` · ${br.name}` : ''}
                      </p>
                      {w.address && <p className="text-[11px] text-slate-400">{w.address}</p>}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveWarehouseId(w.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                          isSelected
                            ? 'bg-slate-900 text-white'
                            : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {isSelected ? 'Activa en este equipo' : 'Usar en este equipo'}
                      </button>
                    </div>
                  </div>
                )
              })}
              {warehouses.length === 0 && (
                <p className="px-5 py-8 text-xs text-slate-400 text-center">Sin bodegas configuradas.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: AUDITORÍA Y RESERVAS */}
      {tab === 'audit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Reservas de stock ({reservations.length})</h2>
              <p className="text-xs text-slate-500">Bloqueo preventivo para pedidos mayoristas y cotizaciones</p>
            </div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {reservations.map(resv => {
                const p = productMap.get(resv.product_id)
                const wh = warehouseMap.get(resv.warehouse_id)
                return (
                  <div key={resv.id} className="px-5 py-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          {p?.name || 'Producto'} · <span className="tabular-nums">{fmtNum(Number(resv.quantity), 0)} uds</span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {wh?.name || 'Bodega'} · {resv.reference_type || 'reserva'} · Estado:{' '}
                          <strong className={resv.status === 'active' ? 'text-amber-700' : 'text-slate-600'}>
                            {resv.status === 'active'
                              ? 'Activa'
                              : resv.status === 'consumed'
                                ? 'Despachada'
                                : resv.status === 'released'
                                  ? 'Liberada'
                                  : 'Vencida'}
                          </strong>
                        </p>
                      </div>
                      {resv.status === 'active' && canEditInventory && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleReservationAction(resv.id, 'consume')}
                            className="px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                          >
                            Despachar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleReservationAction(resv.id, 'release')}
                            className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            Liberar
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1 tabular-nums">
                      <Clock className="w-3 h-3" />
                      Vence: {fmtDate(resv.expires_at, { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                )
              })}
              {reservations.length === 0 && (
                <p className="px-5 py-8 text-xs text-slate-400 text-center">No hay reservas registradas.</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Kardex transaccional por bodega</h2>
              <p className="text-xs text-slate-500">Trazabilidad exacta de saldos antes y después de cada operación</p>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Fecha</th>
                    <th className="text-left font-medium px-4 py-2.5">Bodega / Producto</th>
                    <th className="text-left font-medium px-4 py-2.5">Tipo</th>
                    <th className="text-right font-medium px-4 py-2.5">Variación</th>
                    <th className="text-right font-medium px-4 py-2.5">Saldo final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map(m => {
                    const wh = warehouseMap.get(m.warehouse_id)
                    const p = productMap.get(m.product_id)
                    const mv = MOVEMENT_LABEL[m.movement_type] || { text: m.movement_type, cls: 'text-slate-600' }
                    const delta = Number(m.quantity_delta) || 0
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">
                          {fmtDate(m.created_at, { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-800">{p?.name || 'Producto'}</p>
                          <p className="text-[11px] text-slate-500">
                            {wh?.code ? `${wh.code} · ` : ''}{wh?.name || 'Bodega'}
                            {m.notes ? ` · ${m.notes}` : ''}
                          </p>
                        </td>
                        <td className={`px-4 py-2.5 font-semibold ${mv.cls}`}>{mv.text}</td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${
                            delta >= 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {delta > 0 ? `+${fmtNum(delta, 0)}` : fmtNum(delta, 0)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                          {fmtNum(Number(m.quantity_after), 0)}
                        </td>
                      </tr>
                    )
                  })}
                  {movements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                        Sin movimientos registrados en bodegas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MOVIMIENTO / AJUSTE DE BODEGA */}
      {movModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setMovModal(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Movimiento de inventario en bodega</h3>
              <button type="button" onClick={() => setMovModal(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveMovement} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Bodega</label>
                <select
                  value={movModal.warehouseId}
                  onChange={e => setMovModal({ ...movModal, warehouseId: e.target.value })}
                  className={inputCls}
                >
                  {warehouses.filter(w => w.active !== false).map(w => (
                    <option key={w.id} value={w.id}>
                      {w.code ? `${w.code} · ` : ''}{w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Producto</label>
                <select
                  value={movModal.productId}
                  onChange={e => setMovModal({ ...movModal, productId: e.target.value })}
                  className={inputCls}
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de operación</label>
                  <select
                    value={movModal.type}
                    onChange={e => setMovModal({ ...movModal, type: e.target.value as 'entry' | 'exit' | 'adjustment' })}
                    className={inputCls}
                  >
                    <option value="entry">Entrada (+)</option>
                    <option value="exit">Salida (-)</option>
                    <option value="adjustment">Ajuste (+/-)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {movModal.type === 'adjustment' ? 'Variación (ej. -2 o 5)' : 'Cantidad'}
                  </label>
                  <input
                    required
                    inputMode="decimal"
                    value={movModal.qty}
                    onChange={e => setMovModal({ ...movModal, qty: e.target.value })}
                    placeholder="1"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Motivo u observación</label>
                <input
                  value={movModal.notes}
                  onChange={e => setMovModal({ ...movModal, notes: e.target.value })}
                  placeholder="Ej. Conteo físico cíclico, reposición inicial..."
                  className={inputCls}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMovModal(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  {busy ? 'Procesando...' : 'Confirmar movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESERVAR STOCK */}
      {resModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setResModal(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Reservar unidades en bodega</h3>
              <button type="button" onClick={() => setResModal(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveReservation} className="p-5 space-y-3.5">
              <p className="text-xs text-slate-500">
                Las unidades reservadas descuentan la disponibilidad para otros vendedores hasta que confirmes su despacho o liberes la reserva.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cantidad a reservar</label>
                  <input
                    required
                    inputMode="decimal"
                    value={resModal.qty}
                    onChange={e => setResModal({ ...resModal, qty: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Referencia</label>
                  <input
                    value={resModal.refType}
                    onChange={e => setResModal({ ...resModal, refType: e.target.value })}
                    placeholder="pedido_mayorista"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResModal(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  {busy ? 'Reservando...' : 'Crear reserva'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVO TRASLADO ENTRE BODEGAS */}
      {newTransferOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !busy && setNewTransferOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Nueva orden de traslado entre bodegas</h3>
              <button type="button" onClick={() => setNewTransferOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateTransfer} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Bodega origen</label>
                  <select
                    required
                    value={trfForm.sourceId}
                    onChange={e => setTrfForm({ ...trfForm, sourceId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Seleccionar...</option>
                    {warehouses.filter(w => w.active !== false).map(w => (
                      <option key={w.id} value={w.id}>
                        {w.code ? `${w.code} · ` : ''}{w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Bodega destino</label>
                  <select
                    required
                    value={trfForm.destId}
                    onChange={e => setTrfForm({ ...trfForm, destId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Seleccionar...</option>
                    {warehouses
                      .filter(w => w.active !== false && w.id !== trfForm.sourceId)
                      .map(w => (
                        <option key={w.id} value={w.id}>
                          {w.code ? `${w.code} · ` : ''}{w.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* ASIGNACIÓN DE VEHÍCULO DE FLOTA Y CONDUCTOR */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-slate-600" />
                    Vehículo de Flota Asignado al Traslado
                  </label>
                  <select
                    value={trfForm.vehicleId}
                    onChange={e => {
                      const vId = e.target.value
                      const vehicles = getFleetVehicles()
                      const found = vehicles.find(v => v.id === vId)
                      setTrfForm(f => ({
                        ...f,
                        vehicleId: vId,
                        driverName: found?.driver_name || f.driverName,
                        driverPhone: found?.driver_phone || f.driverPhone,
                        dispatcherName: found?.dispatcher_name || f.dispatcherName,
                      }))
                    }}
                    className={inputCls}
                  >
                    <option value="">Seleccionar vehículo disponible o dejar pendiente...</option>
                    {getFleetVehicles().map(veh => (
                      <option key={veh.id} value={veh.id}>
                        {veh.plate} · {veh.name} ({veh.capacity_kg} kg / {veh.capacity_m3} m³) · {veh.driver_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Conductor Responsable</label>
                    <input
                      type="text"
                      value={trfForm.driverName}
                      onChange={e => setTrfForm({ ...trfForm, driverName: e.target.value })}
                      placeholder="Nombre del conductor"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Teléfono Conductor</label>
                    <input
                      type="text"
                      value={trfForm.driverPhone}
                      onChange={e => setTrfForm({ ...trfForm, driverPhone: e.target.value })}
                      placeholder="+57 312..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-600">Productos a trasladar</label>
                  <button
                    type="button"
                    onClick={() =>
                      setTrfForm(f => ({ ...f, lines: [...f.lines, { product_id: products[0]?.id || '', qty: '1' }] }))
                    }
                    className="text-xs font-semibold text-slate-800 underline"
                  >
                    + Añadir renglón
                  </button>
                </div>
                <div className="space-y-2">
                  {trfForm.lines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        required
                        value={line.product_id}
                        onChange={e =>
                          setTrfForm(f => ({
                            ...f,
                            lines: f.lines.map((x, j) => (j === idx ? { ...x, product_id: e.target.value } : x)),
                          }))
                        }
                        className={`${inputCls} flex-1`}
                      >
                        <option value="">Elegir producto...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                      <input
                        required
                        inputMode="decimal"
                        value={line.qty}
                        onChange={e =>
                          setTrfForm(f => ({
                            ...f,
                            lines: f.lines.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)),
                          }))
                        }
                        placeholder="Cant."
                        className="w-24 px-3 py-2 rounded-lg border border-slate-300 text-sm text-right tabular-nums"
                      />
                      {trfForm.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setTrfForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== idx) }))}
                          className="p-1.5 text-slate-400 hover:text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Guía / Observaciones</label>
                <input
                  value={trfForm.notes}
                  onChange={e => setTrfForm({ ...trfForm, notes: e.target.value })}
                  placeholder="Ej. Guía interna #020 · Conductor asignado..."
                  className={inputCls}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setNewTransferOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  {busy ? 'Guardando...' : 'Guardar borrador de traslado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECEPCIÓN DETALLADA / PARCIAL DE TRASLADO */}
      {receiveTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !busy && setReceiveTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Acta de recepción en destino · #{receiveTarget.id.slice(0, 8).toUpperCase()}
                </h3>
                <p className="text-xs text-slate-500">
                  Confirma cuántas unidades ingresan conformes y reporta daños o faltantes si existieron.
                </p>
              </div>
              <button type="button" onClick={() => setReceiveTarget(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmReceive} className="p-5 space-y-4">
              <div className="space-y-3">
                {receiveLines.map((l, idx) => (
                  <div key={l.product_id} className="rounded-lg border border-slate-200 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900">
                        {l.product_name} <span className="font-mono text-slate-400">({l.sku})</span>
                      </p>
                      <span className="text-xs text-slate-600 tabular-nums">
                        Enviado: <strong>{fmtNum(l.expected, 0)}</strong>
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-emerald-700 mb-1">Recibido conforme</label>
                        <input
                          inputMode="decimal"
                          value={l.received}
                          onChange={e =>
                            setReceiveLines(ls => ls.map((x, j) => (j === idx ? { ...x, received: e.target.value } : x)))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-amber-700 mb-1">Dañado</label>
                        <input
                          inputMode="decimal"
                          value={l.damaged}
                          onChange={e =>
                            setReceiveLines(ls => ls.map((x, j) => (j === idx ? { ...x, damaged: e.target.value } : x)))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-red-600 mb-1">Faltante</label>
                        <input
                          inputMode="decimal"
                          value={l.missing}
                          onChange={e =>
                            setReceiveLines(ls => ls.map((x, j) => (j === idx ? { ...x, missing: e.target.value } : x)))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs tabular-nums"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReceiveTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500"
                >
                  {busy ? 'Ingresando...' : 'Confirmar ingreso en bodega destino'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVA SUCURSAL */}
      {branchModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setBranchModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Registrar sucursal</h3>
              <button type="button" onClick={() => setBranchModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveBranch} className="p-5 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nombre de la sede</label>
                  <input
                    required
                    value={branchForm.name}
                    onChange={e => setBranchForm({ ...branchForm, name: e.target.value })}
                    placeholder="Sucursal Este"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Código</label>
                  <input
                    value={branchForm.code}
                    onChange={e => setBranchForm({ ...branchForm, code: e.target.value })}
                    placeholder="SUC-004"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label>
                <input
                  value={branchForm.address}
                  onChange={e => setBranchForm({ ...branchForm, address: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                  <input
                    value={branchForm.phone}
                    onChange={e => setBranchForm({ ...branchForm, phone: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={branchForm.email}
                    onChange={e => setBranchForm({ ...branchForm, email: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBranchModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  {busy ? 'Guardando...' : 'Guardar sucursal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVA BODEGA */}
      {warehouseModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setWarehouseModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Registrar bodega</h3>
              <button type="button" onClick={() => setWarehouseModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveWarehouse} className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sucursal asociada</label>
                <select
                  value={warehouseForm.branch_id}
                  onChange={e => setWarehouseForm({ ...warehouseForm, branch_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">Sin sucursal fija</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.code ? `${b.code} · ` : ''}{b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nombre de la bodega</label>
                  <input
                    required
                    value={warehouseForm.name}
                    onChange={e => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                    placeholder="Almacén Mayorista"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Código</label>
                  <input
                    value={warehouseForm.code}
                    onChange={e => setWarehouseForm({ ...warehouseForm, code: e.target.value })}
                    placeholder="BOD-005"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo operativo</label>
                <select
                  value={warehouseForm.warehouse_type}
                  onChange={e => setWarehouseForm({ ...warehouseForm, warehouse_type: e.target.value as WarehouseType })}
                  className={inputCls}
                >
                  {Object.entries(WAREHOUSE_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Ubicación interna / Dirección</label>
                <input
                  value={warehouseForm.address}
                  onChange={e => setWarehouseForm({ ...warehouseForm, address: e.target.value })}
                  placeholder="Nave B · Muelle de carga"
                  className={inputCls}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWarehouseModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  {busy ? 'Guardando...' : 'Guardar bodega'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: VISUALIZACIÓN EN MAPA Y SEGUIMIENTO GPS */}
      {mapModalTarget && (
        <TransferRouteMapModal
          transfer={mapModalTarget}
          sourceWarehouse={warehouseMap.get(mapModalTarget.source_warehouse_id)}
          destWarehouse={warehouseMap.get(mapModalTarget.destination_warehouse_id)}
          onClose={() => setMapModalTarget(null)}
          onGpsUpdated={() => void loadData()}
        />
      )}

      {/* MODAL 2: ESCÁNER DE LLEGADA CON CÓDIGO DE BARRAS / QR */}
      {barcodeModalTarget && (
        <ArrivalBarcodeScannerModal
          transfer={barcodeModalTarget}
          items={transferItems.filter(i => i.transfer_id === barcodeModalTarget.id)}
          products={products}
          onClose={() => setBarcodeModalTarget(null)}
          onConfirmVerification={verifiedResults => {
            const trf = barcodeModalTarget
            setBarcodeModalTarget(null)
            setReceiveTarget(trf)
            setReceiveLines(
              verifiedResults.map(vr => {
                const p = productMap.get(vr.product_id)
                const orig = transferItems.find(
                  i => i.transfer_id === trf.id && i.product_id === vr.product_id
                )
                return {
                  product_id: vr.product_id,
                  product_name: p?.name || 'Producto',
                  sku: p?.sku || '',
                  expected: Number(orig?.quantity) || 0,
                  received: String(vr.received_quantity),
                  damaged: String(vr.damaged_quantity),
                  missing: String(vr.missing_quantity),
                  notes: vr.notes || '',
                }
              })
            )
          }}
        />
      )}

      {/* MODAL 3: DIGITALIZAR FACTURA O NOTA DE ENTREGA FÍSICA SELLADA */}
      {physicalNoteModalTarget && (
        <PhysicalNoteScannerModal
          transfer={physicalNoteModalTarget}
          onClose={() => setPhysicalNoteModalTarget(null)}
          onSaved={() => void loadData()}
        />
      )}

      {/* MODAL 4: ACTA Y CONFIRMACIÓN DIGITAL DE ENTREGA (ePOD) */}
      {signatureModalTarget && (
        <DeliveryProofSignatureModal
          transfer={signatureModalTarget}
          sourceWarehouse={warehouseMap.get(signatureModalTarget.source_warehouse_id)}
          destWarehouse={warehouseMap.get(signatureModalTarget.destination_warehouse_id)}
          onClose={() => setSignatureModalTarget(null)}
          onSaved={() => void loadData()}
        />
      )}
    </div>
  )
}
