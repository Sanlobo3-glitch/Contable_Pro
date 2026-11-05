import { CURRENCIES, formatMoney, fmtNum } from '../lib/currency'
import { round2 } from '../lib/tax'

/** Lo que el usuario escribe cuando el cliente paga en otra moneda. */
export interface FxState { cur: string; amount: string; rate: string; /** Parte recibida en la moneda de la empresa (pago mixto). */ base?: string }

/** Pago en otra moneda ya validado, con su equivalente en la moneda de la empresa. */
/* equivalent = TOTAL recibido en la moneda de la empresa (divisa convertida + la parte en moneda de la empresa).
   fxEquivalent = solo la divisa convertida; baseAmount = solo la parte en moneda de la empresa. */
export interface FxResult { currency: string; amount: number; rate: number; baseAmount: number; fxEquivalent: number; equivalent: number }

/** Devuelve el pago en divisa listo para guardar, o null si falta el monto o la tasa. */
export function fxResult(fx: FxState | null): FxResult | null {
  if (!fx || !fx.cur) return null
  const amount = parseFloat(fx.amount)
  const rate = parseFloat(fx.rate)
  if (!(amount > 0) || !(rate > 0)) return null
  const b = parseFloat(fx.base ?? '')
  const baseAmount = b > 0 ? round2(b) : 0
  const fxEquivalent = round2(amount * rate)
  return { currency: fx.cur, amount, rate, baseAmount, fxEquivalent, equivalent: round2(fxEquivalent + baseAmount) }
}

interface Props {
  /** Moneda de la empresa (en la que se cobra todo). */
  base: string
  /** Total de la venta en la moneda de la empresa. */
  total: number
  /** Tasas guardadas en Configuración: { USD: 4000 }. */
  rates: Record<string, number>
  value: FxState | null
  onChange: (v: FxState | null) => void
  disabled?: boolean
}

/** Opción «Pagó en otra moneda»: monedas, monto recibido, tasa editable, equivalente y cambio. */
export default function FxPayment({ base, total, rates, value, onChange, disabled }: Props) {
  const saved = Object.keys(rates).filter(c => c !== base)
  const others = CURRENCIES.filter(c => c.code !== base && !saved.includes(c.code))
  const res = fxResult(value)

  function toggle(on: boolean) {
    if (!on) { onChange(null); return }
    const first = saved[0] ?? (base === 'USD' ? 'EUR' : 'USD')
    onChange({ cur: first, amount: '', rate: rates[first] ? String(rates[first]) : '', base: '' })
  }
  function pickCurrency(code: string) {
    onChange({ cur: code, amount: '', rate: rates[code] ? String(rates[code]) : '', base: value?.base ?? '' })
  }
  const rateNum = parseFloat(value?.rate ?? '')
  const baseNum = Math.max(0, parseFloat(value?.base ?? '') || 0)
  // Lo que falta por cubrir con la divisa, después de la parte recibida en la moneda de la empresa
  const remainingFx = Math.max(0, total - baseNum)
  const exactAmount = rateNum > 0 ? Math.ceil((remainingFx / rateNum) * 100) / 100 : 0
  function exact() {
    if (!value || !(rateNum > 0)) return
    onChange({ ...value, amount: String(exactAmount) })
  }
  // Pago mixto: lo que falta en la moneda de la empresa una vez descontada la divisa
  const restBase = res ? Math.max(0, round2(total - res.fxEquivalent)) : 0
  function fillRest() {
    if (!value || !(restBase > 0)) return
    onChange({ ...value, base: String(restBase) })
  }

  const diff = res ? round2(res.equivalent - total) : 0
  const savedRate = value ? rates[value.cur] : undefined
  const input = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm'

  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
        <input type="checkbox" checked={value !== null} disabled={disabled} onChange={e => toggle(e.target.checked)} className="w-4 h-4" />
        Pagó en otra moneda
      </label>

      {value && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Moneda</label>
              <select value={value.cur} onChange={e => pickCurrency(e.target.value)} className={input}>
                {saved.length > 0 && (
                  <optgroup label="Con tasa guardada">
                    {saved.map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                )}
                <optgroup label={saved.length > 0 ? 'Otras monedas' : 'Monedas'}>
                  {others.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Tasa: 1 {value.cur} = ? {base}</label>
              <input type="number" inputMode="decimal" min="0" step="any" value={value.rate} onChange={e => onChange({ ...value, rate: e.target.value })} placeholder="Ej: 4000" className={input} />
            </div>
          </div>

          <div>
            <div className="flex items-end justify-between gap-2 mb-1">
              <label className="block text-xs font-medium text-slate-500">Monto recibido en {value.cur}</label>
              {rateNum > 0 && (
                <button type="button" onClick={exact} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded">
                  Exacto: {formatMoney(exactAmount, value.cur)}
                </button>
              )}
            </div>
            <input type="number" inputMode="decimal" min="0" step="any" value={value.amount} onChange={e => onChange({ ...value, amount: e.target.value })} placeholder="0" className={input} />
          </div>

          {value.amount.trim() !== '' && (
            <div>
              <div className="flex items-end justify-between gap-2 mb-1">
                <label className="block text-xs font-medium text-slate-500">Además recibió en {base} (opcional)</label>
                {res && restBase > 0 && (
                  <button type="button" onClick={fillRest} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded">
                    Resto: {formatMoney(restBase, base)}
                  </button>
                )}
              </div>
              <input type="number" inputMode="decimal" min="0" step="any" value={value.base ?? ''} onChange={e => onChange({ ...value, base: e.target.value })} placeholder="0" className={input} />
            </div>
          )}

          {!(rateNum > 0) && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Escribe la tasa del día. Puedes dejarla guardada en Configuración para que aparezca sola.</p>}
          {rateNum > 0 && savedRate && Math.abs(rateNum - savedRate) > 1e-9 && (
            <p className="text-[11px] text-amber-700">La tasa guardada es {fmtNum(savedRate, 4)}; aquí usas {fmtNum(rateNum, 4)} solo para esta venta.</p>
          )}

          {res && (
            <div className="text-sm space-y-0.5">
              {res.baseAmount > 0
                ? <p className="text-slate-600">{formatMoney(res.fxEquivalent, base)} en {value.cur} + {formatMoney(res.baseAmount, base)} = <span className="font-semibold text-slate-800">{formatMoney(res.equivalent, base)}</span></p>
                : <p className="text-slate-600">Equivale a <span className="font-semibold text-slate-800">{formatMoney(res.equivalent, base)}</span></p>}
              <p className={`font-semibold ${diff < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {diff < 0 ? `Faltan ${formatMoney(-diff, base)}` : `Cambio: ${formatMoney(diff, base)} (entrégalo en ${base})`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
