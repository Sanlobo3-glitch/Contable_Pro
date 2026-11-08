
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { getDeviceKey } from '../lib/devices'
import DeviceMockup, { type DeviceKind } from '../components/DeviceMockup'
import AvatarCapture, { UserAvatar } from '../components/AvatarCapture'
import InviteSellers from '../components/InviteSellers'
import {
  Copy,
  Check,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Pencil,
  ArrowUpRight,
  X,
} from 'lucide-react'

interface Member {
  id: string
  full_name: string | null
  email: string
  role: string
  active: boolean
  avatar_url?: string | null
  phone: string | null
  job_title: string | null
  zone?: string | null
  national_id: string | null
  address: string | null
  emergency_contact?: string | null
  hire_date?: string | null
  base_salary?: number
  commission_pct?: number
  notes: string | null
}

interface Device {
  id: string
  device_key: string
  name: string
  kind: DeviceKind
  os: string | null
  browser: string | null
  status: 'pendiente' | 'autorizado' | 'bloqueado'
  last_seen: string
}

type Form = {
  full_name: string
  avatar_url: string | null
  phone: string
  job_title: string
  zone: string
  national_id: string
  address: string
  emergency_contact: string
  notes: string
}

const ROLE_TEXT: Record<string, string> = {
  admin: 'Administrador de plataforma',
  tecnico: 'Soporte técnico',
  dueno: 'Dueño',
  admin_empresa: 'Administrador de empresa',
  gerente: 'Gerente operativo',
  contador: 'Contador público',
  almacen: 'Jefe de almacén',
  vendedor: 'Vendedor',
  cajero: 'Cajero POS',
  comprador: 'Compras y abastecimiento',
  transportador: 'Transporte y despacho',
}

const STATUS_TEXT: Record<string, { label: string; cls: string }> = {
  autorizado: { label: 'Autorizado', cls: 'text-emerald-700' },
  pendiente: { label: 'Pendiente de autorización', cls: 'text-amber-700' },
  bloqueado: { label: 'Bloqueado', cls: 'text-red-600' },
}

const KINDS: { id: DeviceKind; label: string; tip: string }[] = [
  {
    id: 'movil',
    label: 'Móvil',
    tip: 'Abre el enlace y usa «Añadir a pantalla de inicio» en el menú del navegador.',
  },
  {
    id: 'tablet',
    label: 'Tablet',
    tip: 'Ideal para el punto de venta en el mostrador.',
  },
  {
    id: 'pc',
    label: 'PC',
    tip: 'Crea un acceso directo desde el menú del navegador (Chrome o Edge).',
  },
  {
    id: 'mac',
    label: 'Mac',
    tip: 'En Safari: Archivo → Añadir al Dock.',
  },
]

const PLAN_LABEL: Record<string, string> = {
  trial: 'Prueba gratuita · límites de Profesional',
  emprendedor: 'Plan Emprendedor',
  profesional: 'Plan Profesional',
  empresarial: 'Plan Empresarial',
  corporativo: 'Plan Corporativo',
}

const EMPTY: Form = {
  full_name: '',
  avatar_url: null,
  phone: '',
  job_title: '',
  zone: '',
  national_id: '',
  address: '',
  emergency_contact: '',
  notes: '',
}

function ago(iso: string) {
  const timestamp = new Date(iso).getTime()

  if (!Number.isFinite(timestamp)) return 'sin información'

  const m = Math.max(0, Math.round((Date.now() - timestamp) / 60000))

  if (m < 2) return 'ahora'
  if (m < 60) return `hace ${m} min`
  if (m < 1440) return `hace ${Math.round(m / 60)} h`

  return `hace ${Math.round(m / 1440)} d`
}

function isRecentlyActive(iso: string): boolean {
  const timestamp = new Date(iso).getTime()

  if (!Number.isFinite(timestamp)) return false

  return Date.now() - timestamp <= 2 * 60 * 1000
}

export default function TeamDevices({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user, refreshUser } = useAuth()

  const isManager =
    user?.role === 'dueno' ||
    user?.role === 'admin_empresa' ||
    user?.role === 'admin'

  const [tab, setTab] = useState<'team' | 'devices'>('team')
  const [team, setTeam] = useState<Member[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [editing, setEditing] = useState<Member | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [removeMemberTarget, setRemoveMemberTarget] = useState<Member | null>(null)
  const [removeDeviceTarget, setRemoveDeviceTarget] = useState<Device | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const [usage, setUsage] = useState<{
    plan: string
    limit: number
    used: number
    enforced: boolean
  } | null>(null)

  const load = useCallback(async () => {
    if (!isManager) return

    setLoading(true)

    try {
      const [nominaRes, devicesRes, usageRes] = await Promise.all([
        supabase.rpc('listar_nomina_equipo'),
        supabase
          .from('devices')
          .select('*')
          .order('last_seen', { ascending: false }),
        supabase.rpc('device_usage'),
      ])

      if (!nominaRes.error && Array.isArray(nominaRes.data)) {
        setTeam(nominaRes.data as Member[])
      } else {
        const fallbackTeam = await supabase.rpc('list_team')

        if (fallbackTeam.error) {
          setMsg({
            ok: false,
            text: fallbackTeam.error.message,
          })
        } else {
          setTeam((fallbackTeam.data as Member[]) || [])
        }
      }

      if (devicesRes.error) {
        setMsg({
          ok: false,
          text: `No se pudieron cargar los dispositivos: ${devicesRes.error.message}`,
        })
      } else {
        setDevices((devicesRes.data as Device[]) || [])
      }

      if (usageRes.error) {
        setUsage(null)
      } else {
        setUsage((usageRes.data as typeof usage) || null)
      }

      setLastRefresh(new Date())
    } catch (error) {
      setMsg({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'No fue posible actualizar los datos del equipo.',
      })
    } finally {
      setLoading(false)
    }
  }, [isManager])

  // Carga inicial y sincronización de cambios en dispositivos.
  useEffect(() => {
    if (!isManager) return

    void load()

    const channel = supabase
      .channel('team-devices-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'devices',
        },
        () => {
          void load()
        }
      )
      .subscribe()

    // Actualiza los datos al volver a la pestaña.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void load()
      }
    }

    const handleFocus = () => {
      void load()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void supabase.removeChannel(channel)
    }
  }, [isManager, load])

  if (!isManager) {
    return (
      <p className="text-sm text-slate-500">
        No tienes permiso para ver esta página.
      </p>
    )
  }

  function startEdit(m: Member) {
    setEditing(m)

    setForm({
      full_name: m.full_name || '',
      avatar_url: m.avatar_url || null,
      phone: m.phone || '',
      job_title: m.job_title || '',
      zone: m.zone || '',
      national_id: m.national_id || '',
      address: m.address || '',
      emergency_contact: m.emergency_contact || '',
      notes: m.notes || '',
    })
  }

  async function saveStaff(m: Member) {
    setSaving(true)
    setMsg(null)

    const { error } = await supabase.rpc('guardar_ficha_miembro', {
      p_user_id: m.id,
      p_full_name: form.full_name.trim() || null,
      p_role: m.role,
      p_active: m.active,
      p_avatar_url: form.avatar_url || null,
      p_national_id: form.national_id.trim() || null,
      p_phone: form.phone.trim() || null,
      p_job_title: form.job_title.trim() || null,
      p_zone: form.zone.trim() || null,
      p_address: form.address.trim() || null,
      p_emergency_contact: form.emergency_contact.trim() || null,
      p_hire_date: m.hire_date || null,
      p_base_salary: Number(m.base_salary) || 0,
      p_commission_pct: Number(m.commission_pct) || 0,
      p_notes: form.notes.trim() || null,
    })

    if (error) {
      if (
        /guardar_ficha_miembro|schema cache|does not exist/i.test(
          error.message || ''
        )
      ) {
        const fb = await supabase.rpc('save_staff_details', {
          p_user_id: m.id,
          p_phone: form.phone.trim() || null,
          p_job_title: form.job_title.trim() || null,
          p_national_id: form.national_id.trim() || null,
          p_address: form.address.trim() || null,
          p_notes: form.notes.trim() || null,
        })

        setSaving(false)

        if (fb.error) {
          setMsg({ ok: false, text: fb.error.message })
          return
        }

        setMsg({
          ok: true,
          text: 'Datos básicos guardados. Ejecuta el SQL de Nómina e Invitaciones en Supabase para guardar foto y nómina.',
        })

        setEditing(null)
        await load()
        return
      }

      setSaving(false)
      setMsg({ ok: false, text: error.message })
      return
    }

    setSaving(false)
    setMsg({ ok: true, text: 'Foto y datos personales actualizados.' })
    setEditing(null)

    if (m.id === user?.id) await refreshUser()

    await load()
  }

  async function confirmRemoveMember() {
    if (!removeMemberTarget) return

    const { data, error } = await supabase.rpc('retirar_miembro_empresa', {
      p_user_id: removeMemberTarget.id,
    })

    if (error) {
      setMsg({
        ok: false,
        text: /retirar_miembro_empresa|does not exist/i.test(error.message)
          ? 'Ejecuta primero el script SQL de Nómina e Invitaciones en Supabase para retirar perfiles.'
          : error.message,
      })
    } else {
      setMsg({
        ok: true,
        text: (data as any)?.message || 'Perfil retirado del equipo.',
      })

      await load()
    }

    setRemoveMemberTarget(null)
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.rpc('set_device_status', {
      p_id: id,
      p_status: status,
    })

    if (error) {
      setMsg({ ok: false, text: error.message })
    } else {
      setMsg({
        ok: true,
        text:
          status === 'autorizado'
            ? 'Dispositivo autorizado correctamente.'
            : status === 'bloqueado'
              ? 'Dispositivo bloqueado correctamente.'
              : 'Estado del dispositivo actualizado.',
      })

      await load()
    }
  }

  async function confirmRemoveDevice() {
    if (!removeDeviceTarget) return

    const { error } = await supabase.rpc('delete_device', {
      p_id: removeDeviceTarget.id,
    })

    setRemoveDeviceTarget(null)

    if (error) {
      setMsg({ ok: false, text: error.message })
    } else {
      setMsg({
        ok: true,
        text: 'Dispositivo eliminado correctamente.',
      })

      await load()
    }
  }

  async function toggleEnforce() {
    if (!usage) return

    const { error } = await supabase.rpc('set_device_enforcement', {
      p_enabled: !usage.enforced,
    })

    if (error) {
      setMsg({ ok: false, text: error.message })
    } else {
      setMsg({
        ok: true,
        text: usage.enforced
          ? 'Se desactivó la autorización obligatoria.'
          : 'Se activó la autorización obligatoria.',
      })

      await load()
    }
  }

  function copyLink() {
    navigator.clipboard
      .writeText(window.location.origin)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        setMsg({
          ok: false,
          text: 'No se pudo copiar el enlace. Copia la dirección desde el navegador.',
        })
      })
  }

  const here = getDeviceKey()

  const stale = devices.filter(
    d =>
      d.status === 'autorizado' &&
      Date.now() - new Date(d.last_seen).getTime() > 30 * 86400000
  ).length

  const onlineCount = devices.filter(
    d => d.status === 'autorizado' && isRecentlyActive(d.last_seen)
  ).length

  const input =
    'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-slate-600'

  const tabBtn = (id: 'team' | 'devices', label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
        tab === id
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Equipo y dispositivos
          </h1>

          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {team.filter(m => m.role === 'vendedor').length} vendedores ·{' '}
            {team.filter(m => m.role !== 'vendedor').length} dirección ·{' '}
            {devices.length} dispositivos
          </p>

          {lastRefresh && (
            <p className="text-xs text-slate-400 mt-1">
              Actualizado: {lastRefresh.toLocaleTimeString()}
              {loading ? ' · Actualizando...' : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('sellers')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
            >
              Abrir Nómina de vendedores
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-white rounded-xl border border-slate-200">
        {tabBtn('team', 'Miembros del equipo')}
        {tabBtn('devices', 'Dispositivos conectados')}
      </div>

      {msg && (
        <div
          className={`flex items-center justify-between gap-3 text-xs px-4 py-3 rounded-xl border ${
            msg.ok
              ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
              : 'text-red-700 bg-red-50 border-red-200'
          }`}
        >
          <span>{msg.text}</span>

          <button
            type="button"
            onClick={() => setMsg(null)}
            className="p-1 rounded hover:bg-black/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-4">
          <InviteSellers
            onTeamChanged={load}
            onOpenPayroll={onNavigate ? () => onNavigate('sellers') : undefined}
          />

          {team.length === 0 && (
            <p className="text-sm text-slate-400">
              Aún no hay personas registradas en tu empresa.
            </p>
          )}

          {team.map(m => {
            const roleLabel = ROLE_TEXT[m.role] || m.role
            const isEditingThis = editing?.id === m.id

            return (
              <div
                key={m.id}
                className="bg-white rounded-xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <UserAvatar
                    src={m.avatar_url}
                    name={m.full_name}
                    email={m.email}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {m.full_name || m.email}
                    </p>

                    <p className="text-xs text-slate-500 truncate">
                      {m.email}
                    </p>

                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {[
                        roleLabel,
                        m.national_id ? `ID ${m.national_id}` : null,
                        m.job_title,
                        m.zone,
                        m.phone,
                        m.active ? 'Autorizado' : 'Suspendido',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        isEditingThis ? setEditing(null) : startEdit(m)
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Foto y datos
                    </button>

                    {m.id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => setRemoveMemberTarget(m)}
                        title="Retirar perfil no autorizado"
                        className="p-1.5 rounded-lg border border-slate-200 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isEditingThis && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                    <AvatarCapture
                      value={form.avatar_url}
                      name={form.full_name}
                      email={m.email}
                      onChange={avatar_url =>
                        setForm({ ...form, avatar_url })
                      }
                      disabled={saving}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Nombre completo
                        </label>
                        <input
                          value={form.full_name}
                          onChange={e =>
                            setForm({ ...form, full_name: e.target.value })
                          }
                          className={input}
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Cédula / ID
                        </label>
                        <input
                          value={form.national_id}
                          onChange={e =>
                            setForm({ ...form, national_id: e.target.value })
                          }
                          className={input}
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Teléfono
                        </label>
                        <input
                          value={form.phone}
                          onChange={e =>
                            setForm({ ...form, phone: e.target.value })
                          }
                          className={input}
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Contacto de emergencia
                        </label>
                        <input
                          value={form.emergency_contact}
                          onChange={e =>
                            setForm({
                              ...form,
                              emergency_contact: e.target.value,
                            })
                          }
                          className={input}
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Cargo
                        </label>
                        <input
                          value={form.job_title}
                          onChange={e =>
                            setForm({ ...form, job_title: e.target.value })
                          }
                          className={input}
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Zona / Ruta
                        </label>
                        <input
                          value={form.zone}
                          onChange={e =>
                            setForm({ ...form, zone: e.target.value })
                          }
                          className={input}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs text-slate-600 mb-1">
                          Dirección
                        </label>
                        <input
                          value={form.address}
                          onChange={e =>
                            setForm({ ...form, address: e.target.value })
                          }
                          className={input}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs text-slate-600 mb-1">
                          Notas
                        </label>
                        <input
                          value={form.notes}
                          onChange={e =>
                            setForm({ ...form, notes: e.target.value })
                          }
                          className={input}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void saveStaff(m)}
                        className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                      >
                        {saving ? 'Guardando...' : 'Guardar foto y datos'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="px-4 py-2 rounded-lg text-xs text-slate-600 border border-slate-200 hover:bg-slate-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'devices' && (
        <div className="space-y-5">
          <div className="relative h-56 sm:h-72 rounded-xl overflow-hidden bg-slate-900">
            <div className="absolute left-1/2 -translate-x-1/2 top-5 w-[60%] sm:w-[46%] drop-shadow-2xl">
              <DeviceMockup kind="mac" />
            </div>

            <div className="absolute left-[5%] bottom-3 w-[32%] sm:w-[24%] drop-shadow-2xl">
              <DeviceMockup kind="tablet" />
            </div>

            <div className="absolute right-[7%] bottom-3 w-[14%] sm:w-[10%] drop-shadow-2xl">
              <DeviceMockup kind="movil" />
            </div>

            <p className="absolute left-4 top-3 text-white text-sm font-semibold">
              Trabaja desde cualquier dispositivo
            </p>
          </div>

          {usage && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Dispositivos autorizados
                </h2>

                <span className="text-xs text-slate-500 text-right">
                  {PLAN_LABEL[usage.plan] || usage.plan}
                </span>
              </div>

              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    usage.used >= usage.limit
                      ? 'bg-red-500'
                      : usage.used / usage.limit > 0.7
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                  }`}
                  style={{
                    width: `${
                      usage.limit > 0
                        ? Math.min(100, (usage.used / usage.limit) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>

              <p className="text-xs text-slate-500 tabular-nums">
                {usage.used} de {usage.limit} en uso.
                {usage.used >= usage.limit
                  ? ' Libera un cupo o mejora tu plan para autorizar más.'
                  : ''}
                {stale > 0
                  ? ` Tienes ${stale} sin uso hace más de 30 días: elimínalos para liberar cupo.`
                  : ''}
              </p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
                  {onlineCount} con actividad reciente
                </span>
                <span>
                  {devices.length - onlineCount} sin actividad reciente
                </span>
              </div>

              <label className="flex items-start gap-3 text-sm text-slate-600 pt-3 border-t border-slate-100">
                <input
                  type="checkbox"
                  checked={usage.enforced}
                  onChange={() => void toggleEnforce()}
                  className="mt-1"
                />

                <span>
                  <strong className="text-slate-800">
                    Exigir autorización.
                  </strong>{' '}
                  Los vendedores no podrán usar un dispositivo nuevo hasta que
                  lo autorices.
                </span>
              </label>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Conecta un dispositivo en 3 pasos
            </h2>

            <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
              <li>
                Abre este enlace en el dispositivo nuevo:

                <button
                  type="button"
                  onClick={copyLink}
                  className="ml-2 inline-flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md"
                >
                  {copied ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}{' '}
                  {window.location.origin.replace('https://', '')}
                </button>
              </li>

              <li>Inicia sesión con tu usuario.</li>

              <li>
                Aparecerá aquí abajo. Los dispositivos de dueño y
                administradores de empresa se gestionan según las reglas de
                autorización de tu compañía. Los de vendedores pueden quedar
                pendientes hasta que los autorices.
              </li>
            </ol>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {KINDS.map(k => (
              <div
                key={k.id}
                className="bg-white rounded-xl border border-slate-200 p-3"
              >
                <div className="h-20 flex items-center justify-center mb-2">
                  <DeviceMockup kind={k.id} className="max-h-20 w-auto" />
                </div>

                <p className="text-sm font-semibold text-slate-800">
                  {k.label}
                </p>

                <p className="text-xs text-slate-500 mt-1">{k.tip}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Dispositivos de tu empresa
              </h2>

              <span className="text-xs text-slate-400">
                {devices.length} registrados
              </span>
            </div>

            {devices.length === 0 && (
              <p className="text-sm text-slate-400">
                Aún no hay dispositivos registrados.
              </p>
            )}

            <ul className="divide-y divide-slate-100">
              {devices.map(d => {
                const st = STATUS_TEXT[d.status] || STATUS_TEXT.pendiente
                const recentlyActive =
                  d.status === 'autorizado' && isRecentlyActive(d.last_seen)

                return (
                  <li
                    key={d.id}
                    className="py-3 flex items-center gap-3"
                  >
                    <div className="w-14 shrink-0">
                      <DeviceMockup kind={d.kind} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {d.name}

                        {d.device_key === here && (
                          <span className="text-xs font-normal text-emerald-700">
                            {' '}· Este dispositivo
                          </span>
                        )}
                      </p>

                      <p className="text-xs text-slate-500 truncate">
                        {[d.os, d.browser].filter(Boolean).join(' · ')} ·{' '}
                        {ago(d.last_seen)} ·{' '}
                        <span className={`font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                      </p>

                      {d.status === 'autorizado' && (
                        <p
                          className={`text-xs mt-1 ${
                            recentlyActive
                              ? 'text-emerald-700'
                              : 'text-slate-400'
                          }`}
                        >
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                              recentlyActive
                                ? 'bg-emerald-500'
                                : 'bg-slate-300'
                            }`}
                          />
                          {recentlyActive
                            ? 'Actividad en los últimos 2 minutos'
                            : 'Sin actividad reciente'}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1 shrink-0">
                      {d.status !== 'autorizado' && (
                        <button
                          type="button"
                          onClick={() =>
                            void setStatus(d.id, 'autorizado')
                          }
                          title="Autorizar"
                          className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50"
                        >
                          <ShieldCheck className="w-4 h-4" />
                        </button>
                      )}

                      {d.status !== 'bloqueado' &&
                        d.device_key !== here && (
                          <button
                            type="button"
                            onClick={() =>
                              void setStatus(d.id, 'bloqueado')
                            }
                            title="Bloquear"
                            className="p-2 rounded-lg text-amber-600 hover:bg-amber-50"
                          >
                            <ShieldOff className="w-4 h-4" />
                          </button>
                        )}

                      <button
                        type="button"
                        onClick={() => setRemoveDeviceTarget(d)}
                        title="Eliminar"
                        className="p-2 rounded-lg text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Modal confirmar retiro de miembro */}
      {removeMemberTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setRemoveMemberTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-5 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-900">
              Retirar miembro del equipo
            </h2>

            <p className="text-xs text-slate-600 leading-relaxed">
              ¿Confirmas retirar a{' '}
              <strong>
                {removeMemberTarget.full_name || removeMemberTarget.email}
              </strong>
              ? Se revocará su acceso y sus dispositivos de inmediato.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRemoveMemberTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => void confirmRemoveMember()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700"
              >
                Retirar perfil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar eliminación de dispositivo */}
      {removeDeviceTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setRemoveDeviceTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-5 w-full max-w-sm space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-900">
              Eliminar dispositivo
            </h2>

            <p className="text-xs text-slate-600 leading-relaxed">
              ¿Eliminar <strong>{removeDeviceTarget.name}</strong>? Volverá a
              solicitar acceso si alguien inicia sesión de nuevo desde él.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRemoveDeviceTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => void confirmRemoveDevice()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
