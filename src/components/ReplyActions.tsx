import { useEffect, useRef, useState } from 'react'
import { Copy, Share2, MessageCircle, Printer } from 'lucide-react'
import { copyToClipboard, buildReplyText, shareReply, openWhatsApp, printReply, type ReplyContent } from '../lib/copilotShare'

/** Barra de acciones bajo cada respuesta sustancial del Copiloto. */
export default function ReplyActions({ content, question }: { content: ReplyContent; question?: string }) {
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const say = (text: string, ok = true) => {
    setNote({ text, ok })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNote(null), 3000)
  }

  async function copy() {
    if (await copyToClipboard(buildReplyText(content))) say('Respuesta copiada')
    else say('No se pudo copiar. Mantén pulsado el texto para copiarlo.', false)
  }

  async function share() {
    const r = await shareReply(content, question)
    if (r === 'copied') say('Tu equipo no permite compartir directamente; copié la respuesta.')
    else if (r === 'failed') say('No se pudo compartir ni copiar la respuesta.', false)
    /* 'shared' y 'cancelled': el propio sistema ya mostró el resultado */
  }

  const btn = 'min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium active:bg-slate-100'
  const plain = `${btn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button type="button" onClick={() => void copy()} className={plain}><Copy className="w-4 h-4" /> Copiar</button>
        <button type="button" onClick={() => void share()} className={plain}><Share2 className="w-4 h-4" /> Compartir</button>
        <button type="button" onClick={() => openWhatsApp(content, question)} className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}><MessageCircle className="w-4 h-4" /> WhatsApp</button>
        <button type="button" onClick={() => printReply(content, question)} className={plain}><Printer className="w-4 h-4" /> Imprimir</button>
      </div>
      <p role="status" aria-live="polite" className={`text-xs mt-2 ${note ? (note.ok ? 'text-emerald-700' : 'text-red-600') : 'hidden'}`}>{note?.text}</p>
    </div>
  )
}
