import { normalizeCatalogPaymentMethods } from './catalogCommerce'
import type {
  CatalogPaymentMethodConfig,
  CompanyConfig,
  CompanyWhatsAppSettings,
  WhatsAppTemplateScenario,
} from '../types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-_]{0,78}[a-z0-9])?$/i

const RESERVED_SLUGS = new Set([
  'api',
  'admin',
  'login',
  'registro',
  'register',
  'terminos',
  'privacidad',
  'manual',
  'reset-password',
  'assets',
  'static',
  'index.html',
  'manifest.webmanifest',
])

export function isUuidIdentifier(val?: string | null): boolean {
  return UUID_RE.test((val || '').trim())
}

export function slugifyStoreAlias(raw?: string | null): string {
  const clean = (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')

  if (!clean) return ''
  if (RESERVED_SLUGS.has(clean)) return `tienda-${clean}`
  return clean.length >= 2 ? clean : `tienda-${clean}`
}

export function isValidStoreIdentifier(raw?: string | null): boolean {
  const v = (raw || '').trim()
  if (!v) return false
  if (UUID_RE.test(v)) return true
  if (RESERVED_SLUGS.has(v.toLowerCase())) return false
  return v.length >= 2 && SLUG_RE.test(v)
}

export function getPublicStoreIdentifierFromLocation(loc?: {
  pathname: string
  search: string
}): string | null {
  try {
    const pathname = loc ? loc.pathname : window.location.pathname
    const search = loc ? loc.search : window.location.search

    const pathMatch = pathname.match(/^\/(?:tienda|catalogo)\/([^/?#]+)\/?$/i)
    if (pathMatch && pathMatch[1]) {
      const decoded = decodeURIComponent(pathMatch[1]).trim()
      if (isValidStoreIdentifier(decoded)) return decoded
    }

    const params = new URLSearchParams(search)
    const fromQuery = (params.get('tienda') || params.get('catalogo') || '').trim()
    if (isValidStoreIdentifier(fromQuery)) return fromQuery
  } catch {
    /* ignore */
  }
  return null
}

export interface StoreBrandVersionSource {
  name?: string | null
  catalog_slug?: string | null
  rif?: string | null
  logo_url?: string | null
  brand_theme?: string | null
  catalog_welcome?: string | null
  brand_version?: string | null
  whatsapp_settings?: CompanyWhatsAppSettings | null
}

/**
 * Genera una huella corta determinística a partir del nombre, slug,
 * logo, color, eslogan y versión de la empresa. Cuando cualquiera de esos datos cambia, la huella
 * cambia automáticamente (?v=xxxx) para que WhatsApp invalide al instante su caché de vista previa.
 */
export function computeBrandVersionHash(
  meta?: StoreBrandVersionSource | null,
  forceSalt?: string | number | null
): string {
  if (!meta) return ''
  const tagline = meta.whatsapp_settings?.brand_tagline || ''
  const rawSeed = [
    (meta.name || '').trim().toLowerCase(),
    (meta.catalog_slug || '').trim().toLowerCase(),
    (meta.logo_url || '').trim(),
    (meta.brand_theme || '').trim(),
    (meta.catalog_welcome || '').trim(),
    tagline.trim(),
    (meta.brand_version || '').trim(),
    forceSalt ? String(forceSalt) : '',
  ].join('|')
  if (!rawSeed.replace(/\|/g, '')) return ''

  let h = 2166136261
  for (let i = 0; i < rawSeed.length; i++) {
    h ^= rawSeed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const cleanHash = (h >>> 0).toString(36).slice(0, 6)
  return forceSalt ? `${cleanHash}_${forceSalt}` : cleanHash
}

/**
 * Construye el enlace comercial propio de la empresa (/tienda/<alias-o-id>).
 * Esta ruta activa los metadatos OpenGraph dinámicos en el servidor para que WhatsApp
 * despliegue el logo, nombre y descripción de la empresa (nunca el de InventarioPro).
 */
export function buildCompanyStoreUrl(
  origin: string,
  companyId?: string | null,
  catalogSlug?: string | null,
  brandMeta?: StoreBrandVersionSource | null,
  cacheBuster?: string | number | null
): string {
  const cleanOrigin = (origin || '').replace(/\/+$/, '')
  const cleanSlug = slugifyStoreAlias(catalogSlug) || slugifyStoreAlias(brandMeta?.name)
  const vHash = computeBrandVersionHash(brandMeta, cacheBuster)
  const suffix = vHash ? `?v=${encodeURIComponent(vHash)}` : ''

  if (cleanSlug) {
    return `${cleanOrigin}/tienda/${encodeURIComponent(cleanSlug)}${suffix}`
  }
  const cleanId = (companyId || '').trim()
  if (cleanId) {
    return `${cleanOrigin}/tienda/${encodeURIComponent(cleanId)}${suffix}`
  }
  return cleanOrigin || '/'
}

/**
 * Enlace raíz oficial de invitación a la aplicación InventarioPro.
 * Conserva intactos el logo, título y descripción de InventarioPro.
 */
export function buildPlatformInviteUrl(origin: string): string {
  const cleanOrigin = (origin || '').replace(/\/+$/, '')
  return `${cleanOrigin}/`
}

export function buildPlatformInviteWhatsAppMessage(opts: {
  origin: string
  inviterName?: string | null
  inviterCompany?: string | null
}): string {
  const appUrl = buildPlatformInviteUrl(opts.origin)
  const who = opts.inviterName?.trim()
    ? opts.inviterCompany?.trim()
      ? `*${opts.inviterName.trim()}* (${opts.inviterCompany.trim()})`
      : `*${opts.inviterName.trim()}*`
    : 'nuestro equipo'

  return [
    `Hola, te escribe ${who}.`,
    `Te comparto el enlace oficial de *InventarioPro*, la plataforma web con la que gestionamos inventario multibodega, POS, catálogo digital con pagos verificados y contabilidad integrada:`,
    appUrl,
  ].join('\n\n')
}

export function cleanWhatsAppDigits(raw?: string | null): string {
  const digits = (raw || '').replace(/[^\d]/g, '')
  return digits.length >= 8 ? digits : ''
}

export function getGreetingByHour(date: Date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'Buenos días'
  if (h >= 12 && h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

export interface WhatsAppScenarioInfo {
  id: WhatsAppTemplateScenario
  label: string
  shortLabel: string
  description: string
  variables: string[]
}

export const WHATSAPP_SCENARIOS: WhatsAppScenarioInfo[] = [
  {
    id: 'store_invite',
    label: 'Tarjeta de Tienda Online (Logo y Vitrina)',
    shortLabel: 'Tarjeta de Tienda',
    description:
      'Ideal para que WhatsApp despliegue en grande el logo y nombre de tu empresa junto al acceso directo a comprar.',
    variables: [
      '{saludo_hora}',
      '{cliente}',
      '{empresa}',
      '{eslogan}',
      '{asesor}',
      '{enlace_tienda}',
      '{horario}',
    ],
  },
  {
    id: 'catalog_selection',
    label: 'Catálogo Curado con Lista de Precios',
    shortLabel: 'Catálogo + Precios',
    description:
      'Envía una selección de productos con sus precios vigentes, presentaciones y el enlace interactivo al final.',
    variables: [
      '{saludo_hora}',
      '{cliente}',
      '{empresa}',
      '{asesor}',
      '{titulo_catalogo}',
      '{lista_productos}',
      '{nota_comercial}',
      '{enlace_tienda}',
    ],
  },
  {
    id: 'wholesale_b2b',
    label: 'Propuesta Mayorista y Clientes Jurídicos (B2B)',
    shortLabel: 'Mayorista B2B',
    description:
      'Tono corporativo para distribuidores y empresas con precios por volumen, RIF y despacho programado.',
    variables: [
      '{saludo_hora}',
      '{cliente}',
      '{empresa}',
      '{rif}',
      '{asesor}',
      '{lista_productos}',
      '{enlace_tienda}',
      '{horario}',
    ],
  },
  {
    id: 'quick_payment_info',
    label: 'Datos Oficiales de Pago + Enlace de Pedido',
    shortLabel: 'Datos de Pago',
    description:
      'Comparte en 1 clic tus cuentas activas (Pago Móvil, Nequi, Zelle, Transferencia) y el enlace para subir el capture.',
    variables: [
      '{saludo_hora}',
      '{cliente}',
      '{empresa}',
      '{rif}',
      '{metodos_pago}',
      '{enlace_tienda}',
    ],
  },
  {
    id: 'order_verified',
    label: 'Confirmación de Pago Corroborado (Pedidos Web)',
    shortLabel: 'Pago Verificado',
    description:
      'Notifica al comprador cuando administración valida su capture de pago y pasa el pedido a alistamiento.',
    variables: [
      '{saludo_hora}',
      '{cliente}',
      '{empresa}',
      '{pedido}',
      '{monto}',
      '{referencia}',
      '{pin}',
      '{enlace_tienda}',
    ],
  },
  {
    id: 'order_dispatched',
    label: 'Aviso de Pedido Despachado o Listo para Retiro',
    shortLabel: 'Despacho / Retiro',
    description:
      'Informa al cliente que su compra ya salió en ruta o puede retirarse en sede con su código de seguimiento.',
    variables: [
      '{saludo_hora}',
      '{cliente}',
      '{empresa}',
      '{pedido}',
      '{modalidad_entrega}',
      '{nota_admin}',
      '{pin}',
      '{enlace_tienda}',
    ],
  },
]

export const DEFAULT_WHATSAPP_TEMPLATES: Record<WhatsAppTemplateScenario, string> = {
  store_invite: [
    '{saludo_hora}{cliente_coma}, te saluda *{asesor}* de *{empresa}*.',
    '{eslogan}',
    'Explora nuestro catálogo actualizado en tiempo real, elige tallas o presentaciones y arma tu pedido directo aquí:',
    '{enlace_tienda}',
    '{bloque_horario}',
  ].join('\n\n'),

  catalog_selection: [
    '{saludo_hora}{cliente_coma}, te saluda *{asesor}* de *{empresa}*.',
    'Te comparto nuestro *{titulo_catalogo}*:',
    '{lista_productos}',
    '{nota_comercial}',
    'Haz tu compra directa y adjunta tu comprobante en nuestra tienda en línea:\n{enlace_tienda}',
  ].join('\n\n'),

  wholesale_b2b: [
    '{saludo_hora}{cliente_coma}, cordial saludo de parte de *{empresa}*{rif_parentesis}.',
    'Ponemos a tu disposición nuestra propuesta comercial para compras por volumen y atención corporativa (atendido por *{asesor}*):',
    '{lista_productos}',
    'Puedes autogestionar tu orden con precios mayoristas automáticos y solicitud de factura fiscal en nuestro portal:\n{enlace_tienda}',
    '{bloque_horario}',
  ].join('\n\n'),

  quick_payment_info: [
    '{saludo_hora}{cliente_coma}, te compartimos los canales oficiales de pago de *{empresa}*{rif_parentesis}:',
    '{metodos_pago}',
    'Una vez realizada tu transferencia o pago móvil, puedes registrar tu pedido y subir el capture directamente aquí:\n{enlace_tienda}',
  ].join('\n\n'),

  order_verified: [
    '{saludo_hora} *{cliente}*, te escribimos de *{empresa}*.',
    'Hemos *corroborado exitosamente tu pago*{referencia_parentesis} correspondiente al pedido *{pedido}* por *{monto}*.',
    'Tu orden ya pasó a preparación. Puedes consultar el avance en tiempo real con tu código *{pedido}* y PIN *{pin}* en:\n{enlace_tienda}',
  ].join('\n\n'),

  order_dispatched: [
    '{saludo_hora} *{cliente}*, te informamos desde *{empresa}* que tu pedido *{pedido}* ya se encuentra en estado: *{modalidad_entrega}*.',
    '{nota_admin}',
    'Consulta el detalle de tu orden con el código *{pedido}* y PIN *{pin}* en:\n{enlace_tienda}',
  ].join('\n\n'),
}

export function normalizeWhatsAppSettings(
  raw: unknown,
  fallback?: {
    companyName?: string
    phone?: string
    welcome?: string | null
  }
): Required<Omit<CompanyWhatsAppSettings, 'templates'>> & {
  templates: Record<WhatsAppTemplateScenario, string>
} {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const rawTemplates =
    obj.templates && typeof obj.templates === 'object' && !Array.isArray(obj.templates)
      ? (obj.templates as Record<string, unknown>)
      : {}

  const templates: Record<WhatsAppTemplateScenario, string> = {
    store_invite:
      typeof rawTemplates.store_invite === 'string' && rawTemplates.store_invite.trim()
        ? rawTemplates.store_invite
        : DEFAULT_WHATSAPP_TEMPLATES.store_invite,
    catalog_selection:
      typeof rawTemplates.catalog_selection === 'string' && rawTemplates.catalog_selection.trim()
        ? rawTemplates.catalog_selection
        : DEFAULT_WHATSAPP_TEMPLATES.catalog_selection,
    wholesale_b2b:
      typeof rawTemplates.wholesale_b2b === 'string' && rawTemplates.wholesale_b2b.trim()
        ? rawTemplates.wholesale_b2b
        : DEFAULT_WHATSAPP_TEMPLATES.wholesale_b2b,
    quick_payment_info:
      typeof rawTemplates.quick_payment_info === 'string' && rawTemplates.quick_payment_info.trim()
        ? rawTemplates.quick_payment_info
        : DEFAULT_WHATSAPP_TEMPLATES.quick_payment_info,
    order_verified:
      typeof rawTemplates.order_verified === 'string' && rawTemplates.order_verified.trim()
        ? rawTemplates.order_verified
        : DEFAULT_WHATSAPP_TEMPLATES.order_verified,
    order_dispatched:
      typeof rawTemplates.order_dispatched === 'string' && rawTemplates.order_dispatched.trim()
        ? rawTemplates.order_dispatched
        : DEFAULT_WHATSAPP_TEMPLATES.order_dispatched,
  }

  const cleanCompany = (fallback?.companyName || '').trim()
  let rawTagline = String(
    obj.brand_tagline ??
      fallback?.welcome ??
      (cleanCompany
        ? `Catálogo oficial de ${cleanCompany} · Atención personalizada`
        : 'Catálogo oficial y pedidos en línea')
  ).trim()

  if (cleanCompany) {
    rawTagline = rawTagline.split('{empresa}').join(cleanCompany)
    if (/^Catálogo oficial de .+ · Atención personalizada$/i.test(rawTagline)) {
      rawTagline = `Catálogo oficial de ${cleanCompany} · Atención personalizada`
    }
  }

  return {
    business_whatsapp: String(obj.business_whatsapp ?? fallback?.phone ?? '').trim(),
    brand_tagline: rawTagline,
    og_card_subtitle: String(
      obj.og_card_subtitle ??
        'Selecciona productos, tallas o medidas y envía tu comprobante de pago en línea.'
    )
      .split('{empresa}')
      .join(cleanCompany || 'nuestra tienda')
      .trim(),
    business_hours: String(obj.business_hours ?? '').trim(),
    advisor_title: String(obj.advisor_title ?? 'Asesor Comercial').trim(),
    include_rif_in_messages: obj.include_rif_in_messages !== false,
    include_hours_in_messages: obj.include_hours_in_messages !== false,
    include_payment_summary_in_messages: Boolean(obj.include_payment_summary_in_messages),
    templates,
  }
}

export function formatActivePaymentSummaryForWhatsApp(
  methods: CatalogPaymentMethodConfig[]
): string {
  const enabled = methods.filter(m => m.enabled)
  if (enabled.length === 0) {
    return '• Consulta nuestros datos bancarios con tu asesor comercial.'
  }
  return enabled
    .map(m => {
      const parts = [
        `*${m.label}*`,
        m.bank_or_platform ? m.bank_or_platform : '',
        m.account_or_phone ? `Dato: ${m.account_or_phone}` : '',
        m.holder_name ? `Titular: ${m.holder_name}` : '',
        m.holder_document ? `Doc: ${m.holder_document}` : '',
      ].filter(Boolean)
      return `• ${parts.join(' · ')}`
    })
    .join('\n')
}

export interface WhatsAppMessageContext {
  config?: Partial<CompanyConfig> | null
  companyName: string
  storeUrl: string
  customerName?: string | null
  advisorName?: string | null
  advisorPhone?: string | null
  catalogTitle?: string | null
  productLinesText?: string | null
  commercialNote?: string | null
  orderNumber?: string | null
  trackingPin?: string | null
  orderTotalFormatted?: string | null
  paymentReference?: string | null
  deliveryStatusLabel?: string | null
  adminNote?: string | null
}

export function renderCompanyWhatsAppMessage(
  scenario: WhatsAppTemplateScenario,
  ctx: WhatsAppMessageContext
): string {
  const cfg = ctx.config || {}
  const wa = normalizeWhatsAppSettings(cfg.whatsapp_settings, {
    companyName: ctx.companyName,
    phone: cfg.phone || '',
    welcome: cfg.catalog_welcome,
  })

  const paymentMethods = normalizeCatalogPaymentMethods(cfg.catalog_payment_methods, {
    companyName: ctx.companyName,
    rif: cfg.rif || '',
    phone: cfg.phone || '',
    email: cfg.email || '',
  })

  const cleanCustomer = (ctx.customerName || '').trim()
  const cleanRif = wa.include_rif_in_messages ? (cfg.rif || '').trim() : ''
  const cleanHours = wa.include_hours_in_messages ? wa.business_hours.trim() : ''
  const cleanAdvisor = (ctx.advisorName || '').trim() || wa.advisor_title || 'Asesor Comercial'
  const cleanPhone = (ctx.advisorPhone || wa.business_whatsapp || cfg.phone || '').trim()
  const paymentSummary = formatActivePaymentSummaryForWhatsApp(paymentMethods)

  const template = wa.templates[scenario] || DEFAULT_WHATSAPP_TEMPLATES[scenario]

  const replacements: Record<string, string> = {
    '{saludo_hora}': getGreetingByHour(),
    '{cliente}': cleanCustomer || 'estimado cliente',
    '{cliente_coma}': cleanCustomer ? ` *${cleanCustomer}*` : '',
    '{empresa}': ctx.companyName.trim() || 'Nuestra Empresa',
    '{rif}': cleanRif,
    '{rif_parentesis}': cleanRif ? ` (${cleanRif})` : '',
    '{eslogan}': wa.brand_tagline ? `_${wa.brand_tagline}_` : '',
    '{asesor}': cleanAdvisor,
    '{cargo_asesor}': wa.advisor_title || 'Asesor Comercial',
    '{enlace_tienda}': ctx.storeUrl,
    '{telefono}': cleanPhone,
    '{horario}': cleanHours,
    '{bloque_horario}': cleanHours ? `Horario de atención: ${cleanHours}` : '',
    '{metodos_pago}': paymentSummary,
    '{titulo_catalogo}': (ctx.catalogTitle || '').trim() || 'Catálogo Comercial',
    '{lista_productos}': (ctx.productLinesText || '').trim(),
    '{nota_comercial}': (ctx.commercialNote || '').trim()
      ? `_${(ctx.commercialNote || '').trim()}_`
      : '',
    '{pedido}': (ctx.orderNumber || '').trim() || 'WEB-0000',
    '{pin}': (ctx.trackingPin || '').trim() || '0000',
    '{monto}': (ctx.orderTotalFormatted || '').trim(),
    '{referencia}': (ctx.paymentReference || '').trim(),
    '{referencia_parentesis}': (ctx.paymentReference || '').trim()
      ? ` (Ref. #${(ctx.paymentReference || '').trim()})`
      : '',
    '{modalidad_entrega}': (ctx.deliveryStatusLabel || '').trim() || 'En proceso',
    '{nota_admin}': (ctx.adminNote || '').trim(),
  }

  let out = template
  for (const [token, val] of Object.entries(replacements)) {
    out = out.split(token).join(val)
  }

  if (
    wa.include_payment_summary_in_messages &&
    scenario !== 'quick_payment_info' &&
    scenario !== 'order_verified' &&
    scenario !== 'order_dispatched' &&
    !template.includes('{metodos_pago}')
  ) {
    out += `\n\n*Medios de pago disponibles:*\n${paymentSummary}`
  }

  return out
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function buildStorePreviewCardSummary(opts: {
  companyName: string
  rif?: string | null
  welcome?: string | null
  whatsappSettings?: CompanyWhatsAppSettings | null
  storeUrl: string
  productsCount?: number
}): {
  title: string
  description: string
  siteName: string
  displayHost: string
} {
  const name = (opts.companyName || 'Tienda Oficial').trim()
  const wa = normalizeWhatsAppSettings(opts.whatsappSettings, {
    companyName: name,
    welcome: opts.welcome,
  })

  const headline = wa.brand_tagline || (opts.welcome || '').trim() || 'Catálogo Digital y Pedidos Online'
  const title = `${name} — ${headline}`.slice(0, 90)

  const descParts: string[] = []
  if (wa.og_card_subtitle) descParts.push(wa.og_card_subtitle)
  if (typeof opts.productsCount === 'number' && opts.productsCount > 0) {
    descParts.push(`${opts.productsCount} productos disponibles.`)
  }
  if (opts.rif?.trim()) {
    descParts.push(`ID Fiscal: ${opts.rif.trim()}.`)
  }
  if (wa.business_hours) {
    descParts.push(`Atención: ${wa.business_hours}.`)
  }
  const description = (
    descParts.join(' ') ||
    `Compra en línea directamente en ${name}. Elige presentaciones y adjunta tu comprobante de pago.`
  ).slice(0, 180)

  let displayHost = opts.storeUrl
  try {
    const u = new URL(opts.storeUrl)
    displayHost = `${u.host}${u.pathname}`
  } catch {
    /* keep raw */
  }

  return {
    title,
    description,
    siteName: name,
    displayHost,
  }
}
