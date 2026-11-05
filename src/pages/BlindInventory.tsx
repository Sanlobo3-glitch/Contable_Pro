import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isCompanyManager, isReadOnly } from '../lib/auth'
import { useCurrency, fmtDateTime } from '../lib/currency'
import { useWarehouse } from '../lib/warehouseContext'
import { useBackOverlay } from '../lib/navigation'
import { downloadCsv } from '../lib/csv'
import { esc, printHtml } from '../lib/documents'
import BarcodeScanner from '../components/BarcodeScanner'
import {
  listSuiteRecords,
  upsertSuiteRecord,
  makeSuiteId,
  makeDocumentCode,
  type BlindCountLine,
  type BlindInventorySession,
} from '../lib/commercialSuiteRepo'
import { recordAnomaly } from '../lib/innovationsRepo'
import type { Category, Product } from '../types'
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  Lock,
  Minus,
  Plus,
  Printer,
  QrCode,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'

type CountFilter = 'all' | 'pending' | 'counted'
type AuditFilter = 'all' | 'differences' | 'shortages' | 'surpluses'

export default function BlindInventory({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user, isDemo } = useAuth()
  const { fmt: money } = useCurrency()
  const { activeWarehouseId, activeWarehouse } = useWarehouse()
  const readOnly = isReadOnly(user)
  const canAuditAndApprove = isCompanyManager(user?.role) || user?.role === 'contador'

  const scopeKey = useMemo(
    () => (isDemo ? 'demo' : user?.company_id || user?.id || 'default'),
    [isDemo, user?.company_id, user?.id]
  )

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [sessions, setSessions] = useState<BlindInventorySession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Modo de vista dentro de una sesión abierta: 'blind' (operador sin ver stock) o 'audit' (gerencia)
  const [viewMode, setViewMode] = useState<'blind' | 'audit'>('blind')
  const [countFilter, setCountFilter] = useState<CountFilter>('all')
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('differences')
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)

  // Modal nueva sesión
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newNotes, setNewNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  useBackOverlay(createOpen || scanning, () => {
    setScanning(false)
    setCreateOpen(false)
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: prodRows }, { data: catRows }, sessionRes] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      listSuiteRecords<BlindInventorySession>('blind_inventory_sessions', scopeKey),
    ])

    setProducts((prodRows || []) as Product[])
    setCategories((catRows || []) as Category[])
    setSessions(sessionRes.rows)
    if (!activeSessionId && sessionRes.rows.length > 0) {
      const openOne = sessionRes.rows.find(
        s => s.status === 'en_conteo' || s.status === 'revision'
      )
      if (openOne) {
        setActiveSessionId(openOne.id)
      }
    }
    setLoading(false)
  }, [scopeKey, activeSessionId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const catMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  )

  // Si el usuario no es gerente/contador, forzar siempre vista ciega durante el conteo
  useEffect(() => {
    if (!canAuditAndApprove && activeSession?.status !== 'aplicada') {
      setViewMode('blind')
    }
  }, [canAuditAndApprove, activeSession?.status])

  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return

    const targetProducts = newCategoryId
      ? products.filter(p => p.category_id === newCategoryId)
      : products

    if (targetProducts.length === 0) {
      setFeedback({
        ok: false,
        text: 'No hay productos registrados en la categoría seleccionada para iniciar la toma física.',
      })
      return
    }

    setSaving(true)
    const code = makeDocumentCode('AUD')
    const catLabel = newCategoryId ? catMap.get(newCategoryId) || 'Categoría' : 'Catálogo general'
    const lines: BlindCountLine[] = targetProducts.map(p => ({
      product_id: p.id,
      product_name: p.name,
      sku: p.sku || '',
      unit: p.unit || 'unidad',
      category_name: p.category_id ? catMap.get(p.category_id) || 'General' : 'General',
      cost: Number(p.cost) || 0,
      price: Number(p.price) || 0,
      expected_stock: Number(p.stock) || 0,
      counted_qty: null,
      counted_at: null,
      note: '',
    }))

    const record: BlindInventorySession = {
      id: makeSuiteId(),
      session_code: code,
      warehouse_id: activeWarehouseId || null,
      title:
        newTitle.trim() ||
        `Toma física ${catLabel}${activeWarehouse ? ` · ${activeWarehouse.name}` : ''}`,
      category_filter: catLabel,
      status: 'en_conteo',
      items: lines,
      counted_by_name: user?.full_name || user?.email || 'Operador',
      approved_by_name: null,
      total_variance_units: 0,
      total_variance_cost: 0,
      notes: newNotes.trim() || null,
      created_at: new Date().toISOString(),
      applied_at: null,
    }

    const { saved } = await upsertSuiteRecord('blind_inventory_sessions', scopeKey, record)
    setSessions(prev => [saved, ...prev.filter(s => s.id !== saved.id)])
    setActiveSessionId(saved.id)
    setViewMode('blind')
    setCreateOpen(false)
    setNewTitle('')
    setNewCategoryId('')
    setNewNotes('')
    setSaving(false)
    setFeedback({
      ok: true,
      text: `Jornada ${code} abierta con ${lines.length} productos en modo ciego (sin revelar existencias teóricas).`,
    })
  }

  async function persistUpdatedSession(next: BlindInventorySession) {
    setSessions(prev => prev.map(s => (s.id === next.id ? next : s)))
    await upsertSuiteRecord('blind_inventory_sessions', scopeKey, next)
  }

  function updateCountForProduct(productId: string, nextValue: number | null, note?: string) {
    if (!activeSession || activeSession.status === 'aplicada' || activeSession.status === 'anulada') {
      return
    }
    const cleanQty =
      nextValue === null || !Number.isFinite(nextValue)
        ? null
        : Math.max(0, Math.round(nextValue * 100) / 100)

    const updatedItems = activeSession.items.map(line => {
      if (line.product_id !== productId) return line
      return {
        ...line,
        counted_qty: cleanQty,
        counted_at: cleanQty !== null ? new Date().toISOString() : null,
        note: note !== undefined ? note : line.note,
      }
    })

    let varUnits = 0
    let varCost = 0
    for (const l of updatedItems) {
      if (l.counted_qty !== null) {
        const diff = l.counted_qty - l.expected_stock
        varUnits += diff
        varCost += diff * l.cost
      }
    }

    const next: BlindInventorySession = {
      ...activeSession,
      counted_by_name: user?.full_name || activeSession.counted_by_name,
      items: updatedItems,
      total_variance_units: Math.round(varUnits * 100) / 100,
      total_variance_cost: Math.round(varCost * 100) / 100,
    }
    void persistUpdatedSession(next)
  }

  function handleBarcodeScan(rawCode: string): string {
    if (!activeSession || activeSession.status === 'aplicada') {
      return 'La sesión actual ya está cerrada'
    }
    const code = rawCode.trim().toLowerCase()
    const found = activeSession.items.find(
      it => (it.sku || '').trim().toLowerCase() === code
    )
    if (!found) {
      return `Código ${rawCode} no pertenece a esta jornada`
    }
    const nextQty = (found.counted_qty ?? 0) + 1
    updateCountForProduct(found.product_id, nextQty)
    return `Contado +1: ${found.product_name} (llevas ${nextQty} ${found.unit})`
  }

  async function handleFinishBlindCount() {
    if (!activeSession || readOnly) return
    const next: BlindInventorySession = {
      ...activeSession,
      status: 'revision',
      counted_by_name: user?.full_name || activeSession.counted_by_name,
    }
    await persistUpdatedSession(next)
    if (canAuditAndApprove) {
      setViewMode('audit')
    }
    setFeedback({
      ok: true,
      text: `Conteo enviado a revisión gerencial (${countedStats.counted} de ${countedStats.total} referencias contadas).`,
    })
  }

  async function handleApproveAndApplyAdjustments() {
    if (!activeSession || !canAuditAndApprove || readOnly || applying) return

    const countedLines = activeSession.items.filter(it => it.counted_qty !== null)
    if (countedLines.length === 0) {
      setFeedback({
        ok: false,
        text: 'Registra al menos un producto contado antes de aplicar el ajuste al Kardex.',
      })
      return
    }

    const diffLines = countedLines.filter(
      it => Math.abs((it.counted_qty ?? 0) - it.expected_stock) >= 0.001
    )

    setApplying(true)
    setFeedback(null)

    let adjustedCount = 0
    const errors: string[] = []

    for (const line of diffLines) {
      const targetStock = line.counted_qty ?? line.expected_stock
      const diff = targetStock - line.expected_stock
      const reason = `Auditoría ciega ${activeSession.session_code} (${diff > 0 ? `+${diff} sobrante` : `${diff} faltante`})${line.note ? ` · ${line.note}` : ''}`

      const { error } = await supabase.rpc('ajustar_stock', {
        p_product_id: line.product_id,
        p_new_stock: targetStock,
        p_reason: reason,
      })

      if (error) {
        errors.push(`${line.product_name}: ${error.message}`)
      } else {
        adjustedCount++
      }
    }

    const next: BlindInventorySession = {
      ...activeSession,
      status: errors.length === 0 ? 'aplicada' : 'revision',
      approved_by_name: user?.full_name || user?.email || 'Gerencia',
      applied_at: errors.length === 0 ? new Date().toISOString() : null,
    }
    await persistUpdatedSession(next)

    if (activeSession.total_variance_cost < 0) {
      try {
        recordAnomaly({
          company_id: user?.company_id || '00000000-0000-4000-8000-000000000001',
          category: 'merma_ciega',
          severity: Math.abs(activeSession.total_variance_cost) > 100000 ? 'critica' : 'moderada',
          title: `Merma física en toma ciega ${activeSession.session_code}`,
          description: `Discrepancia de ${Math.abs(activeSession.total_variance_units)} unidades faltantes en ${diffLines.length} productos durante auditoría física.`,
          involved_user_name: activeSession.counted_by_name || user?.full_name || 'Operario de inventario',
          involved_branch: activeSession.warehouse_id || activeSession.title || null,
          financial_impact: Math.abs(activeSession.total_variance_cost),
        })
      } catch {
        /* ignore */
      }
    }

    await loadData()
    setApplying(false)

    if (errors.length > 0) {
      setFeedback({
        ok: false,
        text: `Se ajustaron ${adjustedCount} productos, pero hubo novedades en ${errors.length}: ${errors[0]}`,
      })
    } else {
      setFeedback({
        ok: true,
        text:
          diffLines.length === 0
            ? `Acta ${activeSession.session_code} cerrada con cuadre exacto (0 diferencias en inventario).`
            : `Acta ${activeSession.session_code} aprobada: se ajustaron ${adjustedCount} referencias directamente en Productos y Kardex.`,
      })
    }
  }

  const countedStats = useMemo(() => {
    if (!activeSession) {
      return {
        total: 0,
        counted: 0,
        pending: 0,
        pct: 0,
        shortagesUnits: 0,
        shortagesCost: 0,
        surplusesUnits: 0,
        surplusesCost: 0,
        exactMatches: 0,
      }
    }
    const total = activeSession.items.length
    let counted = 0
    let shortagesUnits = 0
    let shortagesCost = 0
    let surplusesUnits = 0
    let surplusesCost = 0
    let exactMatches = 0

    for (const it of activeSession.items) {
      if (it.counted_qty !== null) {
        counted++
        const diff = it.counted_qty - it.expected_stock
        if (Math.abs(diff) < 0.001) {
          exactMatches++
        } else if (diff < 0) {
          shortagesUnits += Math.abs(diff)
          shortagesCost += Math.abs(diff) * it.cost
        } else {
          surplusesUnits += diff
          surplusesCost += diff * it.cost
        }
      }
    }

    return {
      total,
      counted,
      pending: total - counted,
      pct: total > 0 ? Math.round((counted / total) * 100) : 0,
      shortagesUnits: Math.round(shortagesUnits * 100) / 100,
      shortagesCost: Math.round(shortagesCost * 100) / 100,
      surplusesUnits: Math.round(surplusesUnits * 100) / 100,
      surplusesCost: Math.round(surplusesCost * 100) / 100,
      exactMatches,
    }
  }, [activeSession])

  const filteredLines = useMemo(() => {
    if (!activeSession) return []
    const q = search.trim().toLowerCase()
    return activeSession.items.filter(it => {
      if (
        q &&
        !it.product_name.toLowerCase().includes(q) &&
        !(it.sku || '').toLowerCase().includes(q) &&
        !it.category_name.toLowerCase().includes(q)
      ) {
        return false
      }

      if (viewMode === 'blind') {
        if (countFilter === 'pending') return it.counted_qty === null
        if (countFilter === 'counted') return it.counted_qty !== null
        return true
      }

      // Vista de auditoría
      const diff = it.counted_qty === null ? 0 : it.counted_qty - it.expected_stock
      if (auditFilter === 'differences') {
        return it.counted_qty !== null && Math.abs(diff) >= 0.001
      }
      if (auditFilter === 'shortages') {
        return it.counted_qty !== null && diff < -0.001
      }
      if (auditFilter === 'surpluses') {
        return it.counted_qty !== null && diff > 0.001
      }
      return true
    })
  }, [activeSession, search, viewMode, countFilter, auditFilter])

  function handleExportAuditCsv() {
    if (!activeSession || !canAuditAndApprove) return
    downloadCsv(
      `acta_auditoria_ciega_${activeSession.session_code}.csv`,
      [
        'SKU',
        'Producto',
        'Categoría',
        'Unidad',
        'Stock Sistema',
        'Conteo Físico',
        'Diferencia Uds',
        'Costo Unitario',
        'Impacto al Costo',
        'Observación',
      ],
      activeSession.items.map(it => {
        const diff = it.counted_qty === null ? 0 : it.counted_qty - it.expected_stock
        return [
          it.sku,
          it.product_name,
          it.category_name,
          it.unit,
          it.expected_stock,
          it.counted_qty ?? 'Sin contar',
          it.counted_qty === null ? '' : diff,
          it.cost,
          it.counted_qty === null ? 0 : Math.round(diff * it.cost * 100) / 100,
          it.note,
        ]
      })
    )
  }

  function handlePrintAuditAct() {
    if (!activeSession || !canAuditAndApprove) return
    const rowsHtml = activeSession.items
      .filter(it => it.counted_qty !== null)
      .map(it => {
        const diff = (it.counted_qty ?? 0) - it.expected_stock
        const impact = diff * it.cost
        return `<tr>
          <td>${esc(it.sku || '—')}</td>
          <td>${esc(it.product_name)}</td>
          <td style="text-align:right">${it.expected_stock}</td>
          <td style="text-align:right;font-weight:600">${it.counted_qty}</td>
          <td style="text-align:right;color:${diff < 0 ? '#b91c1c' : diff > 0 ? '#047857' : '#334155'}">${diff > 0 ? `+${diff}` : diff}</td>
          <td style="text-align:right">${esc(money(impact))}</td>
        </tr>`
      })
      .join('')

    printHtml(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta ${esc(activeSession.session_code)}</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#0f172a;font-size:12px}
        h1{margin:0 0 4px;font-size:18px}
        .meta{color:#64748b;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th,td{border-bottom:1px solid #e2e8f0;padding:7px 8px;text-align:left}
        th{background:#f8fafc;font-size:11px;text-transform:uppercase;color:#475569}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}
        .sig{border-top:1px solid #334155;padding-top:6px;text-align:center;color:#475569}
      </style></head><body>
      <h1>Acta de Auditoría Física Ciega · ${esc(activeSession.session_code)}</h1>
      <div class="meta">${esc(activeSession.title)} · Fecha: ${esc(fmtDateTime(activeSession.created_at))} · Estado: ${esc(activeSession.status.toUpperCase())}</div>
      <p><strong>Faltantes al costo:</strong> -${esc(money(countedStats.shortagesCost))} (${countedStats.shortagesUnits} uds) &nbsp;·&nbsp; <strong>Sobrantes al costo:</strong> +${esc(money(countedStats.surplusesCost))} (${countedStats.surplusesUnits} uds)</p>
      <table>
        <thead><tr><th>SKU</th><th>Producto</th><th style="text-align:right">Sistema</th><th style="text-align:right">Contado</th><th style="text-align:right">Dif.</th><th style="text-align:right">Impacto Costo</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="6">Sin conteos registrados</td></tr>'}</tbody>
      </table>
      <div class="sigs">
        <div class="sig">Contado por: ${esc(activeSession.counted_by_name || 'Operador de almacén')}</div>
        <div class="sig">Aprobado por: ${esc(activeSession.approved_by_name || 'Gerencia / Auditoría')}</div>
      </div>
    </body></html>`)
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Toma física ciega de inventario
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            El equipo cuenta mercancía con lector de barras o celular sin ver el stock del sistema. Gerencia audita las diferencias reales y ajusta el Kardex en un clic sin cerrar el local.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('kardex')}
              className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Ver Kardex
            </button>
          )}
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nueva jornada ciega
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Modo solo lectura: activa tu plan para crear y aplicar auditorías físicas.
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline opacity-75 hover:opacity-100"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Selector de jornadas */}
      {sessions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <label className="text-xs font-medium text-slate-500 whitespace-nowrap">
                Jornada activa
              </label>
              <select
                value={activeSessionId || ''}
                onChange={e => setActiveSessionId(e.target.value || null)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 bg-white max-w-full"
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.session_code} · {s.title} ({s.status === 'aplicada' ? 'Aplicada en Kardex' : s.status === 'revision' ? 'En revisión' : 'En conteo'})
                  </option>
                ))}
              </select>
              {activeSession && (
                <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                  <span>{activeSession.category_filter || 'Catálogo completo'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Creada {fmtDateTime(activeSession.created_at)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Contó: {activeSession.counted_by_name || 'Almacén'}</span>
                </div>
              )}
            </div>

            {activeSession && canAuditAndApprove && (
              <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 self-start">
                <button
                  type="button"
                  onClick={() => setViewMode('blind')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'blind'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Modo conteo ciego
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('audit')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'audit'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Conciliación gerencial
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Estado vacío inicial */}
      {!loading && !activeSession && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <ClipboardCheck className="w-10 h-10 text-slate-400 mx-auto" />
          <div className="max-w-md mx-auto space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Inicia tu primera auditoría de inventario a ciegas
            </h2>
            <p className="text-sm text-slate-500">
              Elige una categoría (por ejemplo, camisas, calzado o bodega principal) para que el encargado registre únicamente lo que ve físicamente sin conocer el saldo teórico.
            </p>
          </div>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Crear jornada de conteo
          </button>
        </div>
      )}

      {/* Contenido de la jornada activa */}
      {activeSession && (
        <div className="space-y-5">
          {/* Resumen según el modo */}
          {viewMode === 'blind' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500">
                    Modo operador activo · Existencias del sistema ocultas por protocolo de auditoría
                  </div>
                  <div className="text-lg font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {countedStats.counted} de {countedStats.total} referencias contadas ({countedStats.pct}%)
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {activeSession.status !== 'aplicada' && (
                    <button
                      type="button"
                      onClick={() => setScanning(true)}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <QrCode className="w-4 h-4" />
                      Escanear con cámara (+1)
                    </button>
                  )}
                  {activeSession.status === 'en_conteo' && countedStats.counted > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleFinishBlindCount()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Enviar conteo a auditoría
                    </button>
                  )}
                </div>
              </div>

              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${countedStats.pct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs text-slate-500">Avance de verificación</p>
                <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                  {countedStats.counted} / {countedStats.total}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {countedStats.exactMatches} referencias cuadradas exactas
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs text-slate-500">Faltantes detectados (pérdida)</p>
                <p className="text-2xl font-bold text-red-700 mt-1 tabular-nums">
                  -{money(countedStats.shortagesCost)}
                </p>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  {countedStats.shortagesUnits} unidades faltantes al costo
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs text-slate-500">Sobrantes físicos</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                  +{money(countedStats.surplusesCost)}
                </p>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  {countedStats.surplusesUnits} unidades adicionales al costo
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-2">
                <div>
                  <p className="text-xs text-slate-500">Estado del acta</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">
                    {activeSession.status === 'aplicada'
                      ? `Aplicada el ${fmtDateTime(activeSession.applied_at || activeSession.created_at)}`
                      : 'Pendiente de ajuste en Kardex'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportAuditCsv}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintAuditAct}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Imprimir acta
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Barra de búsqueda, filtros y botón de aprobación */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, código SKU o categoría..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {viewMode === 'blind' ? (
                  <div className="inline-flex items-center p-1 rounded-lg bg-slate-100">
                    {(
                      [
                        { id: 'all', label: `Todos (${countedStats.total})` },
                        { id: 'pending', label: `Sin contar (${countedStats.pending})` },
                        { id: 'counted', label: `Contados (${countedStats.counted})` },
                      ] as const
                    ).map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setCountFilter(f.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          countFilter === f.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="inline-flex items-center p-1 rounded-lg bg-slate-100">
                    {(
                      [
                        { id: 'differences', label: 'Con diferencias' },
                        { id: 'shortages', label: 'Solo faltantes' },
                        { id: 'surpluses', label: 'Solo sobrantes' },
                        { id: 'all', label: 'Toda la plantilla' },
                      ] as const
                    ).map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setAuditFilter(f.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          auditFilter === f.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}

                {viewMode === 'audit' &&
                  canAuditAndApprove &&
                  activeSession.status !== 'aplicada' && (
                    <button
                      type="button"
                      disabled={readOnly || applying || countedStats.counted === 0}
                      onClick={() => void handleApproveAndApplyAdjustments()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40 transition-colors"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      {applying ? 'Ajustando Kardex...' : 'Aprobar y ajustar Kardex'}
                    </button>
                  )}
              </div>
            </div>

            {/* Tabla principal */}
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Producto / SKU</th>
                    <th className="text-left px-4 py-3 font-medium">Categoría</th>
                    {viewMode === 'audit' && canAuditAndApprove && (
                      <th className="text-right px-4 py-3 font-medium">Stock sistema</th>
                    )}
                    <th className="text-center px-4 py-3 font-medium">Conteo físico real</th>
                    {viewMode === 'audit' && canAuditAndApprove && (
                      <>
                        <th className="text-right px-4 py-3 font-medium">Diferencia</th>
                        <th className="text-right px-4 py-3 font-medium">Impacto al costo</th>
                      </>
                    )}
                    <th className="text-left px-4 py-3 font-medium">Nota / novedad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLines.map(line => {
                    const isLocked = activeSession.status === 'aplicada' || readOnly
                    const diff =
                      line.counted_qty === null ? null : line.counted_qty - line.expected_stock
                    const impact = diff === null ? 0 : diff * line.cost

                    return (
                      <tr key={line.product_id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{line.product_name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            <span>{line.sku || 'Sin SKU'}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{line.unit}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{line.category_name}</td>

                        {viewMode === 'audit' && canAuditAndApprove && (
                          <td className="px-4 py-3 text-right text-slate-700 tabular-nums font-medium">
                            {line.expected_stock}
                          </td>
                        )}

                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() =>
                                updateCountForProduct(
                                  line.product_id,
                                  Math.max(0, (line.counted_qty ?? 0) - 1)
                                )
                              }
                              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              aria-label="Restar una unidad"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              disabled={isLocked}
                              value={line.counted_qty === null ? '' : line.counted_qty}
                              placeholder="—"
                              onChange={e => {
                                const raw = e.target.value
                                updateCountForProduct(
                                  line.product_id,
                                  raw === '' ? null : parseFloat(raw)
                                )
                              }}
                              className="w-20 px-2 py-1.5 text-center rounded-lg border border-slate-300 font-semibold text-slate-900 tabular-nums"
                            />
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() =>
                                updateCountForProduct(
                                  line.product_id,
                                  (line.counted_qty ?? 0) + 1
                                )
                              }
                              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              aria-label="Sumar una unidad"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        {viewMode === 'audit' && canAuditAndApprove && (
                          <>
                            <td
                              className={`px-4 py-3 text-right font-semibold tabular-nums ${
                                diff === null
                                  ? 'text-slate-400'
                                  : diff < 0
                                    ? 'text-red-700'
                                    : diff > 0
                                      ? 'text-emerald-700'
                                      : 'text-slate-600'
                              }`}
                            >
                              {diff === null
                                ? 'Pendiente'
                                : diff > 0
                                  ? `+${diff}`
                                  : diff === 0
                                    ? '0 (Exacto)'
                                    : String(diff)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-medium tabular-nums ${
                                diff === null || diff === 0
                                  ? 'text-slate-500'
                                  : impact < 0
                                    ? 'text-red-700'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {diff === null ? '—' : money(impact)}
                            </td>
                          </>
                        )}

                        <td className="px-4 py-3">
                          <input
                            type="text"
                            disabled={isLocked}
                            value={line.note || ''}
                            onChange={e =>
                              updateCountForProduct(
                                line.product_id,
                                line.counted_qty,
                                e.target.value
                              )
                            }
                            placeholder="Ej. exhibición, avería..."
                            className="w-full min-w-[140px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700"
                          />
                        </td>
                      </tr>
                    )
                  })}

                  {filteredLines.length === 0 && (
                    <tr>
                      <td
                        colSpan={viewMode === 'audit' && canAuditAndApprove ? 7 : 4}
                        className="px-4 py-10 text-center text-slate-400 text-sm"
                      >
                        No hay productos que coincidan con el filtro seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal crear nueva jornada */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Nueva jornada de conteo ciego</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Nombre o zona del conteo
                </label>
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Ej. Conteo semanal mostrador y vitrinas"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Alcance del catálogo
                </label>
                <select
                  value={newCategoryId}
                  onChange={e => setNewCategoryId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Todo el catálogo ({products.length} productos)</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      Solo categoría: {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Instrucciones para quien cuenta (opcional)
                </label>
                <input
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="Ej. Incluir exhibición y maniquíes"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
                >
                  {saving ? 'Abriendo...' : 'Iniciar conteo ciego'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Escáner continuo de cámara */}
      {scanning && (
        <BarcodeScanner onDetect={handleBarcodeScan} onClose={() => setScanning(false)} />
      )}
    </div>
  )
}
