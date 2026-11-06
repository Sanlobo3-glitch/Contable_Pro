import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  Search,
  Gift,
  Building2,
  Database,
  RefreshCw,
} from 'lucide-react'
import { fmtDate } from '../lib/currency'
import type { CompanySummary } from '../types'

const PLANS = [
  { id: 'emprendedor', label: 'Emprendedor' },
  { id: 'profesional', label: 'Profesional' },
  { id: 'empresarial', label: 'Empresarial' },
  { id: 'corporativo', label: 'Corporativo' },
]

const COMPANY_MONTHS = [
  { value: 1, label: '1 mes (30 días)' },
  { value: 3, label: '3 meses (90 días)' },
  { value: 6, label: '6 meses (180 días)' },
  { value: 12, label: '1 año (12 meses)' },
  { value: 0, label: 'Indefinido / De por vida' },
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

export default function AdminPlans({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()

  // Sección 1: Gestión comercial por empresa cliente (Migración 000045)
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [companyFilter, setCompanyFilter] = useState('')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [companyPlan, setCompanyPlan] = useState<string>('profesional')
  const [companyMonths, setCompanyMonths] = useState<number>(1)
  const [companyNote, setCompanyNote] = useState<string>('')
  const [needsMigration45, setNeedsMigration45] = useState(false)

  // Sección 2: Usuarios y cortesías en la empresa interna de pruebas
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Row[]>([])
  const [sel, setSel] = useState<Row | null>(null)
  const [plan, setPlan] = useState('profesional')
  const [duration, setDuration] = useState('30')
  const [courtesy, setCourtesy] = useState(false)
  const [note, setNote] = useState('')
  const [courtesies, setCourtesies] = useState<Row[]>([])
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadCommercialCompanies = useCallback(async () => {
    if (user?.role !== 'admin') return
    const { data, error } = await supabase.rpc('admin_listar_empresas_comerciales')
    if (error) {
      if (/admin_listar_empresas_comerciales|does not exist|schema cache|42883|PGRST202/i.test(error.message || '')) {
        setNeedsMigration45(true)
      }
      return
    }
    setNeedsMigration45(false)
    const list = ((Array.isArray(data) ? data : []) as CompanySummary[]).filter(
      c => c.company_id !== user.company_id
    )
    setCompanies(list)
    setSelectedCompanyId(prev => {
      if (prev && list.some(c => c.company_id === prev)) return prev
      return list[0]?.company_id || ''
    })
  }, [user?.role, user?.company_id])

  const loadCourtesies = useCallback(async () => {
    const { data } = await supabase.rpc('admin_list_courtesies')
    setCourtesies((data as Row[]) || [])
  }, [])

  useEffect(() => {
    if (user?.role === 'admin') {
      void loadCommercialCompanies()
      void loadCourtesies()
    }
  }, [user?.role, loadCommercialCompanies, loadCourtesies])

  const filteredCompanies = useMemo(() => {
    const term = companyFilter.trim().toLowerCase()
    if (!term) return companies
    return companies.filter(
      c =>
        c.company_name.toLowerCase().includes(term) ||
        (c.owner_name || '').toLowerCase().includes(term) ||
        (c.owner_email || '').toLowerCase().includes(term) ||
        c.company_id.toLowerCase().includes(term)
    )
  }, [companies, companyFilter])

  const selectedCompany = useMemo(
    () => companies.find(c => c.company_id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  )

  if (user?.role !== 'admin') {
    return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>
  }

  async function handleActivateCompanyPlan(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCompany || busy) return
    setBusy(true)
    setMsg(null)

    const { error } = await supabase.rpc('admin_activar_plan_empresa', {
      p_company_id: selectedCompany.company_id,
      p_plan: companyPlan,
      p_months: companyMonths,
      p_note: companyNote.trim() || null,
    })

    setBusy(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
      return
    }

    setMsg({
      ok: true,
      text:
        companyMonths === 0
          ? `Plan ${companyPlan} activado de por vida para ${selectedCompany.company_name}.`
          : `Plan ${companyPlan} activado por ${companyMonths} ${companyMonths === 1 ? 'mes' : 'meses'} para ${selectedCompany.company_name}.`,
    })
    setCompanyNote('')
    await loadCommercialCompanies()
  }

  async function handleCompanyTrial(days: number) {
    if (!selectedCompany || busy) return
    setBusy(true)
    setMsg(null)

    const { error } = await supabase.rpc('admin_reactivar_prueba_empresa', {
      p_company_id: selectedCompany.company_id,
      p_days: days,
    })

    setBusy(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
      return
    }

    setMsg({
      ok: true,
      text: `Prueba gratuita de ${days} días habilitada para ${selectedCompany.company_name}.`,
    })
    await loadCommercialCompanies()
  }

  async function handleCompanyStatusChange(status: 'active' | 'suspended') {
    if (!selectedCompany || busy) return
    setBusy(true)
    setMsg(null)

    const { error } = await supabase.rpc('admin_cambiar_estado_empresa', {
      p_company_id: selectedCompany.company_id,
      p_status: status,
      p_note: companyNote.trim() || null,
    })

    setBusy(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
      return
    }

    setMsg({
      ok: true,
      text:
        status === 'suspended'
          ? `Suscripción suspendida para ${selectedCompany.company_name}.`
          : `Suscripción reactivada para ${selectedCompany.company_name}.`,
    })
    await loadCommercialCompanies()
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
    setSel(null); setResults([]); void loadCourtesies()
  }

  async function revoke(r: Row) {
    if (confirmRevokeId !== r.id) {
      setConfirmRevokeId(r.id)
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('admin_revoke_plan', { p_user_id: r.id })
    setBusy(false)
    setConfirmRevokeId(null)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setMsg({ ok: true, text: 'Plan retirado a ' + r.email })
    setSel(null); setResults([]); void loadCourtesies()
  }

  const input = 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-700'

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Activar planes y licencias
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Activa suscripciones comerciales por empresa cliente o administra cortesías internas sin acceder a los datos operativos de terceros.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void loadCommercialCompanies()
            void loadCourtesies()
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      {msg && (
        <p className={`text-sm px-4 py-2.5 rounded-xl border ${msg.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'}`}>
          {msg.text}
        </p>
      )}

      {/* Sección 1: Gestión comercial por Empresa Cliente */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">
              Suscripción comercial por Empresa Cliente
            </h2>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('companies')}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 underline whitespace-nowrap shrink-0"
            >
              Ver directorio completo de empresas
            </button>
          )}
        </div>

        {needsMigration45 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-amber-900">
            <span>
              La gestión comercial por empresa cliente requiere aplicar la <strong>Migración 000045</strong> en el Centro SQL.
            </span>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('sqlcenter')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900 text-white font-semibold hover:bg-amber-800 whitespace-nowrap shrink-0"
              >
                <Database className="w-3.5 h-3.5" />
                Ir al Centro SQL
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleActivateCompanyPlan} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Filtrar empresa cliente
                </label>
                <input
                  value={companyFilter}
                  onChange={e => setCompanyFilter(e.target.value)}
                  placeholder="Filtrar por nombre o titular..."
                  className={input}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Empresa cliente seleccionada
                </label>
                <select
                  value={selectedCompanyId}
                  onChange={e => {
                    const nextId = e.target.value
                    setSelectedCompanyId(nextId)
                    const found = companies.find(c => c.company_id === nextId)
                    if (found?.plan_type && PLANS.some(p => p.id === found.plan_type)) {
                      setCompanyPlan(found.plan_type)
                    }
                  }}
                  className={input}
                >
                  {filteredCompanies.length === 0 ? (
                    <option value="">No hay empresas clientes disponibles</option>
                  ) : (
                    filteredCompanies.map(c => (
                      <option key={c.company_id} value={c.company_id}>
                        {c.company_name} ({c.owner_email || c.owner_name || 'Sin correo'})
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {selectedCompany && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                <span>
                  Titular: <strong>{selectedCompany.owner_name || 'Sin titular'}</strong>
                </span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span>
                  Plan actual: <strong className="capitalize">{selectedCompany.plan_type || 'Sin plan'}</strong>
                </span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span>
                  Estado: <strong>{selectedCompany.subscription_status || 'Sin estado'}</strong>
                </span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span>
                  Miembros: <strong>{selectedCompany.members_count}</strong>
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Plan a asignar
                </label>
                <select
                  value={companyPlan}
                  onChange={e => setCompanyPlan(e.target.value)}
                  className={input}
                >
                  {PLANS.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Duración del plan
                </label>
                <select
                  value={companyMonths}
                  onChange={e => setCompanyMonths(Number(e.target.value))}
                  className={input}
                >
                  {COMPANY_MONTHS.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Nota o referencia
                </label>
                <input
                  value={companyNote}
                  onChange={e => setCompanyNote(e.target.value)}
                  placeholder="Ej. Comprobante #9041 / Renovación"
                  className={input}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!selectedCompany || busy}
                  onClick={() => void handleCompanyTrial(7)}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                >
                  Prueba 7 días
                </button>
                <button
                  type="button"
                  disabled={!selectedCompany || busy}
                  onClick={() => void handleCompanyTrial(30)}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                >
                  Prueba 30 días
                </button>
                <button
                  type="button"
                  disabled={!selectedCompany || busy}
                  onClick={() =>
                    void handleCompanyStatusChange(
                      selectedCompany?.subscription_status === 'suspended'
                        ? 'active'
                        : 'suspended'
                    )
                  }
                  className="px-3 py-2 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                >
                  {selectedCompany?.subscription_status === 'suspended'
                    ? 'Reactivar suscripción'
                    : 'Suspender suscripción'}
                </button>
              </div>

              <button
                type="submit"
                disabled={!selectedCompany || busy}
                className="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                {busy ? 'Guardando...' : 'Activar plan en empresa'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Sección 2: Cortesías y usuarios de la empresa interna de pruebas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Entorno interno de pruebas · Buscar usuario
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Consulta cuentas dentro de tu empresa interna de pruebas para otorgar cortesías o licencias individuales.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void search()}
              placeholder="Correo del usuario interno"
              className={input}
            />
            <button
              type="button"
              onClick={() => void search()}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-semibold shrink-0 hover:bg-slate-800 whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" /> Buscar
            </button>
          </div>

          {results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => pick(r)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${
                sel?.id === r.id ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <p className="font-medium text-slate-800">{r.full_name || r.email}</p>
              <p className="text-xs text-slate-500 tabular-nums">
                {r.email} · {r.plan_type || 'sin plan'} · {fmtEnd(r)}
              </p>
            </button>
          ))}

          {sel && (
            <div className="pt-3 border-t border-slate-200 space-y-3">
              <p className="text-xs font-semibold text-slate-800">{sel.email}</p>
              <div className="grid grid-cols-2 gap-3">
                <select value={plan} onChange={e => setPlan(e.target.value)} className={input}>
                  {PLANS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <select value={duration} onChange={e => setDuration(e.target.value)} className={input}>
                  {DURATIONS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={courtesy} onChange={e => setCourtesy(e.target.checked)} />
                Cortesía o donación
              </label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (ej. Laboratorio interno, donación)" className={input} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void activate()}
                  disabled={busy}
                  className="flex-1 bg-slate-900 text-white py-2 rounded-lg text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando...' : 'Activar plan'}
                </button>
                <button
                  type="button"
                  onClick={() => void revoke(sel)}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50"
                >
                  {confirmRevokeId === sel.id ? '¿Confirmar retiro?' : 'Quitar plan'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <Gift className="w-4 h-4 text-slate-700" /> Cortesías y donaciones activas
          </h2>
          {courtesies.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              Aún no hay cortesías registradas en la empresa interna.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {courtesies.map(r => (
                <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{r.full_name || r.email}</p>
                    <p className="text-[11px] text-slate-500 truncate tabular-nums">
                      {r.plan_type} · {r.subscription_end ? 'hasta ' + fmtDate(r.subscription_end) : 'de por vida'}
                      {r.plan_note ? ' · ' + r.plan_note : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revoke(r)}
                      className="text-xs font-medium text-red-600 hover:underline whitespace-nowrap"
                    >
                      {confirmRevokeId === r.id ? 'Confirmar retiro' : 'Quitar'}
                    </button>
                    {confirmRevokeId === r.id && (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(null)}
                        className="text-[11px] text-slate-500 hover:text-slate-700"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

          
