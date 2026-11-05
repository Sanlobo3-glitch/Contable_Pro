import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Search, Gift } from 'lucide-react'
import { fmtDate } from '../lib/currency'

const PLANS = [
  { id: 'emprendedor', label: 'Emprendedor' },
  { id: 'profesional', label: 'Profesional' },
  { id: 'empresarial', label: 'Empresarial' },
  { id: 'corporativo', label: 'Corporativo' },
]

const DURATIONS = [
  { id: '30', label: '30 días' },
  { id: '90', label: '90 días' },
  { id: '365', label: '1 año' },
  { id: 'life', label: 'De por vida' },
]

interface Row {
  id: string
  email: string
  full_name: string | null
  plan_type: string | null
  subscription_status?: string | null
  subscription_end: string | null
  plan_courtesy?: boolean
  plan_note?: string | null
}

function fmtEnd(r: Row) {
  if (r.subscription_status !== 'active') return 'Sin plan activo'
  return r.subscription_end
    ? 'Activo hasta ' + fmtDate(r.subscription_end)
    : 'Activo de por vida'
}

export default function AdminPlans() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Row[]>([])
  const [sel, setSel] = useState<Row | null>(null)
  const [plan, setPlan] = useState('profesional')
  const [duration, setDuration] = useState('30')
  const [courtesy, setCourtesy] = useState(false)
  const [note, setNote] = useState('')
  const [courtesies, setCourtesies] = useState<Row[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadCourtesies() {
    const { data } = await supabase.rpc('admin_list_courtesies')
    setCourtesies((data as Row[]) || [])
  }

  useEffect(() => {
    if (user?.role === 'admin') loadCourtesies()
  }, [user?.role])

  if (user?.role !== 'admin') {
    return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>
  }

  async function search() {
    setMsg(null)
    if (q.trim().length < 3) {
      setMsg({ ok: false, text: 'Escribe al menos 3 letras del correo.' })
      return
    }
    const { data, error } = await supabase.rpc('admin_find_user', { p_email: q.trim() })
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setResults((data as Row[]) || [])
  }

  function pick(r: Row) {
    setSel(r)
    setPlan(r.plan_type || 'profesional')
    setCourtesy(!!r.plan_courtesy)
    setNote(r.plan_note || '')
  }

  async function activate() {
    if (!sel) return
    setBusy(true); setMsg(null)
    const life = duration === 'life'
    const { error } = await supabase.rpc('admin_set_plan', {
      p_user_id: sel.id,
      p_plan: plan,
      p_days: life ? 0 : Number(duration),
      p_lifetime: life,
      p_courtesy: courtesy,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setMsg({ ok: true, text: 'Plan activado para ' + sel.email })
    setSel(null); setResults([]); loadCourtesies()
  }

  async function revoke(r: Row) {
    if (!window.confirm('¿Quitar el plan a ' + r.email + '? Pasará a solo lectura.')) return
    const { error } = await supabase.rpc('admin_revoke_plan', { p_user_id: r.id })
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setMsg({ ok: true, text: 'Plan retirado a ' + r.email })
    setSel(null); setResults([]); loadCourtesies()
  }

  const input = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700'

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Activar planes</h1>
        <p className="text-sm text-slate-500 mt-1">Activa un plan manualmente o concede acceso de por vida (cortesía o donación).</p>
      </div>

      {msg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${msg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>{msg.text}</p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Correo del usuario" className={input} />
          <button onClick={search} className="flex items-center gap-1 bg-slate-800 text-white px-4 rounded-lg text-sm shrink-0">
            <Search className="w-4 h-4" /> Buscar
          </button>
        </div>
        {results.map(r => (
          <button key={r.id} onClick={() => pick(r)}
            className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${sel?.id === r.id ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <p className="font-medium text-slate-800">{r.full_name || r.email}</p>
            <p className="text-xs text-slate-500">{r.email} · {r.plan_type || 'sin plan'} · {fmtEnd(r)}</p>
          </button>
        ))}
      </div>

      {sel && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">{sel.email}</p>
          <div className="grid grid-cols-2 gap-3">
            <select value={plan} onChange={e => setPlan(e.target.value)} className={input}>
              {PLANS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select value={duration} onChange={e => setDuration(e.target.value)} className={input}>
              {DURATIONS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={courtesy} onChange={e => setCourtesy(e.target.checked)} />
            Cortesía o donación
          </label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (ej. Escuela X, donación)" className={input} />
          <div className="flex gap-2">
            <button onClick={activate} disabled={busy} className="flex-1 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {busy ? 'Guardando...' : 'Activar plan'}
            </button>
            <button onClick={() => revoke(sel)} className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50">
              Quitar plan
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3">
          <Gift className="w-4 h-4" /> Cortesías y donaciones
        </h2>
        {courtesies.length === 0 ? (
          <p className="text-sm text-slate-400">Aún no hay cortesías.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {courtesies.map(r => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800 truncate">{r.full_name || r.email}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {r.plan_type} · {r.subscription_end ? 'hasta ' + fmtDate(r.subscription_end) : 'de por vida'}
                    {r.plan_note ? ' · ' + r.plan_note : ''}
                  </p>
                </div>
                <button onClick={() => revoke(r)} className="text-xs text-red-600 hover:underline shrink-0">Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
      }
          
