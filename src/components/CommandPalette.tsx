import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, ArrowRight, Warehouse as WarehouseIcon, X } from 'lucide-react'
import type { Warehouse } from '../types'

export interface PaletteItem {
  id: string
  label: string
  section: string
  keywords?: string
  icon: ReactNode
}

export default function CommandPalette({
  open,
  onClose,
  items,
  warehouses,
  activeWarehouseId,
  onSelectPage,
  onSelectWarehouse,
}: {
  open: boolean
  onClose: () => void
  items: PaletteItem[]
  warehouses: Warehouse[]
  activeWarehouseId: string | null
  onSelectPage: (pageId: string) => void
  onSelectWarehouse: (warehouseId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      window.setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const navMatches = items.filter(
      it =>
        !q ||
        it.label.toLowerCase().includes(q) ||
        it.section.toLowerCase().includes(q) ||
        (it.keywords && it.keywords.toLowerCase().includes(q))
    )

    const whMatches =
      warehouses.length > 1
        ? warehouses
            .filter(
              w =>
                w.active !== false &&
                (!q ||
                  'cambiar bodega'.includes(q) ||
                  w.name.toLowerCase().includes(q) ||
                  String(w.code || '').toLowerCase().includes(q))
            )
            .map(w => ({
              kind: 'warehouse' as const,
              key: `wh:${w.id}`,
              id: w.id,
              label: `Operar con ${w.code ? `${w.code} · ` : ''}${w.name}`,
              sub: activeWarehouseId === w.id ? 'Bodega activa actual' : 'Cambiar bodega activa',
            }))
        : []

    return [
      ...navMatches.map(n => ({
        kind: 'page' as const,
        key: `pg:${n.id}`,
        id: n.id,
        label: n.label,
        sub: n.section,
        icon: n.icon,
      })),
      ...whMatches.map(w => ({
        ...w,
        icon: <WarehouseIcon className="w-4 h-4 shrink-0 text-slate-500" />,
      })),
    ].slice(0, 18)
  }, [items, warehouses, activeWarehouseId, query])

  useEffect(() => {
    setCursor(0)
  }, [query])

  if (!open) return null

  function executeIndex(idx: number) {
    const target = filtered[idx]
    if (!target) return
    if (target.kind === 'page') {
      onSelectPage(target.id)
    } else {
      onSelectWarehouse(target.id)
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex items-start justify-center pt-16 sm:pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 w-full max-w-xl overflow-hidden shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2.5">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor(c => (filtered.length ? (c + 1) % filtered.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor(c => (filtered.length ? (c - 1 + filtered.length) % filtered.length : 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                executeIndex(cursor)
              }
            }}
            placeholder="Ir a cualquier módulo, reporte, libro contable o cambiar bodega..."
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600"
            aria-label="Cerrar buscador rápido"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-xs text-slate-400 text-center">
              Sin coincidencias para «{query}».
            </p>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === cursor
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => executeIndex(idx)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                    active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={active ? 'text-white' : 'text-slate-500'}>{item.icon}</span>
                    <span className="text-sm font-medium truncate">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                      {item.sub}
                    </span>
                    <ArrowRight className={`w-3.5 h-3.5 ${active ? 'text-white' : 'text-slate-300'}`} />
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>Usa ↑ ↓ para navegar · Enter para abrir</span>
          <span>Esc para cerrar</span>
        </div>
      </div>
    </div>
  )
}
