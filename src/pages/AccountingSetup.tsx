import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting } from '../lib/auth'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { fmtNum } from '../lib/currency'

interface Account { id: string; code: string; name: string; is_postable: boolean; active: boolean }
interface Settings { start_date: string | null; active: boolean; timezone: string; map: Record<string, string> }
interface Recon { code: string; label: string; operational: number; accounting: number; difference: number; note: string }

const KEYS: [string, string][] = [
  ['caja', 'Caja (cobros en efectivo y pago de compras)'],
  ['bancos', 'Bancos (tarjeta y transferencia)'],
  ['ventas', 'Ingresos por ventas'],
  ['impuestos', 'Impuestos por pagar'],
  ['costo_ventas', 'Costo de ventas'],
  ['inventario', 'Inventario de mercancías'],
]
const OPT: [string, string][] = [
  ['devoluciones', 'Devoluciones en ventas (si no eliges, se usa Ingresos por ventas)'],
  ['gastos', 'Gastos y faltantes de caja'],
  ['otros_ingresos', 'Otros ingresos y sobrantes de caja'],
  ['ajustes_inventario', 'Ajustes de inventario (mermas y sobrantes de stock)'],
]
const money = (n: number) => fmtNum(Number(n), 2, 2)
const today = () => new Date().toLocaleDateString('sv-SE')

export default function AccountingSetup() {
  const { user } = useAuth()
  const isManager = canViewAccounting(user?.role)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [map, setMap] = useState<Record<string, string>>({})
  const [start, setStart] = useState(today())
  const [recon, setRecon] = useState<Recon[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmActivate, setConfirmActivate] = useState(false)
  const [confirmPostPending, setConfirmPostPending] = useState(false)

  async function load() {
    const [a, s] = await Promise.all([
      supabase.from('acc_accounts').select('id, code, name, is_postable, active').order('code'),
      supabase.from('acc_settings').select('*').maybeSingle(),
    ])
    setAccounts(((a.data as Account[]) || []).filter(x => x.is_postable && x.active))
    const st = (s.data as Settings | null) || null
    setSettings(st); setMap(st?.map || {})
    if (st?.start_date) setStart(st.start_date)
  }

  useEffect(() => { if (isManager) void load() }, [isManager])

  if (!isManager) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>

  const fail = (text: string) => setMsg({ ok: false, text })
  const complete = KEYS.every(([k]) => map[k])

  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('acc_save_settings', { p_map: map })
    setBusy(false)
    if (error) fail(error.message); else { setMsg({ ok: true, text: 'Cuentas guardadas' }); void load() }
  }

  async function executeToggle(active: boolean) {
    setBusy(true)
    setConfirmActivate(false)
    const { error } = await supabase.rpc('acc_activate', { p_start: active ? start : null, p_active: active })
    setBusy(false)
    if (error) fail(error.message); else { setMsg({ ok: true, text: active ? 'Contabilidad automática activada' : 'Contabilidad automática desactivada' }); void load() }
  }

  async function reconcile() {
    setBusy(true)
    const { data, error } = await supabase.rpc('acc_reconcile')
    setBusy(false)
    if (error) fail(error.message); else setRecon((data as Recon[]) || [])
  }

  async function executePostPending() {
    setBusy(true)
    setConfirmPostPending(false)
    const { data, error } = await supabase.rpc('acc_post_pending')
    setBusy(false)
    if (error) { fail(error.message); return }
    const r = data as {
      ventas: number; compras: number; abonos?: number; pagos_proveedor?: number
      gastos?: number; devoluciones: number; devoluciones_compra?: number; caja: number; ajustes: number
    }
    const extras = [
      typeof r.gastos === 'number' ? `${r.gastos} gastos` : '',
      typeof r.abonos === 'number' ? `${r.abonos} abonos` : '',
      typeof r.pagos_proveedor === 'number' ? `${r.pagos_proveedor} pagos a proveedores` : '',
      typeof r.devoluciones_compra === 'number' ? `${r.devoluciones_compra} dev. a proveedores` : '',
    ].filter(Boolean).join(', ')
    setMsg({ ok: true, text: `Contabilizados: ${r.ventas} ventas, ${r.compras} compras${extras ? `, ${extras}` : ''}, ${r.devoluciones} devoluciones, ${r.caja} movimientos de caja y ${r.ajustes} ajustes` })
    void reconcile()
  }

  const input = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700'

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Configuración contable</h1>
        <p className="text-sm text-slate-500 mt-1">Relaciona tus operaciones con las cuentas y activa la contabilidad automática.</p>
      </div>
      {msg && <p className={`text-sm px-3 py-2 rounded-lg ${msg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>{msg.text}</p>}

      {accounts.length === 0 && <p className="text-sm text-amber-800 bg-amber-50 px-3 py-2 rounded-lg">Primero crea tu plan de cuentas en Contabilidad.</p>}

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">1. Cuentas por operación</h2>
        {KEYS.map(([k, label]) => (
          <div key={k}>
            <label className="block text-xs text-slate-500 mb-1">{label}</label>
            <select value={map[k] || ''} onChange={e => setMap({ ...map, [k]: e.target.value })} className={input}>
              <option value="">Sin configurar</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
        ))}
        <p className="text-xs font-medium text-slate-700 pt-2 border-t border-slate-100">Opcionales: si faltan, esos movimientos no se bloquean, quedan pendientes en la conciliación</p>
        {OPT.map(([k, label]) => (
          <div key={k}>
            <label className="block text-xs text-slate-500 mb-1">{label}</label>
            <select value={map[k] || ''} onChange={e => setMap({ ...map, [k]: e.target.value })} className={input}>
              <option value="">Sin configurar</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
        ))}
        <button onClick={save} disabled={busy} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">Guardar cuentas</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">2. Reglas que se aplicarán</h2>
        <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside">
          <li><strong>Venta:</strong> débito a Caja (efectivo) o Bancos (tarjeta/transferencia) por el total (si es fiado, a Clientes por cobrar, cuenta que se elige en Cartera); crédito a Ingresos por la base y a Impuestos por el IVA. Además, costo de ventas contra inventario (cantidad × costo promedio del producto).</li>
          <li><strong>Compra:</strong> débito a Inventario y crédito a Caja (efectivo), Bancos (tarjeta/transferencia) o Proveedores por pagar si es a crédito (cuenta que se elige en Cuentas por pagar). Al abonar al proveedor, baja Proveedores por pagar contra Caja o Bancos.</li>
          <li><strong>Gastos operativos:</strong> débito a la cuenta propia configurada en la categoría del gasto (o a Gastos generales si la categoría usa la predeterminada); crédito a Caja (efectivo) o Bancos (tarjeta/transferencia).</li>
          <li><strong>Anulaciones:</strong> se crea un asiento de reversión; el original se conserva.</li>
          <li><strong>Devoluciones:</strong> en ventas baja el ingreso (y el IVA proporcional) contra Caja, Bancos o Cartera según la forma de reembolso, y la mercancía vuelve a Inventario; en compras sale de Inventario contra Cuentas por pagar, Caja o Bancos.</li>
          <li><strong>Caja manual y arqueos:</strong> ingresos y sobrantes contra Otros ingresos; egresos y faltantes contra Gastos. <strong>Ajustes de stock:</strong> contra la cuenta de ajustes, a costo actual.</li>
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">3. Activación</h2>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${settings?.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {settings?.active ? `Activa desde ${settings.start_date}` : 'Inactiva'}
          </span>
        </div>
        <label className="block text-xs text-slate-500">Fecha de inicio contable (los documentos anteriores no se contabilizan solos)</label>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className={input} />
        {!complete && <p className="text-xs text-amber-800">Falta configurar todas las cuentas para poder activar.</p>}

        {confirmActivate ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
            <p className="text-xs text-emerald-900">
              Desde el <strong>{start}</strong>, cada venta, compra, abono y gasto nuevo generará su asiento contable automáticamente. ¿Deseas activarla?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmActivate(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void executeToggle(true)}
                disabled={busy}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                {busy ? 'Activando…' : 'Confirmar activación'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setConfirmActivate(true)} disabled={busy || !complete || !!settings?.active} className="flex-1 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">Activar</button>
            <button onClick={() => void executeToggle(false)} disabled={busy || !settings?.active} className="px-4 py-2 rounded-lg text-sm text-slate-700 border border-slate-200 disabled:opacity-40">Desactivar</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">4. Conciliación</h2>
          <div className="flex gap-2">
            <button onClick={reconcile} disabled={busy || !settings?.start_date} className="text-xs font-medium bg-slate-800 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">Conciliar</button>
            <button onClick={() => setConfirmPostPending(true)} disabled={busy || !settings?.active} className="text-xs font-medium text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg disabled:opacity-40">Contabilizar pendientes</button>
          </div>
        </div>

        {confirmPostPending && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-xs text-slate-700">
              Se contabilizarán todos los documentos desde la fecha de inicio que aún no tienen asiento (ventas, compras, gastos, abonos, pagos a proveedores, devoluciones, caja y ajustes).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmPostPending(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void executePostPending()}
                disabled={busy}
                className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
              >
                {busy ? 'Procesando…' : 'Contabilizar ahora'}
              </button>
            </div>
          </div>
        )}

        {recon.length === 0 && <p className="text-sm text-slate-400">Pulsa «Conciliar» para comparar tus cifras operativas con las contables.</p>}
        {recon.map(r => {
          const diff = Math.abs(Number(r.difference)) < 0.005
          return (
            <div key={r.code} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              <div className="flex items-center gap-2">
                {diff ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
                <p className="text-sm font-medium text-slate-800 flex-1">{r.label}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mt-1 pl-6 tabular-nums">
                <span className="text-slate-500">Operativo <b className="block font-mono text-slate-800">{money(r.operational)}</b></span>
                <span className="text-slate-500">Contable <b className="block font-mono text-slate-800">{money(r.accounting)}</b></span>
                <span className="text-slate-500">Diferencia <b className={`block font-mono ${diff ? 'text-emerald-700' : 'text-amber-700'}`}>{money(r.difference)}</b></span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 pl-6">{r.note}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
