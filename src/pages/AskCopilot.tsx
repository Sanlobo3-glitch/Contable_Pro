import { useEffect, useRef, useState } from 'react'
import { MessageCircleQuestion, Send, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, fmtNum } from '../lib/currency'
import { parseQuestion, norm, SUGGESTIONS, type Intent } from '../lib/copilotAsk'
import { parseBrainQuestion, runTool, renderToolResult, getAiConfig, BRAIN_SUGGESTIONS_MANAGER, BRAIN_SUGGESTIONS_SELLER, type AiConfig } from '../lib/aiTools'
import { askIa, getIaModels, loadModel, saveModel, nextModel } from '../lib/aiClient'
import AiOwnerCard from '../components/AiOwnerCard'
import AiPicker, { AiConnections, type Engine, type GeminiState } from '../components/AiPicker'
import ReplyBody from '../components/ReplyBody'
import ReplyActions from '../components/ReplyActions'

/** `meta` (proveedor/modelo reales) queda solo para diagnóstico: la pantalla siempre dice «Copiloto». */
interface Bubble {
  id: number; from: 'me' | 'bot'; title?: string; lines?: string[]; text?: string; action?: { label: string; page: string }
  /** Avisos que viajan con la respuesta al copiar, compartir o imprimir. */
  notes?: string[]
  /** Datos de uso que solo se ven en pantalla (herramientas consultadas, consultas restantes). */
  info?: string[]
  /** Respuesta sustancial: muestra la barra Copiar · Compartir · WhatsApp · Imprimir. */
  rich?: boolean
  /** Pregunta que originó la respuesta (para la vista de impresión y el mensaje compartido). */
  question?: string
  meta?: { source: 'ia' | 'cerebro' | 'reglas'; provider?: string; model?: string }
}

const METHOD: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado' }
const num = (n: number) => fmtNum(Number(n), 2)

// «camisas reebok» → «camisa reebok»: así encuentra el producto aunque lo escribas en plural
const singular = (s: string) => s.split(' ').map(w => (w.length > 3 ? w.replace(/(es|s)$/, '') : w)).join(' ')

export default function AskCopilot({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = user?.role === 'dueno' || user?.role === 'admin'
  const [msgs, setMsgs] = useState<Bubble[]>([{ id: 0, from: 'bot', text: 'Hola, soy tu Copiloto. Pregúntame por tus ventas, tu stock, tus deudas o lo más vendido. Escribe como hablas.' }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [forceIa, setForceIa] = useState(false)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const idRef = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, busy])
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  // Estado del cerebro y de la IA de la empresa (si el SQL de la Etapa 1 aún no está, simplemente no se muestra)
  useEffect(() => { void getAiConfig().then(setCfg) }, [])
  // Modelos de IA que permite el servidor (vacío si la pasarela aún no está lista)
  useEffect(() => { void getIaModels().then(ms => { setModels(ms); setModel(loadModel(ms)) }) }, [])
  const iaReady = Boolean(cfg?.ai_enabled && cfg?.consent_ok && models.length > 0)
  const cycleModel = () => { const n = nextModel(models, model); setModel(n); saveModel(n) }
  // Lo que ve la persona: «InventarioPro» (cerebro propio) o «Gemini» (siempre con IA)
  const engine: Engine = forceIa && iaReady ? 'gemini' : 'brain'
  const onEngine = (e: Engine) => setForceIa(e === 'gemini')
  const geminiState: GeminiState = !cfg ? 'no_disponible' : !cfg.consent_ok ? 'pendiente' : !cfg.ai_enabled ? 'desactivado' : models.length ? 'conectado' : 'no_disponible'
  const geminiHint = geminiState === 'pendiente' ? 'El dueño debe aceptar el aviso de uso para activar Gemini.'
    : geminiState === 'desactivado' ? 'La IA está desactivada en tu empresa.'
    : 'Gemini no está disponible por ahora.'

  const push = (b: Omit<Bubble, 'id'>) => setMsgs(m => [...m, { ...b, id: idRef.current++ }])

  async function call(it: Intent) {
    let tz = 'America/Bogota'
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz } catch { /* usa el valor por defecto */ }
    return supabase.rpc('copilot_query', { p_kind: it.kind, p_arg: it.arg, p_period: it.period, p_tz: tz })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function render(r: any): Omit<Bubble, 'id' | 'from'> {
    switch (r.kind) {
      case 'ventas': {
        if (!r.count) return { text: `${r.mine ? 'Tú no registraste' : 'No hay'} ventas ${r.label === 'hoy' || r.label === 'ayer' ? '' : 'en '}${r.label}.` }
        const L = [`${r.count} ${r.count === 1 ? 'venta' : 'ventas'} · promedio ${money(r.avg)}`]
        for (const [k, v] of Object.entries(r.by_method as Record<string, number>)) if (Number(v) > 0) L.push(`• ${METHOD[k] ?? k}: ${money(Number(v))}`)
        return { title: `${r.mine ? 'Tú vendiste' : 'Vendiste'} ${money(r.total)} ${r.label === 'hoy' || r.label === 'ayer' ? r.label : 'en ' + r.label}`, lines: L }
      }
      case 'top_productos':
        if (!r.items.length) return { text: `No hay ventas ${r.label} para armar el ranking.` }
        return { title: `Lo más vendido ${r.label}`, lines: r.items.map((p: { name: string; qty: number; amount: number }, i: number) => `${i + 1}. ${p.name} — ${num(p.qty)} uds · ${money(p.amount)}`) }
      case 'top_clientes':
        if (!r.items.length) return { text: `No hay ventas ${r.label} para armar el ranking.` }
        return { title: `Tus mejores clientes ${r.label}`, lines: r.items.map((c: { name: string; count: number; amount: number }, i: number) => `${i + 1}. ${c.name} — ${money(c.amount)} (${c.count} ${c.count === 1 ? 'compra' : 'compras'})`) }
      case 'utilidad':
        if (!r.count) return { text: `No hay ventas ${r.label}, así que no hay utilidad que calcular.` }
        return { title: `Ganancia estimada ${r.label}: ${money(r.profit)}`, lines: [`Ventas (sin impuesto): ${money(r.revenue)}`, `Costo de lo vendido: ${money(r.cost)}`, `Margen: ${r.margin} %`, 'Se calcula con el costo actual de cada producto.'] }
      case 'stock_resumen': {
        const c = r.counts
        if (!c.sin_stock && !c.bajo_minimo) return { text: 'Todo bien: ningún producto está agotado ni bajo el mínimo.' }
        return {
          title: `${c.sin_stock} sin stock · ${c.bajo_minimo} bajo el mínimo`,
          lines: r.items.map((p: { name: string; stock: number; min_stock: number }) => `• ${p.name}: quedan ${num(p.stock)}${p.min_stock > 0 ? ` (mínimo ${num(p.min_stock)})` : ''}`),
          action: isManager ? { label: 'Ver sugerencia de compras', page: 'buyplan' } : { label: 'Ver productos', page: 'products' },
        }
      }
      case 'stock_producto':
        if (!r.items.length) return { text: `No encontré ningún producto parecido a «${r.arg}». Prueba con otra parte del nombre o con el código.` }
        return {
          title: r.items.length === 1 ? undefined : `Encontré ${r.items.length} productos`,
          lines: r.items.map((p: { name: string; stock: number; min_stock: number; price: number }) =>
            `• ${p.name}: ${num(p.stock)} en stock${p.min_stock > 0 && p.stock <= p.min_stock ? ' (bajo el mínimo)' : ''} · precio ${money(p.price)}`),
        }
      case 'deuda_total':
        if (!(r.owed > 0)) return { text: 'Nadie te debe nada por fiado.' }
        return {
          title: `Te deben ${money(r.owed)}${r.overdue > 0 ? ` (${money(r.overdue)} vencido)` : ''}`,
          lines: r.items.map((c: { name: string; owed: number }) => `• ${c.name}: ${money(c.owed)}`),
          action: { label: 'Ver cartera', page: 'cartera' },
        }
      case 'deuda_cliente':
        if (!r.items.length) return { text: `No encontré ningún cliente parecido a «${r.arg}».` }
        return {
          title: undefined,
          lines: r.items.map((c: { name: string; owed: number; overdue: number }) =>
            c.owed > 0 ? `• ${c.name} debe ${money(c.owed)}${c.overdue > 0 ? ` (${money(c.overdue)} vencido)` : ''}` : `• ${c.name} no debe nada`),
          action: { label: 'Ver cartera', page: 'cartera' },
        }
      default:
        return { text: 'No pude armar esa respuesta.' }
    }
  }

  /** Responde con IA (Gemini). Devuelve true si respondió; si falla, avisa y devuelve false para usar las reglas. */
  async function askWithIa(q: string): Promise<boolean> {
    if (!navigator.onLine) { push({ from: 'bot', text: 'Sin conexión no puedo usar la IA.' }); return false }
    setBusy(true)
    const r = await askIa(q, model)
    setBusy(false)
    if (!r.ok) { push({ from: 'bot', text: r.error }); return false }
    const info = [
      r.tools.length ? `Consultó ${r.tools.length} ${r.tools.length === 1 ? 'herramienta' : 'herramientas'} de tus datos.` : 'No consultó tus datos.',
      r.cached ? 'Respuesta guardada de hace unos minutos.' : `Te quedan ${r.remaining} consultas con IA hoy.`,
    ]
    // La pantalla no muestra el modelo: queda en `meta` para diagnóstico y auditoría
    push({ from: 'bot', text: r.answer, notes: ['Generado por IA: verifica las cifras importantes.'], info, rich: true, question: q, meta: { source: 'ia', provider: r.provider, model: r.model } })
    if (!r.cached) void getAiConfig().then(setCfg)
    return true
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    push({ from: 'me', text: q })
    setInput('')
    // Modo «siempre con IA»: si la IA falla, se sigue con las reglas de siempre
    if (forceIa && iaReady && await askWithIa(q)) return
    // Preguntas del cerebro ampliado (resumen financiero, caja, reposición, rentabilidad…)
    const brain = parseBrainQuestion(q, isManager)
    if (brain) {
      if (!navigator.onLine) { push({ from: 'bot', text: 'Sin conexión no puedo consultar tus datos. Inténtalo cuando vuelva la señal.' }); return }
      setBusy(true)
      const res = await runTool(brain)
      setBusy(false)
      push({ from: 'bot', ...renderToolResult(res, money, num, isManager), rich: res.ok, question: q, meta: { source: 'cerebro' } })
      return
    }
    const it = parseQuestion(q)
    if (!it) {
      // Pregunta que las reglas no entienden: la IA (si la empresa la activó) intenta responderla
      if (iaReady && !forceIa) { await askWithIa(q); return }
      push({ from: 'bot', text: 'Aún no entiendo esa pregunta. Prueba con algo como «¿cuánto vendí hoy?», «¿quién me debe?» o «¿cuántas camisas quedan?».' })
      return
    }
    if (!navigator.onLine) { push({ from: 'bot', text: 'Sin conexión no puedo consultar tus datos. Inténtalo cuando vuelva la señal.' }); return }
    setBusy(true)
    let { data, error } = await call(it)
    // si no encontró el producto o cliente, reintenta con las palabras en singular
    if (!error && it.arg && data && Array.isArray(data.items) && data.items.length === 0 && singular(norm(it.arg)) !== norm(it.arg)) {
      const r2 = await call({ ...it, arg: singular(norm(it.arg)) })
      if (!r2.error && r2.data && r2.data.items?.length) { data = r2.data; error = r2.error }
    }
    setBusy(false)
    if (error) {
      const m = error.message || ''
      if (/copilot_query|does not exist|schema cache/i.test(m)) push({ from: 'bot', text: 'Esta función aún no está activada en tu base de datos. Ejecuta el SQL de «Pregúntale al Copiloto» en Supabase.' })
      else if (/solo para el due/i.test(m)) push({ from: 'bot', text: 'Esa información solo la ve el dueño o el administrador.' })
      else push({ from: 'bot', text: 'No pude consultar: ' + m })
      return
    }
    const out = render(data)
    push({ from: 'bot', ...out, rich: Boolean(out.title || out.lines?.length), question: q, meta: { source: 'reglas' } })
  }

  const base = isManager ? SUGGESTIONS : SUGGESTIONS.filter(s => !/gané|debe/i.test(s))
  const chips = [...base, ...(isManager ? BRAIN_SUGGESTIONS_MANAGER : BRAIN_SUGGESTIONS_SELLER)]

  return (
    <div className="max-w-2xl flex flex-col min-h-[calc(100vh-9rem)] supports-[height:100dvh]:min-h-[calc(100dvh-9rem)]">
      {/* Identidad fija: siempre «Copiloto», responda quien responda */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative w-11 h-11 rounded-2xl bg-slate-800 flex items-center justify-center shrink-0">
          <MessageCircleQuestion className="w-6 h-6 text-white" />
          <span title={online ? 'Disponible' : 'Sin conexión'} className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-50 ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-800 leading-tight">Copiloto</h1>
          <p className="text-xs sm:text-sm text-slate-500 leading-snug">Inteligencia empresarial de InventarioPro</p>
        </div>
      </div>
      {cfg ? (
        <>
          <AiPicker engine={engine} onEngine={onEngine} online={online} geminiReady={iaReady} geminiHint={geminiHint} models={models} model={model} onCycleModel={cycleModel} />
          {cfg.is_owner && <AiConnections gemini={geminiState} />}
        </>
      ) : null}
      {cfg?.is_owner && <AiOwnerCard cfg={cfg} onChange={setCfg} />}

      <div className="flex-1 space-y-2 pb-3">
        {msgs.map(m => (
          <div key={m.id} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
            {m.from === 'me' ? (
              <div className="max-w-[88%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm bg-slate-800 text-white whitespace-pre-line break-words">{m.text}</div>
            ) : (
              <div data-source={m.meta?.source} data-provider={m.meta?.provider} data-model={m.meta?.model}
                className="max-w-[92%] sm:max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-3 text-sm bg-white border border-slate-200 text-slate-700 break-words">
                {m.id !== 0 && <p className="flex items-center gap-1 mb-1.5 text-xs font-medium text-emerald-700"><Sparkles className="w-3.5 h-3.5 text-emerald-500" /> Copiloto</p>}
                <ReplyBody content={m} />
                {m.info && m.info.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-slate-400">{m.info.map((l, i) => <li key={i}>{l}</li>)}</ul>}
                {m.action && onNavigate && <button onClick={() => onNavigate(m.action!.page)} className="mt-3 text-xs font-medium bg-slate-800 text-white px-3 py-2 rounded-lg hover:bg-slate-700">{m.action.label}</button>}
                {m.rich && <ReplyActions content={m} question={m.question} />}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-slate-400">Consultando…</div></div>}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 bg-slate-50 pt-2 pb-[env(safe-area-inset-bottom)] space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {chips.map(s => <button key={s} onClick={() => ask(s)} disabled={busy} className="shrink-0 text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100 disabled:opacity-50">{s}</button>)}
        </div>
        <form onSubmit={e => { e.preventDefault(); void ask(input) }} className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} maxLength={200} placeholder="Escribe tu pregunta…" className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 text-base sm:text-sm bg-white" />
          <button type="submit" disabled={busy || !input.trim()} className="shrink-0 bg-slate-800 text-white px-4 rounded-xl hover:bg-slate-700 disabled:opacity-40" aria-label="Enviar"><Send className="w-4 h-4" /></button>
        </form>
      </div>
    </div>
  )
}
