// Gráficos SVG ligeros (sin librerías) para el Centro de Mando.

export function Sparkline({ values, color = '#2563eb', height = 36 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return <div style={{ height }} />
  const w = 120
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(1e-9, max - min)
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`)
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Dos curvas acumuladas por hora: hoy (sólida) contra el promedio habitual (punteada). */
export function HourlyCompare({ today, typical, nowHour }: { today: number[]; typical: number[]; nowHour: number }) {
  const w = 320
  const h = 110
  const max = Math.max(...today, ...typical, 1)
  const x = (i: number) => (i / 23) * (w - 8) + 4
  const y = (v: number) => h - 14 - (v / max) * (h - 24)
  const line = (arr: number[], upTo: number) =>
    arr.slice(0, upTo + 1).map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {[0, 6, 12, 18, 23].map(hr => (
        <g key={hr}>
          <line x1={x(hr)} x2={x(hr)} y1={8} y2={h - 14} stroke="#e2e8f0" strokeWidth="1" />
          <text x={x(hr)} y={h - 2} fontSize="9" textAnchor={hr === 23 ? 'end' : hr === 0 ? 'start' : 'middle'} fill="#94a3b8">{hr}h</text>
        </g>
      ))}
      <polyline points={line(typical, 23)} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
      <polyline points={line(today, nowHour)} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={x(nowHour)} cy={y(today[nowHour] ?? 0)} r="3.5" fill="#16a34a" />
    </svg>
  )
}

export function HBars({ items, format }: { items: { label: string; value: number; color?: string; of?: number }[]; format: (n: number) => string }) {
  const max = Math.max(...items.map(i => i.value), 1)
  return (
    <div className="space-y-2">
      {items.map(it => (
        <div key={it.label}>
          <div className="flex justify-between text-xs text-slate-600 mb-0.5">
            <span className="truncate pr-2">{it.label}</span>
            <span className="font-medium text-slate-800 shrink-0">{format(it.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(it.of && it.of > 0 ? Math.min(1, it.value / it.of) : it.value / max) * 100}%`, background: it.color ?? '#2563eb' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Donut({ parts, size = 110 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const r = 40
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
      {total > 0 && parts.map(p => {
        const len = (p.value / total) * c
        const el = (
          <circle key={p.label} cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)" />
        )
        acc += len
        return el
      })}
    </svg>
  )
}

/** Mapa de calor semana x hora (7 filas, 24 columnas). Lunes arriba. */
export function Heat({ matrix }: { matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat())
  const names = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[320px]">
        {matrix.map((row, d) => (
          <div key={d} className="flex items-center gap-[2px] mb-[2px]">
            <span className="w-4 text-[9px] text-slate-400">{names[d]}</span>
            {row.map((v, h) => (
              <div key={h} className="flex-1 h-3 rounded-[2px]" title={`${names[d]} ${h}h · ${v} ventas`}
                style={{ background: v === 0 ? '#f1f5f9' : `rgba(37,99,235,${0.15 + (v / max) * 0.85})` }} />
            ))}
          </div>
        ))}
        <div className="flex justify-between text-[9px] text-slate-400 pl-4 mt-0.5"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      </div>
    </div>
  )
}
