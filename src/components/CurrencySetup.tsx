import { useState } from 'react'
import { Coins } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { normalizeCurrency, refreshCurrency, formatMoney } from '../lib/currency'
import CurrencySelect from './CurrencySelect'

/* Moneda sugerida según la zona horaria o el país del dispositivo (el dueño siempre puede cambiarla). */
const TZ_CURRENCY: Record<string, string> = {
  'America/Bogota': 'COP', 'America/Caracas': 'VES', 'America/Mexico_City': 'MXN', 'America/Monterrey': 'MXN',
  'America/Argentina/Buenos_Aires': 'ARS', 'America/Buenos_Aires': 'ARS', 'America/Santiago': 'CLP', 'America/Lima': 'PEN',
  'America/Sao_Paulo': 'BRL', 'America/La_Paz': 'BOB', 'America/Montevideo': 'UYU', 'America/Asuncion': 'PYG',
  'America/Santo_Domingo': 'DOP', 'America/Guatemala': 'GTQ', 'America/Tegucigalpa': 'HNL', 'America/Managua': 'NIO',
  'America/Costa_Rica': 'CRC', 'America/Panama': 'PAB', 'America/Havana': 'CUP', 'America/Guayaquil': 'USD',
  'America/El_Salvador': 'USD', 'America/New_York': 'USD', 'America/Chicago': 'USD', 'America/Denver': 'USD',
  'America/Los_Angeles': 'USD', 'America/Toronto': 'CAD', 'Europe/Madrid': 'EUR', 'Europe/Paris': 'EUR',
  'Europe/Berlin': 'EUR', 'Europe/Rome': 'EUR', 'Europe/Lisbon': 'EUR', 'Europe/London': 'GBP',
}
const REGION_CURRENCY: Record<string, string> = {
  CO: 'COP', VE: 'VES', MX: 'MXN', AR: 'ARS', CL: 'CLP', PE: 'PEN', BR: 'BRL', BO: 'BOB', UY: 'UYU', PY: 'PYG',
  DO: 'DOP', GT: 'GTQ', HN: 'HNL', NI: 'NIO', CR: 'CRC', PA: 'PAB', CU: 'CUP', EC: 'USD', SV: 'USD', US: 'USD',
  CA: 'CAD', GB: 'GBP', ES: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', IE: 'EUR',
}

function suggestCurrency(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && TZ_CURRENCY[tz]) return TZ_CURRENCY[tz]
  } catch { /* sin zona horaria */ }
  const region = (typeof navigator !== 'undefined' ? navigator.language : '').split('-')[1]?.toUpperCase()
  return (region && REGION_CURRENCY[region]) || 'USD'
}

/** Pantalla de primer ingreso: el dueño elige la moneda en la que trabajará toda la empresa. */
export default function CurrencySetup() {
  const { signOut } = useAuth()
  const [code, setCode] = useState(suggestCurrency())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (saving) return
    setSaving(true); setError('')
    const cur = normalizeCurrency(code)
    const { data: row, error: readErr } = await supabase.from('company_config').select('id').limit(1).maybeSingle()
    if (readErr) { setSaving(false); setError('No se pudo guardar: ' + readErr.message); return }
    const res = row?.id
      ? await supabase.from('company_config').update({ currency: cur, currency_confirmed: true }).eq('id', row.id)
      : await supabase.from('company_config').insert({ name: '', rif: '', address: '', phone: '', email: '', currency: cur, tax_rate: 0, invoice_prefix: 'FAC', geo_mode: 'off', currency_confirmed: true })
    setSaving(false)
    if (res.error) { setError('No se pudo guardar: ' + res.error.message + '. Revisa tu conexión e inténtalo de nuevo.'); return }
    refreshCurrency()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6">
        <div className="w-10 h-10 rounded-lg bg-slate-800 text-white flex items-center justify-center mb-3"><Coins className="w-5 h-5" /></div>
        <h1 className="text-lg font-bold text-slate-800">¿En qué moneda trabaja tu negocio?</h1>
        <p className="text-sm text-slate-500 mt-1">
          Tus precios, ventas, compras, caja y reportes se manejarán en esta moneda. Si un cliente te paga en otra moneda,
          lo registras en la venta y queda guardado con su tasa de cambio.
        </p>
        <div className="mt-4">
          <CurrencySelect value={code} onChange={setCode} />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          Elígela con cuidado: si la cambias después, los montos que ya registraste no se convierten (solo cambia el símbolo con que se muestran).
        </p>
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg mt-3">{error}</p>}
        <button onClick={confirm} disabled={saving} className="w-full mt-4 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
          {saving ? 'Guardando...' : `Usar ${normalizeCurrency(code)} (${formatMoney(1234.5, code)})`}
        </button>
        <button onClick={signOut} className="w-full mt-2 text-xs text-slate-400 hover:text-slate-600 py-1">Cerrar sesión</button>
      </div>
    </div>
  )
}
