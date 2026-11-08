import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting } from '../lib/auth'
import { CheckCircle2, AlertTriangle, XCircle, Printer, X } from 'lucide-react'
import { fmtDate, fmtNum } from '../lib/currency'

interface Check { code: string; label: string; status: 'ok' | 'aviso' | 'error'; detail: string }
interface TB {
  code: string; name: string; opening_debit: number; opening_credit: number
  period_debit: number; period_credit: number; closing_debit: number; closing_credit: number
}
interface Closing {
  id: string; year: number; month: number; status: 'cerrado' | 'reabierto'; notes: string | null
  checks: Check[]; trial_balance: TB[]; totals: { debitos: number; creditos: number }
  closed_by_name: string | null; closed_at: string
  reopened_by_name: string | null; reopened_at: string | null; reopen_reason: string | null
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const money = (n: number) => fmtNum(Number(n), 2, 2)
const when = (iso: string) => fmtDate(iso, { dateStyle: 'medium', timeStyle: 'short' })
const PRINT_CSS = `@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; } .no-print { display: none !important; } }`

export default function AccountingClose() {
  const { user } = useAuth()
  const isManager = canViewAccounting(user?.role)
  const canReopen = user?.role === 'dueno' || user?.role === 'admin'
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
  const [year, setYear] = useState(prev.getFullYear())
  const [month, setMonth] = useState(prev.getMonth() + 1)
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [notes, setNotes] = useState('')
  const [ack, setAck] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [reopenTarget, setReopenTarget] = useState<Closing | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [closings, setClosings] = useState<Closing[]>([])
  const [report, setReport] = useState<Closing | null>(null)

  async function load() {
    const { data } = await supabase.from('acc_closings').select('*').order('closed_at', { ascending: false }).limit(36)
    setClosings((data as Closing[]) || [])
  }

  useEffect(() => { if (isManager) void load() }, [isManager])

  if (!isManager) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>

  const fail = (text: string) => setMsg({ ok: false, text })
  const errors = checks?.filter(c => c.status === 'error').length ?? 0
  const warns = checks?.filter(c => c.status === 'aviso').length ?? 0
  const canClose = !!checks && errors === 0 && (warns === 0 || ack)

  async function review() {
    setBusy(true); setMsg(null); setAck(false); setConfirmClose(false)
    const { data, error } = await supabase.rpc('acc_close_check', { p_year: year, p_month: month })
    setBusy(false)
    if (error) { fail(error.message); setChecks(null) } else setChecks((data as Check[]) || [])
  }

  async function executeClose() {
    setBusy(true)
    const { error } = await supabase.rpc('acc_close_period', { p_year: year, p_month: month, p_notes: notes, p_ack: ack })
    setBusy(false)
    setConfirmClose(false)
    if (error) { fail(error.message); return }
    setMsg({ ok: true, text: `Periodo cerrado: ${MONTHS[month - 1]} de ${year}` })
    setChecks(null); setNotes(''); setAck(false); void load()
  }

  async function executeReopen(e: React.FormEvent) {
    e.preventDefault()
    if (!reopenTarget || !reopenReason.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('acc_reopen_period', {
      p_year: reopenTarget.year,
      p_month: reopenTarget.month,
      p_reason: reopenReason.trim(),
    })
    setBusy(false)
    if (error) {
      fail(error.message)
    } else {
      setMsg({ ok: true, text: 'Periodo reabierto y registrado en bitácora' })
      setReport(null)
      setReopenTarget(null)
      setReopenReason('')
      void load()
    }
  }

  const input = 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700'
  const icon = (s: Check['status']) =>
    s === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> :
    s === 'aviso' ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> : <XCircle className="w-4 h-4 text-red-600 shrink-0" />

  return (
    <div className="space-y-5 max-w-3xl">
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <h1 className="text-xl font-bold text-slate-800">Cierre de libros</h1>
        <p className="text-sm text-slate-500 mt-1">Revisa, cierra y bloquea un mes contable. No es el cierre de caja diario.</p>
      </div>
      {msg && <p className={`no-print text-sm px-3 py-2 rounded-lg ${msg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>{msg.text}</p>}

      <div className="no-print bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">1. Elige el periodo y revisa</h2>
        <div className="flex gap-2">
          <select value={month} onChange={e => { setMonth(Number(e.target.value)); setChecks(null); setConfirmClose(false) }} className={`${input} flex-1 capitalize`}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => { setYear(Number(e.target.value)); setChecks(null); setConfirmClose(false) }} className={`${input} w-24 tabular-nums`} />
          <button onClick={review} disabled={busy} className="bg-slate-800 text-white px-4 rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap">Revisar</button>
        </div>
        {checks && (
          <div className="space-y-2 pt-2">
            {checks.map(c => (
              <div key={c.code} className="flex gap-2 items-start">
                {icon(c.status)}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{c.label}</p>
                  <p className="text-xs text-slate-500">{c.detail}</p>
                </div>
              </div>
            ))}
            {errors > 0 && <p className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">Resuelve los {errors} error(es) antes de cerrar.</p>}
            {errors === 0 && warns > 0 && (
              <label className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 px-3 py-2 rounded-lg">
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-1" />
                Revisé los {warns} aviso(s) y quiero cerrar el periodo.
              </label>
            )}
            {errors === 0 && (
              <>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Observaciones del cierre (opcional)" className={`${input} w-full`} />
                {!confirmClose ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClose(true)}
                    disabled={busy || !canClose}
                    className="w-full bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  >
                    Cerrar periodo
                  </button>
                ) : (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2.5">
                    <p className="text-xs text-amber-900">
                      Se cerrará <strong className="capitalize">{MONTHS[month - 1]} de {year}</strong>. Nadie podrá registrar asientos en ese periodo salvo que el dueño lo reabra.
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmClose(false)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-medium text-slate-700"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void executeClose()}
                        disabled={busy}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy ? 'Cerrando…' : 'Confirmar cierre contable'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="no-print bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">2. Historial de cierres</h2>
        {closings.length === 0 && <p className="text-sm text-slate-400">Aún no has cerrado ningún periodo.</p>}
        <ul className="divide-y divide-slate-100">
          {closings.map(c => (
            <li key={c.id} className="py-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 capitalize">{MONTHS[c.month - 1]} de {c.year}</p>
                  <p className="text-xs text-slate-500">Cerrado por {c.closed_by_name || '—'} · {when(c.closed_at)}</p>
                  {c.status === 'reabierto' && <p className="text-xs text-amber-700">Reabierto por {c.reopened_by_name || '—'} · {c.reopened_at && when(c.reopened_at)} · {c.reopen_reason}</p>}
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${c.status === 'cerrado' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{c.status}</span>
              </div>
              <div className="flex gap-3 mt-1">
                <button onClick={() => setReport(report?.id === c.id ? null : c)} className="text-xs text-slate-600 underline">Informe</button>
                {c.status === 'cerrado' && canReopen && (
                  <button onClick={() => { setReopenTarget(c); setReopenReason('') }} className="text-xs text-red-600 underline">
                    Reabrir
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {report && (
        <div className="print-area bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-800 capitalize">Informe de cierre · {MONTHS[report.month - 1]} de {report.year}</h2>
              <p className="text-xs text-slate-500">Cerrado por {report.closed_by_name || '—'} el {when(report.closed_at)}{report.status === 'reabierto' ? ' (periodo reabierto después)' : ''}</p>
              {report.notes && <p className="text-xs text-slate-600 mt-1">Observaciones: {report.notes}</p>}
            </div>
            <button onClick={() => window.print()} className="no-print flex items-center gap-1 text-xs bg-slate-800 text-white px-3 py-1.5 rounded-lg shrink-0"><Printer className="w-3.5 h-3.5" /> Imprimir</button>
          </div>
          <div className="space-y-1">
            {report.checks.map(c => <p key={c.code} className="text-xs text-slate-600"><b>{c.status === 'ok' ? '✔' : c.status === 'aviso' ? '⚠' : '✖'}</b> {c.label}: {c.detail}</p>)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 px-2 text-left">Cuenta</th>
                  {['Inicial D', 'Inicial C', 'Débitos', 'Créditos', 'Final D', 'Final C'].map(h => <th key={h} className="py-1.5 px-2 text-right whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.trial_balance.map(r => (
                  <tr key={r.code} className="border-b border-slate-100 text-slate-700">
                    <td className="py-1.5 px-2"><span className="font-mono text-slate-500 mr-1">{r.code}</span>{r.name}</td>
                    {[r.opening_debit, r.opening_credit, r.period_debit, r.period_credit, r.closing_debit, r.closing_credit].map((v, i) => (
                      <td key={i} className="py-1.5 px-2 text-right font-mono tabular-nums">{Number(v) ? money(Number(v)) : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="py-1.5 px-2" colSpan={3}>Totales del periodo</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">{money(report.totals.debitos)}</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">{money(report.totals.creditos)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Modal para reabrir periodo con motivo obligatorio */}
      {reopenTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setReopenTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 capitalize">
                  Reabrir {MONTHS[reopenTarget.month - 1]} de {reopenTarget.year}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  El motivo quedará registrado en el historial de auditoría contable.
                </p>
              </div>
              <button type="button" onClick={() => setReopenTarget(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={executeReopen} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Motivo de reapertura</label>
                <textarea
                  required
                  rows={2}
                  value={reopenReason}
                  onChange={e => setReopenReason(e.target.value)}
                  placeholder="Ej. Ajuste de depreciación o factura de proveedor recibida fuera de fecha"
                  className={`${input} w-full`}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReopenTarget(null)}
                  disabled={busy}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || !reopenReason.trim()}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? 'Reabriendo…' : 'Confirmar reapertura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
