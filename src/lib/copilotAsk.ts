/**
 * «Pregúntale al Copiloto»: entiende preguntas en español y las convierte en una consulta segura
 * a tus propios datos. No usa IA externa: no tiene costo y no envía tus datos a nadie.
 */
export type Period = 'hoy' | 'ayer' | 'semana' | '7dias' | 'mes' | 'mes_pasado' | '30dias'
export type AskKind = 'ventas' | 'top_productos' | 'top_clientes' | 'utilidad' | 'stock' | 'deuda'
export interface Intent { kind: AskKind; arg: string | null; period: Period }

export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:()"]/g, ' ').replace(/\s+/g, ' ').trim()
}

function detectPeriod(t: string): Period {
  if (/\bmes (pasado|anterior)\b|\bultimo mes\b/.test(t)) return 'mes_pasado'
  if (/\b(30|treinta) dias\b/.test(t)) return '30dias'
  if (/\b(7|siete) dias\b|\bultima semana\b|\bsemana pasada\b/.test(t)) return '7dias'
  if (/\best(e|a) mes\b|\bdel mes\b|\bmensual\b|\ben el mes\b/.test(t)) return 'mes'
  if (/\best(a|e) semana\b|\bsemanal\b|\bde la semana\b/.test(t)) return 'semana'
  if (/\bayer\b/.test(t)) return 'ayer'
  if (/\bmes\b/.test(t)) return 'mes'
  if (/\bsemana\b/.test(t)) return 'semana'
  return 'hoy'
}

const STOP = new Set(['cuanto', 'cuantos', 'cuantas', 'cuanta', 'que', 'quien', 'quienes', 'me', 'te', 'mi', 'mis', 'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'a', 'en', 'por', 'para', 'y', 'o', 'es', 'son', 'hay', 'tengo', 'tiene', 'tienen', 'queda', 'quedan', 'cuesta', 'cuestan', 'vale', 'valen', 'precio', 'stock', 'existencia', 'existencias', 'inventario', 'unidades', 'unidad', 'producto', 'productos', 'articulo', 'cliente', 'clientes', 'debe', 'deben', 'deuda', 'fiado', 'saldo', 'cartera', 'esta', 'este', 'hoy', 'ayer', 'mes', 'semana', 'dime', 'dame', 'muestrame', 'ver', 'saber', 'quiero', 'cual', 'cuales', 'sera', 'ya', 'todavia', 'aun', 'se', 'lo', 'le', 'tal', 'si', 'puedes', 'favor', 'por', 'pasado', 'anterior', 'ultimo', 'ultima'])

function leftover(t: string): string | null {
  const w = t.split(' ').filter(x => x && !STOP.has(x))
  return w.length ? w.join(' ') : null
}

/** Devuelve la consulta que corresponde a la pregunta, o null si no la entendió. */
export function parseQuestion(q: string): Intent | null {
  const t = norm(q)
  if (!t) return null
  const period = detectPeriod(t)

  if (/\b(utilidad|ganancia|ganancias|gane|ganado|margen|rentab)/.test(t)) return { kind: 'utilidad', arg: null, period: period === 'hoy' && !/\bhoy\b/.test(t) ? 'mes' : period }
  if (/\b(mejor(es)? clientes?|clientes? que mas|quien(es)? (me )?compra(n)? mas|top clientes)/.test(t)) return { kind: 'top_clientes', arg: null, period: period === 'hoy' && !/\bhoy\b/.test(t) ? 'mes' : period }
  if (/(mas vendid|se vende(n)? mas|se vendio mas|top productos|mejores productos|que (mas )?(se )?vend)/.test(t)) return { kind: 'top_productos', arg: null, period: period === 'hoy' && !/\bhoy\b/.test(t) ? 'mes' : period }
  if (/\b(debe|deben|deuda|deudas|fiado|fiados|cartera|por cobrar|moroso|morosos|me deben)/.test(t)) {
    const m = t.match(/\b(?:debe|deuda de|fiado a|saldo de|cartera de)\s+(.+)$/)
    return { kind: 'deuda', arg: m ? leftover(m[1]) : leftover(t), period }
  }
  if (/\b(se agota|agotan|agotado|agotados|por acabar|se acaba|se acaban|bajo (el )?minimo|sin stock|poco stock|faltan?|reponer)/.test(t)) return { kind: 'stock', arg: null, period }
  if (/\b(stock|quedan|queda|hay|existencias?|inventario|precio|cuesta|cuestan|vale|valen|unidades|tengo)\b/.test(t)) {
    const arg = leftover(t)
    return { kind: 'stock', arg, period }
  }
  if (/\b(vend|venta|ventas|vendi|vendimos|facturado|facturacion|ingresos?|recaud|entro|entrado)/.test(t)) return { kind: 'ventas', arg: null, period }
  return null
}

export const SUGGESTIONS = [
  '¿Cuánto vendí hoy?',
  '¿Quién me debe?',
  '¿Qué se está agotando?',
  'Productos más vendidos del mes',
  '¿Cuánto gané este mes?',
  '¿Cuánto vendí ayer?',
]
