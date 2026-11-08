import { useEffect, useState } from 'react'
import {
  ArrowLeftRight,
  Boxes,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Send,
} from 'lucide-react'
import { getBranchBalanceSuggestions } from '../lib/innovationsRepo'
import type { BranchStockBalanceSuggestion } from '../types'

interface BranchRebalancingProps {
  onNavigate?: (page: string) => void
}

export default function BranchRebalancing({ onNavigate }: BranchRebalancingProps) {
  const [suggestions, setSuggestions] = useState<BranchStockBalanceSuggestion[]>([])
  const [transferredIds, setTransferredIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSuggestions(getBranchBalanceSuggestions())
  }, [])

  function handleTransfer(sug: BranchStockBalanceSuggestion) {
    setTransferredIds(prev => new Set(prev).add(sug.id))
    if (onNavigate) {
      setTimeout(() => {
        onNavigate('warehouses')
      }, 800)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-100 text-blue-800 rounded-xl">
            <ArrowLeftRight className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Balanceo Predictivo entre Sucursales
            </h1>
            <p className="text-xs text-slate-500">
              Evita compras innecesarias reubicando stock inmovilizado hacia las sedes con riesgo inminente de agotamiento.
            </p>
          </div>
        </div>

        {onNavigate && (
          <button
            onClick={() => onNavigate('warehouses')}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5" />
            Ver Sedes y Traslados
          </button>
        )}
      </div>

      {/* Grid de Sugerencias de Traslado */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {suggestions.map(sug => {
          const isDone = transferredIds.has(sug.id)

          return (
            <div
              key={sug.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md">
                    {sug.sku}
                  </span>
                  <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Agotamiento en ~{sug.estimated_stockout_days} días
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-base">{sug.product_name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Movimiento sugerido: <strong>{sug.suggested_transfer_qty} unidades</strong>
                  </p>
                </div>

                {/* Comparativa Visual de Sedes */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  {/* Origen (Con Exceso) */}
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                    <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-blue-600" /> Sede Origen (Exceso de inventario)
                    </p>
                    <p className="font-bold text-slate-800 mt-1">{sug.source_branch_name}</p>
                    <div className="flex justify-between text-[11px] text-slate-600 mt-1">
                      <span>Stock actual: {sug.source_stock} u.</span>
                      <span className="text-emerald-700 font-semibold">{sug.source_days_cover} días cobertura</span>
                    </div>
                  </div>

                  {/* Destino (En Riesgo) */}
                  <div className="p-2.5 rounded-xl bg-red-50/50 border border-red-100 text-xs">
                    <p className="text-[11px] font-semibold text-red-700 flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-red-600" /> Sede Destino (Riesgo de agotamiento)
                    </p>
                    <p className="font-bold text-slate-800 mt-1">{sug.target_branch_name}</p>
                    <div className="flex justify-between text-[11px] text-slate-600 mt-1">
                      <span className="font-bold text-red-700">Stock crítico: {sug.target_stock} u.</span>
                      <span className="text-red-600 font-semibold">{sug.target_days_cover} días cobertura</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Botón de Traslado Directo */}
              <div className="pt-4 mt-2">
                <button
                  disabled={isDone}
                  onClick={() => handleTransfer(sug)}
                  className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    isDone
                      ? 'bg-emerald-100 text-emerald-800 cursor-default'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20'
                  }`}
                >
                  {isDone ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Traslado Registrado
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" /> Crear Traslado Sugerido
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
