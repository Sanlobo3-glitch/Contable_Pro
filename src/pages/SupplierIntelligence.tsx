import { useEffect, useState } from 'react'
import {
  Award,
  CheckCircle2,
  Clock,
  DollarSign,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Building2,
  ShoppingBasket,
  Search,
} from 'lucide-react'
import { getSupplierScorecards } from '../lib/innovationsRepo'
import type { SupplierScorecard } from '../types'

interface SupplierIntelligenceProps {
  onNavigate?: (page: string) => void
}

export default function SupplierIntelligence({ onNavigate }: SupplierIntelligenceProps) {
  const [scorecards, setScorecards] = useState<SupplierScorecard[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    setScorecards(getSupplierScorecards())
  }, [])

  const filtered = scorecards.filter(s =>
    s.supplier_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Inteligencia y Evaluación de Proveedores
            </h1>
            <p className="text-xs text-slate-500">
              Métricas reales de cumplimiento logístico (OTIF), demoras en entrega y variación acumulada de costos.
            </p>
          </div>
        </div>

        {onNavigate && (
          <button
            onClick={() => onNavigate('suppliers')}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5" />
            Fichas de Proveedores
          </button>
        )}
      </div>

      {/* Buscador */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nombre de proveedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Grid de Proveedores Evaluados */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(card => {
          const isGradeA = card.grade.startsWith('A')
          const isHighInflation = card.cost_variation_pct_12m > 10

          return (
            <div
              key={card.supplier_id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all space-y-4"
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{card.supplier_name}</h3>
                  <p className="text-[11px] text-slate-400 font-mono">NIT/Doc: {card.supplier_document}</p>
                </div>
                <span
                  className={`px-3 py-1 rounded-xl text-sm font-black border ${
                    isGradeA
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : card.grade === 'B'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-red-50 text-red-800 border-red-200'
                  }`}
                >
                  {card.grade}
                </span>
              </div>

              {/* Métricas clave */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] text-slate-500 font-semibold uppercase">Cumplimiento OTIF</p>
                  <p className="text-base font-extrabold text-slate-800 mt-0.5">
                    {card.on_time_in_full_pct}%
                  </p>
                  <p className="text-[10px] text-slate-400">A tiempo y completo</p>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] text-slate-500 font-semibold uppercase">Demora promedio</p>
                  <p className="text-base font-extrabold text-slate-800 mt-0.5">
                    {card.avg_delay_days} días
                  </p>
                  <p className="text-[10px] text-slate-400">Post orden de compra</p>
                </div>

                <div className={`p-2.5 rounded-xl border ${isHighInflation ? 'bg-red-50 border-red-200 text-red-900' : 'bg-slate-50 border-slate-100 text-slate-800'}`}>
                  <p className="text-[10px] font-semibold uppercase">Variación Costos</p>
                  <p className="text-base font-extrabold mt-0.5 flex items-center gap-1">
                    {card.cost_variation_pct_12m > 0 ? '+' : ''}{card.cost_variation_pct_12m}%
                    {isHighInflation && <AlertTriangle className="w-4 h-4 text-red-600" />}
                  </p>
                  <p className="text-[10px] text-slate-500">Últimos 12 meses</p>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] text-slate-500 font-semibold uppercase">Tasa Devolución</p>
                  <p className="text-base font-extrabold text-slate-800 mt-0.5">
                    {card.return_rate_pct}%
                  </p>
                  <p className="text-[10px] text-slate-400">Defectos / mermas</p>
                </div>
              </div>

              {/* Alertas del Proveedor */}
              {card.active_alerts.length > 0 && (
                <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200 text-xs text-amber-900 space-y-1">
                  {card.active_alerts.map((al, idx) => (
                    <p key={idx} className="flex items-start gap-1.5 text-[11px]">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>{al}</span>
                    </p>
                  ))}
                </div>
              )}

              {/* Acciones */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Última compra: {card.last_purchase_date || 'Reciente'}
                </span>
                {onNavigate && (
                  <button
                    onClick={() => onNavigate('purchaseorders')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    <ShoppingBasket className="w-3.5 h-3.5" />
                    Crear O.C.
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
