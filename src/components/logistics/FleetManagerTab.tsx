import { useState } from 'react'
import type { FleetVehicle, VehicleMaintenanceRecord, Warehouse, VehicleOperationalStatus } from '../../types'
import {
  getFleetVehicles,
  saveFleetVehicle,
  deleteFleetVehicle,
  getVehicleMaintenanceRecords,
  saveVehicleMaintenanceRecord,
} from '../../lib/fleetRepo'
import { useCurrency } from '../../lib/currency'
import {
  Truck,
  Plus,
  Wrench,
  ShieldCheck,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Phone,
  User,
  Gauge,
  MapPin,
  Radio,
  FileText,
  Trash2,
  Edit2,
  Clock,
  Building2,
  X,
  Search,
} from 'lucide-react'

interface FleetManagerTabProps {
  warehouses: Warehouse[]
  canEdit: boolean
  onSelectVehicleForMap?: (vehicle: FleetVehicle) => void
}

const STATUS_CONFIG: Record<
  VehicleOperationalStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  operativo: {
    label: 'Operativo / Disponible',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
  },
  en_ruta: {
    label: 'En Ruta / Despacho Activo',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
  },
  en_taller: {
    label: 'En Mantenimiento / Taller',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
  },
  inactivo: {
    label: 'Inactivo / Baja Temporal',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
  },
}

export default function FleetManagerTab({
  warehouses,
  canEdit,
  onSelectVehicleForMap,
}: FleetManagerTabProps) {
  const { fmt: money } = useCurrency()
  const [vehicles, setVehicles] = useState<FleetVehicle[]>(() => getFleetVehicles())
  const [maintenances, setMaintenances] = useState<VehicleMaintenanceRecord[]>(() =>
    getVehicleMaintenanceRecords()
  )

  const [search, setSearch] = useState('')
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState('all')
  const [selectedVehicleForHistory, setSelectedVehicleForHistory] = useState<FleetVehicle | null>(
    null
  )

  // Modal para crear / editar vehículo
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<FleetVehicle | null>(null)
  const [vehicleForm, setVehicleForm] = useState<Partial<FleetVehicle>>({
    name: '',
    plate: '',
    brand_model: '',
    vehicle_type: 'camion',
    capacity_kg: 3500,
    capacity_m3: 14,
    odometer_km: 10000,
    warehouse_id: warehouses[0]?.id || '',
    driver_name: '',
    driver_phone: '',
    driver_license: 'C2',
    dispatcher_name: '',
    status: 'operativo',
    soat_expires_at: new Date(Date.now() + 300 * 86400000).toISOString().split('T')[0],
    rtm_expires_at: new Date(Date.now() + 250 * 86400000).toISOString().split('T')[0],
    insurance_policy: '',
    notes: '',
  })

  // Modal para agregar mantenimiento
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false)
  const [maintenanceForm, setMaintenanceForm] = useState<Partial<VehicleMaintenanceRecord>>({
    maintenance_type: 'preventivo',
    description: '',
    cost: 350000,
    odometer_km: 0,
    performed_at: new Date().toISOString().split('T')[0],
    workshop_name: '',
    performed_by: '',
    next_due_date: new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0],
    next_due_km: 0,
  })

  const openNewVehicleModal = () => {
    setEditingVehicle(null)
    setVehicleForm({
      name: '',
      plate: '',
      brand_model: '',
      vehicle_type: 'camion',
      capacity_kg: 3500,
      capacity_m3: 14,
      odometer_km: 10000,
      warehouse_id: warehouses[0]?.id || '',
      driver_name: '',
      driver_phone: '',
      driver_license: 'C2',
      dispatcher_name: '',
      status: 'operativo',
      soat_expires_at: new Date(Date.now() + 300 * 86400000).toISOString().split('T')[0],
      rtm_expires_at: new Date(Date.now() + 250 * 86400000).toISOString().split('T')[0],
      insurance_policy: 'Póliza Empresarial Todo Riesgo',
      notes: '',
    })
    setVehicleModalOpen(true)
  }

  const openEditVehicleModal = (veh: FleetVehicle) => {
    setEditingVehicle(veh)
    setVehicleForm({ ...veh })
    setVehicleModalOpen(true)
  }

  const handleSaveVehicle = (e: React.FormEvent) => {
    e.preventDefault()
    if (!vehicleForm.name || !vehicleForm.plate) return

    const wh = warehouses.find(w => w.id === vehicleForm.warehouse_id)
    const payload: FleetVehicle = {
      id: editingVehicle ? editingVehicle.id : `veh-${Date.now()}`,
      company_id: 'c-demo-1',
      name: vehicleForm.name.trim(),
      plate: vehicleForm.plate.trim().toUpperCase(),
      brand_model: vehicleForm.brand_model?.trim() || '',
      vehicle_type: vehicleForm.vehicle_type || 'camion',
      capacity_kg: Number(vehicleForm.capacity_kg) || 0,
      capacity_m3: Number(vehicleForm.capacity_m3) || 0,
      odometer_km: Number(vehicleForm.odometer_km) || 0,
      warehouse_id: vehicleForm.warehouse_id || warehouses[0]?.id || '',
      warehouse_name: wh?.name || 'Bodega Asignada',
      driver_name: vehicleForm.driver_name?.trim() || 'Conductor por asignar',
      driver_phone: vehicleForm.driver_phone?.trim() || '',
      driver_license: vehicleForm.driver_license?.trim() || 'C2',
      dispatcher_name: vehicleForm.dispatcher_name?.trim() || '',
      status: vehicleForm.status || 'operativo',
      soat_expires_at: vehicleForm.soat_expires_at || '',
      rtm_expires_at: vehicleForm.rtm_expires_at || '',
      insurance_policy: vehicleForm.insurance_policy || '',
      notes: vehicleForm.notes || '',
      created_at: editingVehicle ? editingVehicle.created_at : new Date().toISOString(),
    }

    const updated = saveFleetVehicle(payload)
    setVehicles(updated)
    setVehicleModalOpen(false)
  }

  const handleDeleteVehicle = (id: string) => {
    if (confirm('¿Deseas retirar este vehículo de la flota activa?')) {
      const updated = deleteFleetVehicle(id)
      setVehicles(updated)
      if (selectedVehicleForHistory?.id === id) {
        setSelectedVehicleForHistory(null)
      }
    }
  }

  const openNewMaintenance = (veh: FleetVehicle) => {
    setSelectedVehicleForHistory(veh)
    setMaintenanceForm({
      vehicle_id: veh.id,
      maintenance_type: 'preventivo',
      description: '',
      cost: 450000,
      odometer_km: veh.odometer_km,
      performed_at: new Date().toISOString().split('T')[0],
      workshop_name: 'Taller Autorizado Central',
      performed_by: 'Mecánico de Turno',
      next_due_date: new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0],
      next_due_km: veh.odometer_km + 5000,
    })
    setMaintenanceModalOpen(true)
  }

  const handleSaveMaintenance = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedVehicleForHistory || !maintenanceForm.description) return

    const newMaint: VehicleMaintenanceRecord = {
      id: `maint-${Date.now()}`,
      vehicle_id: selectedVehicleForHistory.id,
      maintenance_type: maintenanceForm.maintenance_type || 'preventivo',
      description: maintenanceForm.description.trim(),
      cost: Number(maintenanceForm.cost) || 0,
      odometer_km: Number(maintenanceForm.odometer_km) || selectedVehicleForHistory.odometer_km,
      performed_at: maintenanceForm.performed_at || new Date().toISOString().split('T')[0],
      workshop_name: maintenanceForm.workshop_name?.trim() || 'Taller Central',
      performed_by: maintenanceForm.performed_by?.trim() || 'Técnico Especialista',
      next_due_date: maintenanceForm.next_due_date,
      next_due_km: Number(maintenanceForm.next_due_km) || undefined,
    }

    const updated = saveVehicleMaintenanceRecord(newMaint)
    setMaintenances(updated)

    // Actualizar también el odómetro y fecha de último mantenimiento en el vehículo
    const updatedVehicles = saveFleetVehicle({
      ...selectedVehicleForHistory,
      odometer_km: Math.max(selectedVehicleForHistory.odometer_km, newMaint.odometer_km),
      last_maintenance_at: newMaint.performed_at,
      next_maintenance_km: newMaint.next_due_km,
    })
    setVehicles(updatedVehicles)
    setMaintenanceModalOpen(false)
  }

  // Filtrado de vehículos
  const filteredVehicles = vehicles.filter(v => {
    const matchesSearch =
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.plate.toLowerCase().includes(search.toLowerCase()) ||
      v.driver_name.toLowerCase().includes(search.toLowerCase())
    const matchesWarehouse =
      selectedWarehouseFilter === 'all' || v.warehouse_id === selectedWarehouseFilter
    return matchesSearch && matchesWarehouse
  })

  return (
    <div className="space-y-6">
      {/* Barra Superior con Métricas y Filtros */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-slate-800" />
              Gestión de Flota, Activos de Transporte y Mantenimiento
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Control de vehículos vinculados a bodegas, tripulación asignada, odómetros, SOAT,
              tecnomecánica y bitácora técnica
            </p>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={openNewVehicleModal}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow flex items-center gap-2 shrink-0 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Registrar Vehículo de Flota
            </button>
          )}
        </div>

        {/* Filtros rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por placa, modelo, conductor..."
              className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              value={selectedWarehouseFilter}
              onChange={e => setSelectedWarehouseFilter(e.target.value)}
              className="w-full py-2 px-3 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-slate-900"
            >
              <option value="all">Todas las Bodegas Conectadas</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Grid de Vehículos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredVehicles.map(veh => {
          const wh = warehouses.find(w => w.id === veh.warehouse_id)
          const st = STATUS_CONFIG[veh.status] || STATUS_CONFIG.operativo
          const vehMaints = maintenances.filter(m => m.vehicle_id === veh.id)

          // Cálculo de alertas de vencimiento SOAT y RTM
          const soatDays = Math.round(
            (new Date(veh.soat_expires_at).getTime() - Date.now()) / 86400000
          )
          const rtmDays = Math.round(
            (new Date(veh.rtm_expires_at).getTime() - Date.now()) / 86400000
          )

          return (
            <div
              key={veh.id}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all"
            >
              <div className="p-5 space-y-4">
                {/* Cabecera de la tarjeta con placa y estatus */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-black px-2.5 py-1 bg-slate-900 text-white rounded-lg tracking-wider">
                        {veh.plate}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.bg} ${st.text} ${st.border}`}
                      >
                        {st.label}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm truncate pt-1">{veh.name}</h3>
                    <p className="text-xs text-slate-500">{veh.brand_model}</p>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditVehicleModal(veh)}
                        title="Editar vehículo"
                        className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVehicle(veh.id)}
                        title="Eliminar de flota"
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Bodega Conectada y Capacidad */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" /> Bodega Base:
                    </span>
                    <span className="font-bold text-slate-900 text-right truncate max-w-[170px]">
                      {wh?.name || veh.warehouse_name || 'No conectada'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Gauge className="w-3.5 h-3.5 text-slate-400" /> Odómetro:
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {veh.odometer_km.toLocaleString()} km
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Truck className="w-3.5 h-3.5 text-slate-400" /> Capacidad de Carga:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {veh.capacity_kg.toLocaleString()} kg · {veh.capacity_m3} m³
                    </span>
                  </div>
                </div>

                {/* Tripulación Asignada (Conductor y Despachador) */}
                <div className="space-y-1.5 text-xs">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    Tripulación Titular
                  </p>
                  <div className="text-slate-600 space-y-0.5 pl-5">
                    <p className="font-semibold text-slate-800">{veh.driver_name}</p>
                    <div className="flex items-center gap-2 text-slate-500 text-[11px]">
                      <Phone className="w-3 h-3 text-slate-400" />
                      <span>{veh.driver_phone || 'Sin teléfono'}</span>
                      <span>· Lic: {veh.driver_license}</span>
                    </div>
                    {veh.dispatcher_name && (
                      <p className="text-[11px] text-slate-500">
                        Auxiliar: <span className="font-medium text-slate-700">{veh.dispatcher_name}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Vencimientos y Mantenimiento */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div
                    className={`p-2 rounded-lg border ${
                      soatDays < 30 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>SOAT</span>
                      {soatDays < 30 && <AlertTriangle className="w-3 h-3 text-red-600" />}
                    </div>
                    <p className="font-mono mt-0.5 text-[10px]">{veh.soat_expires_at}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">
                      {soatDays > 0 ? `${soatDays} días rest.` : 'Vencido'}
                    </p>
                  </div>

                  <div
                    className={`p-2 rounded-lg border ${
                      rtmDays < 30 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>Tecnomecánica</span>
                      {rtmDays < 30 && <AlertTriangle className="w-3 h-3 text-red-600" />}
                    </div>
                    <p className="font-mono mt-0.5 text-[10px]">{veh.rtm_expires_at}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">
                      {rtmDays > 0 ? `${rtmDays} días rest.` : 'Vencido'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Botonera de acciones por vehículo */}
              <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedVehicleForHistory(veh)}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1.5"
                >
                  <Wrench className="w-3.5 h-3.5 text-slate-500" />
                  Bitácora ({vehMaints.length})
                </button>

                {canEdit && (
                  <button
                    type="button"
                    onClick={() => openNewMaintenance(veh)}
                    className="px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Mantenimiento
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Historial / Bitácora de Mantenimiento Seleccionada */}
      {selectedVehicleForHistory && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Bitácora de Mantenimiento · {selectedVehicleForHistory.plate} ({selectedVehicleForHistory.name})
                </h3>
                <p className="text-xs text-slate-500">
                  Historial de reparaciones, cambios de aceite, frenos y revisiones de taller
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedVehicleForHistory(null)}
              className="text-slate-400 hover:text-slate-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {maintenances.filter(m => m.vehicle_id === selectedVehicleForHistory.id).length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No hay registros de mantenimiento aún para este vehículo.
              </div>
            ) : (
              maintenances
                .filter(m => m.vehicle_id === selectedVehicleForHistory.id)
                .map(m => (
                  <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 uppercase">{m.maintenance_type}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-slate-600">{m.performed_at}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-slate-600">{m.odometer_km.toLocaleString()} km</span>
                      </div>
                      <p className="text-slate-700">{m.description}</p>
                      <p className="text-[11px] text-slate-400">
                        {m.workshop_name} · Técnico: {m.performed_by}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-bold text-slate-900 text-sm">{money(m.cost)}</p>
                      {m.next_due_date && (
                        <p className="text-[10px] text-slate-500">Próximo: {m.next_due_date}</p>
                      )}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* Modal Crear / Editar Vehículo */}
      {vehicleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {editingVehicle ? 'Editar Vehículo de Flota' : 'Registrar Nuevo Vehículo en Flota'}
              </h3>
              <button
                type="button"
                onClick={() => setVehicleModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVehicle} className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Placa del Vehículo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={vehicleForm.plate || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, plate: e.target.value })}
                    placeholder="Ej. WDF-892"
                    className="w-full p-2.5 border border-slate-300 rounded-xl font-mono uppercase font-bold focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Nombre Descriptivo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={vehicleForm.name || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, name: e.target.value })}
                    placeholder="Ej. Camión Turbo 4.5T"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Marca y Modelo</label>
                  <input
                    type="text"
                    value={vehicleForm.brand_model || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, brand_model: e.target.value })}
                    placeholder="Ej. Chevrolet NPR 2024"
                    className="w-full p-2.5 border border-slate-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Bodega Base Conectada <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={vehicleForm.warehouse_id}
                    onChange={e => setVehicleForm({ ...vehicleForm, warehouse_id: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-xl bg-white"
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code || 'BOD'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Capacidad (kg)</label>
                  <input
                    type="number"
                    value={vehicleForm.capacity_kg || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, capacity_kg: Number(e.target.value) })}
                    placeholder="3500"
                    className="w-full p-2.5 border border-slate-300 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Volumen (m³)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={vehicleForm.capacity_m3 || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, capacity_m3: Number(e.target.value) })}
                    placeholder="14"
                    className="w-full p-2.5 border border-slate-300 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Odómetro Actual (km)</label>
                  <input
                    type="number"
                    value={vehicleForm.odometer_km || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, odometer_km: Number(e.target.value) })}
                    placeholder="45000"
                    className="w-full p-2.5 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              {/* Tripulación */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <p className="font-bold text-slate-900 uppercase">Tripulación Asignada</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Conductor Titular</label>
                    <input
                      type="text"
                      value={vehicleForm.driver_name || ''}
                      onChange={e => setVehicleForm({ ...vehicleForm, driver_name: e.target.value })}
                      placeholder="Nombre del conductor"
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Teléfono Conductor</label>
                    <input
                      type="text"
                      value={vehicleForm.driver_phone || ''}
                      onChange={e => setVehicleForm({ ...vehicleForm, driver_phone: e.target.value })}
                      placeholder="+57 312..."
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Vencimientos Legales */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vencimiento SOAT</label>
                  <input
                    type="date"
                    value={vehicleForm.soat_expires_at || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, soat_expires_at: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vencimiento Tecnomecánica (RTM)</label>
                  <input
                    type="date"
                    value={vehicleForm.rtm_expires_at || ''}
                    onChange={e => setVehicleForm({ ...vehicleForm, rtm_expires_at: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setVehicleModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow"
                >
                  Guardar Vehículo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Mantenimiento */}
      {maintenanceModalOpen && selectedVehicleForHistory && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Registrar Mantenimiento · {selectedVehicleForHistory.plate}
              </h3>
              <button
                type="button"
                onClick={() => setMaintenanceModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMaintenance} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Tipo de Servicio</label>
                  <select
                    value={maintenanceForm.maintenance_type}
                    onChange={e =>
                      setMaintenanceForm({
                        ...maintenanceForm,
                        maintenance_type: e.target.value as any,
                      })
                    }
                    className="w-full p-2.5 border border-slate-300 rounded-xl bg-white"
                  >
                    <option value="preventivo">Mantenimiento Preventivo</option>
                    <option value="cambio_aceite">Cambio de Aceite y Filtros</option>
                    <option value="frenos">Frenos y Suspensión</option>
                    <option value="llantas">Llantas y Alineación</option>
                    <option value="correctivo">Mantenimiento Correctivo</option>
                    <option value="revision_general">Revisión General / Sincronización</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Costo Total ($)</label>
                  <input
                    type="number"
                    value={maintenanceForm.cost || ''}
                    onChange={e =>
                      setMaintenanceForm({ ...maintenanceForm, cost: Number(e.target.value) })
                    }
                    className="w-full p-2.5 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Descripción Detallada del Trabajo
                </label>
                <textarea
                  rows={3}
                  required
                  value={maintenanceForm.description || ''}
                  onChange={e =>
                    setMaintenanceForm({ ...maintenanceForm, description: e.target.value })
                  }
                  placeholder="Detalles de repuestos cambiados, mano de obra..."
                  className="w-full p-2.5 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Taller / Proveedor</label>
                  <input
                    type="text"
                    value={maintenanceForm.workshop_name || ''}
                    onChange={e =>
                      setMaintenanceForm({ ...maintenanceForm, workshop_name: e.target.value })
                    }
                    placeholder="Taller Central"
                    className="w-full p-2.5 border border-slate-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Fecha de Realización</label>
                  <input
                    type="date"
                    value={maintenanceForm.performed_at || ''}
                    onChange={e =>
                      setMaintenanceForm({ ...maintenanceForm, performed_at: e.target.value })
                    }
                    className="w-full p-2.5 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setMaintenanceModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow"
                >
                  Guardar en Bitácora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
