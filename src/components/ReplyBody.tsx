import { Info, Lightbulb } from 'lucide-react'
import type { ReplyContent } from '../lib/copilotShare'

/**
 * Presentación segura de una respuesta del Copiloto.
 * Todo se pinta como texto de React (nunca como HTML): lo que llegue no puede ejecutar nada.
 * Solo se da formato (negritas **así**, listas, títulos); las cifras se muestran tal cual llegaron.
 */

type Block =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; start: number; items: string[] }
  | { t: 'note'; text: string }
  | { t: 'rec'; text: string }

const BULLET = /^\s*[•\-*·]\s+(.*)$/
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/
const HEAD = /^\s*#{1,4}\s+(.*)$/
const NOTE = /^\s*ℹ\s*(.*)$/
const REC = /^\s*(?:ℹ\s*)?(?:\*\*)?(?:Recomendaci[oó]n|Recomendaciones|Sugerencia|Te recomiendo|Mi recomendaci[oó]n)/i
const TOKEN = /(\*\*[^*\n]+\*\*|[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?%)/

function parseBlocks(src: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ t: 'p', text: para.join('\n') }); para = [] } }
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); continue }
    if (REC.test(line)) { flush(); out.push({ t: 'rec', text: line.replace(/^\s*ℹ\s*/, '') }); continue }
    const nm = NOTE.exec(line)
    if (nm) { flush(); out.push({ t: 'note', text: nm[1] }); continue }
    const hm = HEAD.exec(line)
    if (hm) { flush(); out.push({ t: 'h', text: hm[1] }); continue }
    const bm = BULLET.exec(line)
    if (bm) {
      flush()
      const last = out[out.length - 1]
      if (last && last.t === 'ul') last.items.push(bm[1])
      else out.push({ t: 'ul', items: [bm[1]] })
      continue
    }
    const om = NUMBER.exec(line)
    if (om) {
      flush()
      const last = out[out.length - 1]
      if (last && last.t === 'ol') last.items.push(om[2])
      else out.push({ t: 'ol', start: Number(om[1]), items: [om[2]] })
      continue
    }
    para.push(line)
  }
  flush()
  return out
}

/** Resalta negritas y cifras (con $, € o %) sin cambiar ni un carácter del texto. */
function Inline({ s }: { s: string }) {
  const parts = s.split(TOKEN)
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p
        if (p.startsWith('**')) return <strong key={i} className="font-semibold text-slate-800">{p.slice(2, -2)}</strong>
        return <span key={i} className="font-semibold text-slate-800 tabular-nums whitespace-nowrap">{p}</span>
      })}
    </>
  )
}

export default function ReplyBody({ content }: { content: ReplyContent }) {
  const blocks: Block[] = [
    ...parseBlocks(content.text ?? ''),
    ...parseBlocks((content.lines ?? []).join('\n')),
    ...(content.notes ?? []).map((n): Block => ({ t: 'note', text: n })),
  ]
  return (
    <div className="space-y-2 leading-relaxed">
      {content.title && <p className="font-semibold text-slate-800 text-[15px] leading-snug"><Inline s={content.title} /></p>}
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': return <p key={i} className="font-semibold text-slate-800 pt-1"><Inline s={b.text} /></p>
          case 'p': return <p key={i} className="text-slate-700 whitespace-pre-line"><Inline s={b.text} /></p>
          case 'ul': return <ul key={i} className="list-disc pl-5 space-y-1 text-slate-700 marker:text-emerald-500">{b.items.map((t, j) => <li key={j}><Inline s={t} /></li>)}</ul>
          case 'ol': return <ol key={i} start={b.start} className="list-decimal pl-5 space-y-1 text-slate-700 marker:text-slate-400 marker:font-medium">{b.items.map((t, j) => <li key={j}><Inline s={t} /></li>)}</ol>
          case 'rec': return (
            <div key={i} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span><Inline s={b.text} /></span>
            </div>
          )
          case 'note': return (
            <p key={i} className="flex gap-1.5 text-xs text-slate-500 leading-snug">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" />
              <span>{b.text}</span>
            </p>
          )
        }
      })}
    </div>
  )
}
