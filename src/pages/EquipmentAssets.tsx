import { useEffect, useState } from 'react'
import {
  Wrench,
  Truck,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Building2,
  Calendar,
  DollarSign,
  Search,
  Filter,
  X,
} from 'lucide-react'
import { useCurrency, fmtDate } from '../lib/currency'
import { getEquipmentAssets, saveEquipmentAsset } from '../lib/innovationsRepo'
import type { EquipmentAsset, AssetStatus, MaintenanceStatus } from '../types'

interface EquipmentAssetsProps {
  onNavigate?: (page: string) => void
}

const CATEGORY_LABELS = {
  vehiculo: 'Vehículo de reparto',
  frio_congelador: 'Refrigeración y frío',
  balanza: 'Balanza / Báscula',
  impresora_pos: 'Impresora térmica POS',
  computo: 'Terminal de cómputo',
  maquinaria: 'Maquinaria de planta',
}

export default function EquipmentAssets({ onNavigate }: EquipmentAssetsProps) {
  const { fmt } = useCurrency()
  const [assets, setAssets] = useState<EquipmentAsset[]>([])
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newAsset, setNewAsset] = useState<Partial<EquipmentAsset>>({
    category: 'vehiculo',
    status: 'operativo',
    maintenance_interval_days: 90,
  })

  useEffect(() => {
    setAssets(getEquipmentAssets())
  }, [])

  const filtered = assets.filter(
    a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.asset_code.toLowerCase().includes(search.toLowerCase())
  )

  function handleCreateAsset() {
    if (!newAsset.name || !newAsset.asset_code) {
      alert('Por favor indica código y nombre del activo')
      return
    }

    const created: EquipmentAsset = {
      id: `asset-${Date.now().toString(36)}`,
      company_id: '00000000-0000-4000-8000-000000000001',
      asset_code: newAsset.asset_code.toUpperCase(),
      name: newAsset.name,
      category: newAsset.category as any,
      serial_number: newAsset.serial_number || 'S/N',
      branch_id: 'b-central',
      branch_name: 'Bodega Principal',
      purchase_date: new Date().toISOString().split('T')[0],
      warranty_expires_at: null,
      acquisition_cost: Number(newAsset.acquisition_cost || 0),
      status: 'operativo',
      maintenance_interval_days: Number(newAsset.maintenance_interval_days || 90),
      last_maintenance_at: new Date().toISOString().split('T')[0],
      next_maintenance_at: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
      maintenance_status: 'al_dia',
      notes: newAsset.notes || '',
    }

    const updated = saveEquipmentAsset(created)
    setAssets(updated)
    setShowAddModal(false)
    setNewAsset({ category: 'vehiculo', status: 'operativo', maintenance_interval_days: 90 })
  }

  function handleCompleteMaintenance(asset: EquipmentAsset) {
    const nextDate = new Date(Date.now() + asset.maintenance_interval_days * 86400000)
      .toISOString()
      .split('T')[0]

    const updatedAsset: EquipmentAsset = {
      ...asset,
      last_maintenance_at: new Date().toISOString().split('T')[0],
      next_maintenance_at: nextDate,
      maintenance_status: 'al_dia',
    }

    const updated = saveEquipmentAsset(updatedAsset)
    setAssets(updated)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-100 text-cyan-800 rounded-xl">
            <Wrench className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Gestión de Maquinaria, Activos y Mantenimiento
            </h1>
            <p className="text-xs text-slate-500">
              Control preventivo de vehículos de reparto, balanzas, congeladores y equipos POS para evitar paradas operativas.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nuevo Activo / Máquina
        </button>
      </div>

      {/* Buscador */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por código o nombre de equipo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      </div>

      {/* Grid de Activos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(asset => {
          const isOverdue = asset.maintenance_status === 'vencido'
          const isNear = asset.maintenance_status === 'proximo'

          return (
            <div
              key={asset.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-md">
                      {asset.asset_code}
                    </span>
                    <h3 className="font-bold text-slate-900 text-sm mt-1">{asset.name}</h3>
                    <p className="text-[11px] text-slate-400">
                      {CATEGORY_LABELS[asset.category] || asset.category} • S/N: {asset.serial_number}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      isOverdue
                        ? 'bg-red-100 text-red-800'
                        : isNear
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {isOverdue ? 'VENCIDO' : isNear ? 'PRÓXIMO' : 'AL DÍA'}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Sede asignada:</span>
                    <span className="font-semibold text-slate-700">{asset.branch_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Último servicio:</span>
                    <span className="font-medium">{fmtDate(asset.last_maintenance_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Próximo servicio:</span>
                    <span className="font-bold text-slate-900">{fmtDate(asset.next_maintenance_at)}</span>
                  </div>
                  {asset.odometer_or_hours && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Kilometraje / Horas:</span>
                      <span className="font-mono font-bold">{asset.odometer_or_hours.toLocaleString()} km</span>
                    </div>
                  )}
                  {asset.notes && (
                    <p className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg mt-2">
                      {asset.notes}
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Costo: {fmt(asset.acquisition_cost)}
                </span>

                <button
                  onClick={() => handleCompleteMaintenance(asset)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Registrar Servicio
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Nuevo Activo */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800 text-base">Registrar Nuevo Activo</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 mb-1">Código de Activo</label>
                <input
                  type="text"
                  placeholder="Ej: VEH-02 o BAL-04"
                  value={newAsset.asset_code || ''}
                  onChange={e => setNewAsset({ ...newAsset, asset_code: e.target.value })}
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Nombre o Descripción</label>
                <input
                  type="text"
                  placeholder="Ej: Balanza Digital de Precisión Mostrador 2"
                  value={newAsset.name || ''}
                  onChange={e => setNewAsset({ ...newAsset, name: e.target.value })}
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Categoría</label>
                  <select
                    value={newAsset.category}
                    onChange={e => setNewAsset({ ...newAsset, category: e.target.value as any })}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  >
                    <option value="vehiculo">Vehículo de reparto</option>
                    <option value="frio_congelador">Refrigeración / Frío</option>
                    <option value="balanza">Balanza / Báscula</option>
                    <option value="impresora_pos">Impresora POS</option>
                    <option value="computo">Cómputo / Pantalla</option>
                    <option value="maquinaria">Maquinaria general</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Intervalo Mantenimiento</label>
                  <input
                    type="number"
                    placeholder="Días (ej: 90)"
                    value={newAsset.maintenance_interval_days || 90}
                    onChange={e => setNewAsset({ ...newAsset, maintenance_interval_days: Number(e.target.value) })}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Costo de Adquisición ($)</label>
                <input
                  type="number"
                  placeholder="Ej: 1200000"
                  value={newAsset.acquisition_cost || ''}
                  onChange={e => setNewAsset({ ...newAsset, acquisition_cost: Number(e.target.value) })}
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1.5 text-xs text-slate-500 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateAsset}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Guardar Activo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
