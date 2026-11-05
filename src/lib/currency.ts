import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'USD', name: 'Dólar estadounidense' },
  { code: 'EUR', name: 'Euro' },
  { code: 'COP', name: 'Peso colombiano' },
  { code: 'MXN', name: 'Peso mexicano' },
  { code: 'ARS', name: 'Peso argentino' },
  { code: 'CLP', name: 'Peso chileno' },
  { code: 'PEN', name: 'Sol peruano' },
  { code: 'BRL', name: 'Real brasileño' },
  { code: 'VES', name: 'Bolívar venezolano' },
  { code: 'BOB', name: 'Boliviano' },
  { code: 'UYU', name: 'Peso uruguayo' },
  { code: 'PYG', name: 'Guaraní paraguayo' },
  { code: 'DOP', name: 'Peso dominicano' },
  { code: 'GTQ', name: 'Quetzal guatemalteco' },
  { code: 'HNL', name: 'Lempira hondureño' },
  { code: 'NIO', name: 'Córdoba nicaragüense' },
  { code: 'CRC', name: 'Colón costarricense' },
  { code: 'PAB', name: 'Balboa panameño' },
  { code: 'CUP', name: 'Peso cubano' },
  { code: 'GBP', name: 'Libra esterlina' },
  { code: 'CHF', name: 'Franco suizo' },
  { code: 'CAD', name: 'Dólar canadiense' },
  { code: 'AUD', name: 'Dólar australiano' },
  { code: 'NZD', name: 'Dólar neozelandés' },
  { code: 'JPY', name: 'Yen japonés' },
  { code: 'CNY', name: 'Yuan chino' },
  { code: 'KRW', name: 'Won surcoreano' },
  { code: 'INR', name: 'Rupia india' },
  { code: 'IDR', name: 'Rupia indonesia' },
  { code: 'PHP', name: 'Peso filipino' },
  { code: 'THB', name: 'Baht tailandés' },
  { code: 'VND', name: 'Dong vietnamita' },
  { code: 'MYR', name: 'Ringgit malayo' },
  { code: 'SGD', name: 'Dólar de Singapur' },
  { code: 'HKD', name: 'Dólar de Hong Kong' },
  { code: 'TRY', name: 'Lira turca' },
  { code: 'AED', name: 'Dírham de los EAU' },
  { code: 'SAR', name: 'Riyal saudí' },
  { code: 'ILS', name: 'Nuevo séquel israelí' },
  { code: 'EGP', name: 'Libra egipcia' },
  { code: 'ZAR', name: 'Rand sudafricano' },
  { code: 'NGN', name: 'Naira nigeriana' },
  { code: 'KES', name: 'Chelín keniano' },
  { code: 'MAD', name: 'Dírham marroquí' },
  { code: 'SEK', name: 'Corona sueca' },
  { code: 'NOK', name: 'Corona noruega' },
  { code: 'DKK', name: 'Corona danesa' },
  { code: 'PLN', name: 'Esloti polaco' },
  { code: 'CZK', name: 'Corona checa' },
  { code: 'HUF', name: 'Forinto húngaro' },
  { code: 'RON', name: 'Leu rumano' },
  { code: 'RUB', name: 'Rublo ruso' },
  { code: 'UAH', name: 'Grivna ucraniana' },
]

// Valores antiguos guardados como texto libre en company_config.currency
const LEGACY: Record<string, string> = {
  'BS': 'VES', 'BS.': 'VES', 'BS.S': 'VES', 'BOLIVARES': 'VES',
  '$': 'USD', 'US$': 'USD', 'DOLAR': 'USD', 'DOLARES': 'USD',
  '€': 'EUR', 'EUROS': 'EUR',
}

/** Devuelve siempre un código ISO válido (USD si no se reconoce). */
export function normalizeCurrency(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(s)) {
    try {
      new Intl.NumberFormat('en', { style: 'currency', currency: s })
      return s
    } catch { /* código no soportado */ }
  }
  return LEGACY[s] || 'USD'
}

const formatters = new Map<string, Intl.NumberFormat>()

/** Formatea un monto: moneda de la empresa + formato numérico del dispositivo. */
export function formatMoney(value: unknown, currency?: unknown): string {
  const code = normalizeCurrency(currency)
  const n = Number(value)
  const v = Number.isFinite(n) ? n : 0
  const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'es'
  const key = `${locale}|${code}`
  let f = formatters.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
    } catch {
      f = new Intl.NumberFormat('es', { style: 'currency', currency: code })
    }
    formatters.set(key, f)
  }
  return f.format(v)
}

/* ───────── Formato por idioma del dispositivo (números y fechas) ───────── */

/** Idioma del dispositivo (ej. es-CO, en-US). Si no se conoce, español. */
export function deviceLocale(): string {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'es'
}

const numFormatters = new Map<string, Intl.NumberFormat>()

/** Número con separadores del dispositivo. Ej.: fmtNum(1234.5, 2, 2) → «1.234,50» o «1,234.50». */
export function fmtNum(value: unknown, maxDigits = 2, minDigits = 0): string {
  const n = Number(value)
  const v = Number.isFinite(n) ? n : 0
  const key = `${deviceLocale()}|${minDigits}|${maxDigits}`
  let f = numFormatters.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(deviceLocale(), { minimumFractionDigits: minDigits, maximumFractionDigits: Math.max(minDigits, maxDigits) })
    } catch {
      f = new Intl.NumberFormat('es', { minimumFractionDigits: minDigits, maximumFractionDigits: Math.max(minDigits, maxDigits) })
    }
    numFormatters.set(key, f)
  }
  return f.format(v)
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value === null || value === undefined || value === '') return null
  // «2026-10-28» sin hora se toma como fecha local (evita que se corra un día)
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00') : new Date(value as string | number)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Fecha en el formato del dispositivo. Por defecto: «28 oct 2026». Devuelve «—» si no es válida. */
export function fmtDate(value: unknown, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const d = toDate(value)
  if (!d) return '—'
  try { return new Intl.DateTimeFormat(deviceLocale(), opts).format(d) } catch { return new Intl.DateTimeFormat('es', opts).format(d) }
}

/** Fecha y hora en el formato del dispositivo. */
export function fmtDateTime(value: unknown): string {
  return fmtDate(value, { dateStyle: 'medium', timeStyle: 'short' })
}

type Cfg = { currency: string; taxRate: number; confirmed: boolean | null; fxRates: Record<string, number> }
const BASE_CFG: Cfg = { currency: 'USD', taxRate: 0, confirmed: null, fxRates: {} }
let cache: { uid: string; cfg: Cfg } | null = null
const listeners = new Set<() => void>()

/** Tasas de cambio guardadas: { USD: 4000 } = 1 USD vale 4000 en la moneda de la empresa. Ignora lo inválido. */
export function parseFxRates(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const code = k.trim().toUpperCase()
      const n = Number(v)
      if (/^[A-Z]{3}$/.test(code) && Number.isFinite(n) && n > 0) out[code] = n
    }
  }
  return out
}

/** Moneda de la empresa ya cargada (USD si aún no se ha cargado). Para funciones fuera de componentes: llama antes a useCurrency() en la pantalla. */
export function currentCurrency(): string {
  return cache?.cfg.currency ?? 'USD'
}

/** Llamar después de guardar la configuración de la empresa. */
export function refreshCurrency() {
  cache = null
  listeners.forEach(l => l())
}

// Copia en el teléfono: así, sin señal, la app sigue mostrando la moneda de la empresa
const storeKey = (uid: string) => `ip-cfg-${uid}`
function readStored(uid: string): Cfg | null {
  try {
    const raw = localStorage.getItem(storeKey(uid))
    if (!raw) return null
    const o = JSON.parse(raw)
    return { currency: normalizeCurrency(o.currency), taxRate: Number(o.taxRate) || 0, confirmed: o.confirmed === false ? false : true, fxRates: parseFxRates(o.fxRates) }
  } catch { return null }
}
function writeStored(uid: string, cfg: Cfg) {
  try { localStorage.setItem(storeKey(uid), JSON.stringify(cfg)) } catch { /* almacenamiento bloqueado */ }
}

/** Lee la configuración de moneda. Devuelve null si no hay conexión (para no pisar lo guardado). */
async function loadCfg(): Promise<Cfg | null> {
  try {
    const full: any = await supabase.from('company_config').select('currency, tax_rate, currency_confirmed, fx_rates').limit(1).maybeSingle()
    if (!full.error) {
      const d = full.data
      return {
        currency: normalizeCurrency(d?.currency),
        taxRate: Number(d?.tax_rate) || 0,
        confirmed: d ? d.currency_confirmed === true : false, // sin fila: la empresa aún no eligió moneda
        fxRates: parseFxRates(d?.fx_rates),
      }
    }
    // Todavía no existen las columnas nuevas (o falló la red): se intenta con lo básico
    const basic: any = await supabase.from('company_config').select('currency, tax_rate').limit(1).maybeSingle()
    if (basic.error) return null
    const d = basic.data
    return { currency: normalizeCurrency(d?.currency), taxRate: Number(d?.tax_rate) || 0, confirmed: true, fxRates: {} }
  } catch { return null }
}

/** Hook: `const { fmt, currency, taxRate, confirmed, fxRates } = useCurrency()` */
export function useCurrency() {
  const { user } = useAuth()
  const uid = (user as any)?.id || ''
  const [cfg, setCfg] = useState<Cfg>(
    cache && cache.uid === uid ? cache.cfg : (uid ? readStored(uid) : null) ?? BASE_CFG
  )
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const l = () => setTick(t => t + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])

  useEffect(() => {
    if (!uid) return
    if (cache && cache.uid === uid) { setCfg(cache.cfg); return }
    let alive = true
    loadCfg().then(c => {
      if (!alive || !c) return
      cache = { uid, cfg: c }
      writeStored(uid, c)
      setCfg(c)
    })
    return () => { alive = false }
  }, [uid, tick])

  return {
    currency: cfg.currency,
    taxRate: cfg.taxRate,
    /** null = aún cargando; false = la empresa todavía no eligió su moneda. */
    confirmed: cfg.confirmed,
    /** Tasas guardadas: { USD: 4000 } = 1 USD vale 4000 en la moneda de la empresa. */
    fxRates: cfg.fxRates,
    fmt: (n: unknown) => formatMoney(n, cfg.currency),
  }
}
