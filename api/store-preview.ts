import zlib from 'node:zlib'

/**
 * Motor dinámico de Metadatos OpenGraph (WhatsApp, Telegram, Redes Sociales)
 * para los enlaces personalizados de cada empresa (/tienda/<alias> y /catalogo/<alias>).
 *
 * - Cuando se comparte el enlace de una empresa (/tienda/<slug>), absorbe el LOGO,
 *   nombre comercial, eslogan, RIF y color institucional de ESA empresa.
 * - El enlace raíz de la plataforma (/) permanece intacto con el logo y descripción
 *   oficial de InventarioPro para invitaciones al sistema.
 */

export interface StorePreviewReq {
  method?: string
  url?: string
  originalUrl?: string
  params?: Record<string, string | undefined>
  query?: Record<string, string | string[] | undefined>
  headers: Record<string, string | string[] | undefined>
}

export interface StorePreviewRes {
  status(code: number): StorePreviewRes
  setHeader(name: string, value: string): void
  send?(body: string | Buffer): void
  end?(body?: string | Buffer): void
  json?(body: unknown): void
}

interface StoreMetaRecord {
  found: boolean
  available: boolean
  company_id?: string
  catalog_slug?: string | null
  brand_version?: string | null
  name?: string
  rif?: string | null
  phone?: string | null
  address?: string | null
  welcome?: string | null
  logo_url?: string | null
  brand_theme?: string | null
  currency?: string | null
  show_wholesale?: boolean
  whatsapp_settings?: Record<string, unknown> | null
  products_count?: number
}

const THEME_COLORS: Record<string, { main: [number, number, number]; dark: [number, number, number]; hex: string }> = {
  emerald: { main: [4, 120, 87], dark: [6, 78, 59], hex: '#047857' },
  slate: { main: [15, 23, 42], dark: [2, 6, 23], hex: '#0f172a' },
  blue: { main: [29, 78, 216], dark: [30, 58, 138], hex: '#1d4ed8' },
  indigo: { main: [67, 56, 202], dark: [49, 46, 129], hex: '#4338ca' },
  rose: { main: [190, 18, 60], dark: [136, 19, 55], hex: '#be123c' },
  amber: { main: [180, 83, 9], dark: [120, 53, 15], hex: '#b45309' },
  teal: { main: [15, 118, 110], dark: [19, 78, 74], hex: '#0f766e' },
  violet: { main: [109, 40, 217], dark: [76, 29, 149], hex: '#6d28d9' },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Tabla CRC32 estándar para chunks PNG
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function insideRoundedRect(
  x: number,
  y: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  rad: number
): boolean {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false
  const cx = x < rx + rad ? rx + rad : x > rx + rw - rad - 1 ? rx + rw - rad - 1 : x
  const cy = y < ry + rad ? ry + rad : y > ry + rh - rad - 1 ? ry + rh - rad - 1 : y
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= rad * rad
}

/**
 * Genera un PNG real (320x320 RGB) con el color institucional de la empresa
 * cuando ésta aún no ha subido un archivo de logo propio, evitando mostrar el logo de InventarioPro.
 */
export function generateBrandedStorePng(themeKey?: string | null): Buffer {
  const w = 320
  const h = 320
  const palette = THEME_COLORS[(themeKey || 'emerald').toLowerCase()] || THEME_COLORS.emerald
  const [mr, mg, mb] = palette.main
  const [dr, dg, db] = palette.dark

  const rowLen = 1 + w * 3
  const raw = Buffer.alloc(rowLen * h)

  for (let y = 0; y < h; y++) {
    const rowOffset = y * rowLen
    raw[rowOffset] = 0 // filtro None
    const t = y / (h - 1)
    const bgR = Math.round(dr + (mr - dr) * t)
    const bgG = Math.round(dg + (mg - dg) * t)
    const bgB = Math.round(db + (mb - db) * t)

    for (let x = 0; x < w; x++) {
      let r = bgR
      let g = bgG
      let b = bgB

      // Tarjeta central blanca (56, 56, 208, 208, r=36)
      if (insideRoundedRect(x, y, 56, 56, 208, 208, 36)) {
        r = 255
        g = 255
        b = 255

        // Cuerpo de bolsa comercial corporativa (104, 134, 112, 92, r=14)
        if (insideRoundedRect(x, y, 104, 134, 112, 92, 14)) {
          r = mr
          g = mg
          b = mb

          // Detalle interior blanco sutil (sonrisa / pliegue de bolsa)
          const sdx = x - 160
          const sdy = y - 166
          const sDist = Math.sqrt(sdx * sdx + sdy * sdy)
          if (y >= 166 && sDist >= 22 && sDist <= 28) {
            r = 255
            g = 255
            b = 255
          }
        } else {
          // Asa superior arqueada de la tienda (centro 160, 134, radio ext 34, int 24)
          const hdx = x - 160
          const hdy = y - 134
          const hDist = Math.sqrt(hdx * hdx + hdy * hdy)
          if (y <= 136 && hDist >= 23 && hDist <= 33) {
            r = mr
            g = mg
            b = mb
          }
        }
      }

      const px = rowOffset + 1 + x * 3
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idatData = zlib.deflateSync(raw, { level: 6 })
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function escHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function headerFirst(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string {
  const val = headers[key] ?? headers[key.toLowerCase()]
  if (Array.isArray(val)) return val[0] || ''
  return val || ''
}

function resolveRequestOrigin(req: StorePreviewReq): string {
  const xfProto = headerFirst(req.headers, 'x-forwarded-proto').split(',')[0].trim()
  const xfHost = headerFirst(req.headers, 'x-forwarded-host').split(',')[0].trim()
  const host = xfHost || headerFirst(req.headers, 'host').trim() || 'localhost:3000'
  const proto =
    xfProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}

function extractQueryParam(req: StorePreviewReq, name: string): string {
  const qVal = req.query?.[name]
  if (typeof qVal === 'string' && qVal.trim()) return qVal.trim()
  if (Array.isArray(qVal) && qVal[0]?.trim()) return qVal[0].trim()
  try {
    const u = new URL(req.url || '/', 'http://localhost')
    return (u.searchParams.get(name) || '').trim()
  } catch {
    return ''
  }
}

function extractStoreFromRequest(req: StorePreviewReq): string {
  const fromParam = (req.params?.store || '').trim()
  if (fromParam) return fromParam

  const explicit =
    extractQueryParam(req, 'store') ||
    extractQueryParam(req, 'tienda') ||
    extractQueryParam(req, 'catalogo')
  if (explicit) return explicit

  try {
    const u = new URL(req.originalUrl || req.url || '/', 'http://localhost')
    const m = u.pathname.match(/^\/(?:tienda|catalogo)\/([^/?#]+)\/?$/i)
    if (m && m[1]) return decodeURIComponent(m[1]).trim()
  } catch {
    /* ignore */
  }
  return ''
}

function sendBody(res: StorePreviewRes, status: number, body: string | Buffer): void {
  res.status(status)
  if (typeof res.send === 'function') {
    res.send(body)
  } else if (typeof res.end === 'function') {
    res.end(body)
  }
}

async function fetchStoreMetadataFromSupabase(
  storeKey: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  fetchFn: typeof fetch,
  managementToken?: string,
  projectRef?: string
): Promise<StoreMetaRecord | null> {
  if (!storeKey || !supabaseUrl || !supabaseAnonKey) return null

  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'application/json',
  }

  // 1. Intentar RPC ultraligera obtener_metadatos_enlace_tienda (migración 000019)
  try {
    const resp = await fetchFn(`${supabaseUrl}/rest/v1/rpc/obtener_metadatos_enlace_tienda`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_slug_or_id: storeKey }),
    })
    if (resp.ok) {
      const data = (await resp.json()) as StoreMetaRecord | null
      if (data && typeof data === 'object' && data.found) {
        return data
      }
      if (data && typeof data === 'object' && data.found === false) {
        return null
      }
    }
  } catch {
    /* fallback below */
  }

  // 2. Fallback si aún no se aplicó 000019 y storeKey es UUID
  if (UUID_RE.test(storeKey)) {
    try {
      const resp = await fetchFn(`${supabaseUrl}/rest/v1/rpc/obtener_catalogo_publico`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_company_id: storeKey }),
      })
      if (resp.ok) {
        const payload = (await resp.json()) as {
          available?: boolean
          company?: Record<string, unknown>
          products?: unknown[]
        } | null
        if (payload?.company) {
          const c = payload.company
          return {
            found: true,
            available: Boolean(payload.available),
            company_id: String(c.company_id || storeKey),
            catalog_slug: c.catalog_slug ? String(c.catalog_slug) : null,
            name: String(c.name || 'Tienda Oficial'),
            rif: c.rif ? String(c.rif) : null,
            phone: c.phone ? String(c.phone) : null,
            address: c.address ? String(c.address) : null,
            welcome: c.welcome ? String(c.welcome) : null,
            logo_url: c.logo_url ? String(c.logo_url) : null,
            brand_theme: c.brand_theme ? String(c.brand_theme) : 'emerald',
            currency: c.currency ? String(c.currency) : 'USD',
            show_wholesale: Boolean(c.show_wholesale),
            whatsapp_settings:
              c.whatsapp_settings && typeof c.whatsapp_settings === 'object'
                ? (c.whatsapp_settings as Record<string, unknown>)
                : {},
            products_count: Array.isArray(payload.products) ? payload.products.length : 0,
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3. Fallback de lectura vía Management API si SUPABASE_ACCESS_TOKEN está presente y aún no se ejecutó 000019
  if (managementToken && projectRef) {
    try {
      const safeKey = storeKey.toLowerCase().replace(/[^a-z0-9-]/g, '')
      if (safeKey) {
        const q = `
          SELECT jsonb_build_object(
            'found', true,
            'available', coalesce(cc.catalog_enabled, true),
            'company_id', cc.company_id,
            'catalog_slug', coalesce(to_jsonb(cc)->>'catalog_slug', regexp_replace(lower(translate(coalesce(cc.name, 'tienda'), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc')), '[^a-z0-9]+', '-', 'g')),
            'name', coalesce(nullif(btrim(cc.name), ''), 'Tienda Oficial'),
            'rif', cc.rif,
            'phone', cc.phone,
            'address', cc.address,
            'welcome', cc.catalog_welcome,
            'logo_url', cc.logo_url,
            'brand_theme', coalesce(nullif(btrim(cc.brand_theme), ''), 'emerald'),
            'currency', coalesce(cc.currency, 'USD'),
            'show_wholesale', coalesce(cc.catalog_show_wholesale, true),
            'whatsapp_settings', coalesce((to_jsonb(cc)->'whatsapp_settings'), '{}'::jsonb),
            'products_count', (
              SELECT count(*)::int FROM public.products p
              WHERE p.company_id = cc.company_id AND coalesce(p.catalog_visible, true) = true
            )
          ) AS store_meta
          FROM public.company_config cc
          WHERE cc.company_id::text = '${safeKey}'
             OR lower(coalesce(to_jsonb(cc)->>'catalog_slug', '')) = '${safeKey}'
             OR trim(both '-' from regexp_replace(lower(translate(coalesce(cc.name, ''), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc')), '[^a-z0-9]+', '-', 'g')) = '${safeKey}'
          LIMIT 1;
        `
        const mgmtResp = await fetchFn(
          `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${managementToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: q }),
          }
        )
        if (mgmtResp.ok) {
          const rows = (await mgmtResp.json()) as Array<{ store_meta?: StoreMetaRecord }>
          if (Array.isArray(rows) && rows[0]?.store_meta?.found) {
            return rows[0].store_meta
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return null
}

function buildInjectedStoreHtml(
  templateHtml: string,
  meta: StoreMetaRecord,
  origin: string,
  requestedVersion?: string
): string {
  const companyName = (meta.name || 'Tienda Oficial').trim()
  const canonicalSlugOrId = (meta.catalog_slug || meta.company_id || '').trim()
  const canonicalUrl = canonicalSlugOrId
    ? `${origin}/tienda/${encodeURIComponent(canonicalSlugOrId)}`
    : `${origin}/`

  const cleanVersion = (requestedVersion || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16)
  const ogShareUrl =
    cleanVersion && canonicalSlugOrId
      ? `${canonicalUrl}?v=${encodeURIComponent(cleanVersion)}`
      : canonicalUrl

  const wa =
    meta.whatsapp_settings && typeof meta.whatsapp_settings === 'object'
      ? meta.whatsapp_settings
      : {}
  let brandTagline = String(
    wa.brand_tagline || meta.welcome || 'Catálogo Digital y Pedidos en Línea'
  )
    .split('{empresa}')
    .join(companyName)
    .trim()

  if (/^Catálogo oficial de .+ · Atención personalizada$/i.test(brandTagline)) {
    brandTagline = `Catálogo oficial de ${companyName} · Atención personalizada`
  }

  const ogSubtitle = String(
    wa.og_card_subtitle ||
      'Selecciona productos, tallas o presentaciones y adjunta tu comprobante de pago en línea.'
  )
    .split('{empresa}')
    .join(companyName)
    .trim()
  const businessHours = String(wa.business_hours || '').trim()

  const cardTitle = `${companyName} — ${brandTagline}`.slice(0, 95)

  const descParts: string[] = [ogSubtitle]
  if (typeof meta.products_count === 'number' && meta.products_count > 0) {
    descParts.push(`${meta.products_count} productos disponibles.`)
  }
  if (meta.rif?.trim()) {
    descParts.push(`${meta.rif.trim()}.`)
  }
  if (businessHours) {
    descParts.push(`Horario: ${businessHours}.`)
  }
  const cardDescription = descParts.join(' ').slice(0, 195)

  const rawLogo = (meta.logo_url || '').trim()
  const isExternalHttpLogo =
    /^https?:\/\//i.test(rawLogo) && !rawLogo.endsWith('/logo_inventarioPro.png')
  const imgVersion = cleanVersion || (meta.brand_version || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12)
  const baseOgImageUrl = isExternalHttpLogo
    ? rawLogo
    : `${origin}/api/store-preview?asset=logo&store=${encodeURIComponent(canonicalSlugOrId)}`
  const ogImageUrl = imgVersion
    ? `${baseOgImageUrl}${baseOgImageUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(imgVersion)}`
    : baseOgImageUrl

  const themePalette =
    THEME_COLORS[(meta.brand_theme || 'emerald').toLowerCase()] || THEME_COLORS.emerald

  const storeJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: companyName,
    description: cardDescription,
    url: canonicalUrl,
    image: ogImageUrl,
    ...(meta.phone ? { telephone: meta.phone } : {}),
    ...(meta.address ? { address: meta.address } : {}),
  }).replace(/</g, '\\u003c')

  const prefetchJson = JSON.stringify({
    store: canonicalSlugOrId,
    company_id: meta.company_id || null,
    catalog_slug: meta.catalog_slug || null,
    name: companyName,
  }).replace(/</g, '\\u003c')

  let html = templateHtml

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escHtml(cardTitle)}</title>`)
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${escHtml(cardDescription)}" />`
  )
  html = html.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${escHtml(canonicalUrl)}" />`
  )
  html = html.replace(
    /<link\s+rel="icon"[^>]*>/i,
    `<link rel="icon" type="image/png" href="${escHtml(ogImageUrl)}" />`
  )
  html = html.replace(
    /<link\s+rel="apple-touch-icon"[^>]*>/i,
    `<link rel="apple-touch-icon" href="${escHtml(ogImageUrl)}" />`
  )
  html = html.replace(
    /<meta\s+name="theme-color"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="theme-color" content="${escHtml(themePalette.hex)}" />`
  )

  html = html.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${escHtml(ogShareUrl)}" />`
  )
  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${escHtml(cardTitle)}" />`
  )
  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${escHtml(cardDescription)}" />`
  )
  html = html.replace(
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:image" content="${escHtml(ogImageUrl)}" />`
  )
  html = html.replace(
    /<meta\s+property="og:site_name"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:site_name" content="${escHtml(companyName)}" />`
  )

  html = html.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${escHtml(cardTitle)}" />`
  )
  html = html.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${escHtml(cardDescription)}" />`
  )
  html = html.replace(
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:image" content="${escHtml(ogImageUrl)}" />`
  )

  html = html.replace(
    /<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${storeJsonLd}</script>\n    <script>window.__IP_STORE_PREFETCH__=${prefetchJson};</script>`
  )

  return html
}

const FALLBACK_SPA_HTML = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Catálogo Digital</title>
    <meta name="description" content="Catálogo comercial en línea" />
    <link rel="canonical" href="/" />
    <link rel="icon" type="image/png" href="/logo_inventarioPro.png" />
    <link rel="apple-touch-icon" href="/logo_inventarioPro.png" />
    <meta name="theme-color" content="#047857" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="/" />
    <meta property="og:title" content="Catálogo Digital" />
    <meta property="og:description" content="Catálogo comercial en línea" />
    <meta property="og:image" content="/logo_inventarioPro.png" />
    <meta property="og:site_name" content="Tienda Oficial" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Catálogo Digital" />
    <meta name="twitter:description" content="Catálogo comercial en línea" />
    <meta name="twitter:image" content="/logo_inventarioPro.png" />
    <script type="application/ld+json">{}</script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`

export function createStorePreviewHandler(deps?: {
  fetchFn?: typeof fetch
  env?: Record<string, string | undefined>
  loadTemplateHtml?: (reqUrl: string, origin: string) => Promise<string>
}) {
  const fetchFn = deps?.fetchFn || globalThis.fetch.bind(globalThis)
  const getEnv = () => deps?.env || process.env

  return async function handleStorePreview(
    req: StorePreviewReq,
    res: StorePreviewRes
  ): Promise<void> {
    const env = getEnv()
    const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '')
      .trim()
      .replace(/\/+(rest|auth|storage|functions|realtime)\/v1\/?$/i, '')
      .replace(/\/+$/, '')
    const supabaseAnonKey = (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim()
    const managementToken = (env.SUPABASE_ACCESS_TOKEN || '').trim()
    const hostMatch = supabaseUrl.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i)
    const projectRef = (env.SUPABASE_PROJECT_REF || (hostMatch ? hostMatch[1] : '')).trim()
    const origin = resolveRequestOrigin(req)
    const storeKey = extractStoreFromRequest(req)
    const assetType = extractQueryParam(req, 'asset').toLowerCase()

    const meta = await fetchStoreMetadataFromSupabase(
      storeKey,
      supabaseUrl,
      supabaseAnonKey,
      fetchFn,
      managementToken,
      projectRef
    )

    // Modo binario de imagen para og:image / favicon de la empresa
    if (assetType === 'logo') {
      const rawLogo = (meta?.logo_url || '').trim()

      // 1. Si el logo está guardado como DataURL (data:image/png;base64,...), convertir a bytes reales para WhatsApp
      const dataMatch = rawLogo.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i)
      if (dataMatch) {
        const mime = dataMatch[1].toLowerCase()
        const cleanB64 = dataMatch[2].replace(/\s+/g, '')
        if (!mime.includes('svg')) {
          const buf = Buffer.from(cleanB64, 'base64')
          res.setHeader('Content-Type', mime)
          res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600')
          sendBody(res, 200, buf)
          return
        }
      }

      // 2. Si el logo es una URL HTTP pública de Supabase Storage u otro CDN (distinto al logo de InventarioPro)
      if (/^https?:\/\//i.test(rawLogo) && !rawLogo.endsWith('/logo_inventarioPro.png')) {
        try {
          const imgResp = await fetchFn(rawLogo)
          if (imgResp.ok) {
            const cType = imgResp.headers.get('content-type') || 'image/png'
            const arrBuf = await imgResp.arrayBuffer()
            res.setHeader('Content-Type', cType)
            res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600')
            sendBody(res, 200, Buffer.from(arrBuf))
            return
          }
        } catch {
          /* fallback to generated corporate PNG */
        }
      }

      // 3. Emblema PNG corporativo generado en el color de identidad de la empresa (nunca el logo de InventarioPro)
      const generatedPng = generateBrandedStorePng(meta?.brand_theme)
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800')
      sendBody(res, 200, generatedPng)
      return
    }

    // Modo diagnóstico JSON opcional (?format=json)
    if (extractQueryParam(req, 'format').toLowerCase() === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      sendBody(
        res,
        200,
        JSON.stringify({
          ok: true,
          storeKey,
          found: Boolean(meta?.found),
          meta: meta || null,
        })
      )
      return
    }

    // Cargar plantilla HTML base (index.html compilado en Vercel o transformado por Vite en desarrollo)
    let baseHtml = FALLBACK_SPA_HTML
    if (deps?.loadTemplateHtml) {
      try {
        baseHtml = await deps.loadTemplateHtml(req.url || '/', origin)
      } catch {
        /* fallback */
      }
    } else {
      try {
        const tplResp = await fetchFn(`${origin}/index.html`, {
          headers: { Accept: 'text/html' },
        })
        if (tplResp.ok) {
          baseHtml = await tplResp.text()
        }
      } catch {
        /* fallback */
      }
    }

    const reqVersion = extractQueryParam(req, 'v')
    const finalHtml = meta?.found
      ? buildInjectedStoreHtml(baseHtml, meta, origin, reqVersion)
      : baseHtml

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300')
    sendBody(res, 200, finalHtml)
  }
}

const defaultStorePreviewHandler = createStorePreviewHandler()

export default async function handler(
  req: StorePreviewReq,
  res: StorePreviewRes
): Promise<void> {
  await defaultStorePreviewHandler(req, res)
}
