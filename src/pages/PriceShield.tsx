import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canManageInventory, isReadOnly } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import {
  applyCommercialRounding,
  computeGrossMarginPct,
  saveLabelsPreselection,
  simulateProductPrice,
  upsertSuiteRecord,
  makeSuiteId,
  makeDocumentCode,
  type PriceShieldBatch,
  type PriceStrategy,
  type RoundingMode,
} from '../lib/commercialSuiteRepo'
import type { Category, Product } from '../types'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Lock,
  QrCode,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'

type HealthFilter = 'all' | 'low_margin' | 'below_cost' | 'changed'

export default function PriceShield({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user, isDemo } = useAuth()
  const { fmt: money } = useCurrency()
  const allowed = canManageInventory(user?.role)
  const readOnly = isReadOnly(user)

  const scopeKey = useMemo(
    () => (isDemo ? 'demo' : user?.company_id || user?.id || 'default'),
    [isDemo, user?.company_id, user?.id]
  )

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  // Parámetros del escudo y simulador
  const [strategy, setStrategy] = useState<PriceStrategy>('protect_margin')
  const [targetMarginPct, setTargetMarginPct] = useState('35')
  const [percentValue, setPercentValue] = useState('8')
  const [rounding, setRounding] = useState<RoundingMode>('mult_100')
  const [syncWholesale, setSyncWholesale] = useState(true)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [search, setSearch] = useState('')

  // Overrides manuales y selección
  const [manualPriceOverrides, setManualPriceOverrides] = useState<Record<string, number>>({})
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [lastUpdatedIds, setLastUpdatedIds] = useState<string[]>([])

  const [applying, setApplying] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    const [{ data: prodRows }, { data: catRows }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
    ])
    setProducts((prodRows || []) as Product[])
    setCategories((catRows || []) as Category[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const catMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

  const minMarginNum = Math.min(85, Math.max(1, parseFloat(targetMarginPct) || 35))
  const pctNum = parseFloat(percentValue) || 0

  const simulatedRows = useMemo(() => {
    return products.map(product => {
      const sim = simulateProductPrice({
        product,
        strategy,
        percentValue: pctNum,
        targetMarginPct: minMarginNum,
        rounding,
        syncWholesale,
      })

      const hasManual = Object.prototype.hasOwnProperty.call(manualPriceOverrides, product.id)
      const finalPrice = hasManual ? manualPriceOverrides[product.id] : sim.newPrice
      const finalMargin = computeGrossMarginPct(finalPrice, sim.newCost)
      const finalChanged =
        Math.abs(finalPrice - Number(product.price || 0)) >= 0.01 ||
        Math.abs(sim.newCost - Number(product.cost || 0)) >= 0.01

      return {
        product,
        categoryName: product.category_id ? catMap.get(product.category_id) || 'General' : 'General',
        prevCost: Number(product.cost) || 0,
        prevPrice: Number(product.price) || 0,
        prevMargin: sim.prevMarginPct,
        newCost: sim.newCost,
        newPrice: finalPrice,
        newWholesale: sim.newWholesale,
        newMargin: finalMargin,
        changed: finalChanged,
        belowCost: (Number(product.price) || 0) <= (Number(product.cost) || 0) && (Number(product.cost) || 0) > 0,
        lowMargin:
          (Number(product.cost) || 0) > 0 && sim.prevMarginPct < minMarginNum - 0.05,
        selected: finalChanged && !excludedIds.has(product.id),
      }
    })
  }, [
    products,
    strategy,
    pctNum,
    minMarginNum,
    rounding,
    syncWholesale,
    manualPriceOverrides,
    excludedIds,
    catMap,
  ])

  const summary = useMemo(() => {
    let lowMarginCount = 0
    let belowCostCount = 0
    let selectedCount = 0
    let sumPrevMargin = 0
    let sumNewMargin = 0
    let countedWithCost = 0

    for (const r of simulatedRows) {
      if (r.lowMargin) lowMarginCount++
      if (r.belowCost) belowCostCount++
      if (r.selected) selectedCount++
      if (r.prevCost > 0) {
        sumPrevMargin += r.prevMargin
        sumNewMargin += r.selected ? r.newMargin : r.prevMargin
        countedWithCost++
      }
    }

    return {
      lowMarginCount,
      belowCostCount,
      selectedCount,
      avgPrevMargin: countedWithCost > 0 ? Math.round((sumPrevMargin / countedWithCost) * 10) / 10 : 0,
      avgNewMargin: countedWithCost > 0 ? Math.round((sumNewMargin / countedWithCost) * 10) / 10 : 0,
    }
  }, [simulatedRows])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return simulatedRows.filter(r => {
      if (categoryFilter && r.product.category_id !== categoryFilter) return false
      if (
        q &&
        !r.product.name.toLowerCase().includes(q) &&
        !(r.product.sku || '').toLowerCase().includes(q)
      ) {
        return false
      }
      if (healthFilter === 'low_margin') return r.lowMargin
      if (healthFilter === 'below_cost') return r.belowCost
      if (healthFilter === 'changed') return r.changed
      return true
    })
  }, [simulatedRows, categoryFilter, search, healthFilter])

  function toggleRowSelection(productId: string) {
    setExcludedIds(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  async function handleApplySelectedPrices() {
    if (readOnly || applying) return
    const toApply = simulatedRows.filter(r => r.selected && r.changed)
    if (toApply.length === 0) return

    setApplying(true)
    setFeedback(null)

    const updatedIds: string[] = []
    const errors: string[] = []

    for (const row of toApply) {
      const payload: Record<string, unknown> = {
        price: row.newPrice,
        cost: row.newCost,
      }
      if (syncWholesale && row.newWholesale !== null) {
        payload.price_wholesale = row.newWholesale
      }

      // Si el producto tiene variantes con precios propios, escalarlos proporcionalmente con el mismo redondeo
      if (
        Array.isArray(row.product.variants) &&
        row.product.variants.length > 0 &&
        row.prevPrice > 0
      ) {
        const ratio = row.newPrice / row.prevPrice
        payload.variants = row.product.variants.map(v => ({
          ...v,
          price: applyCommercialRounding((Number(v.price) || row.prevPrice) * ratio, rounding),
        }))
      }

      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', row.product.id)

      if (error) {
        errors.push(`${row.product.name}: ${error.message}`)
      } else {
        updatedIds.push(row.product.id)
      }
    }

    if (updatedIds.length > 0) {
      const batch: PriceShieldBatch = {
        id: makeSuiteId(),
        batch_code: makeDocumentCode('PRC'),
        strategy_label: strategy,
        rounding_mode: rounding,
        updated_count: updatedIds.length,
        avg_prev_margin: summary.avgPrevMargin,
        avg_new_margin: summary.avgNewMargin,
        product_ids: updatedIds,
        created_by_name: user?.full_name || user?.email || 'Gerencia',
        created_at: new Date().toISOString(),
      }
      await upsertSuiteRecord('price_shield_batches', scopeKey, batch)
      setLastUpdatedIds(updatedIds)
      setManualPriceOverrides({})
      setExcludedIds(new Set())
      await loadCatalog()
    }

    setApplying(false)

    if (errors.length > 0) {
      setFeedback({
        ok: false,
        text: `Se actualizaron ${updatedIds.length} productos, con error en ${errors.length}: ${errors[0]}`,
      })
    } else {
      setFeedback({
        ok: true,
        text: `¡Listo! Se actualizaron los precios de ${updatedIds.length} productos en el catálogo y POS. Puedes imprimir sus nuevas etiquetas en un clic.`,
      })
    }
  }

  function handleSendUpdatedToLabels() {
    if (lastUpdatedIds.length === 0 || !onNavigate) return
    saveLabelsPreselection(lastUpdatedIds)
    onNavigate('labels')
  }

  if (!allowed) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-center gap-2">
        <Lock className="w-4 h-4 shrink-0" />
        Solo gerencia, administración o almacén autorizado pueden ajustar márgenes y precios.
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Escudo de márgenes y actualizador de precios
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Detecta productos que perdieron rentabilidad frente al costo de reposición, simula ajustes con redondeo comercial limpio y envía el lote directo a impresión de etiquetas.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={visibleRows.length === 0}
            onClick={() =>
              downloadCsv(
                'simulacion_escudo_precios.csv',
                [
                  'SKU',
                  'Producto',
                  'Categoría',
                  'Costo Actual',
                  'Precio Actual',
                  'Margen Actual %',
                  'Nuevo Precio',
                  'Nuevo Margen %',
                ],
                visibleRows.map(r => [
                  r.product.sku,
                  r.product.name,
                  r.categoryName,
                  r.prevCost,
                  r.prevPrice,
                  r.prevMargin,
                  r.newPrice,
                  r.newMargin,
                ])
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            Exportar simulación
          </button>

          {lastUpdatedIds.length > 0 && onNavigate && (
            <button
              type="button"
              onClick={handleSendUpdatedToLabels}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-600"
            >
              <QrCode className="w-4 h-4" />
              Imprimir etiquetas actualizadas ({lastUpdatedIds.length})
            </button>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Modo solo lectura: activa tu suscripción para aplicar cambios masivos de precios.
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <div className="flex items-center gap-3">
            {feedback.ok && lastUpdatedIds.length > 0 && onNavigate && (
              <button
                type="button"
                onClick={handleSendUpdatedToLabels}
                className="font-semibold underline"
              >
                Abrir Etiquetas con los {lastUpdatedIds.length} productos →
              </button>
            )}
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs opacity-75 hover:opacity-100"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Tarjetas de salud de margen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Referencias bajo margen meta ({minMarginNum}%)</p>
          <p
            className={`text-2xl font-bold mt-1 tabular-nums ${
              summary.lowMarginCount > 0 ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {summary.lowMarginCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">De {products.length} productos totales</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">En pérdida crítica (Precio ≤ Costo)</p>
          <p
            className={`text-2xl font-bold mt-1 tabular-nums ${
              summary.belowCostCount > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {summary.belowCostCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">Requieren corrección inmediata</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Margen bruto promedio (Antes → Después)</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {summary.avgPrevMargin}% →{' '}
            <span className="text-emerald-700">{summary.avgNewMargin}%</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">Sobre productos con costo registrado</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <p className="text-xs text-slate-500">Productos listos para actualizar</p>
            <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
              {summary.selectedCount}
            </p>
          </div>
          <button
            type="button"
            disabled={readOnly || applying || summary.selectedCount === 0}
            onClick={() => void handleApplySelectedPrices()}
            className="mt-2 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs sm:text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            {applying ? 'Actualizando precios...' : `Aplicar a ${summary.selectedCount} producto(s)`}
          </button>
        </div>
      </div>

      {/* Panel de reglas de simulación y redondeo */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Regla de actualización
            </label>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value as PriceStrategy)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="protect_margin">Proteger margen bruto mínimo (%)</option>
              <option value="percent_increase">Incremento porcentual directo (%)</option>
              <option value="cost_hike_recalc">Subir costo de reposición (%) + recalcular</option>
            </select>
          </div>

          {strategy === 'protect_margin' ? (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Margen bruto mínimo deseado (%)
              </label>
              <input
                type="number"
                min="1"
                max="85"
                step="0.5"
                value={targetMarginPct}
                onChange={e => setTargetMarginPct(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold tabular-nums"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {strategy === 'percent_increase'
                  ? 'Porcentaje de ajuste de precio (%)'
                  : 'Aumento en costo de reposición (%)'}
              </label>
              <input
                type="number"
                step="0.5"
                value={percentValue}
                onChange={e => setPercentValue(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold tabular-nums"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Redondeo comercial de vitrina
            </label>
            <select
              value={rounding}
              onChange={e => setRounding(e.target.value as RoundingMode)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="exact">Exacto (2 decimales)</option>
              <option value="mult_50">Múltiplos de 50</option>
              <option value="mult_100">Múltiplos de 100</option>
              <option value="mult_500">Múltiplos de 500</option>
              <option value="mult_1000">Múltiplos de 1.000</option>
              <option value="psych_900">Terminación comercial .900</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Filtrar por categoría
            </label>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">Todas las categorías</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={syncWholesale}
              onChange={e => setSyncWholesale(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span>Ajustar también precios al por mayor y variantes proporcionalmente</span>
          </label>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-64 max-w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar SKU o producto..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>

            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100">
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'low_margin', label: 'Bajo margen' },
                  { id: 'below_cost', label: 'En pérdida' },
                  { id: 'changed', label: 'Con cambio simulado' },
                ] as const
              ).map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setHealthFilter(f.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    healthFilter === f.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tabla comparativa Antes vs Después */}
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="w-10 px-3 py-3 text-center">Aplicar</th>
                <th className="text-left px-4 py-3 font-medium">Producto / SKU</th>
                <th className="text-right px-4 py-3 font-medium">Costo</th>
                <th className="text-right px-4 py-3 font-medium">Precio actual</th>
                <th className="text-right px-4 py-3 font-medium">Margen actual</th>
                <th className="text-right px-4 py-3 font-medium">Nuevo precio</th>
                <th className="text-right px-4 py-3 font-medium">Nuevo margen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map(r => (
                <tr key={r.product.id} className="hover:bg-slate-50/70">
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      disabled={!r.changed || readOnly}
                      checked={r.selected}
                      onChange={() => toggleRowSelection(r.product.id)}
                      className="rounded border-slate-300"
                    />
                  </td>

                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 flex items-center gap-1.5">
                      <span>{r.product.name}</span>
                      {r.belowCost && (
                        <AlertTriangle
                          className="w-3.5 h-3.5 text-red-600 shrink-0"
                          aria-label="Precio inferior o igual al costo"
                        />
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      <span>{r.product.sku || 'Sin SKU'}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{r.categoryName}</span>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {money(r.newCost)}
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {money(r.prevPrice)}
                  </td>

                  <td
                    className={`px-4 py-3 text-right tabular-nums text-xs font-semibold ${
                      r.belowCost
                        ? 'text-red-700'
                        : r.lowMargin
                          ? 'text-amber-700'
                          : 'text-slate-600'
                    }`}
                  >
                    {r.prevCost > 0 ? `${r.prevMargin}%` : 'Sin costo'}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      disabled={readOnly}
                      value={r.newPrice}
                      onChange={e => {
                        const v = parseFloat(e.target.value)
                        if (Number.isFinite(v) && v >= 0) {
                          setManualPriceOverrides(prev => ({
                            ...prev,
                            [r.product.id]: v,
                          }))
                        }
                      }}
                      className={`w-28 px-2.5 py-1.5 rounded-lg border text-right font-semibold tabular-nums text-sm ${
                        r.changed
                          ? 'border-emerald-400 bg-emerald-50/40 text-slate-900'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    />
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-xs font-semibold text-emerald-700">
                    {r.newCost > 0 ? (
                      <span className="inline-flex items-center gap-1 justify-end">
                        {r.changed && <TrendingUp className="w-3.5 h-3.5" />}
                        {r.newMargin}%
                      </span>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-slate-300 inline" />
                    )}
                  </td>
                </tr>
              ))}

              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">
                    No hay productos que coincidan con el filtro seleccionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
