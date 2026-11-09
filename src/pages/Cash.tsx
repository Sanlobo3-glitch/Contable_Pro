import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import { useWarehouse } from '../lib/warehouseContext'
import type { CashEntry } from '../types'
import {
  Plus,
  X,
  Wallet,
  TrendingUp,
  TrendingDown,
  Lock,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Banknote,
  Coins,
  ShieldCheck,
  Building2,
  FileText,
  Clock,
  Sparkles,
  ArrowRight,
} from 'lucide-react'

export interface CashDenominationCount {
  value: number
  count: number
  type: 'bill' | 'coin'
  label: string
}

export interface PaymentMethodSummary {
  method: string
  label: string
  total: number
  count: number
}

export interface CashClosingFull {
  id: string
  closed_at: string
  closed_by_name: string | null
  opening_balance: number
  income: number
  expense: number
  expected: number
  counted: number
  difference: number
  notes: string | null
  terminal_number?: string
  warehouse_name?: string
  denominations?: CashDenominationCount[]
  payment_breakdown?: PaymentMethodSummary[]
  consecutive?: string
  status?: 'cuadrado' | 'sobrante' | 'faltante'
}

type Period = 'hoy' | '7d' | 'mes' | 'todo'
const PERIODS: { id: Period; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'todo', label: 'Todo' },
]

const ORIGIN: Record<string, string> = {
  sale: 'Ventas en Mostrador',
  purchase: 'Compras',
  devolution: 'Devoluciones de clientes',
  purchase_devolution: 'Devoluciones de proveedores',
  anulacion_devolucion_compra: 'Anulaciones dev. proveedor',
  abono: 'Abonos de cartera (fiado)',
  anulacion_abono: 'Anulaciones de abono',
  pago_proveedor: 'Pagos a proveedores',
  anulacion_pago_proveedor: 'Anulaciones de pago a proveedor',
  gasto: 'Gastos operativos',
  anulacion_gasto: 'Anulaciones de gasto',
  anulacion_venta: 'Anulaciones de venta',
  anulacion_compra: 'Anulaciones de compra',
  arqueo: 'Ajustes de arqueo',
  cash_closing: 'Cierre Z de turno',
}

const DEFAULT_DENOMINATIONS: CashDenominationCount[] = [
  { value: 100000, count: 0, type: 'bill', label: '$100.000' },
  { value: 50000, count: 0, type: 'bill', label: '$50.000' },
  { value: 20000, count: 0, type: 'bill', label: '$20.000' },
  { value: 10000, count: 0, type: 'bill', label: '$10.000' },
  { value: 5000, count: 0, type: 'bill', label: '$5.000' },
  { value: 2000, count: 0, type: 'bill', label: '$2.000' },
  { value: 1000, count: 0, type: 'coin', label: '$1.000' },
  { value: 500, count: 0, type: 'coin', label: '$500' },
  { value: 200, count: 0, type: 'coin', label: '$200' },
  { value: 100, count: 0, type: 'coin', label: '$100' },
  { value: 50, count: 0, type: 'coin', label: '$50' },
]

function periodStart(p: Period): Date | null {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (p === 'hoy') return d
  if (p === '7d') {
    d.setDate(d.getDate() - 6)
    return d
  }
  if (p === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

const signed = (e: CashEntry) => (e.type === 'ingreso' ? 1 : -1) * Number(e.amount)
const originOf = (e: CashEntry) => (e.reference_type ? ORIGIN[e.reference_type] ?? e.reference_type : 'Manuales')
const r2 = (n: number) => Math.round(n * 100) / 100
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

export default function Cash({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const { user, masterRoleOverride } = useAuth()
  const { fmt: money } = useCurrency()
  const { activeWarehouse } = useWarehouse()
  const readOnly = isReadOnly(user)
  const effectiveRole = masterRoleOverride || user?.role
  const isManager =
    effectiveRole === 'dueno' ||
    effectiveRole === 'admin' ||
    effectiveRole === 'admin_empresa' ||
    effectiveRole === 'gerente'

  const [entries, setEntries] = useState<CashEntry[]>([])
  const [closings, setClosings] = useState<CashClosingFull[]>([])
  const [tab, setTab] = useState<'movimientos' | 'cierres'>('movimientos')
  const [period, setPeriod] = useState<Period>('hoy')
  const [showForm, setShowForm] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // Formulario de movimiento manual
  const [form, setForm] = useState({
    type: 'ingreso' as 'ingreso' | 'egreso',
    amount: '',
    description: '',
  })

  // Arqueo de caja y Cierre Z
  const [blindCountMode, setBlindCountMode] = useState(true)
  const [revealedAudit, setRevealedAudit] = useState(false)
  const [countingMethod, setCountingMethod] = useState<'denominations' | 'direct'>('denominations')
  const [denominations, setDenominations] = useState<CashDenominationCount[]>(DEFAULT_DENOMINATIONS)
  const [directCounted, setDirectCounted] = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [activeShiftSales, setActiveShiftSales] = useState<any[]>([])

  // Modal de visualización / impresión de Cierre Z
  const [viewingClosing, setViewingClosing] = useState<CashClosingFull | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      const [{ data: e }, { data: c }, { data: s }] = await Promise.all([
        supabase.from('cash_entries').select('*').order('created_at', { ascending: false }),
        supabase.from('cash_closings').select('*').order('closed_at', { ascending: false }),
        supabase
          .from('sales')
          .select('id, total, payment_method, created_at, status, customer_name')
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      setEntries((e || []) as CashEntry[])

      // Enriquecer cierres con detalles guardados localmente si existen
      const localZ = JSON.parse(localStorage.getItem('contable_pro_cierres_z') || '{}')
      const mergedClosings: CashClosingFull[] = ((c || []) as any[]).map(row => {
        const enriched = localZ[row.id] || {}
        return {
          ...row,
          ...enriched,
          status:
            row.difference === 0
              ? 'cuadrado'
              : row.difference > 0
                ? 'sobrante'
                : 'faltante',
          consecutive: enriched.consecutive || `CZ-${row.id.slice(0, 8).toUpperCase()}`,
        }
      })
      setClosings(mergedClosings)
      setActiveShiftSales(s || [])
    } catch (err: any) {
      console.warn('Error loading cash data:', err)
    }
  }

  // Cálculos de saldo y arqueo
  const lastClosing = closings[0]
  const lastAt = lastClosing ? new Date(lastClosing.closed_at) : null
  const sinceLast = lastAt ? entries.filter(e => new Date(e.created_at) > lastAt) : entries
  const incSince = sinceLast.filter(e => e.type === 'ingreso').reduce((s, e) => s + Number(e.amount), 0)
  const expSince = sinceLast.filter(e => e.type === 'egreso').reduce((s, e) => s + Number(e.amount), 0)
  const balanceNow = r2(entries.reduce((s, e) => s + signed(e), 0))
  const openingNow = r2(balanceNow - incSince + expSince)

  // Desglose de ventas por método de pago desde el último cierre
  const shiftSales = useMemo(() => {
    if (!lastAt) return activeShiftSales
    return activeShiftSales.filter(s => new Date(s.created_at) > lastAt)
  }, [activeShiftSales, lastAt])

  const paymentBreakdown = useMemo<PaymentMethodSummary[]>(() => {
    const map: Record<string, { label: string; total: number; count: number }> = {
      efectivo: { label: 'Efectivo en Caja', total: 0, count: 0 },
      tarjeta: { label: 'Datáfono / Tarjetas', total: 0, count: 0 },
      transferencia: { label: 'Transferencias (Nequi / Bancolombia)', total: 0, count: 0 },
      cartera: { label: 'Crédito / Fiado', total: 0, count: 0 },
    }
    for (const s of shiftSales) {
      if (s.status === 'anulada') continue
      const m = s.payment_method || 'efectivo'
      const key = map[m] ? m : 'efectivo'
      map[key].total = r2(map[key].total + Number(s.total || 0))
      map[key].count += 1
    }
    return Object.entries(map).map(([k, v]) => ({
      method: k,
      label: v.label,
      total: v.total,
      count: v.count,
    }))
  }, [shiftSales])

  // Total de efectivo calculado en la matriz de denominaciones
  const countedFromDenominations = useMemo(() => {
    return denominations.reduce((acc, curr) => acc + curr.value * (curr.count || 0), 0)
  }, [denominations])

  // Efectivo contado efectivo (según método seleccionado)
  const countedNum =
    countingMethod === 'denominations'
      ? countedFromDenominations
      : parseFloat(directCounted) || 0

  const diff = isNaN(countedNum) ? null : r2(countedNum - balanceNow)

  function handleDenominationChange(index: number, countStr: string) {
    const val = parseInt(countStr, 10)
    const count = isNaN(val) || val < 0 ? 0 : val
    setDenominations(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], count }
      return copy
    })
  }

  function resetDenominations() {
    setDenominations(DEFAULT_DENOMINATIONS.map(d => ({ ...d, count: 0 })))
    setDirectCounted('')
    setRevealedAudit(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    setErrMsg('')
    const amount = parseFloat(form.amount)
    if (!(amount > 0)) {
      setErrMsg('El monto debe ser mayor a cero')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('cash_entries').insert({
      type: form.type,
      amount,
      description: form.description.trim(),
    })
    setSaving(false)
    if (error) {
      setErrMsg('Error al registrar: ' + error.message)
      return
    }
    setShowForm(false)
    setForm({ type: 'ingreso', amount: '', description: '' })
    load()
  }

  async function handleClose(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    setErrMsg('')

    if (isNaN(countedNum) || countedNum < 0) {
      setErrMsg('Ingresa el conteo físico de dinero en efectivo.')
      return
    }

    if (diff !== null && diff !== 0 && !closeNotes.trim()) {
      setErrMsg('Existe una diferencia de caja. Explica el motivo en las notas de auditoría.')
      return
    }

    setSaving(true)
    const { data, error } = await supabase.rpc('cerrar_caja', {
      p_counted: countedNum,
      p_expected_seen: balanceNow,
      p_notes: closeNotes.trim() || null,
    })
    setSaving(false)

    if (error) {
      setErrMsg('No se pudo cerrar la caja: ' + error.message)
      load()
      return
    }

    const row = data as any
    const closingId = row.id || `cz-${Date.now()}`
    const consec = `CZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${closingId.slice(0, 4).toUpperCase()}`

    const enrichedClosing: CashClosingFull = {
      id: closingId,
      closed_at: row.closed_at || new Date().toISOString(),
      closed_by_name: user?.full_name || user?.email || 'Cajero en Turno',
      opening_balance: openingNow,
      income: incSince,
      expense: expSince,
      expected: balanceNow,
      counted: countedNum,
      difference: diff || 0,
      notes: closeNotes.trim() || null,
      terminal_number: 'Terminal POS 01',
      warehouse_name: activeWarehouse?.name || 'Sede Principal',
      denominations: countingMethod === 'denominations' ? denominations : undefined,
      payment_breakdown: paymentBreakdown,
      consecutive: consec,
      status: diff === 0 ? 'cuadrado' : (diff || 0) > 0 ? 'sobrante' : 'faltante',
    }

    // Persistir detalle completo para reimpresión y auditoría
    const localZ = JSON.parse(localStorage.getItem('contable_pro_cierres_z') || '{}')
    localZ[closingId] = enrichedClosing
    localStorage.setItem('contable_pro_cierres_z', JSON.stringify(localZ))

    const res =
      diff === 0
        ? 'cuadra exacto'
        : (diff || 0) > 0
          ? `sobrante de ${money(diff || 0)}`
          : `faltante de ${money(Math.abs(diff || 0))}`

    setNotice(`Cierre Z generado (${consec}). Esperado ${money(balanceNow)}, contado ${money(countedNum)}: ${res}.`)
    setShowClose(false)
    resetDenominations()
    setCloseNotes('')
    setTab('cierres')
    load()

    // Abrir automáticamente el comprobante Z para revisión o impresión inmediata
    setViewingClosing(enrichedClosing)
  }

  // Resumen por periodo
  const start = periodStart(period)
  const inPeriod = start ? entries.filter(e => new Date(e.created_at) >= start) : entries
  const saldoInicial = start
    ? entries.filter(e => new Date(e.created_at) < start).reduce((s, e) => s + signed(e), 0)
    : 0
  const ingresos = inPeriod.filter(e => e.type === 'ingreso').reduce((s, e) => s + Number(e.amount), 0)
  const egresos = inPeriod.filter(e => e.type === 'egreso').reduce((s, e) => s + Number(e.amount), 0)
  const saldoFinal = saldoInicial + ingresos - egresos

  const byOrigin = new Map<string, { ingresos: number; egresos: number }>()
  for (const e of inPeriod) {
    const k = originOf(e)
    const cur = byOrigin.get(k) ?? { ingresos: 0, egresos: 0 }
    if (e.type === 'ingreso') cur.ingresos += Number(e.amount)
    else cur.egresos += Number(e.amount)
    byOrigin.set(k, cur)
  }

  function exportExcel() {
    const todayStr = new Date().toLocaleDateString('sv-SE')
    if (tab === 'cierres') {
      downloadCsv(
        `cierres_caja_z_${todayStr}.csv`,
        [
          'Consecutivo Z',
          'Fecha Cierre',
          'Cajero Responsable',
          'Sede / Terminal',
          'Saldo Inicial',
          'Ingresos Turno',
          'Egresos Turno',
          'Saldo Teórico Esperado',
          'Efectivo Físico Contado',
          'Diferencia',
          'Estado',
          'Notas y Observaciones',
        ],
        closings.map(c => [
          c.consecutive || c.id,
          fmtDateTime(c.closed_at),
          c.closed_by_name || 'Cajero',
          c.warehouse_name || 'Principal',
          c.opening_balance,
          c.income,
          c.expense,
          c.expected,
          c.counted,
          c.difference,
          c.difference === 0 ? 'Cuadrado' : c.difference > 0 ? 'Sobrante' : 'Faltante',
          c.notes || '',
        ])
      )
      return
    }
    downloadCsv(
      `movimientos_caja_${period}_${todayStr}.csv`,
      ['Fecha y Hora', 'Tipo', 'Origen / Concepto', 'Descripción', 'Monto'],
      inPeriod.map(e => [
        fmtDateTime(e.created_at),
        e.type,
        originOf(e),
        e.description,
        signed(e),
      ])
    )
  }

  function handlePrintTicket() {
    window.print()
  }

  return (
    <div className="space-y-6">
      {/* Encabezado Principal */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800">Caja y Arqueos de Turno</h1>
            <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono">
              Fase 1: Cierres Z & Arqueos Ciegos
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Control de efectivo en caja, conteo ciego antifraude, denominaciones y emisión de Comprobantes Z.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 shadow-sm"
          >
            <Download className="w-4 h-4 text-slate-500" /> Excel
          </button>

          {onNavigate && (
            <button
              onClick={() => onNavigate('expenses')}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 shadow-sm"
            >
              <TrendingDown className="w-4 h-4 text-rose-600" /> Gastos
            </button>
          )}

          <button
            onClick={() => {
              if (readOnly) return
              setNotice('')
              setErrMsg('')
              resetDenominations()
              setShowClose(true)
            }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-emerald-600 text-white px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 shadow-sm"
          >
            <ClipboardCheck className="w-4 h-4" /> Realizar Arqueo / Cierre Z
          </button>

          <button
            onClick={() => {
              if (readOnly) return
              setErrMsg('')
              setShowForm(true)
            }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Entrada / Salida
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Se requiere suscripción activa para asentar movimientos de caja.
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Selector de pestañas */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setTab('movimientos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'movimientos'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Wallet className="w-4 h-4" /> Movimientos del Libro de Caja
        </button>

        <button
          onClick={() => setTab('cierres')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'cierres'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <FileText className="w-4 h-4" /> Historial de Cierres Z & Arqueos ({closings.length})
        </button>
      </div>

      {/* PESTAÑA 1: MOVIMIENTOS */}
      {tab === 'movimientos' && (
        <>
          <div className="flex gap-2 overflow-x-auto">
            {PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                  period === p.id ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Tarjetas de Saldo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <Wallet className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500 font-medium">Saldo inicial periodo</span>
              </div>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-700">{money(saldoInicial)}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <span className="text-xs text-slate-500 font-medium">+ Ingresos</span>
              </div>
              <p className="text-lg font-bold font-mono tabular-nums text-emerald-600">{money(ingresos)}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <TrendingDown className="w-4 h-4 text-rose-600" />
                <span className="text-xs text-slate-500 font-medium">− Egresos</span>
              </div>
              <p className="text-lg font-bold font-mono tabular-nums text-rose-600">{money(egresos)}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldCheck className="w-4 h-4 text-slate-600" />
                <span className="text-xs text-slate-500 font-medium">Efectivo Teórico Actual</span>
              </div>
              <p className={`text-lg font-bold font-mono tabular-nums ${saldoFinal >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>
                {money(saldoFinal)}
              </p>
            </div>
          </div>

          {/* Desglose por Origen */}
          {byOrigin.size > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-700 uppercase tracking-wide">
                Desglose analítico por tipo de operación
              </div>
              <div className="divide-y divide-slate-100">
                {Array.from(byOrigin.entries()).map(([name, v]) => (
                  <div key={name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-slate-700 font-medium">{name}</span>
                    <span className="flex gap-4 font-mono text-xs">
                      {v.ingresos > 0 && <span className="text-emerald-600 font-semibold">+{money(v.ingresos)}</span>}
                      {v.egresos > 0 && <span className="text-rose-600 font-semibold">-{money(v.egresos)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabla de movimientos */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-100">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Fecha y Hora</th>
                  <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                  <th className="text-left px-4 py-3 font-semibold">Concepto / Origen</th>
                  <th className="text-left px-4 py-3 font-semibold">Descripción</th>
                  <th className="text-right px-4 py-3 font-semibold">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inPeriod.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">
                      {fmtDateTime(e.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded capitalize ${
                          e.type === 'ingreso' ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'
                        }`}
                      >
                        {e.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-xs font-medium">{originOf(e)}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{e.description}</td>
                    <td
                      className={`px-4 py-3 font-mono font-semibold text-right ${
                        e.type === 'ingreso' ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {e.type === 'ingreso' ? '+' : '-'}
                      {money(Number(e.amount))}
                    </td>
                  </tr>
                ))}
                {inPeriod.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-xs">
                      No hay movimientos registrados en este periodo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* PESTAÑA 2: CIERRES Z & ARQUEOS */}
      {tab === 'cierres' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Registros inmutables de corte de turno con auditoría ciega y conciliación de medios de pago.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {closings.map(c => {
              const diffVal = c.difference
              const isBalanced = diffVal === 0
              const isOver = diffVal > 0
              const isShort = diffVal < 0

              return (
                <div
                  key={c.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:border-slate-300 transition"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800 text-sm">
                          {c.consecutive || `CZ-${c.id.slice(0, 8).toUpperCase()}`}
                        </span>
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded capitalize ${
                            isBalanced
                              ? 'text-emerald-700 bg-emerald-50'
                              : isOver
                                ? 'text-sky-700 bg-sky-50'
                                : 'text-rose-700 bg-rose-50'
                          }`}
                        >
                          {isBalanced ? 'Cuadrado Exacto' : isOver ? `Sobrante +${money(diffVal)}` : `Faltante -${money(Math.abs(diffVal))}`}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{fmtDateTime(c.closed_at)}</span>
                        <span>·</span>
                        <span>{c.closed_by_name ? `Cerrado por ${c.closed_by_name}` : 'Cajero'}</span>
                        {c.warehouse_name && (
                          <>
                            <span>·</span>
                            <span>{c.warehouse_name}</span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setViewingClosing(c)}
                        className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium hover:bg-slate-200 transition"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" /> Ver Comprobante Z
                      </button>
                    </div>
                  </div>

                  {/* Resumen numérico */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3.5 p-3 bg-slate-50 rounded-lg text-xs font-mono">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-sans">Fondo Inicial</p>
                      <p className="font-semibold text-slate-700">{money(c.opening_balance)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-sans">Ingresos Turno</p>
                      <p className="font-semibold text-emerald-600">+{money(c.income)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-sans">Egresos Turno</p>
                      <p className="font-semibold text-rose-600">-{money(c.expense)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-sans">Teórico Esperado</p>
                      <p className="font-semibold text-slate-700">{money(c.expected)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-sans">Efectivo Contado</p>
                      <p className="font-bold text-slate-900">{money(c.counted)}</p>
                    </div>
                  </div>

                  {c.notes && (
                    <p className="text-xs text-slate-600 mt-2 bg-amber-50/60 border border-amber-100 rounded px-2.5 py-1.5">
                      <span className="font-semibold text-amber-900">Nota del cajero: </span>
                      {c.notes}
                    </p>
                  )}
                </div>
              )
            })}

            {closings.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
                Aún no se han ejecutado cierres de caja Z.
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: NUEVO MOVIMIENTO MANUAL (Entrada / Salida de caja) */}
      {showForm && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setShowForm(false)}
        >
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800 text-base">Registrar Movimiento de Caja</h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {errMsg && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">
                {errMsg}
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de Operación</label>
                <select
                  value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value as 'ingreso' | 'egreso' })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-slate-800 focus:outline-hidden"
                >
                  <option value="ingreso">Ingreso (+ Aporte de sencillo / Base adicional)</option>
                  <option value="egreso">Egreso (− Retiro de efectivo / Caja menor)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Monto</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Concepto / Motivo</label>
                <input
                  required
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Ej: Aporte de menudo de apertura / Pago taxi emergencia"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition"
              >
                {saving ? 'Registrando...' : 'Confirmar Movimiento'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ARQUEO CIEGO Y CIERRE Z DE CAJA */}
      {showClose && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs overflow-y-auto"
          onClick={() => setShowClose(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl my-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header del modal */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-slate-800 text-lg">Arqueo de Turno & Cierre Z</h2>
                  <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded">
                    Cierre Z
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lastClosing
                    ? `Período desde el último cierre (${fmtDateTime(lastClosing.closed_at)})`
                    : 'Primer cierre de turno en la terminal'}
                </p>
              </div>
              <button onClick={() => setShowClose(false)} className="p-1 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {errMsg && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">
                {errMsg}
              </p>
            )}

            {/* Selector de Modo de Arqueo */}
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-slate-700" />
                <div>
                  <p className="text-xs font-bold text-slate-800">Modo de Arqueo Ciego Antifraude</p>
                  <p className="text-[11px] text-slate-500">
                    {blindCountMode
                      ? 'El monto esperado permanece oculto hasta que ingresas tu conteo físico.'
                      : 'Monto esperado visible.'}
                  </p>
                </div>
              </div>

              {isManager && (
                <button
                  type="button"
                  onClick={() => setBlindCountMode(!blindCountMode)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-300 bg-white px-2.5 py-1 rounded-lg font-medium"
                >
                  {blindCountMode ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{blindCountMode ? 'Desactivar Modo Ciego' : 'Activar Modo Ciego'}</span>
                </button>
              )}
            </div>

            {/* Alternar método de conteo */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setCountingMethod('denominations')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition flex items-center justify-center gap-2 ${
                  countingMethod === 'denominations'
                    ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-4 h-4" /> Desglose por Billetes y Monedas (Recomendado)
              </button>
              <button
                type="button"
                onClick={() => setCountingMethod('direct')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition flex items-center justify-center gap-2 ${
                  countingMethod === 'direct'
                    ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Coins className="w-4 h-4" /> Monto Directo
              </button>
            </div>

            <form onSubmit={handleClose} className="space-y-4">
              {/* MÉTODO 1: Matriz de Denominaciones COP */}
              {countingMethod === 'denominations' && (
                <div className="space-y-3">
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 flex justify-between">
                      <span>Denominación (Billetes / Monedas)</span>
                      <span>Cantidad × Subtotal</span>
                    </div>

                    <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto p-2 space-y-1">
                      {denominations.map((d, idx) => {
                        const sub = d.value * (d.count || 0)
                        return (
                          <div key={d.value} className="flex items-center justify-between text-xs py-1 px-1">
                            <span className="font-bold text-slate-800 font-mono w-24 flex items-center gap-1.5">
                              {d.type === 'bill' ? (
                                <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Coins className="w-3.5 h-3.5 text-amber-600" />
                              )}
                              {d.label}
                            </span>

                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1">
                                <span className="text-slate-400 text-[10px]">Cant:</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={d.count === 0 ? '' : d.count}
                                  onChange={e => handleDenominationChange(idx, e.target.value)}
                                  placeholder="0"
                                  className="w-16 px-2 py-1 text-center font-mono border border-slate-200 rounded focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                                />
                              </div>

                              <span className="w-28 text-right font-mono font-semibold text-slate-700">
                                {money(sub)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="bg-slate-100 px-4 py-2.5 flex justify-between items-center text-sm font-bold text-slate-900 border-t border-slate-200">
                      <span>Total Físico Contado:</span>
                      <span className="font-mono text-base text-emerald-700">{money(countedFromDenominations)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* MÉTODO 2: Conteo Directo */}
              {countingMethod === 'direct' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Efectivo total contado en caja
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={directCounted}
                    onChange={e => setDirectCounted(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 font-mono text-base focus:ring-2 focus:ring-slate-800 focus:outline-hidden"
                  />
                </div>
              )}

              {/* Resumen de medios de cobro del turno */}
              {paymentBreakdown.length > 0 && (
                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                  <p className="text-xs font-bold text-slate-700 mb-2">Ventas del Turno por Medio de Cobro:</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {paymentBreakdown.map(p => (
                      <div key={p.method} className="bg-white p-2 rounded-lg border border-slate-200">
                        <p className="text-[10px] text-slate-400">{p.label}</p>
                        <p className="font-mono font-bold text-slate-800 mt-0.5">{money(p.total)}</p>
                        <p className="text-[10px] text-slate-400">{p.count} transacciones</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cuadro comparativo: Esperado vs Contado */}
              {(!blindCountMode || revealedAudit) ? (
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                  <div className="flex justify-between px-3 py-2 text-slate-600">
                    <span>Saldo inicial del turno</span>
                    <span className="font-mono">{money(openingNow)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 text-slate-600">
                    <span>+ Ingresos netos del turno</span>
                    <span className="font-mono text-emerald-600">+{money(incSince)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 text-slate-600">
                    <span>− Egresos netos del turno</span>
                    <span className="font-mono text-rose-600">-{money(expSince)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-slate-100/70 font-bold text-slate-800 text-sm">
                    <span>Efectivo Teórico Esperado:</span>
                    <span className="font-mono">{money(balanceNow)}</span>
                  </div>

                  {diff !== null && (
                    <div
                      className={`flex justify-between items-center px-3 py-2.5 font-bold ${
                        diff === 0
                          ? 'bg-emerald-50 text-emerald-800'
                          : diff > 0
                            ? 'bg-sky-50 text-sky-800'
                            : 'bg-rose-50 text-rose-800'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {diff === 0 ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-4 h-4" />
                        )}
                        <span>{diff === 0 ? 'Caja Cuadrada Exactamente' : diff > 0 ? 'Sobrante de Caja' : 'Faltante de Caja'}</span>
                      </span>
                      <span className="font-mono text-sm">
                        {diff === 0 ? money(0) : diff > 0 ? `+${money(diff)}` : `-${money(Math.abs(diff))}`}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-slate-100 rounded-xl text-center">
                  <button
                    type="button"
                    onClick={() => setRevealedAudit(true)}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-700 bg-white border border-slate-300 font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-50 transition"
                  >
                    <Eye className="w-4 h-4 text-slate-500" />
                    <span>Finalizar conteo y cotejar contra saldo teórico</span>
                  </button>
                </div>
              )}

              {/* Justificación obligatoria si hay diferencia */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notas de auditoría y justificación{' '}
                  {diff !== null && diff !== 0 ? (
                    <span className="text-rose-600 font-bold">(Obligatorio por diferencia de caja)</span>
                  ) : (
                    '(Opcional)'
                  )}
                </label>
                <textarea
                  value={closeNotes}
                  onChange={e => setCloseNotes(e.target.value)}
                  rows={2}
                  placeholder={
                    diff !== null && diff !== 0
                      ? 'Describe por qué se presenta el faltante o sobrante...'
                      : 'Observaciones generales del turno...'
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              {/* Botón de Confirmación */}
              <button
                type="submit"
                disabled={saving || (diff !== null && diff !== 0 && !closeNotes.trim())}
                className="w-full bg-emerald-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 transition shadow-sm flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4" />
                <span>{saving ? 'Cerrando turno y generando Z...' : 'Emitir Cierre Z y Bloquear Turno'}</span>
              </button>

              <p className="text-[11px] text-slate-400 text-center">
                El Comprobante Z es inmutable. Si existe diferencia, se genera un asiento automático de ajuste contable.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: VISOR E IMPRESIÓN DE COMPROBANTE DE CIERRE Z TÉRMICO */}
      {viewingClosing && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setViewingClosing(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[95vh] overflow-y-auto shadow-2xl p-6"
            onClick={e => e.stopPropagation()}
          >
            {/* Barra de acciones superiores */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 print:hidden">
              <span className="text-xs font-bold text-slate-500 uppercase">Comprobante Z Oficial</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrintTicket}
                  className="flex items-center gap-1.5 bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-700 transition"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir Ticket (80mm/58mm)
                </button>
                <button onClick={() => setViewingClosing(null)} className="p-1 rounded hover:bg-slate-100">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            {/* Ticket Térmico Formateado */}
            <div className="bg-white p-4 font-mono text-xs border border-dashed border-slate-300 rounded-lg text-slate-800 space-y-3">
              {/* Encabezado del ticket */}
              <div className="text-center space-y-1 border-b border-dashed border-slate-300 pb-3">
                <p className="font-bold text-base text-slate-900 tracking-wider">CONTABLE PRO</p>
                <p className="text-[11px] text-slate-500">SISTEMA INTEGRADO NIIF & POS</p>
                <p className="font-bold text-sm text-slate-800 mt-1">COMPROBANTE DE CIERRE Z</p>
                <p className="text-xs font-semibold">{viewingClosing.consecutive || `CZ-${viewingClosing.id.slice(0, 8)}`}</p>
              </div>

              {/* Datos de control */}
              <div className="text-[11px] space-y-0.5 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Fecha y Hora:</span>
                  <span className="font-bold">{fmtDateTime(viewingClosing.closed_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Terminal:</span>
                  <span>{viewingClosing.terminal_number || 'POS 01'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Sede:</span>
                  <span>{viewingClosing.warehouse_name || 'Principal'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cajero:</span>
                  <span>{viewingClosing.closed_by_name || 'Cajero'}</span>
                </div>
              </div>

              {/* Ventas por medio de pago */}
              <div className="space-y-1 border-b border-dashed border-slate-300 pb-2">
                <p className="font-bold text-[11px] uppercase tracking-wide">Recaudo por Medio de Pago:</p>
                {(viewingClosing.payment_breakdown && viewingClosing.payment_breakdown.length > 0
                  ? viewingClosing.payment_breakdown
                  : [
                      { label: 'Efectivo', total: viewingClosing.income },
                      { label: 'Otros medios', total: 0 },
                    ]
                ).map((p, i) => (
                  <div key={i} className="flex justify-between text-[11px]">
                    <span className="text-slate-600">{p.label}:</span>
                    <span className="font-bold">{money(p.total)}</span>
                  </div>
                ))}
              </div>

              {/* Resumen del arqueo físico */}
              <div className="space-y-1 border-b border-dashed border-slate-300 pb-2">
                <p className="font-bold text-[11px] uppercase tracking-wide">Arqueo Físico de Caja:</p>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Fondo Inicial:</span>
                  <span>{money(viewingClosing.opening_balance)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">+ Total Ingresos:</span>
                  <span>{money(viewingClosing.income)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">− Total Egresos:</span>
                  <span>{money(viewingClosing.expense)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold pt-1 border-t border-slate-200">
                  <span>Saldo Teórico Esperado:</span>
                  <span>{money(viewingClosing.expected)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-slate-900">
                  <span>Efectivo Físico Contado:</span>
                  <span>{money(viewingClosing.counted)}</span>
                </div>
                <div
                  className={`flex justify-between text-xs font-bold pt-1 ${
                    viewingClosing.difference === 0
                      ? 'text-emerald-700'
                      : viewingClosing.difference > 0
                        ? 'text-sky-700'
                        : 'text-rose-700'
                  }`}
                >
                  <span>Resultado Arqueo:</span>
                  <span>
                    {viewingClosing.difference === 0
                      ? 'CUADRADO EXACTO'
                      : viewingClosing.difference > 0
                        ? `SOBRANTE +${money(viewingClosing.difference)}`
                        : `FALTANTE -${money(Math.abs(viewingClosing.difference))}`}
                  </span>
                </div>
              </div>

              {/* Denominaciones si están disponibles */}
              {viewingClosing.denominations && viewingClosing.denominations.length > 0 && (
                <div className="space-y-1 border-b border-dashed border-slate-300 pb-2">
                  <p className="font-bold text-[10px] uppercase text-slate-500">Detalle de Monedas/Billetes:</p>
                  <div className="grid grid-cols-2 gap-x-2 text-[10px]">
                    {viewingClosing.denominations
                      .filter(d => (d.count || 0) > 0)
                      .map(d => (
                        <div key={d.value} className="flex justify-between">
                          <span>{d.label} × {d.count}</span>
                          <span>{money(d.value * d.count)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {viewingClosing.notes && (
                <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded">
                  <span className="font-bold">Observaciones: </span>
                  {viewingClosing.notes}
                </div>
              )}

              {/* Firmas de validación */}
              <div className="pt-6 grid grid-cols-2 gap-4 text-center text-[10px]">
                <div className="border-t border-slate-400 pt-1">
                  <p className="font-bold">{viewingClosing.closed_by_name || 'Cajero'}</p>
                  <p className="text-slate-400">Firma Cajero</p>
                </div>
                <div className="border-t border-slate-400 pt-1">
                  <p className="font-bold">Supervisor / Gerente</p>
                  <p className="text-slate-400">Firma Verificación</p>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-400 pt-2">
                *** FIN DEL COMPROBANTE Z ***
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
