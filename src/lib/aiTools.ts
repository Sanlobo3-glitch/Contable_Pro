/**
 * Cerebro de datos (Plan 2 · Etapa 1). Sin IA externa.
 *
 * Todo pasa por UN solo punto de entrada en la base de datos: `ai_run_tool`.
 * Ahí se valida la sesión, el rol y los límites, y se deja registro de la consulta.
 * La empresa y el rol salen siempre de la sesión: este archivo nunca los envía.
 */
import { supabase } from './supabase'
import { norm } from './copilotAsk'

export type ToolName =
  | 'ventas_resumen' | 'top_productos' | 'top_clientes' | 'stock_producto'
  | 'inventario_riesgo' | 'reposicion' | 'clientes_dormidos' | 'cartera' | 'cuentas_por_pagar'
  | 'rentabilidad' | 'caja_resumen' | 'vendedores' | 'contabilidad_estado' | 'resumen_financiero'

/** confirmado = registros reales · estimado = proyección · recomendacion = sugerencia · mixto = combina datos y estimaciones */
export type Nature = 'confirmado' | 'estimado' | 'recomendacion' | 'mixto'

export interface ToolRequest { tool: ToolName; args: Record<string, string | number> }

export interface ToolOk {
  ok: true
  tool: ToolName
  nature: Nature
  generated_at: string
  duration_ms: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  notes: string[]
}
export interface ToolFail { ok: false; status: 'denied' | 'error' | 'limit'; error: string }
export type ToolResult = ToolOk | ToolFail

export interface ToolBubble {
  title?: string
  lines?: string[]
  text?: string
  action?: { label: string; page: string }
}

/** Herramientas que solo ve el dueño o el administrador. */
const MANAGER_ONLY: ToolName[] = [
  'top_clientes', 'inventario_riesgo', 'reposicion', 'cartera', 'cuentas_por_pagar', 'rentabilidad',
  'caja_resumen', 'vendedores', 'contabilidad_estado', 'resumen_financiero',
]

type Period = 'hoy' | 'ayer' | 'semana' | '7dias' | 'mes' | 'mes_pasado' | '30dias'

function detectPeriod(t: string, fallback: Period): Period {
  if (/\bmes (pasado|anterior)\b|\bultimo mes\b/.test(t)) return 'mes_pasado'
  if (/\b(30|treinta) dias\b/.test(t)) return '30dias'
  if (/\b(7|siete) dias\b|\bultima semana\b|\bsemana pasada\b/.test(t)) return '7dias'
  if (/\best(e|a) mes\b|\bdel mes\b|\bmensual\b|\ben el mes\b/.test(t)) return 'mes'
  if (/\best(a|e) semana\b|\bsemanal\b|\bde la semana\b/.test(t)) return 'semana'
  if (/\bayer\b/.test(t)) return 'ayer'
  if (/\bhoy\b/.test(t)) return 'hoy'
  return fallback
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Rango de fechas (hora local del dispositivo) para las herramientas que reciben desde/hasta. */
function rangeFor(p: Period): { from: string; to: string } {
  const today = new Date()
  const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c }
  switch (p) {
    case 'hoy': return { from: iso(today), to: iso(today) }
    case 'ayer': { const y = addDays(today, -1); return { from: iso(y), to: iso(y) } }
    case 'semana': { const dow = (today.getDay() + 6) % 7; return { from: iso(addDays(today, -dow)), to: iso(today) } }
    case '7dias': return { from: iso(addDays(today, -6)), to: iso(today) }
    case 'mes': return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) }
    case 'mes_pasado': return {
      from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
    default: return { from: iso(addDays(today, -29)), to: iso(today) }
  }
}

/**
 * Reconoce las preguntas que responde el cerebro ampliado. Devuelve null si no es una de ellas
 * (entonces se usa el Copiloto de siempre). Si no eres dueño/administrador, las herramientas de
 * gestión no se ofrecen: la pregunta sigue el camino anterior.
 */
export function parseBrainQuestion(q: string, isManager: boolean): ToolRequest | null {
  const t = norm(q)
  if (!t) return null
  let req: ToolRequest | null = null

  if (/resumen financiero|como va (mi |el )?negocio|estado (financiero|del negocio)|salud (financiera|del negocio)|panorama (financiero|del negocio)|como (estan|van) mis finanzas/.test(t)) {
    req = { tool: 'resumen_financiero', args: { period: detectPeriod(t, 'mes') } }
  } else if (/cierre (contable|de libros|del mes)|conciliacion|esta cuadrada|que falta (para )?cerrar|contabilidad (al dia|cuadra)/.test(t)) {
    req = { tool: 'contabilidad_estado', args: {} }
  } else if (/\bcaja\b|arqueo|cuanto gaste|egresos|gastos (de|del)\b/.test(t)) {
    req = { tool: 'caja_resumen', args: rangeFor(detectPeriod(t, '30dias')) }
  } else if (/vendedores|equipo de ventas|quien (vende|vendio) mas|ranking de (ventas|vendedores)|metas? del equipo/.test(t)) {
    req = { tool: 'vendedores', args: { period: detectPeriod(t, 'mes') } }
  } else if (/reponer|que (debo|tengo que|hay que) comprar|sugerencia de compra|pedido a proveedor|reposicion/.test(t)) {
    req = { tool: 'reposicion', args: { cover_days: 15 } }
  } else if (/estancad|sin rotacion|sin moverse|sin movimiento|exceso de (stock|inventario)|inmovilizad|riesgo de agot|se (me )?van a agotar/.test(t)) {
    req = { tool: 'inventario_riesgo', args: { cover_days: 15 } }
  } else if (/clientes? (dormid|inactiv|perdid|que dejaron|se (estan )?enfria)|dejaron de comprar|recuperar clientes|clientes en riesgo|clientes por recuperar/.test(t)) {
    req = { tool: 'clientes_dormidos', args: { limit: 15 } }
  } else if (/rentabilidad|margen bajo|por producto|clasificacion abc|debajo del costo|productos? (que )?(me )?(pierden|dan perdida)|que producto (me )?deja mas/.test(t)) {
    req = { tool: 'rentabilidad', args: rangeFor(detectPeriod(t, '30dias')) }
  } else if (/cartera vencida|morosos?|detalle de (la )?cartera|quien esta atrasado/.test(t)) {
    req = { tool: 'cartera', args: {} }
  } else if (/cuentas? por pagar|obligaciones por pagar|(cuanto |que )?(le )?debo\b|deuda(s)? (con |a )?proveedor|pagar a proveedor|proveedores? vencid|facturas? (de |a )?proveedor|a quien(es)? le(s)? debo/.test(t)) {
    req = { tool: 'cuentas_por_pagar', args: {} }
  }

  if (!req) return null
  if (!isManager && MANAGER_ONLY.includes(req.tool)) return null
  return req
}

/** Preguntas sugeridas del cerebro ampliado. */
export const BRAIN_SUGGESTIONS_MANAGER = [
  'Resumen financiero del mes',
  '¿Cuánto debo a proveedores?',
  '¿Qué debo reponer?',
  '¿Cómo va la caja?',
  'Clientes que dejaron de comprar',
  'Productos sin rotación',
  'Rentabilidad por producto',
  '¿Cómo van mis vendedores?',
  '¿Está cuadrada la contabilidad?',
]
export const BRAIN_SUGGESTIONS_SELLER = ['Clientes que dejaron de comprar']

/** Llama al único punto de entrada seguro. Nunca lanza: siempre devuelve un resultado. */
export async function runTool(req: ToolRequest): Promise<ToolResult> {
  if (req.tool === 'cuentas_por_pagar') {
    const t0 = Date.now()
    const { data, error } = await supabase.rpc('cuentas_por_pagar')
    if (error) {
      const m = error.message || ''
      if (/cuentas_por_pagar|does not exist|schema cache/i.test(m)) {
        return { ok: false, status: 'error', error: 'Cuentas por pagar aún no está activada en tu base de datos. Ejecuta el SQL de cuentas por pagar en Supabase.' }
      }
      if (/no autorizado|sin permiso/i.test(m)) return { ok: false, status: 'denied', error: 'Tu usuario no está autorizado para consultar.' }
      return { ok: false, status: 'error', error: 'No pude consultar: ' + m }
    }
    return {
      ok: true,
      tool: 'cuentas_por_pagar',
      nature: 'confirmado',
      generated_at: (data as { generated_at?: string } | null)?.generated_at ?? new Date().toISOString(),
      duration_ms: Date.now() - t0,
      data: data ?? { total_owed: 0, total_overdue: 0, suppliers: [] },
      notes: [],
    }
  }

  let tz = 'America/Caracas'
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz } catch { /* usa el valor por defecto */ }

  if (req.tool === 'resumen_financiero') {
    const [mainRes, cxpRes] = await Promise.all([
      supabase.rpc('ai_run_tool', { p_tool: req.tool, p_args: { ...req.args, tz } }),
      supabase.rpc('cuentas_por_pagar'),
    ])
    const { data, error } = mainRes
    if (error) {
      const m = error.message || ''
      if (/ai_run_tool|does not exist|schema cache/i.test(m)) {
        return { ok: false, status: 'error', error: 'Esta función aún no está activada en tu base de datos. Ejecuta el SQL de la Etapa 1 en Supabase.' }
      }
      if (/no autorizado/i.test(m)) return { ok: false, status: 'denied', error: 'Tu usuario no está autorizado para consultar.' }
      return { ok: false, status: 'error', error: 'No pude consultar: ' + m }
    }
    if (!data || typeof data !== 'object') return { ok: false, status: 'error', error: 'La respuesta llegó vacía.' }
    const res = data as ToolResult
    if (res.ok && !cxpRes.error && cxpRes.data && typeof cxpRes.data === 'object') {
      res.data = { ...(res.data ?? {}), cxp: cxpRes.data }
    }
    return res
  }

  const { data, error } = await supabase.rpc('ai_run_tool', { p_tool: req.tool, p_args: { ...req.args, tz } })
  if (error) {
    const m = error.message || ''
    if (/ai_run_tool|does not exist|schema cache/i.test(m)) {
      return { ok: false, status: 'error', error: 'Esta función aún no está activada en tu base de datos. Ejecuta el SQL de la Etapa 1 en Supabase.' }
    }
    if (/no autorizado/i.test(m)) return { ok: false, status: 'denied', error: 'Tu usuario no está autorizado para consultar.' }
    return { ok: false, status: 'error', error: 'No pude consultar: ' + m }
  }
  if (!data || typeof data !== 'object') return { ok: false, status: 'error', error: 'La respuesta llegó vacía.' }
  return data as ToolResult
}

export interface AiConfig {
  allowed: boolean
  ai_enabled: boolean
  plan: string
  ai_daily_limit: number
  ai_used_today: number
  ai_remaining_today: number
  is_owner: boolean
  brain_enabled: boolean
  consent_ok: boolean
  consent_tier: 'gratuito' | 'pago' | null
  consent_at: string | null
  month_cost: number
  month_cap: number
}

/** Estado del cerebro y de la IA para esta empresa. Devuelve null si el SQL aún no está instalado. */
export async function getAiConfig(): Promise<AiConfig | null> {
  const { data, error } = await supabase.rpc('ai_config')
  if (error || !data) return null
  return data as AiConfig
}

// ---------------------------------------------------------------------------------------------
// Presentación de resultados (texto corto, pensado para el celular)
// ---------------------------------------------------------------------------------------------

type Money = (n: unknown) => string
type Num = (n: number) => string

const NATURE_NOTE: Record<Nature, string> = {
  confirmado: 'ℹ Datos confirmados: salen de tus registros.',
  estimado: 'ℹ Estimación a partir de tu historial; no es un dato confirmado.',
  recomendacion: 'ℹ Recomendación: la decisión es tuya.',
  mixto: 'ℹ Mezcla datos confirmados y estimaciones.',
}

const STATUS_LABEL: Record<string, string> = {
  agotado: 'agotado', riesgo: 'en riesgo', bajo_minimo: 'bajo el mínimo',
  exceso: 'con exceso', sin_rotacion: 'sin rotación', sin_historial: 'sin historial',
}
const ORIGIN_LABEL: Record<string, string> = {
  sale: 'Ventas', purchase: 'Compras', devolution: 'Devoluciones', abono: 'Abonos',
  anulacion_venta: 'Anulaciones de venta', anulacion_compra: 'Anulaciones de compra',
  anulacion_abono: 'Anulaciones de abono', pago_proveedor: 'Pagos a proveedores',
  anulacion_pago_proveedor: 'Anulaciones de pago a proveedor',
  arqueo: 'Arqueos', manual: 'Movimientos manuales',
}
const FLAG_LABEL: Record<string, string> = { perdida: 'vende con pérdida', margen_bajo: 'margen bajo', sin_costo: 'sin costo registrado' }
const RISK_LABEL: Record<string, string> = { alto: 'riesgo alto', medio: 'riesgo medio', bajo: 'riesgo bajo', ninguno: 'sin riesgo' }

/* eslint-disable @typescript-eslint/no-explicit-any */
export function renderToolResult(res: ToolResult, money: Money, num: Num, isManager: boolean): ToolBubble {
  if (!res.ok) {
    if (res.status === 'denied') return { text: 'Esa información solo la ve el dueño o el administrador.' }
    return { text: res.error }
  }
  const d: any = res.data ?? {}
  const note = NATURE_NOTE[res.nature] ?? ''
  const withNote = (b: ToolBubble): ToolBubble => (b.lines ? { ...b, lines: [...b.lines, note] } : { ...b, lines: [note] })

  switch (res.tool) {
    case 'inventario_riesgo': {
      const items: any[] = d.items ?? []
      if (!items.length) return { text: 'Todo bien: ningún producto está agotado, en riesgo ni parado en bodega.' }
      const lines = items.slice(0, 8).map(p => {
        const label = STATUS_LABEL[p.status] ?? p.status
        const low = p.confidence === 'baja' || p.confidence === 'insuficiente' ? ' (estimación poco fiable)' : ''
        if (p.status === 'exceso' || p.status === 'sin_rotacion') {
          return `• ${p.name} — ${label}: ${num(p.observed?.stock ?? 0)} uds, ${money(p.observed?.stock_value_at_cost ?? 0)} parado`
        }
        const dl = p.estimated?.days_left
        return `• ${p.name} — ${label}: quedan ${num(p.observed?.stock ?? 0)}${dl != null ? ` (≈ ${Math.round(dl)} d)` : ''}${low}`
      })
      if ((d.items_total ?? items.length) > 8) lines.push(`… y ${d.items_total - 8} más`)
      return withNote({
        title: `${d.items_total ?? items.length} productos necesitan atención`,
        lines,
        action: isManager ? { label: 'Ver sugerencia de compras', page: 'buyplan' } : undefined,
      })
    }
    case 'reposicion': {
      const items: any[] = d.items ?? []
      if (!items.length) return { text: 'No hace falta reponer nada por ahora con los días de cobertura elegidos.' }
      const lines = items.slice(0, 8).map(p =>
        `• ${p.name}: comprar ${num(p.qty)} (quedan ${num(p.stock)})${p.supplier_name ? ` · ${p.supplier_name}` : ''}`)
      if ((d.items_total ?? items.length) > 8) lines.push(`… y ${d.items_total - 8} más`)
      return withNote({
        title: `Conviene reponer ${d.items_total ?? items.length} productos (≈ ${money(d.total ?? 0)})`,
        lines,
        action: { label: 'Ver sugerencia de compras', page: 'buyplan' },
      })
    }
    case 'clientes_dormidos': {
      const items: any[] = d.items ?? []
      if (!items.length) return { text: 'No veo clientes con riesgo de abandono según su historial de compras.' }
      const lines = items.slice(0, 8).map(c =>
        `• ${c.name} — ${RISK_LABEL[c.risk] ?? c.risk}: ${c.days_since} d sin comprar${c.usual_interval_days ? ` (compraba cada ~${Math.round(c.usual_interval_days)} d)` : ''}`)
      if ((d.items_total ?? items.length) > 8) lines.push(`… y ${d.items_total - 8} más`)
      return withNote({
        title: `${d.items_total ?? items.length} clientes para recuperar`,
        lines,
        action: { label: 'Planear ruta', page: 'map' },
      })
    }
    case 'cartera': {
      const items: any[] = d.items ?? []
      if (!(Number(d.total_owed) > 0)) return { text: 'Nadie te debe nada por fiado.' }
      const over = Number(d.total_overdue) > 0
      const lines = items.slice(0, 8).map(c => `• ${c.name}: ${money(c.owed)}${Number(c.overdue) > 0 ? ` · ${money(c.overdue)} vencido` : ''}`)
      if ((d.items_total ?? items.length) > 8) lines.push(`… y ${d.items_total - 8} más`)
      return withNote({
        title: `Te deben ${money(d.total_owed)}${over ? ` (${money(d.total_overdue)} vencido)` : ''}`,
        lines,
        action: { label: 'Ver cartera', page: 'cartera' },
      })
    }
    case 'cuentas_por_pagar': {
      const items: any[] = d.suppliers ?? d.items ?? []
      if (!(Number(d.total_owed) > 0)) {
        return { text: 'No debes nada a proveedores por compras a crédito.', action: { label: 'Ver cuentas por pagar', page: 'payables' } }
      }
      const over = Number(d.total_overdue) > 0
      const lines = items.slice(0, 8).map(s => `• ${s.name}: ${money(s.owed)}${Number(s.overdue) > 0 ? ` · ${money(s.overdue)} vencido` : ''}`)
      if (items.length > 8) lines.push(`… y ${items.length - 8} más`)
      return withNote({
        title: `Debes a proveedores ${money(d.total_owed)}${over ? ` (${money(d.total_overdue)} vencido)` : ''}`,
        lines,
        action: { label: 'Ver cuentas por pagar', page: 'payables' },
      })
    }
    case 'rentabilidad': {
      const top: any[] = d.top ?? []
      const s = d.summary ?? {}
      if (!top.length) return { text: 'No hay ventas en ese periodo para calcular la rentabilidad.' }
      const lines: string[] = [`Del ${d.from} al ${d.to} · ventas sin impuesto ${money(s.revenue ?? 0)}`]
      top.slice(0, 5).forEach((p, i) => lines.push(`${i + 1}. ${p.name} — ${money(p.profit)}${p.margin_pct != null ? ` (${p.margin_pct} %)` : ''}`))
      const attn: any[] = d.attention ?? []
      if (attn.length) {
        lines.push('Ojo con:')
        attn.slice(0, 5).forEach(p => lines.push(`• ${p.name}: ${(p.flags ?? []).map((f: string) => FLAG_LABEL[f] ?? f).join(', ')}`))
      }
      return withNote({
        title: `Utilidad estimada ${money(s.profit ?? 0)}${s.margin_pct != null ? ` · margen ${s.margin_pct} %` : ''}`,
        lines,
        action: { label: 'Ver rentabilidad', page: 'profit' },
      })
    }
    case 'caja_resumen': {
      const lines: string[] = [
        `Del ${d.from} al ${d.to}: entraron ${money(d.ingresos)} · salieron ${money(d.egresos)} (neto ${money(d.neto_periodo)})`,
      ]
      for (const o of (d.by_origin ?? []).slice(0, 4)) {
        lines.push(`• ${ORIGIN_LABEL[o.origin] ?? o.origin}: +${money(o.ingresos)} / −${money(o.egresos)}`)
      }
      const g: any[] = d.gastos_manuales ?? []
      if (g.length) {
        lines.push('Gastos manuales más altos:')
        g.slice(0, 3).forEach(x => lines.push(`• ${x.description || 'Sin descripción'}: ${money(x.amount)}`))
      }
      if (d.ultimo_arqueo) {
        const dif = Number(d.ultimo_arqueo.difference)
        lines.push(`Último arqueo (${new Date(d.ultimo_arqueo.closed_at).toLocaleDateString()}): ${dif === 0 ? 'sin diferencia' : 'diferencia ' + money(dif)}`)
      }
      return withNote({ title: `Caja: saldo actual ${money(d.saldo_actual)}`, lines, action: { label: 'Ir a caja', page: 'cash' } })
    }
    case 'vendedores': {
      const items: any[] = d.items ?? []
      if (!items.length) return { text: `No hay ventas ni visitas ${d.label ?? 'en ese periodo'}.` }
      const lines = items.slice(0, 8).map((v, i) =>
        `${i + 1}. ${v.name} — ${money(v.sales_total)} · ${v.sales_count} ${v.sales_count === 1 ? 'venta' : 'ventas'} · ${v.visits} visitas${v.goal_sales_pct != null ? ` · meta ${v.goal_sales_pct} %` : ''}`)
      return withNote({ title: `Vendedores ${d.label ?? ''}`.trim(), lines, action: { label: 'Ver metas', page: 'goals' } })
    }
    case 'contabilidad_estado': {
      if (!d.active) return { text: d.message ?? 'La contabilidad automática no está activada.' }
      const diffs: any[] = d.reconcile_diffs ?? []
      const issues: any[] = d.close_issues ?? []
      const p = d.period ?? {}
      const per = `${pad(p.month ?? 0)}/${p.year ?? ''}`
      if (!diffs.length && !issues.length) {
        return withNote({ title: 'Contabilidad al día', lines: [`Sin diferencias de conciliación ni pendientes para cerrar ${per}.`], action: { label: 'Ir a cierre de libros', page: 'accclose' } })
      }
      const lines: string[] = []
      diffs.slice(0, 6).forEach(x => lines.push(`• ${x.label}: diferencia ${num(Number(x.difference))}`))
      issues.slice(0, 6).forEach(x => lines.push(`• ${x.label} (${x.status}): ${x.detail}`))
      return withNote({ title: `Contabilidad: ${per} ${p.closed ? 'cerrado' : 'abierto'} · hay puntos por revisar`, lines, action: { label: 'Ir a cierre de libros', page: 'accclose' } })
    }
    case 'resumen_financiero': {
      const c = d.confirmado ?? {}
      const e = d.estimado ?? {}
      const cxp = d.cxp
      const cxpLine = cxp && typeof cxp === 'object'
        ? `Por pagar: ${money(cxp.total_owed ?? 0)}${Number(cxp.total_overdue) > 0 ? ` (${money(cxp.total_overdue)} vencido)` : ''}`
        : c.cuentas_por_pagar != null
          ? `Por pagar: ${money(c.cuentas_por_pagar)}${Number(c.cuentas_por_pagar_vencido) > 0 ? ` (${money(c.cuentas_por_pagar_vencido)} vencido)` : ''}`
          : 'Por pagar: instala el SQL de cuentas por pagar en Supabase para ver este dato.'
      const lines: string[] = [
        `Ventas: ${money(c.ventas_total)} (${c.ventas_cantidad})`,
        `Compras: ${money(c.compras_total)}`,
        `Caja: entraron ${money(c.caja_ingresos)} · salieron ${money(c.caja_egresos)}`,
        `Por cobrar: ${money(c.cartera_por_cobrar)}${Number(c.cartera_vencida) > 0 ? ` (${money(c.cartera_vencida)} vencido)` : ''}`,
        cxpLine,
        `Inventario a costo: ${money(c.valor_inventario_a_costo)}`,
        `Utilidad estimada: ${money(e.utilidad)}${e.margen_pct != null ? ` · margen ${e.margen_pct} %` : ''}`,
      ]
      return withNote({ title: `Resumen financiero ${d.label ?? ''}`.trim(), lines, action: { label: 'Ver reportes', page: 'reports' } })
    }
    default:
      return { text: 'No pude armar esa respuesta.' }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
