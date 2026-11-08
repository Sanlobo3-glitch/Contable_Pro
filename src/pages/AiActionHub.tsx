import { useEffect, useState } from 'react'
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Clock,
  ArrowRight,
  TrendingUp,
  ShoppingCart,
  Send,
  Lock,
  Layers,
  History,
  Info,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtDateTime } from '../lib/currency'
import {
  getAiActionProposals,
  approveAiActionProposal,
  rejectAiActionProposal,
} from '../lib/innovationsRepo'
import type { AiActionProposal } from '../types'

/**
 * Quién puede ver y resolver una propuesta según el «rol requerido»:
 * admin y dueño ven todas; admin de empresa todas menos las de dueño/admin; el resto solo las de su propio rol.
 */
function canActOnProposal(userRole: string | undefined, requiredRole: string): boolean {
  if (!userRole) return false
  if (userRole === 'admin' || userRole === 'super_admin' || userRole === 'dueno') return true
  if (userRole === 'admin_empresa') return requiredRole !== 'dueno' && requiredRole !== 'admin'
  return userRole === requiredRole
}

interface AiActionHubProps {
  onNavigate?: (page: string) => void
}

export default function AiActionHub({ onNavigate }: AiActionHubProps) {
  const { user } = useAuth()
  const { fmt } = useCurrency()
  const [proposals, setProposals] = useState<AiActionProposal[]>([])
  const [activeTab, setActiveTab] = useState<'pendientes' | 'historial'>('pendientes')
  const [rejectModalId, setRejectModalId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => {
    setProposals(getAiActionProposals())
  }, [])

  // Cada rol solo ve (y puede aprobar) las propuestas que le corresponden
  const visibleProposals = proposals.filter(p => canActOnProposal(user?.role, p.required_role))
  const pendingList = visibleProposals.filter(p => p.status === 'pendiente')
  const historyList = visibleProposals.filter(p => p.status !== 'pendiente')

  function handleApprove(id: string) {
    const updated = approveAiActionProposal(id, user?.full_name || 'Administrador')
    setProposals(updated)
    setSuccessMsg('Propuesta aprobada. (Demostración: no se modificó ningún dato real de tu empresa.)')
    setTimeout(() => setSuccessMsg(null), 4000)
  }

  function handleRejectSubmit() {
    if (!rejectModalId) return
    const updated = rejectAiActionProposal(rejectModalId, rejectReason || 'Descartado por decisión operativa')
    setProposals(updated)
    setRejectModalId(null)
    setRejectReason('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-100 text-purple-800 rounded-xl">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              Agente de IA: Acciones Bajo Aprobación
              <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                Human-in-the-Loop
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              La IA propone decisiones operativas estratégicas; tú mantienes el control y la autorización final.
            </p>
          </div>
        </div>

        {/* Pestañas */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('pendientes')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'pendientes'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Pendientes ({pendingList.length})
          </button>
          <button
            onClick={() => setActiveTab('historial')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'historial'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Historial ({historyList.length})
          </button>
        </div>
      </div>

      {/* Aviso: datos de ejemplo */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <span>
          <strong>Propuestas de demostración.</strong> Son ejemplos guardados en este navegador: aprobar o descartar
          no crea compras, cambia precios ni envía mensajes reales.
        </span>
      </div>

      {/* Alerta de Éxito */}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-center gap-2.5 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Pestaña Pendientes */}
      {activeTab === 'pendientes' && (
        <div className="space-y-4">
          {pendingList.length === 0 ? (
            <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center text-slate-400">
              <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-80" />
              <p className="text-base font-bold text-slate-700">No hay acciones pendientes de aprobación</p>
              <p className="text-xs text-slate-500 mt-1">
                El agente de IA supervisa continuamente ventas, compras y cobros en segundo plano.
              </p>
            </div>
          ) : (
            pendingList.map(item => {
              const isHigh = item.severity === 'alta'

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all overflow-hidden"
                >
                  <div className="p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            isHigh
                              ? 'bg-red-100 text-red-800'
                              : item.severity === 'media'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {item.severity.toUpperCase()} IMPACTO
                        </span>
                        <span className="text-xs text-slate-400">
                          Detectado {fmtDateTime(item.created_at)}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        Rol requerido: <strong className="text-slate-700">{item.required_role}</strong>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {item.explanation}
                      </p>
                    </div>

                    {/* Previsualización del Payload */}
                    {item.payload && (
                      <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-xl text-xs space-y-1.5 font-mono text-slate-700">
                        {item.action_type === 'crear_orden_compra' && (
                          <div className="flex flex-wrap gap-4">
                            <span>Proveedor: <strong>{item.payload.supplier_name}</strong></span>
                            <span>Cantidad: <strong>{item.payload.quantity} unid.</strong></span>
                            <span>Costo unitario: <strong>{fmt(item.payload.unit_cost)}</strong></span>
                            <span>Total sugerido: <strong>{fmt(item.payload.total_amount)}</strong></span>
                          </div>
                        )}
                        {item.action_type === 'ajuste_precio_minimo' && (
                          <div className="flex flex-wrap gap-4">
                            <span>Producto: <strong>{item.payload.product_name}</strong></span>
                            <span>Costo anterior: <strong>{fmt(item.payload.old_cost)}</strong> → Nuevo: <strong>{fmt(item.payload.new_cost)}</strong></span>
                            <span>Precio propuesto: <strong>{fmt(item.payload.recommended_price)}</strong></span>
                          </div>
                        )}
                        {item.action_type === 'recordatorio_cartera' && (
                          <div className="flex flex-wrap gap-4">
                            <span>Clientes afectados: <strong>{item.payload.customers?.length}</strong></span>
                            <span>Cartera total en mora: <strong>{fmt(item.payload.total_debt)}</strong></span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Acciones Human-in-the-Loop */}
                  <div className="bg-slate-50/80 px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <button
                      onClick={() => setRejectModalId(item.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    >
                      Descartar propuesta
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(item.id)}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Aprobar propuesta
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Pestaña Historial */}
      {activeTab === 'historial' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-600">
            Bitácora de Acciones Supervisadas de IA
          </div>
          <div className="divide-y divide-slate-100">
            {historyList.map(item => (
              <div key={item.id} className="p-4 flex items-center justify-between text-xs">
                <div>
                  <p className="font-bold text-slate-800">{item.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {item.status === 'aprobada'
                      ? `Aprobado por ${item.approved_by} • ${fmtDateTime(item.approved_at || item.created_at)} • Tx: ${item.executed_tx_id}`
                      : `Rechazado: ${item.rejection_reason || 'Sin motivo'}`}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full font-bold text-[10px] ${
                    item.status === 'aprobada'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {item.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal Rechazo */}
      {rejectModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-3">
            <h3 className="font-bold text-slate-800 text-sm">Motivo de rechazo de la propuesta</h3>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Indica por qué se descarta esta recomendación..."
              className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectModalId(null)}
                className="px-3 py-1.5 text-xs text-slate-500 font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleRejectSubmit}
                className="px-4 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold"
              >
                Confirmar Descarte
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
