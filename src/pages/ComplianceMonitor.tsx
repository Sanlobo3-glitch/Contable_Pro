import { useEffect, useState } from 'react'
import {
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  ShieldAlert,
  Building2,
  Truck,
  Flame,
  Scale,
  X,
} from 'lucide-react'
import { useCurrency, fmtDate } from '../lib/currency'
import { getComplianceItems, saveComplianceItem } from '../lib/innovationsRepo'
import type { ComplianceItem, ComplianceCategory, ComplianceUrgency } from '../types'

interface ComplianceMonitorProps {
  onNavigate?: (page: string) => void
}

const CATEGORY_META: Record<ComplianceCategory, { label: string; icon: any; color: string }> = {
  camara_comercio: { label: 'Registro Mercantil', icon: Building2, color: 'text-blue-600 bg-blue-50' },
  transporte_soat: { label: 'Transporte y Vehículos', icon: Truck, color: 'text-amber-600 bg-amber-50' },
  bomberos_sanidad: { label: 'Seguridad y Sanidad', icon: Flame, color: 'text-red-600 bg-red-50' },
  impuesto_fiscal: { label: 'Tributario e Impuestos', icon: Scale, color: 'text-purple-600 bg-purple-50' },
  contrato_arriendo: { label: 'Contratos y Arriendos', icon: FileText, color: 'text-indigo-600 bg-indigo-50' },
  lote_perecedero: { label: 'Lotes de Inventario', icon: Clock, color: 'text-emerald-600 bg-emerald-50' },
}

export default function ComplianceMonitor({ onNavigate }: ComplianceMonitorProps) {
  const { fmt } = useCurrency()
  const [items, setItems] = useState<ComplianceItem[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [filterUrgency, setFilterUrgency] = useState<string>('todos')
  const [newItem, setNewItem] = useState<Partial<ComplianceItem>>({
    category: 'transporte_soat',
    urgency: 'vigente',
  })

  useEffect(() => {
    setItems(getComplianceItems())
  }, [])

  const filtered = items.filter(
    i => filterUrgency === 'todos' || i.urgency === filterUrgency
  )

  function handleCreateItem() {
    if (!newItem.title || !newItem.due_date) {
      alert('Por favor completa título y fecha de vencimiento.')
      return
    }

    const diffDays = Math.ceil(
      (new Date(newItem.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    )
    const urgency: ComplianceUrgency =
      diffDays < 0 ? 'vencido' : diffDays <= 20 ? 'proximo_vencer' : 'vigente'

    const created: ComplianceItem = {
      id: `comp-${Date.now().toString(36)}`,
      company_id: '00000000-0000-4000-8000-000000000001',
      title: newItem.title,
      category: newItem.category as any,
      due_date: newItem.due_date,
      urgency,
      days_left: diffDays,
      estimated_cost: Number(newItem.estimated_cost || 0),
      responsible_person: newItem.responsible_person || 'Administrador',
      notes: newItem.notes || '',
    }

    const updated = saveComplianceItem(created)
    setItems(updated)
    setShowAddModal(false)
    setNewItem({ category: 'transporte_soat', urgency: 'vigente' })
  }

  function handleMarkCompleted(item: ComplianceItem) {
    const updated = saveComplianceItem({
      ...item,
      completed_at: new Date().toISOString(),
      urgency: 'vigente',
      days_left: 365,
      due_date: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
    })
    setItems(updated)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-100 text-indigo-800 rounded-xl">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Cumplimiento y Vencimientos Empresariales
            </h1>
            <p className="text-xs text-slate-500">
              Calendario unificado de SOAT, Bomberos, Registro Mercantil, Pólizas de Transporte y Obligaciones Fiscales.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nuevo Vencimiento
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setFilterUrgency('todos')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
            filterUrgency === 'todos'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          Todos ({items.length})
        </button>
        <button
          onClick={() => setFilterUrgency('proximo_vencer')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
            filterUrgency === 'proximo_vencer'
              ? 'bg-amber-600 text-white'
              : 'bg-white border border-slate-200 text-amber-700 hover:bg-amber-50'
          }`}
        >
          Próximos a Vencer ({items.filter(i => i.urgency === 'proximo_vencer').length})
        </button>
        <button
          onClick={() => setFilterUrgency('vencido')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
            filterUrgency === 'vencido'
              ? 'bg-red-600 text-white'
              : 'bg-white border border-slate-200 text-red-700 hover:bg-red-50'
          }`}
        >
          Vencidos ({items.filter(i => i.urgency === 'vencido').length})
        </button>
      </div>

      {/* Grid de Vencimientos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filtered.map(item => {
          const meta = CATEGORY_META[item.category] || CATEGORY_META.camara_comercio
          const Icon = meta.icon
          const isUrgent = item.urgency === 'proximo_vencer' || item.urgency === 'vencido'

          return (
            <div
              key={item.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${meta.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                        {meta.label}
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 leading-tight">
                        {item.title}
                      </h3>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap ${
                      item.urgency === 'vencido'
                        ? 'bg-red-100 text-red-800'
                        : item.urgency === 'proximo_vencer'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {item.days_left < 0
                      ? 'VENCIDO'
                      : item.days_left === 0
                      ? 'VENCE HOY'
                      : `EN ${item.days_left} DÍAS`}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase">Fecha límite:</span>
                    <strong className="text-slate-800">{fmtDate(item.due_date)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase">Responsable:</span>
                    <span className="font-medium text-slate-700">{item.responsible_person}</span>
                  </div>
                  {item.estimated_cost ? (
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Costo est.:</span>
                      <span className="font-bold text-slate-900">{fmt(item.estimated_cost)}</span>
                    </div>
                  ) : null}
                </div>

                {item.notes && (
                  <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    {item.notes}
                  </p>
                )}
              </div>

              <div className="pt-4 border-t border-slate-100 mt-3 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {item.completed_at ? 'Renovado recientemente' : 'Requiere gestión'}
                </span>

                <button
                  onClick={() => handleMarkCompleted(item)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Marcar Renovado
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Nuevo Vencimiento */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800 text-base">Registrar Nuevo Vencimiento</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 mb-1">Título del Requisito</label>
                <input
                  type="text"
                  placeholder="Ej: SOAT Furgón Reparto Norte"
                  value={newItem.title || ''}
                  onChange={e => setNewItem({ ...newItem, title: e.target.value })}
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Categoría</label>
                  <select
                    value={newItem.category}
                    onChange={e => setNewItem({ ...newItem, category: e.target.value as any })}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  >
                    <option value="transporte_soat">Transporte y SOAT</option>
                    <option value="camara_comercio">Cámara de Comercio</option>
                    <option value="bomberos_sanidad">Bomberos y Sanidad</option>
                    <option value="impuesto_fiscal">Tributario / DIAN</option>
                    <option value="contrato_arriendo">Contrato / Arriendo</option>
                    <option value="lote_perecedero">Lote perecedero</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Fecha de Vencimiento</label>
                  <input
                    type="date"
                    value={newItem.due_date || ''}
                    onChange={e => setNewItem({ ...newItem, due_date: e.target.value })}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Costo Estimado ($)</label>
                  <input
                    type="number"
                    placeholder="Ej: 850000"
                    value={newItem.estimated_cost || ''}
                    onChange={e => setNewItem({ ...newItem, estimated_cost: Number(e.target.value) })}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Responsable</label>
                  <input
                    type="text"
                    placeholder="Ej: Coordinador Logística"
                    value={newItem.responsible_person || ''}
                    onChange={e => setNewItem({ ...newItem, responsible_person: e.target.value })}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Notas / Instrucciones</label>
                <textarea
                  rows={2}
                  placeholder="Detalles sobre renovación..."
                  value={newItem.notes || ''}
                  onChange={e => setNewItem({ ...newItem, notes: e.target.value })}
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
                onClick={handleCreateItem}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Guardar Vencimiento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
