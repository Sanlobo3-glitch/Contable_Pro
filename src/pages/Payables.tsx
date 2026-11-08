import { useEffect, useMemo, useState } from 'react'
import { Receipt, RefreshCw, Search, ChevronRight, ArrowLeft, WifiOff, MessageCircle, Settings2, CheckCircle2, Ban, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageInventory } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { newId } from '../lib/offlineQueue'
import { downloadCsv } from '../lib/csv'

interface Creditor {
  supplier_id: string
  name: string
  phone: string | null
  document: string | null
  owed: number
  overdue: number
  oldest_due: string | null
  open_purchases: number
  credit_limit: number
  credit_days: number
  last_payment: string | null
}
interface PayablesPortfolio { today: string; total_owed: number; total_overdue: number; suppliers: Creditor[] }
interface OpenPurchase { id: string; total: number; balance: number; due_date: string | null; created_at: string; days_overdue: number }
interface SupplierPayment { id: string; amount: number; method: string; status: string; note: string | null; by: string | null; created_at: string }
interface SupplierDetail {
  supplier: { id: string; name: string; phone: string | null; document: string | null }
  owed: number; overdue: number; credit_limit: number; credit_days: number
  purchases: OpenPurchase[]; payments: SupplierPayment[]
}
interface CxpCfg { account_id: string | null; account_code: string | null; account_name: string | null; accounting_active: boolean }
interface Account { id: string; code: string; name: string; is_postable: boolean; active: boolean }
interface SupplierLite { id: string; name: string }

const METHOD: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }
const day = (d: string | null) => (d ? new Date(d.length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString() : '—')
const isMissing = (m: string) => /cuentas_por_pagar|cuenta_por_pagar|supplier_payments|cxp_|does not exist|schema cache|registrar_pago_proveedor/i.test(m || '')

export default function Payables() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const canManage = canManageInventory(user?.role)
  const readOnly = isReadOnly(user) || !canManage
  const isManager = user?.role === 'dueno' || user?.role === 'admin'

  const [data, setData] = useState<PayablesPortfolio | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [note, setNote] = useState('')

  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupplierDetail | null>(null)
  const [detLoading, setDetLoading] = useState(false)

  // Pago / abono a proveedor
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('efectivo')
  const [payNote, setPayNote] = useState('')
  const [payId, setPayId] = useState(newId())
  const [saving, setSaving] = useState(false)

  // Condiciones de crédito con el proveedor
  const [limit, setLimit] = useState('')
  const [days, setDays] = useState('30')
  const [editTerms, setEditTerms] = useState(false)

  // Contabilidad (cuenta de Proveedores por pagar)
  const [cxp, setCxp] = useState<CxpCfg | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [cxpPick, setCxpPick] = useState('')
  const [showCxp, setShowCxp] = useState(false)

  // Proveedores sin deuda actual (para configurarles plazo o cupo)
  const [allSuppliers, setAllSuppliers] = useState<SupplierLite[]>([])

  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  function flash(msg: string) {
    setNote(msg)
    window.setTimeout(() => setNote(''), 5000)
  }

  async function load() {
    if (!isManager) return
    setLoading(true); setError('')
    const { data: res, error: err } = await supabase.rpc('cuentas_por_pagar')
    setLoading(false)
    if (err) { setError(isMissing(err.message) ? 'sin_sql' : err.message); return }
    setData(res as PayablesPortfolio)
  }

  async function loadCxp() {
    if (!isManager) return
    const [c, a, su] = await Promise.all([
      supabase.rpc('cxp_config'),
      supabase.from('acc_accounts').select('id, code, name, is_postable, active').order('code'),
      supabase.from('suppliers').select('id, name').order('name'),
    ])
    if (!c.error && c.data) { const cfg = c.data as CxpCfg; setCxp(cfg); setCxpPick(cfg.account_id || '') }
    if (!a.error && a.data) setAccounts((a.data as Account[]).filter(x => x.is_postable && x.active))
    if (!su.error && su.data) setAllSuppliers(su.data as SupplierLite[])
  }

  useEffect(() => { void load(); void loadCxp() }, [isManager])

  if (!canManage) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>

  async function openSupplier(id: string) {
    setSel(id); setDetail(null); setDetLoading(true); setEditTerms(false)
    setAmount(''); setPayNote(''); setMethod('efectivo'); setPayId(newId())
    const { data: res, error: err } = await supabase.rpc('cuenta_por_pagar_proveedor', { p_supplier_id: id })
    setDetLoading(false)
    if (err) { flash('No se pudo abrir el proveedor: ' + err.message); setSel(null); return }
    const d = res as SupplierDetail
    setDetail(d)
    setLimit(String(Number(d.credit_limit) || 0)); setDays(String(d.credit_days ?? 30))
    setAmount(d.owed > 0 ? String(Number(d.owed)) : '')
  }

  async function refreshAll(id: string) {
    await Promise.all([load(), openSupplier(id)])
  }

  async function savePayment() {
    if (!detail || saving || readOnly) return
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) { alert('Escribe un valor de pago mayor que cero.'); return }
    if (n > detail.owed + 0.005) { alert(`El pago no puede ser mayor que la deuda con el proveedor (${money(detail.owed)}).`); return }
    if (!navigator.onLine) { alert('Registrar un pago necesita conexión a internet.'); return }
    setSaving(true)
    const { error: err } = await supabase.rpc('registrar_pago_proveedor', {
      p_supplier_id: detail.supplier.id, p_amount: n, p_method: method, p_note: payNote || null, p_client_id: payId,
    })
    setSaving(false)
    if (err) { alert('No se pudo registrar el pago: ' + err.message); return }
    flash(`Pago de ${money(n)} registrado.`)
    await refreshAll(detail.supplier.id)
  }

  async function voidPayment(p: SupplierPayment) {
    if (!detail || !isManager || readOnly) return
    if (!confirm(`¿Anular el pago de ${money(p.amount)}? La deuda con el proveedor vuelve a subir${p.method === 'efectivo' ? ' y el dinero regresa a la caja' : ''}.`)) return
    const { error: err } = await supabase.rpc('anular_pago_proveedor', { p_payment_id: p.id })
    if (err) { alert('No se pudo anular: ' + err.message); return }
    flash('Pago anulado.')
    await refreshAll(detail.supplier.id)
  }

  async function saveTerms() {
    if (!detail || !isManager || readOnly) return
    const l = Number(limit || 0), d = Math.floor(Number(days))
    if (!Number.isFinite(l) || l < 0) { alert('El cupo debe ser 0 o más (0 = sin límite).'); return }
    if (!Number.isFinite(d) || d < 0 || d > 365) { alert('Los días de plazo deben estar entre 0 y 365.'); return }
    const { error: err } = await supabase.rpc('guardar_credito_proveedor', { p_supplier: detail.supplier.id, p_limit: l, p_days: d })
    if (err) { alert('No se pudo guardar: ' + err.message); return }
    flash('Condiciones con el proveedor guardadas.')
    setEditTerms(false)
    await refreshAll(detail.supplier.id)
  }

  async function saveCxp() {
    if (!isManager || readOnly) return
    const { data: res, error: err } = await supabase.rpc('cxp_save_account', { p_account: cxpPick || null })
    if (err) { alert('No se pudo guardar la cuenta: ' + err.message); return }
    const r = (res || {}) as Record<string, number>
    const posted = Number(r.compras || 0) + Number(r.pagos_proveedor || 0)
    flash(posted > 0 ? `Cuenta guardada. Se contabilizaron ${posted} movimiento(s) que estaban pendientes.` : 'Cuenta guardada.')
    setShowCxp(false)
    await loadCxp()
  }

  function contactSupplier(s: { name: string; phone: string | null }, owed: number) {
    const tel = (s.phone || '').replace(/\D/g, '')
    const txt = `Hola ${s.name}, te escribimos respecto a nuestro saldo pendiente de ${money(owed)}.`
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(txt)}`, '_blank', 'noopener')
  }

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.suppliers || []).filter(s =>
      (!onlyOverdue || s.overdue > 0) &&
      (!q || s.name.toLowerCase().includes(q) || (s.document || '').toLowerCase().includes(q)))
  }, [data, search, onlyOverdue])

  const creditorIds = useMemo(() => new Set((data?.suppliers || []).map(s => s.supplier_id)), [data])
  const others = allSuppliers.filter(s => !creditorIds.has(s.id))

  /* ───────── Detalle de un proveedor ───────── */
  if (sel) {
    return (
      <div className="max-w-3xl space-y-4">
        <button onClick={() => { setSel(null); setDetail(null); void load() }} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" /> Volver a cuentas por pagar
        </button>
        {note && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">{note}</div>}
        {detLoading && !detail && <p className="text-sm text-slate-400 text-center py-10">Cargando…</p>}
        {detail && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-slate-800 truncate">{detail.supplier.name}</h1>
                  <p className="text-xs text-slate-500">{[detail.supplier.document, detail.supplier.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>
                </div>
                {detail.owed > 0 && detail.supplier.phone && (
                  <button onClick={() => contactSupplier(detail.supplier, detail.owed)} className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 shrink-0">
                    <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">Por pagar</p><p className="text-base font-bold text-slate-800 break-words">{money(detail.owed)}</p></div>
                <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">Vencido</p><p className={`text-base font-bold break-words ${detail.overdue > 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(detail.overdue)}</p></div>
                <div className="bg-slate-50 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">Cupo</p><p className="text-base font-bold text-slate-800 break-words">{detail.credit_limit > 0 ? money(detail.credit_limit) : 'Sin límite'}</p></div>
              </div>
              <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
                <span>Plazo habitual: {detail.credit_days} días</span>
                {isManager && !readOnly && (
                  <button onClick={() => setEditTerms(v => !v)} className="inline-flex items-center gap-1 text-slate-700 font-medium hover:text-slate-900">
                    <Settings2 className="w-3.5 h-3.5" /> Cupo y plazo
                  </button>
                )}
              </div>
              {editTerms && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Cupo máximo (0 = sin límite)</label>
                    <input type="number" inputMode="decimal" min="0" step="any" value={limit} onChange={e => setLimit(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Días de plazo por defecto</label>
                    <input type="number" inputMode="numeric" min="0" max="365" value={days} onChange={e => setDays(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                  </div>
                  <button onClick={saveTerms} className="col-span-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700">Guardar condiciones</button>
                </div>
              )}
            </div>

            {detail.owed > 0 && !readOnly && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-700">Registrar pago o abono</h2>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Valor</label>
                    <input type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Forma de pago</label>
                    <select value={method} onChange={e => setMethod(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                      {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <input value={payNote} onChange={e => setPayNote(e.target.value)} maxLength={300} placeholder="Nota o referencia de pago (opcional)" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                <p className="text-[11px] text-slate-400">
                  El pago se aplica primero a la compra más antigua. {method === 'efectivo' ? 'Sale dinero de la caja.' : 'No descuenta de la caja (sale de bancos).'}
                </p>
                <button onClick={savePayment} disabled={saving || offline} className="w-full bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">
                  {saving ? 'Registrando...' : 'Registrar pago'}
                </button>
                {offline && <p className="text-xs text-amber-700 flex items-center gap-1.5"><WifiOff className="w-3.5 h-3.5" /> Sin conexión: necesitas internet para registrar pagos.</p>}
              </div>
            )}

            {detail.owed <= 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="text-sm font-medium text-slate-700 mt-2">No tienes deuda pendiente con este proveedor.</p>
              </div>
            )}

            {detail.purchases.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-700 mb-2">Compras a crédito pendientes</h2>
                <ul className="divide-y divide-slate-100">
                  {detail.purchases.map(p => (
                    <li key={p.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-slate-700">Compra del {day(p.created_at)} · total {money(p.total)}</p>
                        <p className={`text-[11px] ${p.days_overdue > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                          {p.days_overdue > 0 ? `Vencida hace ${p.days_overdue} día(s) · ` : 'Vence '}{day(p.due_date)}
                        </p>
                      </div>
                      <span className="font-semibold text-slate-800 whitespace-nowrap">{money(p.balance)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.payments.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-bold text-slate-700 mb-2">Pagos y abonos realizados</h2>
                <ul className="divide-y divide-slate-100">
                  {detail.payments.map(p => (
                    <li key={p.id} className={`py-2 flex items-center justify-between gap-3 text-sm ${p.status === 'anulado' ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-slate-700">
                          <span className={p.status === 'anulado' ? 'line-through' : ''}>{money(p.amount)}</span>
                          {' · '}{METHOD[p.method] ?? p.method}
                          {p.status === 'anulado' && <span className="ml-1.5 text-[10px] font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded">Anulado</span>}
                        </p>
                        <p className="text-[11px] text-slate-500">{day(p.created_at)}{p.by ? ` · ${p.by}` : ''}{p.note ? ` · ${p.note}` : ''}</p>
                      </div>
                      {isManager && !readOnly && p.status === 'activo' && (
                        <button onClick={() => void voidPayment(p)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg shrink-0">
                          <Ban className="w-3.5 h-3.5" /> Anular
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  /* ───────── Lista general de Cuentas por Pagar ───────── */
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0"><Receipt className="w-5 h-5 text-white" /></div>
            <h1 className="text-xl font-bold text-slate-800">Cuentas por pagar</h1>
          </div>
          <p className="text-sm text-slate-600 mt-2">Lo que debes a tus proveedores por compras a crédito. Registra abonos y controla vencimientos.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data && data.suppliers.length > 0 && (
            <button
              onClick={() =>
                downloadCsv(
                  `cuentas_por_pagar_${data.today || new Date().toISOString().slice(0, 10)}.csv`,
                  ['Proveedor', 'Documento', 'Teléfono', 'Por pagar', 'Vencido', 'Compras abiertas', 'Vencimiento más antiguo', 'Cupo', 'Plazo (días)'],
                  data.suppliers.map(s => [
                    s.name,
                    s.document || '',
                    s.phone || '',
                    s.owed,
                    s.overdue,
                    s.open_purchases,
                    s.oldest_due || '',
                    s.credit_limit,
                    s.credit_days,
                  ])
                )
              }
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Download className="w-4 h-4" /> <span className="hidden sm:inline">Excel</span>
            </button>
          )}
          <button onClick={() => void load()} disabled={loading || offline} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </div>

      {offline && <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs"><WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión: necesitas internet para consultar cuentas por pagar.</div>}
      {error === 'sin_sql' && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
          <p className="font-medium">Esta función aún no está activada en tu base de datos.</p>
          <p className="text-xs mt-1">Ejecuta el script SQL <code>20261101_cuentas_por_pagar.sql</code> en Supabase (SQL Editor) y pulsa Actualizar.</p>
        </div>
      )}
      {error && error !== 'sin_sql' && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">No se pudo cargar: {error}</div>}
      {note && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">{note}</div>}

      {isManager && cxp && cxp.accounting_active && !cxp.account_id && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
          <p className="font-medium">Falta elegir la cuenta contable de «Proveedores por pagar».</p>
          <p className="text-xs mt-1">Mientras no la elijas, las compras a crédito y los pagos a proveedores quedan pendientes de contabilizar (no se pierde nada).</p>
          <button onClick={() => setShowCxp(true)} className="mt-2 bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700">Elegir cuenta</button>
        </div>
      )}

      {data && !error && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Por pagar</p><p className="text-base font-bold text-slate-800 break-words">{money(data.total_owed)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Vencido</p><p className={`text-base font-bold break-words ${data.total_overdue > 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(data.total_overdue)}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Proveedores</p><p className="text-base font-bold text-slate-800">{data.suppliers.filter(s => s.owed > 0.004).length}</p></div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar proveedor…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
              <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} className="accent-slate-800" /> Solo vencidos
            </label>
          </div>

          {list.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="font-semibold text-slate-800 mt-3">{data.suppliers.length === 0 ? 'No debes nada a proveedores' : 'Sin resultados'}</p>
              <p className="text-sm text-slate-500 mt-1">{data.suppliers.length === 0 ? 'Cuando registres una compra con condición «Crédito», aparecerá aquí.' : 'Prueba con otra búsqueda.'}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map(s => (
                <li key={s.supplier_id}>
                  <button onClick={() => void openSupplier(s.supplier_id)} className="w-full text-left bg-white rounded-xl border border-slate-200 p-3 hover:bg-slate-50 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                        {s.overdue > 0 && <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">Vencido</span>}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {s.open_purchases} compra(s){s.oldest_due ? ` · vence ${day(s.oldest_due)}` : ''}{s.credit_limit > 0 ? ` · cupo ${money(s.credit_limit)}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-slate-800">{money(s.owed)}</p>
                      {s.overdue > 0 && <p className="text-[11px] text-red-600">{money(s.overdue)} vencido</p>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {isManager && !readOnly && others.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-700">Configurar plazo o cupo a otro proveedor</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">Elige un proveedor (aunque hoy no le debas) para dejar configurados sus días de crédito o cupo máximo.</p>
              <select value="" onChange={e => e.target.value && void openSupplier(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                <option value="">Elegir proveedor…</option>
                {others.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {isManager && cxp && (
            <div className="text-xs text-slate-500 flex items-center justify-between gap-2 flex-wrap">
              <span>Cuenta contable de Proveedores por pagar: <strong className="text-slate-700">{cxp.account_id ? `${cxp.account_code} · ${cxp.account_name}` : 'sin elegir'}</strong></span>
              {!readOnly && <button onClick={() => setShowCxp(true)} className="text-slate-700 font-medium hover:text-slate-900 inline-flex items-center gap-1"><Settings2 className="w-3.5 h-3.5" /> Cambiar</button>}
            </div>
          )}
        </>
      )}

      {showCxp && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setShowCxp(false)}>
          <div className="bg-white rounded-xl w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-800">Cuenta de Proveedores por pagar</h2>
            <p className="text-xs text-slate-500">Es la cuenta del pasivo donde se registra lo que debes a tus proveedores (en el plan de cuentas colombiano suele ser la 2205). Se elige una sola vez.</p>
            <select value={cxpPick} onChange={e => setCxpPick(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
              <option value="">— Sin elegir —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
            {accounts.length === 0 && <p className="text-xs text-amber-700">No hay cuentas disponibles. Crea tu plan de cuentas en Contabilidad → Configuración.</p>}
            <div className="flex gap-2">
              <button onClick={() => setShowCxp(false)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">Cancelar</button>
              <button onClick={saveCxp} className="flex-1 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
