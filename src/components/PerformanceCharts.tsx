import { useState } from 'react'
import { UserAvatar } from './AvatarCapture'

export interface TrendPoint {
  key: string
  label: string
  shortLabel: string
  primary: number
  secondary?: number
  count?: number
}

export function InteractiveTrendChart({
  points,
  primaryLabel,
  secondaryLabel,
  formatValue,
  primaryColor = '#0f172a',
  secondaryColor = '#94a3b8',
  height = 200,
}: {
  points: TrendPoint[]
  primaryLabel: string
  secondaryLabel?: string
  formatValue: (n: number) => string
  primaryColor?: string
  secondaryColor?: string
  height?: number
}) {
  const [selectedIdx, setSelectedIdx] = useState<number>(() => Math.max(0, points.length - 1))

  if (points.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-slate-400">
        No hay datos suficientes en el rango seleccionado para graficar.
      </div>
    )
  }

  const safeIdx = Math.min(Math.max(0, selectedIdx), points.length - 1)
  const active = points[safeIdx]
  const maxVal = Math.max(
    1,
    ...points.map(p => Math.max(p.primary || 0, p.secondary || 0))
  )

  const chartW = 680
  const chartH = height
  const padTop = 14
  const padBottom = 26
  const padX = 12
  const plotW = chartW - padX * 2
  const plotH = chartH - padTop - padBottom
  const slotW = plotW / points.length
  const hasSecondary = Boolean(secondaryLabel) && points.some(p => (p.secondary ?? 0) > 0)

  const yOf = (v: number) => padTop + plotH - (Math.max(0, v) / maxVal) * plotH

  return (
    <div className="space-y-3">
      {/* Barra interactiva de lectura del punto seleccionado */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-slate-900">{active.label}</span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="text-slate-600 tabular-nums">
            {primaryLabel}: <strong className="text-slate-900">{formatValue(active.primary)}</strong>
          </span>
          {secondaryLabel && active.secondary !== undefined && (
            <>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-slate-600 tabular-nums">
                {secondaryLabel}: <strong className="text-slate-700">{formatValue(active.secondary)}</strong>
              </span>
            </>
          )}
          {active.count !== undefined && (
            <>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-slate-500 tabular-nums">
                {active.count} {active.count === 1 ? 'operación' : 'operaciones'}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: primaryColor }} />
            {primaryLabel}
          </span>
          {secondaryLabel && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: secondaryColor }} />
              {secondaryLabel}
            </span>
          )}
        </div>
      </div>

      {/* Lienzo SVG interactivo */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full min-w-[420px] select-none"
          role="img"
          aria-label={`Gráfico de ${primaryLabel}`}
        >
          {[0, 0.5, 1].map(frac => {
            const y = padTop + plotH * (1 - frac)
            return (
              <line
                key={frac}
                x1={padX}
                x2={chartW - padX}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray={frac === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
            )
          })}

          {points.map((pt, i) => {
            const cx = padX + i * slotW + slotW / 2
            const isSelected = i === safeIdx
            const barMaxW = Math.min(28, Math.max(6, slotW * (hasSecondary ? 0.34 : 0.56)))
            const h1 = Math.max(pt.primary > 0 ? 3 : 0, ((pt.primary || 0) / maxVal) * plotH)
            const y1 = padTop + plotH - h1
            const h2 = hasSecondary
              ? Math.max((pt.secondary || 0) > 0 ? 3 : 0, ((pt.secondary || 0) / maxVal) * plotH)
              : 0
            const y2 = padTop + plotH - h2

            const showTick =
              points.length <= 10 ||
              i === 0 ||
              i === points.length - 1 ||
              i % Math.ceil(points.length / 7) === 0

            return (
              <g
                key={pt.key}
                className="cursor-pointer"
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => setSelectedIdx(i)}
              >
                <rect
                  x={padX + i * slotW}
                  y={padTop}
                  width={slotW}
                  height={plotH + padBottom}
                  fill={isSelected ? '#f1f5f9' : 'transparent'}
                  rx={6}
                />

                {hasSecondary ? (
                  <>
                    <rect
                      x={cx - barMaxW - 1}
                      y={y1}
                      width={barMaxW}
                      height={h1}
                      rx={3}
                      fill={isSelected ? '#2563eb' : primaryColor}
                    />
                    <rect
                      x={cx + 1}
                      y={y2}
                      width={barMaxW}
                      height={h2}
                      rx={3}
                      fill={secondaryColor}
                      opacity={isSelected ? 0.95 : 0.75}
                    />
                  </>
                ) : (
                  <rect
                    x={cx - barMaxW / 2}
                    y={y1}
                    width={barMaxW}
                    height={h1}
                    rx={3}
                    fill={isSelected ? '#2563eb' : primaryColor}
                  />
                )}

                {pt.primary === 0 && (!hasSecondary || (pt.secondary || 0) === 0) && (
                  <line
                    x1={cx - barMaxW / 2}
                    x2={cx + barMaxW / 2}
                    y1={yOf(0)}
                    y2={yOf(0)}
                    stroke="#cbd5e1"
                    strokeWidth="2"
                  />
                )}

                {showTick && (
                  <text
                    x={cx}
                    y={chartH - 7}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight={isSelected ? '600' : '400'}
                    fill={isSelected ? '#0f172a' : '#64748b'}
                  >
                    {pt.shortLabel}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export interface SellerBarItem {
  id: string
  name: string
  email: string
  avatar_url?: string | null
  zone?: string | null
  sales: number
  goal: number
  commission: number
  clients: number
  salesCount: number
  active: boolean
}

export function SellerPerformanceBars({
  items,
  formatMoney,
  onSelect,
  selectedId,
}: {
  items: SellerBarItem[]
  formatMoney: (n: number) => string
  onSelect?: (id: string) => void
  selectedId?: string | null
}) {
  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-slate-400">
        Aún no hay vendedores registrados para comparar su rendimiento.
      </div>
    )
  }

  const maxSales = Math.max(1, ...items.map(i => Math.max(i.sales, i.goal)))

  return (
    <div className="divide-y divide-slate-100">
      {items.map(item => {
        const pctBar = Math.min(100, (item.sales / maxSales) * 100)
        const goalPct = item.goal > 0 ? Math.round((item.sales / item.goal) * 100) : null
        const selected = selectedId === item.id

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect?.(item.id)}
            className={`w-full text-left py-3 px-3 rounded-lg transition-colors ${
              selected ? 'bg-slate-50 ring-1 ring-slate-300' : 'hover:bg-slate-50/70'
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <UserAvatar src={item.avatar_url} name={item.name} email={item.email} size="xs" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {item.name}
                    {!item.active && <span className="text-xs font-normal text-red-600"> · Suspendido</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate tabular-nums">
                    {item.salesCount} {item.salesCount === 1 ? 'venta' : 'ventas'} · {item.clients}{' '}
                    {item.clients === 1 ? 'cliente' : 'clientes'}
                    {item.zone ? ` · ${item.zone}` : ''}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0 tabular-nums">
                <p className="text-sm font-semibold text-slate-900">{formatMoney(item.sales)}</p>
                <p className="text-[11px] text-slate-500">
                  {goalPct !== null
                    ? `${goalPct}% de meta (${formatMoney(item.goal)})`
                    : item.commission > 0
                      ? `Comisión: ${formatMoney(item.commission)}`
                      : 'Sin meta asignada'}
                </p>
              </div>
            </div>

            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  goalPct !== null && goalPct >= 100
                    ? 'bg-emerald-600'
                    : goalPct !== null && goalPct < 60
                      ? 'bg-amber-500'
                      : 'bg-slate-900'
                }`}
                style={{ width: `${Math.max(item.sales > 0 ? 3 : 0, pctBar)}%` }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
