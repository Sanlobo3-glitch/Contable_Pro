import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { UserPlus, Copy, Check, Share2, Trash2, Link2, ArrowUpRight } from 'lucide-react'
import { fmtDate } from '../lib/currency'

interface Invite {
  id: string
  code: string
  expires_at: string
  max_uses: number
  used_count: number
}

export default function InviteSellers({
  defaultOpen = false,
  onTeamChanged,
  onOpenPayroll,
}: {
  defaultOpen?: boolean
  onTeamChanged?: () => void
  onOpenPayroll?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [invites, setInvites] = useState<Invite[]>([])
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [existingEmail, setExistingEmail] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  const load = useCallback(async () => {
    const r = await supabase
      .from('company_invites')
      .select('id,code,expires_at,max_uses,used_count')
      .eq('active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    if (!r.error) setInvites((r.data || []) as Invite[])
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const link = (code: string) => `${window.location.origin}/?invite=${code}`

  const whatsappUrl = (code: string) => {
    const text = `Te invito a mi equipo de ventas en InventarioPro.\n1) Abre este enlace directo: ${link(code)}\n2) Completa tu nombre, correo y contraseña en «Registrarme como vendedor».\n3) Confirma tu correo e inicia sesión.\nCódigo de equipo: ${code}`
    return 'https://wa.me/?text=' + encodeURIComponent(text)
  }

  async function create() {
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: err } = await supabase.rpc('crear_invitacion', { p_days: 7, p_max_uses: 5 })
    setBusy(false)
    if (err || !(data as any)?.success) {
      setError(
        /crear_invitacion|schema cache|does not exist/i.test(err?.message || '')
          ? 'Falta instalar el SQL de invitaciones en Supabase.'
          : err?.message || 'No se pudo crear la invitación'
      )
      return
    }
    load()
  }

  async function revoke(id: string) {
    setError('')
    const { error: err } = await supabase.rpc('revocar_invitacion', { p_id: id })
    if (err) setError(err.message)
    else load()
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(link(code))
      setCopied(code)
      window.setTimeout(() => setCopied(''), 2000)
    } catch {
      setError('No se pudo copiar automáticamente. Selecciona y copia el enlace mostrado.')
    }
  }

  async function handleLinkExisting(e: React.FormEvent) {
    e.preventDefault()
    const clean = existingEmail.trim().toLowerCase()
    if (!clean) return
    setLinking(true)
    setError('')
    setNotice('')
    const { data, error: err } = await supabase.rpc('vincular_vendedor_existente', { p_email: clean })
    setLinking(false)
    if (err) {
      setError(
        /vincular_vendedor_existente|schema cache|does not exist/i.test(err.message || '')
          ? 'Ejecuta primero en Supabase el nuevo script SQL de Nómina e Invitaciones para vincular cuentas ya registradas.'
          : err.message
      )
      return
    }
    setExistingEmail('')
    setNotice((data as any)?.message || 'Vendedor vinculado exitosamente a tu empresa.')
    onTeamChanged?.()
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-left text-sm font-semibold text-slate-900"
        >
          <UserPlus className="w-4 h-4 text-slate-600 shrink-0" />
          <span>Invitar o vincular vendedores a tu empresa</span>
          <span className="text-xs font-normal text-slate-400">· {open ? 'Ocultar' : 'Mostrar'}</span>
        </button>

        {onOpenPayroll && (
          <button
            type="button"
            onClick={onOpenPayroll}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap shrink-0"
          >
            Ir a Nómina de vendedores
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>}
          {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">{notice}</p>}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Opción 1: Enlace para vendedores nuevos */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-800">1. Enlace para vendedores nuevos</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Al abrir el enlace se abre directamente el registro como vendedor de tu empresa (válido 7 días, hasta 5 cupos).
                </p>
              </div>
              <button
                type="button"
                onClick={create}
                disabled={busy}
                className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                {busy ? 'Creando enlace…' : 'Crear enlace de invitación'}
              </button>

              {invites.length === 0 ? (
                <p className="text-xs text-slate-400">No tienes enlaces activos en este momento.</p>
              ) : (
                <div className="space-y-2">
                  {invites.map(i => (
                    <div key={i.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs font-mono text-slate-700 break-all">{link(i.code)}</p>
                      <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                        Código {i.code} · usado {i.used_count} de {i.max_uses} · vence {fmtDate(i.expires_at)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5">
                        <button
                          type="button"
                          onClick={() => copy(i.code)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          {copied === i.code ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copied === i.code ? 'Copiado' : 'Copiar enlace'}
                        </button>
                        <a
                          href={whatsappUrl(i.code)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          WhatsApp
                        </a>
                        <button
                          type="button"
                          onClick={() => revoke(i.id)}
                          className="ml-auto p-1.5 text-slate-400 hover:text-red-600"
                          aria-label="Revocar invitación"
                          title="Revocar invitación"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Opción 2: Recuperar / vincular vendedor que ya se inscribió y quedó como dueño afuera */}
            <div className="lg:border-l lg:border-slate-100 lg:pl-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-slate-600" />
                  2. ¿Tu vendedor ya creó su cuenta y no aparece?
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Si se inscribió antes y el sistema lo dejó como dueño en una cuenta vacía, escribe su correo aquí para traerlo de inmediato como vendedor de tu empresa.
                </p>
              </div>
              <form onSubmit={handleLinkExisting} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  required
                  value={existingEmail}
                  onChange={e => setExistingEmail(e.target.value)}
                  placeholder="correo-del-vendedor@ejemplo.com"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:border-slate-500"
                />
                <button
                  type="submit"
                  disabled={linking || !existingEmail.trim()}
                  className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {linking ? 'Vinculando…' : 'Vincular a mi empresa'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
