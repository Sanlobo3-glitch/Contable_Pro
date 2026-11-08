
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  UserProfile,
  Role,
  CompanySummary,
  PlatformStaffMember,
  PlatformStaffRole,
} from '../types'
import {
  X,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  Users as UsersIcon,
  Building2,
  AlertTriangle,
  ShieldCheck,
  ShieldOff,
  UserPlus,
  KeyRound,
} from 'lucide-react'
import { useAuth, canManageUsers, getRoleLabel } from '../lib/auth'
import AvatarCapture, { UserAvatar } from '../components/AvatarCapture'
import { fmtDate, fmtDateTime } from '../lib/currency'

type FilterKey = 'all' | 'dueno' | 'vendedor' | 'attention'
type UsersSectionTab = 'internal' | 'platform_staff'

const PLATFORM_STAFF_ROLE_LABELS: Record<PlatformStaffRole, string> = {
  developer: 'Desarrollador de plataforma',
  operations_manager: 'Gerente de operaciones',
  support_manager: 'Líder de soporte técnico',
  technician: 'Técnico especialista',
  commercial: 'Ejecutivo comercial',
  billing: 'Facturación y cobranza',
  customer_success: 'Éxito del cliente',
}

const PLATFORM_PERMISSION_OPTIONS = [
  { key: 'manage_plans', label: 'Activar y renovar planes' },
  { key: 'view_commercial_companies', label: 'Consultar empresas clientes' },
  { key: 'support_inbox', label: 'Atender bandeja de soporte' },
  { key: 'sql_diagnostics', label: 'Diagnóstico SQL y mantenimiento' },
  { key: 'audit_logs', label: 'Consultar auditoría central' },
] as const

interface AdminEditForm {
  full_name: string
  role: Role
  company_id: string
  active: boolean
  avatar_url: string | null
  national_id: string
  phone: string
  job_title: string
  zone: string
  address: string
  emergency_contact: string
  hire_date: string
  base_salary: string
  commission_pct: string
  notes: string
}

function isSubExpired(u: UserProfile): boolean {
  if (u.role === 'admin' || u.role === 'tecnico') return false

  if (u.subscription_status === 'active') {
    return u.subscription_end
      ? new Date(u.subscription_end).getTime() <= Date.now()
      : false
  }

  if (u.subscription_status === 'trial') {
    return u.trial_end
      ? new Date(u.trial_end).getTime() <= Date.now()
      : true
  }

  return true
}

export default function Users() {
  const { user: currentUser, refreshUser } = useAuth()
  const canEdit = canManageUsers(currentUser?.role)
  const ownCompanyId = currentUser?.company_id || ''

  const [activeTab, setActiveTab] = useState<UsersSectionTab>('internal')
  const [users, setUsers] = useState<UserProfile[]>([])
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [legacyMode, setLegacyMode] = useState(false)
  const [feedback, setFeedback] = useState<{
    ok: boolean
    text: string
  } | null>(null)

  // Equipo global de plataforma (platform_staff)
  const [staffMembers, setStaffMembers] = useState<PlatformStaffMember[]>([])
  const [staffNeedsMigration, setStaffNeedsMigration] = useState(false)
  const [staffModalOpen, setStaffModalOpen] = useState(false)
  const [staffUserId, setStaffUserId] = useState<string>('')
  const [staffCustomUuid, setStaffCustomUuid] = useState<string>('')
  const [staffRole, setStaffRole] = useState<PlatformStaffRole>('technician')
  const [staffPermissions, setStaffPermissions] = useState<Record<string, boolean>>({
    manage_plans: false,
    view_commercial_companies: true,
    support_inbox: true,
    sql_diagnostics: false,
    audit_logs: false,
  })
  const [staffNotes, setStaffNotes] = useState<string>('')

  const [editTarget, setEditTarget] = useState<UserProfile | null>(null)
  const [editForm, setEditForm] = useState<AdminEditForm | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null)

  const load = useCallback(async () => {
    if (!canEdit) {
      setLoading(false)
      return
    }

    if (!ownCompanyId) {
      setUsers([])
      setCompanies([])
      setLoading(false)
      setBusy(false)
      setFeedback({
        ok: false,
        text: 'Esta cuenta no tiene una empresa interna de pruebas asociada. Por seguridad no se mostrarán usuarios de otras empresas.',
      })
      return
    }

    setBusy(true)

    try {
      const [fullUsersRes, companiesRes] = await Promise.all([
        supabase.rpc('admin_listar_usuarios_completo'),
        supabase.rpc('admin_listar_empresas'),
      ])

      let loadedUsers: UserProfile[] = []

      if (!fullUsersRes.error && Array.isArray(fullUsersRes.data)) {
        setLegacyMode(false)
        loadedUsers = fullUsersRes.data as UserProfile[]
      } else {
        const basic = await supabase.rpc('admin_list_users')

        if (basic.error) {
          throw new Error(
            `Error al cargar usuarios: ${basic.error.message}`
          )
        }

        setLegacyMode(true)
        loadedUsers = (basic.data || []) as UserProfile[]
      }

      // Esta pantalla solo administra miembros de la empresa interna.
      // Los clientes empresariales se administran desde "Empresas clientes".
      const internalUsers = loadedUsers.filter(
        u =>
          u.company_id === ownCompanyId &&
          u.role !== 'admin' &&
          !u.archived
      )

      setUsers(internalUsers)

      if (!companiesRes.error && Array.isArray(companiesRes.data)) {
        const ownCompany = (
          companiesRes.data as CompanySummary[]
        ).filter(c => c.company_id === ownCompanyId)

        setCompanies(ownCompany)
      } else {
        setCompanies([])
      }

      if (currentUser?.role === 'admin') {
        const staffRes = await supabase.rpc('admin_listar_equipo_plataforma')
        if (!staffRes.error && Array.isArray(staffRes.data)) {
          setStaffNeedsMigration(false)
          setStaffMembers(staffRes.data as PlatformStaffMember[])
        } else if (
          staffRes.error &&
          /admin_listar_equipo_plataforma|does not exist|schema cache|42883|PGRST202/i.test(
            staffRes.error.message || ''
          )
        ) {
          setStaffNeedsMigration(true)
          setStaffMembers([])
        }
      }
    } catch (error) {
      setUsers([])
      setCompanies([])
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar los usuarios.',
      })
    } finally {
      setBusy(false)
      setLoading(false)
    }
  }, [canEdit, ownCompanyId, currentUser?.role])

  useEffect(() => {
    void load()
  }, [load])

  async function runRpc(
    fn: string,
    args: Record<string, unknown>,
    successMsg?: string
  ) {
    setBusy(true)
    setFeedback(null)

    try {
      const { error } = await supabase.rpc(fn, args)

      if (error) throw error

      if (successMsg) {
        setFeedback({ ok: true, text: successMsg })
      }

      await load()
      return true
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'No se pudo completar la operación.',
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  function openEditModal(u: UserProfile) {
    setFeedback(null)
    setEditTarget(u)

    setEditForm({
      full_name: u.full_name || '',
      role: u.role,
      company_id: ownCompanyId,
      active: u.active,
      avatar_url: u.avatar_url || null,
      national_id: u.national_id || '',
      phone: u.phone || '',
      job_title: u.job_title || '',
      zone: u.zone || '',
      address: u.address || '',
      emergency_contact: u.emergency_contact || '',
      hire_date: u.hire_date
        ? String(u.hire_date).slice(0, 10)
        : '',
      base_salary: String(Number(u.base_salary) || 0),
      commission_pct: String(Number(u.commission_pct) || 0),
      notes: u.notes || '',
    })
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault()

    if (!editTarget || !editForm) return

    // Nunca permitir modificar la empresa desde esta pantalla.
    if (editForm.company_id !== ownCompanyId) {
      setFeedback({
        ok: false,
        text: 'No puedes asignar usuarios a otra empresa desde este módulo.',
      })
      return
    }

    // Nunca permitir convertir un usuario en administrador global.
    if (editForm.role === 'admin') {
      setFeedback({
        ok: false,
        text: 'El rol de administrador global no se puede asignar desde Usuarios.',
      })
      return
    }

    setBusy(true)
    setFeedback(null)

    try {
      const { error } = await supabase.rpc(
        'admin_guardar_usuario_completo',
        {
          p_user_id: editTarget.id,
          p_full_name: editForm.full_name.trim() || null,
          p_role: editForm.role,
          p_company_id: ownCompanyId,
          p_active: editForm.active,
          p_avatar_url: editForm.avatar_url || null,
          p_national_id: editForm.national_id.trim() || null,
          p_phone: editForm.phone.trim() || null,
          p_job_title: editForm.job_title.trim() || null,
          p_zone: editForm.zone.trim() || null,
          p_address: editForm.address.trim() || null,
          p_emergency_contact:
            editForm.emergency_contact.trim() || null,
          p_hire_date: editForm.hire_date || null,
          p_base_salary: Math.max(
            0,
            Number(editForm.base_salary) || 0
          ),
          p_commission_pct: Math.min(
            100,
            Math.max(0, Number(editForm.commission_pct) || 0)
          ),
          p_notes: editForm.notes.trim() || null,
        }
      )

      if (error) {
        // Compatibilidad con instalaciones que todavía no tengan
        // disponible la función de edición completa.
        if (
          /admin_guardar_usuario_completo|schema cache|does not exist/i.test(
            error.message || ''
          )
        ) {
          if (
            editTarget.id !== currentUser?.id &&
            editForm.role !== editTarget.role
          ) {
            const roleResult = await supabase.rpc('admin_set_role', {
              p_user_id: editTarget.id,
              p_role: editForm.role,
            })

            if (roleResult.error) throw roleResult.error
          }

          if (
            editTarget.id !== currentUser?.id &&
            editForm.active !== editTarget.active
          ) {
            const activeResult = await supabase.rpc('admin_set_active', {
              p_user_id: editTarget.id,
              p_active: editForm.active,
            })

            if (activeResult.error) throw activeResult.error
          }

          setEditTarget(null)
          setEditForm(null)
          setFeedback({
            ok: true,
            text: 'Rol y estado actualizados. Para guardar fotografía y datos personales instala la migración de usuarios en Supabase.',
          })

          await load()
          return
        }

        throw error
      }

      setEditTarget(null)
      setEditForm(null)

      setFeedback({
        ok: true,
        text: `Perfil de ${editForm.full_name || editTarget.email} guardado correctamente.`,
      })

      if (editTarget.id === currentUser?.id) {
        await refreshUser()
      }

      await load()
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar el perfil.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return

    setBusy(true)
    setFeedback(null)

    try {
      const { data, error } = await supabase.rpc(
        'admin_eliminar_perfil',
        { p_user_id: deleteTarget.id }
      )

      if (error) {
        if (
          /admin_eliminar_perfil|does not exist/i.test(
            error.message || ''
          )
        ) {
          throw new Error(
            'Instala primero en Supabase la migración 20261101_vendedores_nomina_invitaciones_usuarios.sql.'
          )
        }

        throw error
      }

      setDeleteTarget(null)

      setFeedback({
        ok: true,
        text:
          (data as { message?: string } | null)?.message ||
          'Perfil eliminado o retirado de la plataforma.',
      })

      await load()
    } catch (error) {
      setFeedback({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'No se pudo eliminar el perfil.',
      })
    } finally {
      setBusy(false)
    }
  }

  function toggleActive(u: UserProfile) {
    if (u.id === currentUser?.id) return

    void runRpc(
      'admin_set_active',
      {
        p_user_id: u.id,
        p_active: !u.active,
      },
      `${u.full_name || u.email}: cuenta ${
        !u.active ? 'activada' : 'suspendida'
      }.`
    )
  }

  function openAssignStaffModal(existing?: PlatformStaffMember) {
    setFeedback(null)
    if (existing) {
      setStaffUserId(existing.user_id)
      setStaffCustomUuid('')
      setStaffRole(existing.staff_role)
      setStaffPermissions({
        manage_plans: Boolean(existing.permissions?.manage_plans),
        view_commercial_companies: Boolean(existing.permissions?.view_commercial_companies),
        support_inbox: Boolean(existing.permissions?.support_inbox),
        sql_diagnostics: Boolean(existing.permissions?.sql_diagnostics),
        audit_logs: Boolean(existing.permissions?.audit_logs),
      })
      setStaffNotes(existing.notes || '')
    } else {
      const firstCandidate = users.find(u => u.id !== currentUser?.id && u.active)
      setStaffUserId(firstCandidate?.id || '')
      setStaffCustomUuid('')
      setStaffRole('technician')
      setStaffPermissions({
        manage_plans: false,
        view_commercial_companies: true,
        support_inbox: true,
        sql_diagnostics: false,
        audit_logs: false,
      })
      setStaffNotes('')
    }
    setStaffModalOpen(true)
  }

  async function handleAssignPlatformStaff(e: React.FormEvent) {
    e.preventDefault()
    const targetId = (staffCustomUuid.trim() || staffUserId).trim()
    if (!targetId) {
      setFeedback({
        ok: false,
        text: 'Selecciona un usuario activo o ingresa su identificador UUID.',
      })
      return
    }

    setBusy(true)
    setFeedback(null)
    const { error } = await supabase.rpc('admin_asignar_personal_plataforma', {
      p_user_id: targetId,
      p_staff_role: staffRole,
      p_permissions: staffPermissions,
      p_notes: staffNotes.trim() || null,
    })
    setBusy(false)

    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }

    setStaffModalOpen(false)
    setFeedback({
      ok: true,
      text: `Integrante asignado al equipo de plataforma (${PLATFORM_STAFF_ROLE_LABELS[staffRole]}).`,
    })
    await load()
  }

  async function handleTogglePlatformStaffActive(member: PlatformStaffMember) {
    if (member.user_id === currentUser?.id || busy) return
    await runRpc(
      'admin_estado_personal_plataforma',
      {
        p_user_id: member.user_id,
        p_active: !member.active,
      },
      `${member.full_name || member.email}: acceso en equipo de plataforma ${
        !member.active ? 'reactivado' : 'suspendido'
      }.`
    )
  }

  const metrics = useMemo(() => {
    const owners = users.filter(u => u.role === 'dueno').length
    const sellers = users.filter(u => u.role === 'vendedor').length
    const attention = users.filter(
      u => !u.active || isSubExpired(u)
    ).length

    return {
      total: users.length,
      owners,
      sellers,
      attention,
    }
  }, [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return users.filter(u => {
      if (filter === 'dueno' && u.role !== 'dueno') return false
      if (filter === 'vendedor' && u.role !== 'vendedor') return false

      if (
        filter === 'attention' &&
        u.active &&
        !isSubExpired(u)
      ) {
        return false
      }

      if (!q) return true

      return (
        (u.full_name || '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.company_name || '').toLowerCase().includes(q) ||
        (u.national_id || '').toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q)
      )
    })
  }, [users, filter, search])

  function renderSubStatus(u: UserProfile) {
    if (u.role === 'tecnico') {
      return (
        <div className="text-xs">
          <p className="font-semibold text-emerald-700">Acceso técnico activo</p>
          <p className="text-[11px] text-slate-500">Soporte y sesiones autorizadas</p>
        </div>
      )
    }

    if (u.subscription_status === 'active') {
      const ok = u.subscription_end
        ? new Date(u.subscription_end).getTime() > Date.now()
        : true

      return (
        <div className="text-xs">
          <p
            className={`font-semibold ${
              ok ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {ok ? 'Hereda plan activo' : 'Plan de empresa vencido'}
          </p>
          <p className="text-[11px] text-slate-500 capitalize tabular-nums">
            {u.plan_type || 'Plan empresarial'}
            {u.subscription_end
              ? ` · vence ${fmtDate(u.subscription_end)}`
              : ''}
          </p>
        </div>
      )
    }

    if (u.subscription_status === 'trial') {
      const ok = u.trial_end
        ? new Date(u.trial_end).getTime() > Date.now()
        : false

      return (
        <div className="text-xs">
          <p
            className={`font-semibold ${
              ok ? 'text-amber-700' : 'text-red-600'
            }`}
          >
            {ok ? 'Hereda prueba gratuita' : 'Prueba de empresa vencida'}
          </p>
          {u.trial_end && (
            <p className="text-[11px] text-slate-500 tabular-nums">
              Hasta {fmtDate(u.trial_end)}
            </p>
          )}
        </div>
      )
    }

    return (
      <span className="text-xs font-semibold text-red-600">
        Sin acceso por suscripción
      </span>
    )
  }

  if (!canEdit) {
    return (
      <p className="text-sm text-slate-500">
        No tienes permiso para ver esta página.
      </p>
    )
  }

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-slate-600'

  const roleOptions: { value: Role; label: string }[] = [
    { value: 'vendedor' as Role, label: 'Vendedor' },
    { value: 'cajero' as Role, label: 'Cajero POS' },
    { value: 'almacen' as Role, label: 'Jefe de almacén' },
    { value: 'comprador' as Role, label: 'Compras y abastecimiento' },
    { value: 'transportador' as Role, label: 'Transporte y despacho' },
    { value: 'contador' as Role, label: 'Contador público (CPC)' },
    { value: 'gerente' as Role, label: 'Gerente operativo' },
    { value: 'admin_empresa' as Role, label: 'Administrador de empresa' },
    { value: 'dueno' as Role, label: 'Dueño de empresa' },
    { value: 'tecnico' as Role, label: 'Soporte técnico (sesiones autorizadas)' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Usuarios de la plataforma
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Personal interno de la empresa de pruebas. Los clientes empresariales
            se administran desde Empresas clientes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {currentUser?.role === 'admin' && (
            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab('internal')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === 'internal'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Personal interno ({users.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('platform_staff')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === 'platform_staff'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Equipo plataforma ({staffMembers.length})
              </button>
            </div>
          )}

          {activeTab === 'platform_staff' && currentUser?.role === 'admin' && (
            <button
              type="button"
              disabled={busy || staffNeedsMigration}
              onClick={() => openAssignStaffModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Asignar integrante
            </button>
          )}

          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`}
            />
            Sincronizar
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
        <div className="flex items-start gap-2">
          <Building2 className="w-4 h-4 mt-0.5 text-slate-600 shrink-0" />
          <div>
            <p className="font-semibold text-slate-900">
              {activeTab === 'platform_staff'
                ? 'Equipo global de plataforma (platform_staff)'
                : 'Directorio interno de pruebas'}
            </p>
            <p className="mt-0.5 text-slate-600">
              {activeTab === 'platform_staff'
                ? 'Gestiona especialistas técnicos, soporte, desarrolladores y equipo comercial de Inventario Pro sin alterar la empresa asignada ni conceder acceso a datos privados de terceros.'
                : 'Esta pantalla muestra únicamente los miembros de tu empresa interna de pruebas. Las empresas clientes y sus suscripciones se gestionan desde Empresas clientes.'}
            </p>
          </div>
        </div>
      </div>

      {legacyMode && activeTab === 'internal' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          La función principal de usuarios no está disponible. Revisa que la
          migración de administración de usuarios esté instalada en Supabase.
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-1 rounded hover:bg-black/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {activeTab === 'platform_staff' ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Integrantes del equipo global de plataforma
              </h2>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {staffMembers.length} registrados
            </span>
          </div>

          {staffNeedsMigration ? (
            <div className="p-6 text-xs text-amber-900 bg-amber-50">
              La tabla <strong>platform_staff</strong> y sus funciones RPC requieren aplicar la <strong>Migración 000045</strong> desde el Centro SQL.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs text-slate-500">
                    <th className="px-5 py-3 font-medium">Integrante</th>
                    <th className="px-4 py-3 font-medium">Rol de plataforma</th>
                    <th className="px-4 py-3 font-medium">Permisos funcionales</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-5 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffMembers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-xs text-slate-500">
                        Aún no has asignado integrantes al equipo global de plataforma. Pulsa «Asignar integrante» para registrar técnicos o gerentes operativos.
                      </td>
                    </tr>
                  ) : (
                    staffMembers.map(member => {
                      const activePermLabels = PLATFORM_PERMISSION_OPTIONS.filter(
                        opt => Boolean(member.permissions?.[opt.key])
                      ).map(opt => opt.label)

                      return (
                        <tr key={member.user_id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3.5">
                            <p className="font-semibold text-slate-900">
                              {member.full_name || 'Sin nombre'}
                            </p>
                            <p className="text-xs text-slate-500">{member.email}</p>
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                              {member.user_id.slice(0, 8)} · Perfil {getRoleLabel(member.profile_role)}
                            </p>
                          </td>

                          <td className="px-4 py-3.5 text-xs">
                            <p className="font-semibold text-slate-900">
                              {PLATFORM_STAFF_ROLE_LABELS[member.staff_role] || member.staff_role}
                            </p>
                            {member.notes && (
                              <p className="text-[11px] text-slate-500 mt-0.5 max-w-[220px] truncate">
                                {member.notes}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-3.5 text-xs text-slate-600 max-w-[280px]">
                            {activePermLabels.length > 0
                              ? activePermLabels.join(' · ')
                              : 'Solo consulta básica'}
                          </td>

                          <td className="px-4 py-3.5 text-xs">
                            <span
                              className={`font-semibold ${
                                member.active ? 'text-emerald-700' : 'text-red-600'
                              }`}
                            >
                              {member.active ? 'Activo' : 'Suspendido'}
                            </span>
                            {member.updated_at && (
                              <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                                {fmtDateTime(member.updated_at)}
                              </p>
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openAssignStaffModal(member)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Permisos
                              </button>
                              {member.user_id !== currentUser?.id && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleTogglePlatformStaffActive(member)}
                                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
                                    member.active
                                      ? 'border-amber-200 bg-white text-amber-800 hover:bg-amber-50'
                                      : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                  }`}
                                >
                                  {member.active ? 'Suspender' : 'Activar'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            filter === 'all'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <UsersIcon className="w-4 h-4 text-slate-700" />
              Todos los perfiles
            </span>
            <span className="text-[11px] text-slate-400">Filtrar</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.total}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Personal de la empresa interna
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFilter('dueno')}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            filter === 'dueno'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Building2 className="w-4 h-4 text-blue-600" />
              Dueños
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.owners}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Responsables de empresa
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFilter('vendedor')}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            filter === 'vendedor'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Vendedores
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.sellers}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Personal de ventas
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFilter('attention')}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            filter === 'attention'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Requieren atención
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.attention}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Suspendidos o sin acceso
          </p>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, correo, cédula o teléfono..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-slate-500"
            />
          </div>
          <p className="text-xs text-slate-500 tabular-nums">
            Mostrando {filtered.length} de {users.length} perfiles
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-5 py-3 font-medium">Perfil</th>
                <th className="px-4 py-3 font-medium">Identificación y contacto</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Acceso</th>
                <th className="px-4 py-3 font-medium">Plan heredado</th>
                <th className="px-5 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-slate-400 text-xs"
                  >
                    Cargando perfiles...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-slate-400 text-xs"
                  >
                    No se encontraron usuarios con ese criterio.
                  </td>
                </tr>
              ) : (
                filtered.map(u => {
                  const roleLabel = getRoleLabel(u.role)

                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            src={u.avatar_url}
                            name={u.full_name}
                            email={u.email}
                            size="md"
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate max-w-[210px]">
                              {u.full_name || 'Sin nombre'}
                            </p>
                            <p className="text-xs text-slate-500 truncate max-w-[210px]">
                              {u.email}
                            </p>
                            <p className="text-[11px] text-slate-400 tabular-nums">
                              Alta {fmtDate(u.created_at)}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        <p className="font-mono text-slate-700">
                          {u.national_id || 'Sin documento'}
                        </p>
                        <p className="text-slate-500 mt-0.5 tabular-nums">
                          {u.phone || 'Sin teléfono'}
                        </p>
                        {(u.job_title || u.zone) && (
                          <p className="text-[11px] text-slate-400 truncate max-w-[180px]">
                            {[u.job_title, u.zone]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-xs">
                        <p className="font-medium text-slate-900">
                          {roleLabel}
                        </p>
                      </td>

                      <td className="px-4 py-3.5 text-xs">
                        <span
                          className={`font-semibold ${
                            u.active
                              ? 'text-emerald-700'
                              : 'text-red-600'
                          }`}
                        >
                          {u.active ? 'Autorizado' : 'Suspendido'}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        {renderSubStatus(u)}
                      </td>

                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openEditModal(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Ficha
                          </button>

                          {u.id !== currentUser?.id && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => toggleActive(u)}
                                title={
                                  u.active
                                    ? 'Suspender acceso'
                                    : 'Activar acceso'
                                }
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {u.active ? (
                                  <ShieldOff className="w-3.5 h-3.5 text-amber-600" />
                                ) : (
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                )}
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setDeleteTarget(u)}
                                title="Eliminar o retirar perfil"
                                className="p-1.5 rounded-lg border border-slate-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editTarget && editForm && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !busy && setEditTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Ficha del usuario
                </h2>
                <p className="text-xs text-slate-500">
                  {editTarget.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSaveUser}
              className="p-5 space-y-5 max-h-[80vh] overflow-y-auto"
            >
              <AvatarCapture
                value={editForm.avatar_url}
                name={editForm.full_name}
                email={editTarget.email}
                onChange={avatar_url =>
                  setEditForm({ ...editForm, avatar_url })
                }
                disabled={busy}
              />

              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-900 mb-1">
                  Empresa y rol
                </p>
                <p className="text-[11px] text-slate-500 mb-3">
                  Este usuario pertenece a la empresa interna de pruebas.
                  La suscripción y los dispositivos se administran a nivel
                  empresarial.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Empresa asignada
                    </label>
                    <select
                      value={ownCompanyId}
                      disabled
                      className={`${inputCls} bg-slate-50 text-slate-500`}
                    >
                      {companies.map(c => (
                        <option
                          key={c.company_id}
                          value={c.company_id}
                        >
                          {c.company_name}
                        </option>
                      ))}
                      {companies.length === 0 && (
                        <option value={ownCompanyId}>
                          Empresa interna
                        </option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Rol del perfil
                    </label>
                    <select
                      value={editForm.role}
                      disabled={editTarget.id === currentUser?.id}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          role: e.target.value as Role,
                        })
                      }
                      className={inputCls}
                    >
                      {roleOptions.map(option => (
                        <option
                          key={String(option.value)}
                          value={option.value}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-900 mb-3">
                  Datos personales y de contacto
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Nombre completo
                    </label>
                    <input
                      required
                      value={editForm.full_name}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          full_name: e.target.value,
                        })
                      }
                      placeholder="Nombre y apellido"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Cédula / ID
                    </label>
                    <input
                      value={editForm.national_id}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          national_id: e.target.value,
                        })
                      }
                      placeholder="Documento de identidad"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      value={editForm.phone}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          phone: e.target.value,
                        })
                      }
                      placeholder="Teléfono"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Contacto de emergencia
                    </label>
                    <input
                      value={editForm.emergency_contact}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          emergency_contact: e.target.value,
                        })
                      }
                      placeholder="Familiar o referencia"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Cargo
                    </label>
                    <input
                      value={editForm.job_title}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          job_title: e.target.value,
                        })
                      }
                      placeholder="Ej. Vendedor de ruta"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Zona / Ruta
                    </label>
                    <input
                      value={editForm.zone}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          zone: e.target.value,
                        })
                      }
                      placeholder="Ej. Zona Centro"
                      className={inputCls}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Dirección
                    </label>
                    <input
                      value={editForm.address}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          address: e.target.value,
                        })
                      }
                      placeholder="Dirección física"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Fecha de ingreso
                    </label>
                    <input
                      type="date"
                      value={editForm.hire_date}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          hire_date: e.target.value,
                        })
                      }
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Salario base
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.base_salary}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          base_salary: e.target.value,
                        })
                      }
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Comisión (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editForm.commission_pct}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          commission_pct: e.target.value,
                        })
                      }
                      className={inputCls}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Notas de auditoría
                    </label>
                    <textarea
                      rows={3}
                      value={editForm.notes}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          notes: e.target.value,
                        })
                      }
                      placeholder="Observaciones internas..."
                      className={inputCls}
                    />
                  </div>
                </div>

                {editTarget.id !== currentUser?.id && (
                  <label className="flex items-center gap-2.5 mt-3 text-xs text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={editForm.active}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          active: e.target.checked,
                        })
                      }
                      className="rounded border-slate-300"
                    />
                    <span>Cuenta autorizada para iniciar sesión</span>
                  </label>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando...' : 'Guardar perfil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !busy && setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 p-5 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <UserAvatar
                  src={deleteTarget.avatar_url}
                  name={deleteTarget.full_name}
                  email={deleteTarget.email}
                  size="md"
                />
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Eliminar perfil
                  </h2>
                  <p className="text-xs text-slate-500">
                    {deleteTarget.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Se revocará el acceso del usuario. Si tiene operaciones
              históricas, el sistema debe conservar sus registros y
              archivarlo para no alterar la contabilidad.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Eliminando...' : 'Eliminar perfil'}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Modal para asignar o actualizar integrante en Equipo Global de Plataforma */}
      {staffModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !busy && setStaffModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Equipo global de plataforma
                </h2>
                <p className="text-xs text-slate-500">
                  Asigna funciones administrativas o técnicas de plataforma sin modificar empresas externas.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setStaffModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAssignPlatformStaff} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Usuario de tu empresa interna
                </label>
                <select
                  value={staffUserId}
                  onChange={e => setStaffUserId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Selecciona un usuario o escribe un UUID abajo...</option>
                  {users
                    .filter(u => u.id !== currentUser?.id && u.active)
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.full_name || u.email} ({u.email} · {getRoleLabel(u.role)})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  O identificador UUID directo del perfil (opcional)
                </label>
                <input
                  value={staffCustomUuid}
                  onChange={e => setStaffCustomUuid(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className={`${inputCls} font-mono`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Rol dentro del equipo de plataforma
                </label>
                <select
                  value={staffRole}
                  onChange={e => setStaffRole(e.target.value as PlatformStaffRole)}
                  className={inputCls}
                >
                  {(Object.entries(PLATFORM_STAFF_ROLE_LABELS) as [PlatformStaffRole, string][]).map(
                    ([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-700 mb-2">
                  Permisos operativos en consola
                </p>
                <div className="space-y-2 rounded-lg border border-slate-200 p-3 bg-slate-50/70">
                  {PLATFORM_PERMISSION_OPTIONS.map(opt => (
                    <label
                      key={opt.key}
                      className="flex items-center gap-2 text-xs text-slate-700 select-none"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(staffPermissions[opt.key])}
                        onChange={e =>
                          setStaffPermissions(prev => ({
                            ...prev,
                            [opt.key]: e.target.checked,
                          }))
                        }
                        className="rounded border-slate-300"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Observaciones o alcance (opcional)
                </label>
                <input
                  value={staffNotes}
                  onChange={e => setStaffNotes(e.target.value)}
                  placeholder="Ej. Técnico de soporte nivel 2 / Gestión comercial"
                  className={inputCls}
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStaffModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando...' : 'Guardar en equipo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
