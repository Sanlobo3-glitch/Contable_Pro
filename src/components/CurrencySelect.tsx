import { CURRENCIES, normalizeCurrency, formatMoney } from '../lib/currency'

export default function CurrencySelect({ value, onChange }: { value: unknown; onChange: (code: string) => void }) {
  const code = normalizeCurrency(value)
  return (
    <div>
      <select
        value={code}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
      >
        {CURRENCIES.map(c => (
          <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
        ))}
      </select>
      <p className="text-[11px] text-slate-400 mt-1">Ejemplo: {formatMoney(1234567.89, code)}</p>
    </div>
  )
}
