import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import type { CashEntry } from '../types'
import { Plus, X, Wallet, TrendingUp, TrendingDown, Lock, ClipboardCheck, Download, Clock, ShieldCheck, Banknote } from 'lucide-react'
import CashShiftModal from '../components/CashShiftModal'
import { getActiveShift, type ActiveShift } from '../services/cashShiftService'

interface CashClosing {
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
}

type Period = 'hoy' | '7d' | 'mes' | 'todo'
const PERIODS: { id: Period; label: string }[] = [
  { id: 'hoy', label: 'Hoy' }, { id: '7d', label: '7 días' }, { id: 'mes', label: 'Este mes' }, { id: 'todo', label: 'Todo' },
]
const ORIGIN: Record<string, string> = {
  sale: 'Ventas', purchase: 'Compras', devolution: 'Devoluciones de clientes',
  purchase_devolution: 'Devoluciones de proveedores', anulacion_devolucion_compra: 'Anulaciones dev. proveedor',
  abono: 'Abonos de clientes', anulacion_abono: 'Anulaciones de abono',
  pago_proveedor: 'Pagos a proveedores', anulacion_pago_proveedor: 'Anulaciones de pago a proveedor',
  gasto: 'Gastos operativos', anulacion_gasto: 'Anulaciones de gasto',
  anulacion_venta: 'Anulaciones de venta', anulacion_compra: 'Anulaciones de compra',
  arqueo: 'Ajustes de arqueo',
}

function periodStart(p: Period): Date | null {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (p === 'hoy') return d
  if (p === '7d') { d.setDate(d.getDate() - 6); return d }
  if (p === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}
const signed = (e: CashEntry) => (e.type === 'ingreso' ? 1 : -1) * Number(e.amount)
const originOf = (e: CashEntry) => (e.reference_type ? ORIGIN[e.reference_type] ?? e.reference_type : 'Manuales')
const r2 = (n: number) => Math.round(n * 100) / 100
const fmtDateTime = (s: string) => new Date(s).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

export default function Cash({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(user)
  const [entries, setEntries] = useState<CashEntry[]>([])
  const [closings, setClosings] = useState<CashClosing[]>([])
  const [tab, setTab] = useState<'movimientos' | 'cierres'>('movimientos')
  const [period, setPeriod] = useState<Period>('hoy')
  const [showForm, setShowForm] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [form, setForm] = useState({ type: 'ingreso' as 'ingreso' | 'egreso', amount: '', description: '' })
  const [closeCounted, setCloseCounted] = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [showShiftModal, setShowShiftModal] = useState(false)
  const [activeShift, setActiveShift] = useState<ActiveShift>({
    active: false,
    opening_amount: 0,
    sales_cash: 0,
    sales_card: 0,
    sales_transfer: 0,
    sales_credit: 0,
    sales_count: 0,
    cash_in: 0,
    cash_out: 0,
    expected_cash: 0,
  })

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: e }, { data: c }, shift] = await Promise.all([
      supabase.from('cash_entries').select('*').order('created_at', { ascending: false }),
      supabase.from('cash_closings').select('*').order('closed_at', { ascending: false }),
      getActiveShift(),
    ])
    setEntries((e || []) as CashEntry[])
    setClosings((c || []) as CashClosing[])
    setActiveShift(shift)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    setErrMsg('')
    const amount = parseFloat(form.amount)
    if (!(amount > 0)) { setErrMsg('El monto debe ser mayor a cero'); return }
    setSaving(true)
    const { error } = await supabase.from('cash_entries').insert({ type: form.type, amount, description: form.description.trim() })
    setSaving(false)
    if (error) { setErrMsg('Error al registrar: ' + error.message); return }
    setShowForm(false); setForm({ type: 'ingreso', amount: '', description: '' }); load()
  }

  // Datos para el arqueo
  const lastClosing = closings[0]
  const lastAt = lastClosing ? new Date(lastClosing.closed_at) : null
  const sinceLast = lastAt ? entries.filter(e => new Date(e.created_at) > lastAt) : entries
  const incSince = sinceLast.filter(e => e.type === 'ingreso').reduce((s, e) => s + Number(e.amount), 0)
  const expSince = sinceLast.filter(e => e.type === 'egreso').reduce((s, e) => s + Number(e.amount), 0)
  const balanceNow = r2(entries.reduce((s, e) => s + signed(e), 0))
  const openingNow = r2(balanceNow - incSince + expSince)
  const countedNum = parseFloat(closeCounted)
  const diff = isNaN(countedNum) ? null : r2(countedNum - balanceNow)

  async function handleClose(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    setErrMsg('')
    if (isNaN(countedNum) || countedNum < 0) { setErrMsg('Ingresa el efectivo contado'); return }
    if (diff !== null && diff !== 0 && !closeNotes.trim()) { setErrMsg('Explica la diferencia en las notas'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('cerrar_caja', {
      p_counted: countedNum, p_expected_seen: balanceNow, p_notes: closeNotes.trim() || null,
    })
    setSaving(false)
    if (error) { setErrMsg('No se pudo cerrar la caja: ' + error.message); load(); return }
    const row = data as CashClosing
    const res = row.difference === 0 ? 'cuadra exacto' : row.difference > 0 ? `sobrante de ${money(row.difference)}` : `faltante de ${money(Math.abs(row.difference))}`
    setNotice(`Caja cerrada. Esperado ${money(row.expected)}, contado ${money(row.counted)}: ${res}.`)
    setShowClose(false); setCloseCounted(''); setCloseNotes(''); setTab('cierres'); load()
  }

  // Resumen por periodo
  const start = periodStart(period)
  const inPeriod = start ? entries.filter(e => new Date(e.created_at) >= start) : entries
  const saldoInicial = start ? entries.filter(e => new Date(e.created_at) < start).reduce((s, e) => s + signed(e), 0) : 0
  const ingresos = inPeriod.filter(e => e.type === 'ingreso').reduce((s, e) => s + Number(e.amount), 0)
  const egresos = inPeriod.filter(e => e.type === 'egreso').reduce((s, e) => s + Number(e.amount), 0)
  const saldoFinal = saldoInicial + ingresos - egresos

  const byOrigin = new Map<string, { ingresos: number; egresos: number }>()
  for (const e of inPeriod) {
    const k = originOf(e)
    const cur = byOrigin.get(k) ?? { ingresos: 0, egresos: 0 }
    if (e.type === 'ingreso') cur.ingresos += Number(e.amount); else cur.egresos += Number(e.amount)
    byOrigin.set(k, cur)
  }

  function exportExcel() {
    const todayStr = new Date().toLocaleDateString('sv-SE')
    if (tab === 'cierres') {
      downloadCsv(
        `cierres_caja_${todayStr}.csv`,
        ['Fecha cierre', 'Cerrado por', 'Saldo inicial', 'Ingresos', 'Egresos', 'Esperado', 'Contado', 'Diferencia', 'Notas'],
        closings.map(c => [
          fmtDateTime(c.closed_at),
          c.closed_by_name || '',
          c.opening_balance,
          c.income,
          c.expense,
          c.expected,
          c.counted,
          c.difference,
          c.notes || '',
        ])
      )
      return
    }
    downloadCsv(
      `caja_movimientos_${period}_${todayStr}.csv`,
      ['Fecha', 'Tipo', 'Origen', 'Descripción', 'Monto'],
      inPeriod.map(e => [
        fmtDateTime(e.created_at),
        e.type,
        originOf(e),
        e.description,
        signed(e),
      ])
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h1 className="text-xl font-bold text-slate-800">Caja</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          {onNavigate && (
            <button
              onClick={() => onNavigate('expenses')}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <TrendingDown className="w-4 h-4 text-rose-600" /> Gastos
            </button>
          )}
          <button
            onClick={() => { if (readOnly) return; setNotice(''); setErrMsg(''); setShowClose(true) }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ClipboardCheck className="w-4 h-4" /> Cerrar caja
          </button>
          <button
            onClick={() => { if (readOnly) return; setErrMsg(''); setShowForm(true) }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Movimiento
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Activa tu suscripción para registrar movimientos de caja.
        </div>
      )}

      {notice && (
        <div className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">{notice}</div>
      )}

      {/* Banner de Turno de Caja y Arqueo Ciego */}
      <div className={`p-4 rounded-xl border mb-5 flex flex-wrap items-center justify-between gap-4 ${
        activeShift.active ? 'bg-emerald-50/70 border-emerald-200' : 'bg-slate-50 border-slate-200'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            activeShift.active ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'
          }`}>
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-800">
                {activeShift.active ? 'Turno de Caja Activo' : 'Sin Turno de Caja Abierto'}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                activeShift.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {activeShift.active ? 'En Operación' : 'Cerrado'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeShift.active ? (
                <>
                  Responsable: <strong className="text-slate-700">{activeShift.cashier_name || 'Cajero'}</strong> · Base:{' '}
                  <span className="font-mono">{money(activeShift.opening_amount)}</span> · Ventas en turno:{' '}
                  <span className="font-mono text-emerald-700 font-bold">{money(activeShift.sales_cash)}</span> ({activeShift.sales_count} ventas)
                </>
              ) : (
                'Abre un turno para registrar fondo inicial y habilitar arqueos por denominación.'
              )}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowShiftModal(true)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors ${
            activeShift.active
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-slate-800 text-white hover:bg-slate-700'
          }`}
        >
          {activeShift.active ? (
            <>
              <ShieldCheck className="w-4 h-4" /> Arqueo Ciego / Corte X o Z
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" /> Abrir Turno de Caja
            </>
          )}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {(['movimientos', 'cierres'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize ${tab === t ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{t}</button>
        ))}
      </div>

      {tab === 'movimientos' && (
        <>
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)} className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${period === p.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{p.label}</button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2 mb-2"><Wallet className="w-4 h-4 text-slate-400" /><span className="text-xs text-slate-500">Saldo inicial</span></div><p className="text-lg font-bold text-slate-700">{money(saldoInicial)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-emerald-600" /><span className="text-xs text-slate-500">Ingresos</span></div><p className="text-lg font-bold text-emerald-600">{money(ingresos)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2 mb-2"><TrendingDown className="w-4 h-4 text-red-600" /><span className="text-xs text-slate-500">Egresos</span></div><p className="text-lg font-bold text-red-600">{money(egresos)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2 mb-2"><Wallet className="w-4 h-4 text-slate-600" /><span className="text-xs text-slate-500">Saldo final</span></div><p className={`text-lg font-bold ${saldoFinal >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{money(saldoFinal)}</p></div>
          </div>

          {byOrigin.size > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
              <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-600 uppercase">Desglose por origen</div>
              <div className="divide-y divide-slate-100">
                {Array.from(byOrigin.entries()).map(([name, v]) => (
                  <div key={name} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-700">{name}</span>
                    <span className="flex gap-4">
                      {v.ingresos > 0 && <span className="text-emerald-600">+{money(v.ingresos)}</span>}
                      {v.egresos > 0 && <span className="text-red-600">-{money(v.egresos)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase"><tr><th className="text-left px-4 py-3 font-medium">Fecha</th><th className="text-left px-4 py-3 font-medium">Tipo</th><th className="text-left px-4 py-3 font-medium">Descripción</th><th className="text-left px-4 py-3 font-medium">Monto</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {inPeriod.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-1 rounded ${e.type === 'ingreso' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>{e.type}</span></td>
                    <td className="px-4 py-3 text-slate-700">{e.description}</td>
                    <td className={`px-4 py-3 font-medium ${e.type === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>{e.type === 'ingreso' ? '+' : '-'}{money(Number(e.amount))}</td>
                  </tr>
                ))}
                {inPeriod.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No hay movimientos en este periodo</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'cierres' && (
        <div className="space-y-3">
          {closings.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-800">{fmtDateTime(c.closed_at)}</p>
                  <p className="text-xs text-slate-400">{c.closed_by_name ? `Cerrado por ${c.closed_by_name}` : 'Cierre de caja'}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded whitespace-nowrap ${c.difference === 0 ? 'text-emerald-700 bg-emerald-50' : c.difference > 0 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50'}`}>
                  {c.difference === 0 ? 'Cuadra' : c.difference > 0 ? `Sobrante ${money(c.difference)}` : `Faltante ${money(Math.abs(c.difference))}`}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-sm">
                <div><p className="text-[11px] text-slate-400 uppercase">Inicial</p><p className="text-slate-700">{money(c.opening_balance)}</p></div>
                <div><p className="text-[11px] text-slate-400 uppercase">Ingresos</p><p className="text-emerald-600">+{money(c.income)}</p></div>
                <div><p className="text-[11px] text-slate-400 uppercase">Egresos</p><p className="text-red-600">-{money(c.expense)}</p></div>
                <div><p className="text-[11px] text-slate-400 uppercase">Esperado</p><p className="text-slate-700">{money(c.expected)}</p></div>
                <div><p className="text-[11px] text-slate-400 uppercase">Contado</p><p className="font-bold text-slate-800">{money(c.counted)}</p></div>
              </div>
              {c.notes && <p className="text-xs text-slate-500 mt-3 border-t border-slate-100 pt-2">{c.notes}</p>}
            </div>
          ))}
          {closings.length === 0 && <p className="text-center text-sm text-slate-400 py-8">Aún no hay cierres de caja</p>}
        </div>
      )}

      {showForm && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="font-bold text-slate-800">Nuevo movimiento</h2><button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            {errMsg && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{errMsg}</p>}
            <form onSubmit={handleSubmit} className="space-y-3">
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'ingreso' | 'egreso' })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select>
              <input required type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Monto" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              <input required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descripción (ej: aporte de sencillo / retiro)" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              <button type="submit" disabled={saving} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">{saving ? 'Registrando...' : 'Registrar'}</button>
              {onNavigate && (
                <p className="text-[11px] text-slate-400">
                  ¿Es un gasto del negocio (arriendo, flete, servicios) o se pagó por transferencia? Regístralo mejor en{' '}
                  <button type="button" onClick={() => { setShowForm(false); onNavigate('expenses') }} className="underline text-slate-700 font-medium">Gastos</button>.
                </p>
              )}
            </form>
          </div>
        </div>
      )}

      {showClose && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowClose(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1"><h2 className="font-bold text-slate-800">Cerrar caja</h2><button onClick={() => setShowClose(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <p className="text-xs text-slate-500 mb-4">{lastClosing ? `Desde el último cierre (${fmtDateTime(lastClosing.closed_at)})` : 'Primer cierre: incluye todo el historial de caja'}</p>
            {errMsg && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{errMsg}</p>}
            <form onSubmit={handleClose} className="space-y-3">
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Saldo inicial</span><span className="text-slate-700">{money(openingNow)}</span></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">+ Ingresos</span><span className="text-emerald-600">{money(incSince)}</span></div>
                <div className="flex justify-between px-3 py-2"><span className="text-slate-500">− Egresos</span><span className="text-red-600">{money(expSince)}</span></div>
                <div className="flex justify-between px-3 py-2 bg-slate-50"><span className="font-bold text-slate-800">Esperado en caja</span><span className="font-bold text-slate-800">{money(balanceNow)}</span></div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Efectivo contado</label>
                <input required type="number" step="0.01" min="0" value={closeCounted} onChange={e => setCloseCounted(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              {diff !== null && (
                <div className={`flex justify-between text-sm px-3 py-2 rounded-lg ${diff === 0 ? 'bg-emerald-50 text-emerald-700' : diff > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                  <span>{diff === 0 ? 'Cuadra exacto' : diff > 0 ? 'Sobrante' : 'Faltante'}</span>
                  <span className="font-bold">{diff === 0 ? money(0) : money(Math.abs(diff))}</span>
                </div>
              )}
              <textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)} rows={2} placeholder={diff !== null && diff !== 0 ? 'Explica la diferencia (obligatorio)' : 'Notas (opcional)'} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              <button type="submit" disabled={saving} className="w-full bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Cerrando...' : 'Confirmar cierre'}</button>
              <p className="text-[11px] text-slate-400">El cierre queda guardado y no se puede editar. Si hay diferencia, se registra un ajuste en caja para que el saldo coincida con lo contado.</p>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Apertura de Turno y Arqueo Ciego */}
      <CashShiftModal
        isOpen={showShiftModal}
        onClose={() => setShowShiftModal(false)}
        activeShift={activeShift}
        onShiftChange={load}
      />
    </div>
  )
}
