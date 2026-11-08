import { AlertTriangle, AlertCircle, CheckCircle2, X, ArrowRight } from 'lucide-react'
import { useCurrency } from '../lib/currency'
import type { Insight, Severity } from '../lib/copilot'

export const SEV: Record<Severity, { label: string; box: string; icon: string; chip: string; dot: string }> = {
  alta: { label: 'Urgente', box: 'border-red-200 bg-red-50', icon: 'text-red-600', chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  media: { label: 'Por atender', box: 'border-amber-200 bg-amber-50', icon: 'text-amber-600', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  info: { label: 'Informativa', box: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
}

export function SevIcon({ s, className = 'w-5 h-5' }: { s: Severity; className?: string }) {
  const c = `${className} ${SEV[s].icon}`
  if (s === 'alta') return <AlertTriangle className={c} />
  if (s === 'media') return <AlertCircle className={c} />
  return <CheckCircle2 className={c} />
}

export function InsightCard({ a, onGo, onDismiss, onRestore }: {
  a: Insight
  onGo?: (page: string) => void
  onDismiss?: () => void
  onRestore?: () => void
}) {
  const { fmt: money } = useCurrency()
  const sev = SEV[a.severity]
  const items = a.items || []
  return (
    <div className={`rounded-xl border p-4 ${sev.box}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0"><SevIcon s={a.severity} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">{a.title}</p>
            {onDismiss && (
              <button onClick={onDismiss} title="Ocultar por hoy" className="p-1 -m-1 rounded text-slate-400 hover:text-slate-700 shrink-0"><X className="w-4 h-4" /></button>
            )}
          </div>
          {a.detail && <p className="text-xs text-slate-600 mt-1">{a.detail}</p>}
          {typeof a.amount === 'number' && a.amount > 0 && (
            <p className="text-xs text-slate-600 mt-2">{a.amount_label || 'Total'}: <b className="text-slate-800">{money(a.amount)}</b></p>
          )}
          {items.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {items.map((it, i) => (
                <li key={i} className="flex items-start justify-between gap-3 bg-white/70 rounded-lg px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">{it.label}</p>
                    {it.note && <p className="text-[11px] text-slate-500">{it.note}</p>}
                  </div>
                  {typeof it.money === 'number' && <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">{money(it.money)}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {a.page && onGo && (
              <button onClick={() => onGo(a.page as string)} className="inline-flex items-center gap-1.5 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-700">
                {a.cta || 'Abrir'} <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            {onRestore && <button onClick={onRestore} className="text-xs text-slate-600 underline">Volver a mostrar</button>}
            <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded ${sev.chip}`}>{sev.label}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
