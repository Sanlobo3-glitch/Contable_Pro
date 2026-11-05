import { useState } from 'react'
import { RefreshCw, Sparkles, CheckCircle2, WifiOff } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { dismissInsight, hiddenAlerts, loadInsights, restoreInsight, useCopilot, visibleAlerts } from '../lib/copilot'
import { InsightCard, SEV } from '../components/CopilotCards'

function greeting(name: string) {
  const h = new Date().getHours()
  const g = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
  const first = (name || '').trim().split(/\s+/)[0]
  return first ? `${g}, ${first}` : g
}

function ago(iso: string | null) {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  return h < 24 ? `hace ${h} h` : new Date(iso).toLocaleDateString()
}

export default function Copiloto({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth()
  const cp = useCopilot()
  const [showHidden, setShowHidden] = useState(false)
  const isManager = user?.role === 'dueno' || user?.role === 'admin'
  const list = visibleAlerts(cp)
  const hidden = hiddenAlerts(cp)
  const count = (s: 'alta' | 'media' | 'info') => list.filter(a => a.severity === s).length
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5 text-white" /></div>
            <h1 className="text-xl font-bold text-slate-800">Copiloto</h1>
          </div>
          <p className="text-sm text-slate-600 mt-2">{greeting(user?.full_name || '')}. Esto es lo que conviene mirar hoy.</p>
        </div>
        <button onClick={() => loadInsights(true)} disabled={cp.loading || offline} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40 shrink-0">
          <RefreshCw className={`w-4 h-4 ${cp.loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {(offline || cp.fromCache) && cp.alerts.length > 0 && (
        <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <WifiOff className="w-3.5 h-3.5 shrink-0" /> Mostrando la última lectura guardada en este teléfono{cp.at ? ` (${ago(cp.at)})` : ''}.
        </div>
      )}

      {cp.error === 'sin_sql' && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 mb-4 text-sm">
          <p className="font-medium">El Copiloto aún no está activado en tu base de datos.</p>
          <p className="text-xs mt-1">{isManager ? 'Ejecuta el SQL del Copiloto en Supabase (SQL Editor) y vuelve a pulsar Actualizar.' : 'Pídele al administrador que lo active.'}</p>
        </div>
      )}
      {cp.error && cp.error !== 'sin_sql' && (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">No se pudo actualizar el Copiloto: {cp.error}</div>
      )}

      {cp.loaded && list.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {(['alta', 'media', 'info'] as const).map(s => count(s) > 0 && (
            <span key={s} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${SEV[s].chip}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${SEV[s].dot}`} /> {count(s)} {SEV[s].label.toLowerCase()}{count(s) === 1 ? '' : 's'}
            </span>
          ))}
        </div>
      )}

      {!cp.loaded && cp.loading && <p className="text-sm text-slate-400 text-center py-10">Revisando tu negocio…</p>}

      {cp.loaded && !cp.error && list.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="font-semibold text-slate-800 mt-3">Todo en orden por ahora</p>
          <p className="text-sm text-slate-500 mt-1">No encontré nada urgente. Vuelvo a revisar cada pocos minutos y te aviso aquí.</p>
        </div>
      )}

      <div className="space-y-3">
        {list.map(a => (
          <InsightCard key={a.id} a={a} onGo={onNavigate} onDismiss={() => dismissInsight(a.id)} />
        ))}
      </div>

      {hidden.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowHidden(v => !v)} className="text-xs text-slate-500 underline">
            {showHidden ? 'Ocultar' : 'Ver'} {hidden.length} alerta(s) ocultada(s) por hoy
          </button>
          {showHidden && (
            <div className="space-y-3 mt-3 opacity-80">
              {hidden.map(a => <InsightCard key={a.id} a={a} onGo={onNavigate} onRestore={() => restoreInsight(a.id)} />)}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-8 leading-relaxed">
        {cp.at ? `Actualizado ${ago(cp.at)}. ` : ''}Se actualiza solo cada 5 minutos. El Copiloto calcula todo con los datos de tu propia empresa: no comparte nada con otras empresas.
        {isManager ? ' Como administrador ves alertas de todo el negocio; cada vendedor ve solo las suyas.' : ''}
      </p>
    </div>
  )
}
