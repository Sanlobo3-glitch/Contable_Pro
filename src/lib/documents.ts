import type { CompanyConfig } from '../types'
import { formatMoney } from './currency'

export const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export interface DocData {
  title: string
  number: string
  date: string
  extra?: string
  badge?: string
  partyRoleLabel?: string
  unitColLabel?: string
  partyName: string
  partyLines?: (string | null | undefined | false)[]
  lines: { name: string; quantity: number; price: number; subtotal: number }[]
  /** Opcionales: si hay impuesto, se muestran Subtotal e Impuesto antes del Total. */
  subtotal?: number
  taxRate?: number
  taxAmount?: number
  total: number
  paymentLabel?: string
  /** Si el cliente pagó en otra moneda. `equivalent` está en la moneda de la empresa. */
  /** equivalent = total recibido (divisa convertida + baseAmount); baseAmount = parte recibida en la moneda de la empresa. */
  fx?: { currency: string; amount: number; rate: number; equivalent: number; baseAmount?: number }
  footer?: string
}

export function buildDocHtml(d: DocData, cfg: CompanyConfig | null): string {
  const money = (n: number) => esc(formatMoney(n, cfg?.currency))
  const roleLabel = d.partyRoleLabel || 'Cliente'
  const unitLabel = d.unitColLabel || 'Precio'
  const rows = d.lines.map(l =>
    `<tr><td>${esc(l.name)}</td><td class="r">${esc(l.quantity)}</td><td class="r">${money(l.price)}</td><td class="r">${money(l.subtotal)}</td></tr>`
  ).join('')
  const companyLines = [cfg?.rif && `ID fiscal: ${cfg.rif}`, cfg?.address, cfg?.phone && `Tel: ${cfg.phone}`, cfg?.email]
    .filter(Boolean).map(l => `<div>${esc(l)}</div>`).join('')
  const partyLines = (d.partyLines ?? []).filter(Boolean).map(l => `<div>${esc(l)}</div>`).join('')
  const hasTax = typeof d.taxAmount === 'number' && d.taxAmount > 0
  const taxRows = hasTax
    ? `<div class="sub">Subtotal: ${money(d.subtotal ?? d.total - (d.taxAmount as number))}</div><div class="sub">Impuesto${d.taxRate ? ` (${esc(d.taxRate)}%)` : ''}: ${money(d.taxAmount as number)}</div>`
    : ''

  const fxDiff = d.fx ? Math.round((d.fx.equivalent - d.total) * 100) / 100 : 0
  const fxRows = d.fx
    ? `<div class="sub">Pagó en ${esc(d.fx.currency)}: ${esc(formatMoney(d.fx.amount, d.fx.currency))} (tasa: 1 ${esc(d.fx.currency)} = ${money(d.fx.rate)})</div>${d.fx.baseAmount ? `<div class="sub">Además recibió: ${money(d.fx.baseAmount)}</div>` : ''}${fxDiff > 0 ? `<div class="sub">Cambio: ${money(fxDiff)}</div>` : ''}`
    : ''

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.number)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:0;padding:24px;font-size:13px}
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #1e293b;padding-bottom:12px;margin-bottom:16px}
h1{margin:0 0 4px;font-size:20px}
.muted{color:#64748b}
.title{text-align:right}
.title h2{margin:0;font-size:16px;letter-spacing:1px}
.badge{display:inline-block;margin-top:6px;padding:2px 8px;border:2px solid #dc2626;color:#dc2626;font-weight:bold;font-size:12px}
.box{margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{background:#f1f5f9;text-align:left;padding:8px;font-size:11px;text-transform:uppercase}
td{padding:8px;border-bottom:1px solid #e2e8f0}
.r,th.r{text-align:right}
.sub{margin-top:8px;text-align:right;font-size:13px;color:#475569}
.total{margin-top:12px;text-align:right;font-size:16px;font-weight:bold}
.foot{margin-top:32px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:8px}
@media print{body{padding:0}}
</style></head><body>
<div class="head">
  <div><h1>${esc(cfg?.name || 'Mi Empresa')}</h1><div class="muted">${companyLines}</div></div>
  <div class="title"><h2>${esc(d.title)}</h2><div>${esc(d.number)}</div><div class="muted">Fecha: ${esc(d.date)}</div>${d.extra ? `<div class="muted">${esc(d.extra)}</div>` : ''}${d.badge ? `<div class="badge">${esc(d.badge)}</div>` : ''}</div>
</div>
<div class="box"><strong>${esc(roleLabel)}:</strong> ${esc(d.partyName)}<div class="muted">${partyLines}</div>${d.paymentLabel ? `<div class="muted" style="margin-top:4px">${esc(d.paymentLabel)}</div>` : ''}</div>
<table><thead><tr><th>Descripción</th><th class="r">Cant.</th><th class="r">${esc(unitLabel)}</th><th class="r">Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
${taxRows}
<div class="total">Total: ${money(d.total)}</div>
${fxRows}
${d.footer ? `<div class="foot">${esc(d.footer)}</div>` : ''}
</body></html>`
}

async function waitForDocumentImages(doc: Document, timeoutMs = 3500): Promise<void> {
  const imgs = Array.from(doc.images || [])
  if (imgs.length === 0) {
    await new Promise(resolve => window.setTimeout(resolve, 140))
    return
  }

  const loadPromises = imgs.map(
    img =>
      new Promise<void>(resolve => {
        const settle = () => {
          if (typeof img.decode === 'function') {
            img
              .decode()
              .catch(() => {})
              .finally(() => resolve())
          } else {
            resolve()
          }
        }
        if (img.complete && img.naturalWidth > 0) {
          settle()
          return
        }
        if (img.complete) {
          resolve()
          return
        }
        img.addEventListener('load', settle, { once: true })
        img.addEventListener('error', () => resolve(), { once: true })
      })
  )

  await Promise.race([
    Promise.all(loadPromises),
    new Promise<void>(resolve => window.setTimeout(resolve, timeoutMs)),
  ])
  await new Promise(resolve => window.setTimeout(resolve, 180))
}

export function printHtml(html: string) {
  try {
    const inIframe = window.self !== window.top
    if (!inIframe) {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(html)
        w.document.close()
        w.focus()
        void waitForDocumentImages(w.document).then(() => {
          w.print()
        })
        return
      }
    }
  } catch {
    // Si el navegador bloquea ventanas emergentes, imprimimos en un marco oculto con dimensiones A4 reales
  }

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.left = '-9999px'
  frame.style.top = '0'
  frame.style.width = '820px'
  frame.style.height = '1160px'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
  frame.style.border = '0'
  document.body.appendChild(frame)

  const doc = frame.contentWindow?.document
  if (!doc || !frame.contentWindow) {
    document.body.removeChild(frame)
    return
  }
  doc.open()
  doc.write(html)
  doc.close()
  void waitForDocumentImages(doc).then(() => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } finally {
      window.setTimeout(() => {
        if (frame.parentNode) frame.parentNode.removeChild(frame)
      }, 4000)
    }
  })
}

export function buildShareText(d: DocData, cfg: CompanyConfig | null): string {
  const money = (n: number) => formatMoney(n, cfg?.currency)
  const roleLabel = d.partyRoleLabel || 'Cliente'
  const hasTax = typeof d.taxAmount === 'number' && d.taxAmount > 0
  const fxDiff = d.fx ? Math.round((d.fx.equivalent - d.total) * 100) / 100 : 0
  const lines: (string | undefined | false)[] = [
    `${d.title} ${d.number}`,
    cfg?.name || '',
    '',
    `${roleLabel}: ${d.partyName}`,
    `Fecha: ${d.date}`,
    d.extra,
    d.paymentLabel,
    '',
    ...d.lines.map(l => `- ${l.name} x${l.quantity}: ${money(l.subtotal)}`),
    '',
    hasTax && `Subtotal: ${money(d.subtotal ?? d.total - (d.taxAmount as number))}`,
    hasTax && `Impuesto${d.taxRate ? ` (${d.taxRate}%)` : ''}: ${money(d.taxAmount as number)}`,
    `TOTAL: ${money(d.total)}`,
    d.fx && `Pagó en ${d.fx.currency}: ${formatMoney(d.fx.amount, d.fx.currency)} (tasa: 1 ${d.fx.currency} = ${money(d.fx.rate)})`,
    d.fx && d.fx.baseAmount ? `Además recibió: ${money(d.fx.baseAmount)}` : undefined,
    d.fx && fxDiff > 0 && `Cambio: ${money(fxDiff)}`,
    d.badge,
    cfg?.phone ? `Contacto: ${cfg.phone}` : '',
  ]
  return lines.filter((l): l is string => typeof l === 'string').join('\n')
  }
