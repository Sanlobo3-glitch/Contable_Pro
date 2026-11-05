
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  Building2,
  RefreshCw,
  Search,
  Users,
  CreditCard,
  Mail,
  UserRound,
} from 'lucide-react'
import { fmtDate } from '../lib/currency'

interface CompanyRow {
  company_id: string
  company_name: string
  owner_name: string | null
  owner_email: string | null
  members_count: number
  plan_type: string | null
  subscription_status: string | null
  trial_end: string | null
  subscription_end: string | null
}

function statusInfo(
  status: string | null,
  trialEnd: string | null,
  subEnd: string | null
) {
  if (status === 'active') {
    const expired = subEnd
      ? new Date(subEnd).getTime() <= Date.now()
      : false

    return expired
      ? { label: 'Vencida', style: 'bg-red-50 text-red-700' }
      : { label: 'Activa', style: 'bg-emerald-50 text-emerald-700' }
  }

  if (status === 'trial') {
    const expired =
      !trialEnd || new Date(trialEnd).getTime() <= Date.now()

    return expired
      ? { label: 'Prueba vencida', style: 'bg-red-50 text-red-700' }
      : { label: 'En prueba', style: 'bg-amber-50 text-amber-700' }
  }

  if (status === 'suspended') {
    return { label: 'Suspendida', style: 'bg-red-50 text-red-700' }
  }

  return { label: 'Sin acceso', style: 'bg-slate-100 text-slate-600' }
}

function companyDisplayName(company: CompanyRow) {
  const name = (company.company_name || '').trim()

  const genericNames = [
    'mi empresa',
    'mi negocio',
    'empresa',
  ]

  if (
    !name ||
    genericNames.includes(name.toLowerCase())
  ) {
    if (company.owner_name?.trim()) {
      return `Empresa de ${company.owner_name.trim()}`
    }

    return 'Empresa sin nombre comercial'
  }

  return name
}

function companyInitials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length >= 2) {
    return (
      words[0][0] + words[1][0]
    ).toUpperCase()
  }

  return name.slice(0, 2).toUpperCase()
}

export default function CompanyClients({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()

  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (user?.role !== 'admin') {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc(
      'admin_listar_empresas'
    )

    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return
    }

    const rows = (
      Array.isArray(data) ? data : []
    ) as CompanyRow[]

    // La empresa del administrador global es el entorno interno.
    // No debe contabilizarse como empresa cliente.
    const clients = rows.filter(
      company => company.company_id !== user.company_id
    )

    setCompanies(clients)
    setLoading(false)
  }, [user?.id, user?.role, user?.company_id])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) return companies

    return companies.filter(company => {
      const displayName = companyDisplayName(company)

      return (
        displayName.toLowerCase().includes(q) ||
        (company.company_name || '').toLowerCase().includes(q) ||
        (company.owner_name || '').toLowerCase().includes(q) ||
        (company.owner_email || '').toLowerCase().includes(q)
      )
    })
  }, [companies, search])

  const activeCount = companies.filter(company =>
    statusInfo(
      company.subscription_status,
      company.trial_end,
      company.subscription_end
    ).label === 'Activa'
  ).length

  const trialCount = companies.filter(company =>
    statusInfo(
      company.subscription_status,
      company.trial_end,
      company.subscription_end
    ).label === 'En prueba'
  ).length

  if (user?.role !== 'admin') {
    return (
      <p className="text-sm text-slate-500">
        No tienes permiso para consultar las empresas clientes.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Empresas clientes
          </h1>

          <p className="text-sm text-slate-500 mt-1">
            Administración independiente de las empresas que utilizan Inventario Pro.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw
            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
          />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          No se pudieron cargar las empresas: {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Building2 className="w-4 h-4" />
            Total de empresas clientes
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {companies.length}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <CreditCard className="w-4 h-4" />
            Suscripciones activas
          </div>
          <p className="text-2xl font-bold text-emerald-700 mt-2">
            {activeCount}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Users className="w-4 h-4" />
            Empresas en prueba
          </div>
          <p className="text-2xl font-bold text-amber-700 mt-2">
            {trialCount}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />

            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar empresa, titular o correo..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-slate-500"
            />
          </div>

          <span className="text-xs text-slate-500">
            {filtered.length} de {companies.length} empresas
          </span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">
            Cargando empresas...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />

            <p className="text-sm font-medium text-slate-600">
              No hay empresas clientes para mostrar
            </p>

            <p className="text-xs text-slate-400 mt-1">
              Las empresas registradas aparecerán aquí automáticamente.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-3 font-medium">Empresa</th>
                  <th className="px-4 py-3 font-medium">Titular</th>
                  <th className="px-4 py-3 font-medium">Miembros</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Vencimiento</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filtered.map(company => {
                  const status = statusInfo(
                    company.subscription_status,
                    company.trial_end,
                    company.subscription_end
                  )

                  const expiry =
                    company.subscription_status === 'trial'
                      ? company.trial_end
                      : company.subscription_end

                  const displayName = companyDisplayName(company)

                  const hasConfiguredName =
                    Boolean(company.company_name?.trim()) &&
                    ![
                      'mi empresa',
                      'mi negocio',
                      'empresa',
                    ].includes(company.company_name.trim().toLowerCase())

                  return (
                    <tr
                      key={company.company_id}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-4 py-4 min-w-[230px]">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shrink-0">
                            {companyInitials(displayName)}
                          </div>

                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800">
                              {displayName}
                            </p>

                            {!hasConfiguredName && (
                              <p className="text-[10px] text-amber-600 mt-0.5">
                                Nombre comercial pendiente
                              </p>
                            )}

                            <p className="text-[10px] text-slate-400 font-mono mt-1">
                              {company.company_id.slice(0, 8)}…
                            </p>

                            {company.owner_email && (
                              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                <Mail className="w-3 h-3 shrink-0" />
                                <span className="truncate">
                                  {company.owner_email}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <p className="text-slate-700 flex items-center gap-1.5">
                          <UserRound className="w-3.5 h-3.5 text-slate-400" />
                          {company.owner_name || 'Sin titular'}
                        </p>
                      </td>

                      <td className="px-4 py-4">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          {company.members_count}
                        </span>
                      </td>

                      <td className="px-4 py-4 capitalize text-slate-700">
                        {company.plan_type || 'Sin plan'}
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-[11px] font-semibold ${status.style}`}
                        >
                          {status.label}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-xs text-slate-500">
                        {expiry ? fmtDate(expiry) : 'Sin fecha'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onNavigate?.('adminplans')}
        className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
      >
        Administrar planes
      </button>
    </div>
  )
}
