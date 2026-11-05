/**
 * Copiloto · Acciones sobre una respuesta: copiar, compartir, WhatsApp e imprimir.
 * Reutiliza `esc` y `printHtml` de documents.ts (los mismos que usa Ventas).
 * No toca cifras: el texto que sale es exactamente el que se mostró en el chat.
 */
import { esc, printHtml } from './documents'
import { fmtDateTime } from './currency'

export interface ReplyContent {
  title?: string
  text?: string
  lines?: string[]
  /** Avisos que viajan con la respuesta (p. ej. «Generado por IA: verifica las cifras importantes.»). */
  notes?: string[]
}

export const BRAND = 'Copiloto de InventarioPro'

/** Texto plano completo de la respuesta: título, texto, listas y avisos. */
export function buildReplyText(r: ReplyContent): string {
  return [r.title, r.text, r.lines?.join('\n'), r.notes?.join('\n')]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join('\n\n')
}

/** Mensaje listo para compartir: encabezado de marca + pregunta (si hay) + respuesta. */
export function buildShareMessage(r: ReplyContent, question?: string): string {
  return [`*${BRAND}*`, question ? `Pregunta: ${question}` : '', buildReplyText(r)]
    .filter(Boolean)
    .join('\n\n')
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* se prueba el método alterno */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed'

/** Compartir nativo; si el equipo no lo admite (o falla), copia el contenido. */
export async function shareReply(r: ReplyContent, question?: string): Promise<ShareOutcome> {
  const text = buildShareMessage(r, question)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: BRAND, text })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      /* otro error: se intenta copiar */
    }
  }
  return (await copyToClipboard(text)) ? 'copied' : 'failed'
}

/** Abre WhatsApp con el texto preparado. No envía nada: la persona confirma en WhatsApp. */
export function openWhatsApp(r: ReplyContent, question?: string): void {
  window.open('https://wa.me/?text=' + encodeURIComponent(buildShareMessage(r, question)), '_blank', 'noopener')
}

const block = (s: string) => `<p>${esc(s).replace(/\n/g, '<br>')}</p>`

/** Vista de impresión de UNA respuesta (no el chat ni el menú). */
export function buildReplyHtml(r: ReplyContent, question?: string): string {
  const logo = `${window.location.origin}/logo_inventarioPro.png`
  const lines = (r.lines ?? []).map(l => `<div class="l">${esc(l)}</div>`).join('')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(BRAND)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:0;padding:28px;font-size:14px;line-height:1.5}
.head{display:flex;align-items:center;gap:12px;border-bottom:2px solid #059669;padding-bottom:12px;margin-bottom:18px}
.head img{height:44px;width:auto}
h1{margin:0;font-size:20px}
.muted{color:#64748b;font-size:12px}
.q{background:#f1f5f9;border-radius:8px;padding:10px 12px;margin-bottom:18px}
.q b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:2px}
h2{margin:0 0 8px;font-size:17px}
p{margin:0 0 10px}
.l{margin:0 0 4px}
.notes{margin-top:18px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:11px;color:#64748b}
@media print{body{padding:0}}
</style></head><body>
<div class="head"><img src="${esc(logo)}" alt="" onerror="this.remove()"><div><h1>${esc(BRAND)}</h1><div class="muted">Generado el ${esc(fmtDateTime(new Date()))}</div></div></div>
${question ? `<div class="q"><b>Pregunta</b>${esc(question)}</div>` : ''}
${r.title ? `<h2>${esc(r.title)}</h2>` : ''}
${r.text ? block(r.text) : ''}
${lines}
${r.notes?.length ? `<div class="notes">${r.notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>` : ''}
</body></html>`
}

export function printReply(r: ReplyContent, question?: string): void {
  printHtml(buildReplyHtml(r, question))
}
