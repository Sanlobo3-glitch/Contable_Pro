import { useEffect, useMemo, useState } from 'react'
import { Wallet, RefreshCw, Search, ChevronRight, ArrowLeft, WifiOff, MessageCircle, Settings2, CheckCircle2, Ban, Download, Printer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { newId } from '../lib/offlineQueue'
import { downloadCsv } from '../lib/csv'
import { buildDocHtml, printHtml } from '../lib/documents'
import type { CompanyConfig } from '../types'

interface Debtor {
  customer_id: string
  name: string
  phone: string | null
  document: string | null
  owed: number
  overdue: number
  oldest_due: string | null
  open_sales: number
  credit_limit: number
  credit_days: number
  last_payment: string | null
}
interface Portfolio { today: string; total_owed: number; total_overdue: number; customers: Debtor[] }
interface OpenSale { id: string; total: number; balance: number; due_date: string | null; created_at: string; days_overdue: number }
interface Payment { id: string; amount: number; method: string; status: string; note: string | null; by: string | null; created_at: string }
interface Detail {
  customer: { id: string; name: string; phone: string | null; document: string | null }
  owed: number; overdue: number; credit_limit: number; credit_days: number
  sales: OpenSale[]; payments: Payment[]
}
interface CxcCfg { account_id: string | null; account_code: string | null; account_name: string | null; accounting_active: boolean }
interface Account { id: string; code: string; name: string; is_postable: boolean; active: boolean }
interface CustomerLite { id: string; name: string }

const METHOD: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }
const day = (d: string | null) => (d ? new Date(d.length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString() : '—')
const isMissing = (m: string) => /cartera_|credit_|cxc_|does not exist|schema cache|registrar_abono/i.test(m || '')

export default function Cartera() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(user)
  const isManager = user?.role === 'dueno' || user?.role === 'admin'

  const [data, setData] = useState<Portfolio | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [note, setNote] = useState('')
  const [errNote, setErrNote] = useState('')
  const [config, setConfig] = useState<CompanyConfig | null>(null)

  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detLoading, setDetLoading] = useState(false)
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null)
  const [voiding, setVoiding] = useState(false)

  // abono
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('efectivo')
  const [abNote, setAbNote] = useState('')
  const [abId, setAbId] = useState(newId())
  const [saving, setSaving] = useState(false)

  // cupo
  const [limit, setLimit] = useState('')
  const [days, setDays] = useState('30')
  const [editTerms, setEditTerms] = useState(false)

  // contabilidad (solo dueño/admin)
  const [cxc, setCxc] = useState<CxcCfg | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [cxcPick, setCxcPick] = useState('')
  const [showCxc, setShowCxc] = useState(false)

  // clientes sin deuda (para fijarles cupo)
  const [allCustomers, setAllCustomers] = useState<CustomerLite[]>([])

  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  function flash(msg: string) {
    setNote(msg)
    setErrNote('')
    window.setTimeout(() => setNote(''), 5500)
  }

  function flashError(msg: string) {
    setErrNote(msg)
    window.setTimeout(() => setErrNote(''), 6500)
  }

  async function load() {
    setLoading(true); setError('')
    const [{ data: res, error: err }, { data: cfgRows }] = await Promise.all([
      supabase.rpc('cartera_clientes'),
      supabase.from('company_config').select('*').limit(1),
    ])
    setLoading(false)
    if (cfgRows && cfgRows[0]) setConfig(cfgRows[0] as CompanyConfig)
    if (err) { setError(isMissing(err.message) ? 'sin_sql' : err.message); return }
    setData(res as Portfolio)
  }

  async function loadCxc() {
    if (!isManager) return
    const [c, a] = await Promise.all([
      supabase.rpc('cxc_config'),
      supabase.from('acc_accounts').select('id, code, name, is_postable, active').order('code'),
    ])
    if (!c.error && c.data) { const cfg = c.data as CxcCfg; setCxc(cfg); setCxcPick(cfg.account_id || '') }
    if (!a.error && a.data) setAccounts((a.data as Account[]).filter(x => x.is_postable && x.active))
    const cu = await supabase.from('customers').select('id, name').order('name')
    if (!cu.error && cu.data) setAllCustomers(cu.data as CustomerLite[])
  }

  useEffect(() => { void load(); void loadCxc() }, [isManager])

  async function openCustomer(id: string) {
    setSel(id); setDetail(null); setDetLoading(true); setEditTerms(false)
    setAmount(''); setAbNote(''); setMethod('efectivo'); setAbId(newId())
    const { data: res, error: err } = await supabase.rpc('cartera_cliente', { p_customer_id: id })
    setDetLoading(false)
    if (err) { flash('No se pudo abrir el cliente: ' + err.message); setSel(null); return }
    const d = res as Detail
    setDetail(d)
    setLimit(String(Number(d.credit_limit) || 0)); setDays(String(d.credit_days ?? 30))
    setAmount(d.owed > 0 ? String(Number(d.owed)) : '')
  }

  async function refreshAll(id: string) {
    await Promise.all([load(), openCustomer(id)])
  }

  async function saveAbono() {
    if (!detail || saving || readOnly) return
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) { flashError('Escribe un valor de abono mayor que cero.'); return }
    if (n > detail.owed + 0.005) { flashError(`El abono no puede ser mayor que la deuda (${money(detail.owed)}).`); return }
    if (!navigator.onLine) { flashError('Registrar un abono necesita conexión a internet.'); return }
    setSaving(true)
    const { error: err } = await supabase.rpc('registrar_abono', {
      p_customer_id: detail.customer.id, p_amount: n, p_method: method, p_note: abNote || null, p_client_id: abId,
    })
    setSaving(false)
    if (err) { flashError('No se pudo registrar el abono: ' + err.message); return }
    flash(`Abono de ${money(n)} registrado.`)
    await refreshAll(detail.customer.id)
  }

  async function confirmVoidAbono() {
    if (!detail || !voidTarget || !isManager || readOnly || voiding) return
    setVoiding(true)
    const { error: err } = await supabase.rpc('anular_abono', { p_payment_id: voidTarget.id })
    setVoiding(false)
    if (err) { setVoidTarget(null); flashError('No se pudo anular: ' + err.message); return }
    setVoidTarget(null)
    flash('Abono anulado.')
    await refreshAll(detail.customer.id)
  }

  async function saveTerms() {
    if (!detail || !isManager || readOnly) return
    const l = Number(limit || 0), d = Math.floor(Number(days))
    if (!Number.isFinite(l) || l < 0) { flashError('El cupo debe ser 0 o más (0 = sin límite).'); return }
    if (!Number.isFinite(d) || d < 0 || d > 365) { flashError('Los días de plazo deben estar entre 0 y 365.'); return }
    const { error: err } = await supabase.rpc('guardar_credito_cliente', { p_customer: detail.customer.id, p_limit: l, p_days: d })
    if (err) { flashError('No se pudo guardar: ' + err.message); return }
    flash('Condiciones de crédito guardadas.')
    setEditTerms(false)
    await refreshAll(detail.customer.id)
  }

  async function saveCxc() {
    if (!isManager || readOnly) return
    const { data: res, error: err } = await supabase.rpc('cxc_save_account', { p_account: cxcPick || null })
    if (err) { flashError('No se pudo guardar la cuenta: ' + err.message); return }
    const r = (res || {}) as Record<string, number>
    const posted = Number(r.ventas || 0) + Number(r.abonos || 0)
    flash(posted > 0 ? `Cuenta guardada. Se contabilizaron ${posted} movimiento(s) que estaban pendientes.` : 'Cuenta guardada.')
    setShowCxc(false)
    await loadCxc()
  }

  function buildStatementHref(d: Detail): string {
    const tel = (d.customer.phone || '').replace(/\D/g, '')
    const lines = [
      `*ESTADO DE CUENTA · ${config?.name || 'InventarioPro'}*`,
      `Cliente: *${d.customer.name}*`,
      `Fecha de corte: ${new Date().toLocaleDateString()}`,
      '',
    ]
    if (d.sales.length > 0) {
      lines.push('*Facturas pendientes:*')
      for (const s of d.sales) {
        lines.push(
          `• Venta ${day(s.created_at)} (${s.days_overdue > 0 ? `vencida hace ${s.days_overdue}d` : `vence ${day(s.due_date)}`}) — Saldo: *${money(s.balance)}*`
        )
      }
      lines.push('')
    }
    lines.push(`*SALDO TOTAL PENDIENTE: ${money(d.owed)}*`)
    if (d.overdue > 0) lines.push(`Monto vencido: ${money(d.overdue)}`)
    lines.push('', 'Agradecemos tu gestión de pago.')
    return `https://wa.me/${tel}?text=${encodeURIComponent(lines.join('\n'))}`
  }

  function printStatement(d: Detail) {
    const docLines =
      d.sales.length > 0
        ? d.sales.map(s => ({
            name: `Venta a crédito del ${day(s.created_at)} · ${
              s.days_overdue > 0 ? `Vencida hace ${s.days_overdue} día(s) (${day(s.due_date)})` : `Vence ${day(s.due_date)}`
            }`,
            quantity: 1,
            price: Number(s.total) || 0,
            subtotal: Number(s.balance) || 0,
          }))
        : [
            {
              name: 'Sin facturas pendientes a la fecha',
              quantity: 1,
              price: 0,
              subtotal: 0,
            },
          ]

    const html = buildDocHtml(
      {
        title: 'ESTADO DE CUENTA',
        number: 'EC-' + d.customer.id.slice(0, 8).toUpperCase(),
        date: new Date().toLocaleDateString(),
        extra: `Plazo: ${d.credit_days} días · Cupo: ${d.credit_limit > 0 ? money(d.credit_limit) : 'Sin límite'}`,
        badge: d.overdue > 0 ? `VENCIDO: ${money(d.overdue)}` : undefined,
        partyRoleLabel: 'Cliente',
        unitColLabel: 'Valor original',
        partyName: d.customer.name,
        partyLines: [
          d.customer.document && `Documento: ${d.customer.document}`,
          d.customer.phone && `Teléfono: ${d.customer.phone}`,
        ],
        lines: docLines,
        total: d.owed,
        footer: 'La columna Subtotal refleja el saldo pendiente actual de cada venta después de abonos.',
      },
      config
    )
    printHtml(html)
  }

  function printPaymentReceipt(p: Payment, cust: { name: string; document: string | null }) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Recibo de Caja - RC-${p.id.slice(0, 8).toUpperCase()}</title>
        <style>
          body { font-family: monospace; font-size: 13px; width: 280px; margin: 0 auto; padding: 10px; line-height: 1.4; color: #000; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line { border-bottom: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 15px;">RECIBO DE CAJA / ABONO</div>
        <div class="center">${config?.name || 'Contable Pro ERP'}</div>
        <div class="line"></div>
        <div class="row"><span>Recibo No:</span><span class="bold">RC-${p.id.slice(0, 8).toUpperCase()}</span></div>
        <div class="row"><span>Fecha:</span><span>${new Date(p.created_at).toLocaleString()}</span></div>
        <div class="row"><span>Cliente:</span><span class="bold">${cust.name}</span></div>
        ${cust.document ? `<div class="row"><span>Doc / NIT:</span><span>${cust.document}</span></div>` : ''}
        <div class="line"></div>
        <div class="row"><span>Concepto:</span><span>Abono a cartera de clientes</span></div>
        <div class="row"><span>Medio de pago:</span><span class="bold">${METHOD[p.method] || p.method}</span></div>
        ${p.note ? `<div class="row"><span>Nota:</span><span>${p.note}</span></div>` : ''}
        <div class="line"></div>
        <div class="row bold" style="font-size: 16px;"><span>TOTAL RECIBIDO:</span><span>${money(p.amount)}</span></div>
        <div class="line"></div>
        <br/><br/>
        <div class="center">__________________________<br/>Firma Autorizada / Sello</div>
      </body>
      </html>
    `
    printHtml(html)
  }

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.customers || []).filter(c =>
      (!onlyOverdue || c.overdue > 0) &&
      (!q || c.name.toLowerCase().includes(q) || (c.document || '').toLowerCase().includes(q)))
  }, [data, search, onlyOverdue])

  const debtorIds = useMemo(() => new Set((data?.customers || []).map(c => c.customer_id)), [data])
  const others = allCustomers.filter(c => !debtorIds.has(c.id))

  /* ───────── Detalle de un cliente ───────── */
  if (sel) {
    return (
      <div className="max-w-3xl space-y-4">
        <button onClick={() => { setSel(null); setDetail(null); void load() }} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4" /> Volver a la cartera</button>
        {note && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">{note}</div>}
        {errNote && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">{errNote}</div>}
        {detLoading && !detail && <p className="text-sm text-slate-400 text-center py-10">Cargando…</p>}
        {detail && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-slate-800 truncate">{detail.customer.name}</h1>
                  <p className="text-xs text-slate-500">{[detail.customer.document, detail.customer.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => printStatement(detail)}
                    className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" /> Estado de cuenta
                  </button>
                  {detail.owed > 0 && (
                    <a
                      href={buildStatementHref(detail)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 whitespace-nowrap"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> Enviar cobro
                    </a>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 tabular-nums">
                <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">Debe</p><p className="text-base font-bold text-slate-800 break-words">{money(detail.owed)}</p></div>
                <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">Vencido</p><p className={`text-base font-bold break-words ${detail.overdue > 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(detail.overdue)}</p></div>
                <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">Cupo</p><p className="text-base font-bold text-slate-800 break-words">{detail.credit_limit > 0 ? money(detail.credit_limit) : 'Sin límite'}</p></div>
              </div>
              <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
                <span>Plazo: {detail.credit_days} días</span>
                {isManager && !readOnly && <button onClick={() => setEditTerms(v => !v)} className="inline-flex items-center gap-1 text-slate-700 font-medium hover:text-slate-900"><Settings2 className="w-3.5 h-3.5" /> Cupo y plazo</button>}
              </div>
              {editTerms && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                  <div><label className="block text-xs text-slate-500 mb-1">Cupo máximo (0 = sin límite)</label>
                    <input type="number" inputMode="decimal" min="0" step="any" value={limit} onChange={e => setLimit(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">Días de plazo</label>
                    <input type="number" inputMode="numeric" min="0" max="365" value={days} onChange={e => setDays(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" /></div>
                  <button onClick={saveTerms} className="col-span-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700">Guardar condiciones</button>
                </div>
              )}
            </div>

            {detail.owed > 0 && !readOnly && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-700">Registrar abono</h2>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-xs text-slate-500 mb-1">Valor</label>
                    <input type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">Forma de pago</label>
                    <select value={method} onChange={e => setMethod(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                      {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                </div>
                <input value={abNote} onChange={e => setAbNote(e.target.value)} maxLength={300} placeholder="Nota (opcional)" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                <p className="text-[11px] text-slate-400">El abono se aplica solo a la deuda más vieja primero. {method === 'efectivo' ? 'Entra a la caja.' : 'No entra a la caja (queda en bancos).'}</p>
                <button onClick={saveAbono} disabled={saving || offline} className="w-full bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">{saving ? 'Registrando...' : 'Registrar abono'}</button>
                {offline && <p className="text-xs text-amber-700 flex items-center gap-1.5"><WifiOff className="w-3.5 h-3.5" /> Sin conexión: necesitas internet para registrar abonos.</p>}
              </div>
            )}

            {detail.owed <= 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center"><CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" /><p className="text-sm font-medium text-slate-700 mt-2">Este cliente no debe nada.</p></div>
            )}

            {detail.sales.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-700 mb-2">Ventas a crédito pendientes</h2>
                <ul className="divide-y divide-slate-100">
                  {detail.sales.map(s => (
                    <li key={s.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-slate-700">Venta del {day(s.created_at)} · {money(s.total)}</p>
                        <p className={`text-[11px] ${s.days_overdue > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                          {s.days_overdue > 0 ? `Vencida hace ${s.days_overdue} día(s) · ` : 'Vence '}{day(s.due_date)}
                        </p>
                      </div>
                      <span className="font-semibold text-slate-800 whitespace-nowrap">{money(s.balance)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.payments.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-700 mb-2">Abonos</h2>
                <ul className="divide-y divide-slate-100">
                  {detail.payments.map(p => (
                    <li key={p.id} className={`py-2 flex items-center justify-between gap-3 text-sm ${p.status === 'anulado' ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-slate-700"><span className={p.status === 'anulado' ? 'line-through' : ''}>{money(p.amount)}</span> · {METHOD[p.method] ?? p.method}{p.status === 'anulado' && <span className="ml-1.5 text-[10px] font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded">Anulado</span>}</p>
                        <p className="text-[11px] text-slate-500">{day(p.created_at)}{p.by ? ` · ${p.by}` : ''}{p.note ? ` · ${p.note}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => printPaymentReceipt(p, detail.customer)}
                          title="Imprimir Recibo de Caja"
                          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg"
                        >
                          <Printer className="w-3.5 h-3.5" /> Recibo
                        </button>
                        {isManager && !readOnly && p.status === 'activo' && (
                          <button onClick={() => setVoidTarget(p)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg shrink-0"><Ban className="w-3.5 h-3.5" /> Anular</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {voidTarget && (
              <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !voiding && setVoidTarget(null)}>
                <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
                  <h2 className="font-bold text-slate-800">¿Anular este abono?</h2>
                  <p className="text-xs text-slate-600">
                    Se anulará el abono por <strong>{money(voidTarget.amount)}</strong>. La deuda volverá a subir
                    {voidTarget.method === 'efectivo' ? ' y se descontará de la caja.' : '.'}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={voiding} onClick={() => setVoidTarget(null)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">Cancelar</button>
                    <button type="button" disabled={voiding} onClick={() => void confirmVoidAbono()} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">{voiding ? 'Anulando...' : 'Anular abono'}</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  /* ───────── Lista de la cartera ───────── */
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0"><Wallet className="w-5 h-5 text-white" /></div>
            <h1 className="text-xl font-bold text-slate-800">Cartera (fiado)</h1>
          </div>
          <p className="text-sm text-slate-600 mt-2">Lo que te deben tus clientes por ventas a crédito. Registra abonos y revisa lo vencido.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data && data.customers.length > 0 && (
            <button
              onClick={() =>
                downloadCsv(
                  `cartera_clientes_${data.today || new Date().toISOString().slice(0, 10)}.csv`,
                  ['Cliente', 'Documento', 'Teléfono', 'Por cobrar', 'Vencido', 'Ventas abiertas', 'Vencimiento más antiguo', 'Cupo', 'Plazo (días)'],
                  data.customers.map(c => [
                    c.name,
                    c.document || '',
                    c.phone || '',
                    c.owed,
                    c.overdue,
                    c.open_sales,
                    c.oldest_due || '',
                    c.credit_limit,
                    c.credit_days,
                  ])
                )
              }
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Download className="w-4 h-4" /> <span className="hidden sm:inline">Excel</span>
            </button>
          )}
          <button onClick={() => load()} disabled={loading || offline} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </div>

      {offline && <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs"><WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión: necesitas internet para ver la cartera.</div>}
      {error === 'sin_sql' && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
          <p className="font-medium">Esta función aún no está activada en tu base de datos.</p>
          <p className="text-xs mt-1">Ejecuta el SQL de «Fiado» (partes 1 y 2) en Supabase (SQL Editor) y pulsa Actualizar.</p>
        </div>
      )}
      {error && error !== 'sin_sql' && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">No se pudo cargar: {error}</div>}
      {note && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">{note}</div>}

      {isManager && cxc && cxc.accounting_active && !cxc.account_id && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
          <p className="font-medium">Falta elegir la cuenta contable de «Clientes por cobrar».</p>
          <p className="text-xs mt-1">Mientras no la elijas, las ventas a crédito y los abonos quedan pendientes de contabilizar (no se pierde nada).</p>
          <button onClick={() => setShowCxc(true)} className="mt-2 bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700">Elegir cuenta</button>
        </div>
      )}

      {data && !error && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Por cobrar</p><p className="text-base font-bold text-slate-800 break-words">{money(data.total_owed)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Vencido</p><p className={`text-base font-bold break-words ${data.total_overdue > 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(data.total_overdue)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Clientes</p><p className="text-base font-bold text-slate-800">{data.customers.length}</p></div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
              <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} className="accent-slate-800" /> Solo vencidos
            </label>
          </div>

          {list.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="font-semibold text-slate-800 mt-3">{data.customers.length === 0 ? 'Nadie te debe nada' : 'Sin resultados'}</p>
              <p className="text-sm text-slate-500 mt-1">{data.customers.length === 0 ? 'Cuando vendas con la forma de pago «Fiado», el cliente aparecerá aquí.' : 'Prueba con otra búsqueda.'}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map(c => (
                <li key={c.customer_id}>
                  <button onClick={() => openCustomer(c.customer_id)} className="w-full text-left bg-white rounded-xl border border-slate-200 p-3 hover:bg-slate-50 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                        {c.overdue > 0 && <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">Vencido</span>}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {c.open_sales} venta(s){c.oldest_due ? ` · vence ${day(c.oldest_due)}` : ''}{c.credit_limit > 0 ? ` · cupo ${money(c.credit_limit)}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-slate-800">{money(c.owed)}</p>
                      {c.overdue > 0 && <p className="text-[11px] text-red-600">{money(c.overdue)} vencido</p>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {isManager && !readOnly && others.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-700">Fijar cupo a otro cliente</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">Elige un cliente (aunque hoy no deba) para ponerle cupo máximo y días de plazo.</p>
              <select value="" onChange={e => e.target.value && openCustomer(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                <option value="">Elegir cliente…</option>
                {others.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {isManager && cxc && (
            <div className="text-xs text-slate-500 flex items-center justify-between gap-2 flex-wrap">
              <span>Cuenta contable de Clientes por cobrar: <strong className="text-slate-700">{cxc.account_id ? `${cxc.account_code} · ${cxc.account_name}` : 'sin elegir'}</strong></span>
              {!readOnly && <button onClick={() => setShowCxc(true)} className="text-slate-700 font-medium hover:text-slate-900 inline-flex items-center gap-1"><Settings2 className="w-3.5 h-3.5" /> Cambiar</button>}
            </div>
          )}
        </>
      )}

      {showCxc && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setShowCxc(false)}>
          <div className="bg-white rounded-xl w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-800">Cuenta de Clientes por cobrar</h2>
            <p className="text-xs text-slate-500">Es la cuenta del activo donde se registra lo que te deben (en el plan de cuentas colombiano suele ser la 1305). Se elige una sola vez.</p>
            <select value={cxcPick} onChange={e => setCxcPick(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
              <option value="">— Sin elegir —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
            {accounts.length === 0 && <p className="text-xs text-amber-700">No hay cuentas disponibles. Crea tu plan de cuentas en Contabilidad → Configuración.</p>}
            <div className="flex gap-2">
              <button onClick={() => setShowCxc(false)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">Cancelar</button>
              <button onClick={saveCxc} className="flex-1 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
