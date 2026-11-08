import { useEffect, useState } from 'react'
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Filter,
  DollarSign,
  UserCheck,
  Building2,
  Clock,
  History,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtDateTime } from '../lib/currency'
import { getAnomalyRecords, resolveAnomalyRecord } from '../lib/innovationsRepo'
import type { AnomalyRecord, AnomalySeverity } from '../types'

interface AnomalyDetectorProps {
  onNavigate?: (page: string) => void
}

export default function AnomalyDetector({ onNavigate }: AnomalyDetectorProps) {
  const { user } = useAuth()
  const { fmt } = useCurrency()
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([])
  const [activeFilter, setActiveFilter] = useState<'pendientes' | 'resueltas'>('pendientes')
  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyRecord | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')

  useEffect(() => {
    setAnomalies(getAnomalyRecords())
  }, [])

  const pendingList = anomalies.filter(a => a.status === 'pendiente_revision')
  const resolvedList = anomalies.filter(a => a.status !== 'pendiente_revision')

  const totalPendingImpact = pendingList.reduce((acc, a) => acc + a.financial_impact, 0)

  function handleResolve(resolution: 'justificado' | 'sancionado') {
    if (!selectedAnomaly) return
    const updated = resolveAnomalyRecord(
      selectedAnomaly.id,
      resolution,
      user?.full_name || 'Administrador',
      resolutionNotes || 'Revisado y cerrado por auditoría.'
    )
    setAnomalies(updated)
    setSelectedAnomaly(null)
    setResolutionNotes('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-100 text-red-800 rounded-xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Detección de Anomalías y Prevención de Pérdidas
            </h1>
            <p className="text-xs text-slate-500">
              Disparadores automáticos: descuentos no autorizados, mermas en toma ciega y devoluciones sospechosas.
            </p>
          </div>
        </div>

        {/* Impacto financiero en riesgo */}
        <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-xl flex items-center gap-3">
          <div>
            <p className="text-[10px] font-bold text-red-700 uppercase">Impacto en Riesgo</p>
            <p className="text-base font-black text-red-900">{fmt(totalPendingImpact)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveFilter('pendientes')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeFilter === 'pendientes'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          Pendientes de Auditoría ({pendingList.length})
        </button>
        <button
          onClick={() => setActiveFilter('resueltas')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeFilter === 'resueltas'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          Resueltas / Historial ({resolvedList.length})
        </button>
      </div>

      {/* Lista de Anomalías */}
      <div className="space-y-4">
        {(activeFilter === 'pendientes' ? pendingList : resolvedList).map(item => {
          const isCrit = item.severity === 'critica'

          return (
            <div
              key={item.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      isCrit
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.severity.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {item.category.replace('_', ' ').toUpperCase()}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    • {fmtDateTime(item.detected_at)}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-xs font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-lg">
                    Riesgo: {fmt(item.financial_impact)}
                  </span>
                </div>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                <p className="text-xs text-slate-600 mt-1">{item.description}</p>
              </div>

              <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-50">
                <div className="flex items-center gap-4">
                  {item.involved_user_name && (
                    <span className="flex items-center gap-1 text-slate-700">
                      <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                      Usuario: <strong>{item.involved_user_name}</strong>
                    </span>
                  )}
                  {item.involved_branch && (
                    <span className="flex items-center gap-1 text-slate-700">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      Sede: <strong>{item.involved_branch}</strong>
                    </span>
                  )}
                </div>

                {item.status === 'pendiente_revision' ? (
                  <button
                    onClick={() => setSelectedAnomaly(item)}
                    className="mt-2 sm:mt-0 flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Auditar y Resolver
                  </button>
                ) : (
                  <div className="text-right text-[11px]">
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold ${
                        item.status === 'justificado'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                    <span className="text-slate-400 ml-2">por {item.reviewed_by}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal de Resolución de Auditoría */}
      {selectedAnomaly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800 text-base">Auditar Incidencia</h3>
              <p className="text-xs text-slate-500">{selectedAnomaly.title}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Dictamen y Notas de Auditoría:
              </label>
              <textarea
                rows={3}
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                placeholder="Escribe la explicación o medida disciplinaria tomada..."
                className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setSelectedAnomaly(null)}
                className="px-3 py-1.5 text-xs text-slate-500 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleResolve('justificado')}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Marcar Justificado
              </button>
              <button
                onClick={() => handleResolve('sancionado')}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                Confirmar Falta / Sanción
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
