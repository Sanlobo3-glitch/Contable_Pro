import { useState, type ReactNode } from 'react'
import { Check, RefreshCw, Sparkles } from 'lucide-react'

/**
 * Selector visual de la inteligencia del Copiloto.
 * «InventarioPro» = cerebro propio (reglas + herramientas de tus datos; la IA solo entra si hace falta).
 * «Gemini» = todas las preguntas pasan por la IA (si falla, responde el cerebro propio).
 * Groq, Cloudflare y OpenRouter se muestran, pero se conectan más adelante.
 *
 * Logos opcionales: coloca los archivos en public/ai/ (gemini.svg, groq.svg, cloudflare.svg, openrouter.svg).
 * Si un archivo no existe, se muestra un icono/letras de respaldo.
 */

export type Engine = 'brain' | 'gemini'
export type GeminiState = 'conectado' | 'desactivado' | 'pendiente' | 'no_disponible'

const GREEN = '#1ea34f'

interface Provider { id: string; name: string; sub: string; code: string; color: string; src: string; listName: string; listSub: string }

const GEMINI: Provider = { id: 'gemini', name: 'Gemini', sub: 'Razonamiento avanzado', code: 'GE', color: '#4f7cf0', src: '/ai/gemini.svg', listName: 'Google Gemini', listSub: 'Modelos y consumo de Google' }
const PENDING: Provider[] = [
  { id: 'groq', name: 'Groq', sub: 'Respuesta rápida', code: 'G', color: '#16a79a', src: '/ai/groq.svg', listName: 'Groq', listSub: 'Modelos y consumo según proveedor' },
  { id: 'cloudflare', name: 'Cloudflare', sub: 'Modelos abiertos', code: 'CF', color: '#f48020', src: '/ai/cloudflare.svg', listName: 'Cloudflare Workers AI', listSub: 'Modelos y facturación de Cloudflare' },
  { id: 'openrouter', name: 'OpenRouter', sub: 'Múltiples modelos', code: 'OR', color: '#7c64d0', src: '/ai/openrouter.svg', listName: 'OpenRouter', listSub: 'Acceso a modelos de distintos proveedores' },
]

/** Cuadro con el logo del proveedor (imagen si existe; si no, letras de color). */
function Logo({ p, solid, icon }: { p: Provider; solid?: boolean; icon?: ReactNode }) {
  const [failed, setFailed] = useState(false)
  const base = 'w-11 h-11 rounded-xl shrink-0 flex items-center justify-center overflow-hidden'
  if (!solid && !failed) {
    return (
      <div className={`${base} bg-white border border-slate-200`}>
        <img src={p.src} alt="" className="w-7 h-7 object-contain" onError={() => setFailed(true)} />
      </div>
    )
  }
  if (solid && icon) return <div className={`${base} text-white`} style={{ background: p.color }}>{icon}</div>
  return solid
    ? <div className={`${base} text-white font-bold text-lg`} style={{ background: p.color }}>{p.code}</div>
    : <div className={`${base} bg-white border border-slate-200 font-bold text-sm`} style={{ color: p.color }}>{p.code}</div>
}

interface PickerProps {
  engine: Engine
  onEngine: (e: Engine) => void
  online: boolean
  geminiReady: boolean
  /** Por qué Gemini no está disponible (se muestra al tocarlo). */
  geminiHint: string
  models: string[]
  model: string
  onCycleModel: () => void
}

export default function AiPicker({ engine, onEngine, online, geminiReady, geminiHint, models, model, onCycleModel }: PickerProps) {
  const [hint, setHint] = useState('')
  const [gFailed, setGFailed] = useState(false)

  function pickPending(p: Provider) { setHint(`${p.name} aún no está conectado. Lo conectaremos más adelante.`) }

  const tile = (selected: boolean, dim: boolean) =>
    `relative text-left rounded-2xl p-3.5 min-h-[128px] flex flex-col transition-colors ${selected ? 'bg-white shadow-sm' : 'border border-slate-200 bg-white/70 hover:bg-white'} ${dim ? 'opacity-70' : ''}`
  const selStyle = { borderColor: GREEN, boxShadow: `0 0 0 1px ${GREEN}` }

  return (
    <section className="mb-3 rounded-3xl border border-slate-200 bg-white/80 p-4" aria-label="Copiloto Empresarial">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-700">Copiloto Empresarial</h2>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{online ? 'En línea' : 'Sin conexión'}</span>
      </div>
      <p className="text-sm text-slate-500 mt-3 mb-3">Selecciona tu inteligencia artificial</p>

      <div role="radiogroup" aria-label="Inteligencia artificial" className="grid grid-cols-2 gap-3">
        {/* InventarioPro · cerebro propio */}
        <button type="button" role="radio" aria-checked={engine === 'brain'} onClick={() => { onEngine('brain'); setHint('') }}
          className={`${tile(engine === 'brain', false)} ${engine === 'brain' ? 'border' : ''}`} style={engine === 'brain' ? selStyle : undefined}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ background: '#1ca74e' }}>IP</div>
          {engine === 'brain' && <span className="absolute top-3.5 right-3.5 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: '#0b6b35' }}><Check className="w-3.5 h-3.5" strokeWidth={3} /></span>}
          <span className="mt-3 text-lg font-bold text-slate-900 leading-tight">InventarioPro</span>
          <span className="text-sm text-slate-500">Cerebro propio</span>
        </button>

        {/* Gemini · ya está en el sistema */}
        <button type="button" role="radio" aria-checked={engine === 'gemini'} aria-disabled={!geminiReady}
          onClick={() => { if (geminiReady) { onEngine('gemini'); setHint('') } else setHint(geminiHint) }}
          className={`${tile(engine === 'gemini', !geminiReady)} ${engine === 'gemini' ? 'border' : ''}`} style={engine === 'gemini' ? selStyle : undefined}>
          {gFailed
            ? <Logo p={GEMINI} solid icon={<Sparkles className="w-6 h-6" />} />
            : <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden"><img src={GEMINI.src} alt="" className="w-7 h-7 object-contain" onError={() => setGFailed(true)} /></div>}
          {engine === 'gemini' && <span className="absolute top-3.5 right-3.5 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: '#0b6b35' }}><Check className="w-3.5 h-3.5" strokeWidth={3} /></span>}
          <span className="mt-3 text-lg font-bold text-slate-900 leading-tight">Gemini</span>
          <span className="text-sm text-slate-500">{GEMINI.sub}</span>
        </button>

        {/* Pendientes de conectar */}
        {PENDING.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={false} aria-disabled onClick={() => pickPending(p)} className={tile(false, false)}>
            <Logo p={p} solid />
            <span className="mt-3 text-lg font-bold text-slate-900 leading-tight">{p.name}</span>
            <span className="text-sm text-slate-500">{p.sub}</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-3 leading-snug">
        {engine === 'gemini'
          ? 'Todas tus preguntas pasan por Gemini. Si no puede responder, contesta el cerebro de InventarioPro.'
          : geminiReady
            ? 'Respondo con tus datos al instante. Gemini entra solo cuando tu pregunta lo necesita.'
            : 'Respondo con tus datos al instante, sin costo.'}
      </p>
      {engine === 'gemini' && models.length > 1 && (
        <button type="button" onClick={onCycleModel} className="mt-2 inline-flex items-center gap-1.5 min-h-[36px] text-xs rounded-full border border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50">
          <RefreshCw className="w-3.5 h-3.5" /> Modelo: <span className="font-medium text-slate-800">{model}</span> · Cambiar
        </button>
      )}
      <p role="status" aria-live="polite" className={`text-xs text-amber-700 mt-2 ${hint ? '' : 'hidden'}`}>{hint}</p>
    </section>
  )
}

const STATE_PILL: Record<GeminiState, { label: string; cls: string }> = {
  conectado: { label: 'Conectado', cls: 'bg-emerald-100 text-emerald-700' },
  desactivado: { label: 'Desactivada', cls: 'bg-slate-100 text-slate-500' },
  pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
  no_disponible: { label: 'No disponible', cls: 'bg-slate-100 text-slate-500' },
}

/** Lista de conexiones (solo el dueño). Gemini ya está; el resto se conecta más adelante. */
export function AiConnections({ gemini }: { gemini: GeminiState }) {
  const [msg, setMsg] = useState('')
  const pill = STATE_PILL[gemini]
  return (
    <section className="mb-3 rounded-3xl border border-slate-200 bg-white/80 px-4" aria-label="Conexiones de IA">
      <ul className="divide-y divide-slate-200">
        <li className="flex items-center gap-3 py-4">
          <Logo p={GEMINI} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-900 leading-tight">{GEMINI.listName}</p>
            <p className="text-sm text-slate-500 leading-snug">{GEMINI.listSub}</p>
          </div>
          <span className={`text-sm font-medium px-3 py-1.5 rounded-full shrink-0 ${pill.cls}`}>{pill.label}</span>
        </li>
        {PENDING.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 py-4">
            <Logo p={p} />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-slate-900 leading-tight">{p.listName}</p>
              <p className="text-sm text-slate-500 leading-snug">{p.listSub}</p>
            </div>
            <button type="button" onClick={() => setMsg(`${p.listName} se conectará en una próxima actualización.`)}
              className={`text-sm font-medium px-3 py-1.5 min-h-[36px] rounded-full shrink-0 ${i === 0 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              Conectar
            </button>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className={`text-xs text-amber-700 pb-3 ${msg ? '' : 'hidden'}`}>{msg}</p>
    </section>
  )
}
