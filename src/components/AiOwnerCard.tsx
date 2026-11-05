import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { AiConfig } from '../lib/aiTools'
import { acceptTerms, setAiEnabled } from '../lib/aiClient'

const AVISO =
  'Al activar la IA, tus preguntas y los resultados de tus datos de negocio (ventas, productos, caja, cartera…) se envían a Google (Gemini) para generar la respuesta. ' +
  'Los nombres de clientes y vendedores se reemplazan por códigos antes de enviarse. ' +
  'Según las condiciones de Google, con una cuenta gratuita ese contenido puede usarse para mejorar sus productos y ser revisado por personas; con una cuenta de pago no. ' +
  'Tú decides: puedes desactivar la IA cuando quieras y el cerebro de datos sigue funcionando sin ella.'

export default function AiOwnerCard({ cfg, onChange }: { cfg: AiConfig; onChange: (c: AiConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [tier, setTier] = useState<'gratuito' | 'pago'>(cfg.consent_tier ?? 'gratuito')
  const [showTerms, setShowTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const noPlan = cfg.ai_daily_limit <= 0
  const state = !cfg.consent_ok ? 'pendiente del aviso' : cfg.ai_enabled ? 'activada' : 'desactivada'

  async function run(action: () => Promise<AiConfig | string>) {
    setBusy(true)
    setError('')
    const r = await action()
    setBusy(false)
    if (typeof r === 'string') { setError(r); return }
    onChange(r)
    setShowTerms(false)
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white text-sm">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="flex-1 font-medium text-slate-800">IA de tu empresa</span>
        <span className={`text-xs ${cfg.ai_enabled && cfg.consent_ok ? 'text-emerald-600' : 'text-slate-500'}`}>{state}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-100 pt-3">
          {noPlan && <p className="text-amber-700">Tu plan no incluye consultas con IA.</p>}

          {(!cfg.consent_ok || showTerms) && (
            <div className="space-y-2">
              <p className="text-slate-600 leading-snug">{AVISO}</p>
              <p className="text-slate-700 font-medium">¿Tu cuenta de Gemini es…?</p>
              <label className="flex items-center gap-2"><input type="radio" checked={tier === 'gratuito'} onChange={() => setTier('gratuito')} /> Gratuita</label>
              <label className="flex items-center gap-2"><input type="radio" checked={tier === 'pago'} onChange={() => setTier('pago')} /> De pago</label>
              <button disabled={busy} onClick={() => void run(() => acceptTerms(tier))} className="bg-slate-800 text-white px-3 py-2 rounded-lg disabled:opacity-50">
                Entiendo y acepto
              </button>
            </div>
          )}

          {cfg.consent_ok && !showTerms && (
            <div className="space-y-2">
              <p className="text-slate-600">
                Aviso aceptado ({cfg.consent_tier}){cfg.consent_at ? ` el ${new Date(cfg.consent_at).toLocaleDateString()}` : ''}.{' '}
                <button className="underline text-slate-700" onClick={() => setShowTerms(true)}>Ver o cambiar</button>
              </p>
              <button
                disabled={busy || noPlan}
                onClick={() => void run(() => setAiEnabled(!cfg.ai_enabled))}
                className={`px-3 py-2 rounded-lg text-white disabled:opacity-50 ${cfg.ai_enabled ? 'bg-slate-500' : 'bg-emerald-600'}`}
              >
                {cfg.ai_enabled ? 'Desactivar la IA' : 'Activar la IA'}
              </button>
              <p className="text-xs text-slate-500">
                Hoy: {cfg.ai_used_today} de {cfg.ai_daily_limit} consultas con IA · Mes: ${Number(cfg.month_cost).toFixed(2)} de ${Number(cfg.month_cap).toFixed(2)} (tope)
              </p>
            </div>
          )}

          {error && <p className="text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
