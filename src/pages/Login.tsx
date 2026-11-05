import { useEffect, useState } from 'react'
import { useAuth, captureInviteFromUrl, setPendingInviteCode } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { Package, LogIn, Mail, UserPlus, ArrowLeft, KeyRound, X } from 'lucide-react'
import PasswordInput from '../components/PasswordInput'

import type { DemoRole } from '../lib/supabase'

export default function Login({
  initialMode = 'login',
  onBack,
  onEnterDemo,
}: {
  initialMode?: 'login' | 'register' | 'forgot'
  onBack?: () => void
  onEnterDemo?: (targetPage?: string, role?: DemoRole) => void
}) {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(() => {
    const inv = captureInviteFromUrl()
    return inv ? 'register' : initialMode
  })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [inviteCode, setInviteCode] = useState<string>(() => captureInviteFromUrl() || '')
  const [showInviteInput, setShowInviteInput] = useState<boolean>(() => Boolean(captureInviteFromUrl()))
  const [inviteCompany, setInviteCompany] = useState<string | null>(null)
  const [inviteInvalid, setInviteInvalid] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const clean = inviteCode.trim()
    if (!clean) {
      setInviteCompany(null)
      setInviteInvalid(false)
      return
    }
    let alive = true
    supabase.rpc('info_invitacion', { p_code: clean }).then(({ data, error: err }) => {
      if (!alive) return
      if (err) {
        // Si la función SQL aún no fue ejecutada, mantenemos el código activo sin bloquear
        setInviteCompany(null)
        setInviteInvalid(false)
        return
      }
      if ((data as any)?.valid) {
        setInviteCompany((data as any).company_name || 'Empresa en InventarioPro')
        setInviteInvalid(false)
      } else {
        setInviteCompany(null)
        setInviteInvalid(true)
      }
    })
    return () => { alive = false }
  }, [inviteCode])

  function handleClearInvite() {
    setInviteCode('')
    setInviteCompany(null)
    setInviteInvalid(false)
    setPendingInviteCode(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const cleanInvite = inviteCode.trim()
    if ((mode === 'register' || mode === 'login') && cleanInvite && inviteInvalid) {
      setError('El código de invitación ingresado venció o no es válido. Pide un enlace nuevo al encargado o bórralo si estás creando tu propia empresa.')
      return
    }

    setLoading(true)
    if (cleanInvite) setPendingInviteCode(cleanInvite)

    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) setError(error)
    } else if (mode === 'register') {
      const { error } = await signUp(email, password, fullName, cleanInvite || null)
      if (error) setError(error)
      else if (cleanInvite) {
        setSuccess(
          `Cuenta de vendedor creada${inviteCompany ? ` para ${inviteCompany}` : ''}. Revisa tu correo, confirma tu cuenta e inicia sesión para entrar al equipo.`
        )
      } else {
        setSuccess('Cuenta creada. Revisa tu correo y confirma tu cuenta para iniciar tu prueba gratuita de 3 meses.')
      }
    } else if (mode === 'forgot') {
      const { error } = await resetPassword(email)
      if (error) setError(error)
      else setSuccess('Se ha enviado un enlace de recuperación a tu correo electrónico.')
    }
    setLoading(false)
  }

  const hasInvite = inviteCode.trim().length > 0

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm">
        {onBack && !hasInvite && (
          <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-800 mb-4">
            ← Volver al inicio
          </button>
        )}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center mb-4">
            <Package className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">InventarioPro</h1>
          <p className="text-sm text-slate-500 mt-1">
            {hasInvite ? 'Ingreso por invitación al equipo de ventas' : 'Gestión integral de inventario'}
          </p>
        </div>

        {hasInvite && (
          <div className={`mb-4 rounded-xl border p-3.5 text-xs ${inviteInvalid ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {inviteInvalid
                    ? 'Código de invitación vencido o no encontrado'
                    : inviteCompany
                      ? `Invitación activa: ${inviteCompany}`
                      : 'Invitación de vendedor detectada'}
                </p>
                <p className="mt-1 opacity-90">
                  {inviteInvalid
                    ? 'Solicita un enlace nuevo al dueño o administrador de la empresa.'
                    : mode === 'register'
                      ? `Al crear tu cuenta con el código ${inviteCode.trim()} entrarás directamente como Vendedor de esa empresa.`
                      : `Al iniciar sesión con el código ${inviteCode.trim()} tu cuenta quedará vinculada como Vendedor de esa empresa.`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearInvite}
                className="p-1 rounded hover:bg-black/5 shrink-0"
                title="Quitar código de invitación"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nombre completo</label>
              <input
                required
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Juan Pérez"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder={hasInvite ? 'vendedor@correo.com' : 'admin@empresa.com'}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
            />
          </div>

          {mode !== 'forgot' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
              <PasswordInput
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 6 : undefined}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
              />
            </div>
          )}

          {mode !== 'forgot' && (
            <div>
              {!showInviteInput && !hasInvite ? (
                <button
                  type="button"
                  onClick={() => setShowInviteInput(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  ¿Tienes un código de invitación de vendedor?
                </button>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Código de invitación de equipo (solo vendedores)
                  </label>
                  <input
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    placeholder="Ej: A1B2C3D4"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
                  />
                </div>
              )}
            </div>
          )}

          {mode === 'register' && (
            <label className="flex items-start gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                required
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Acepto los{' '}
                <a href="/terminos" target="_blank" rel="noreferrer" className="underline hover:text-slate-700">
                  Términos y condiciones
                </a>{' '}
                y la{' '}
                <a href="/privacidad" target="_blank" rel="noreferrer" className="underline hover:text-slate-700">
                  Política de privacidad
                </a>
                .
              </span>
            </label>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          {success && <p className="text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">{success}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {mode === 'login' && <LogIn className="w-4 h-4" />}
            {mode === 'register' && <UserPlus className="w-4 h-4" />}
            {mode === 'forgot' && <Mail className="w-4 h-4" />}
            {loading
              ? 'Procesando...'
              : mode === 'login'
                ? hasInvite
                  ? 'Iniciar sesión y unirme al equipo'
                  : 'Iniciar sesión'
                : mode === 'register'
                  ? hasInvite
                    ? 'Registrarme como vendedor'
                    : 'Crear cuenta'
                  : 'Enviar enlace'}
          </button>

          <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
            {mode === 'login' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register')
                    setError(null)
                    setSuccess(null)
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900 text-center"
                >
                  ¿No tienes cuenta? <span className="font-medium text-slate-900">Regístrate</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot')
                    setError(null)
                    setSuccess(null)
                  }}
                  className="text-sm text-slate-500 hover:text-slate-700 text-center"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </>
            )}
            {mode !== 'login' && (
              <button
                type="button"
                onClick={() => {
                  setMode('login')
                  setError(null)
                  setSuccess(null)
                  setPassword('')
                }}
                className="flex items-center justify-center gap-1 text-sm text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> ¿Ya tienes cuenta? Inicia sesión
              </button>
            )}
          </div>
        </form>

        {mode === 'register' && !hasInvite && (
          <p className="text-center text-xs text-slate-400 mt-3">
            Al registrarte como empresa obtienes un periodo de prueba gratuito de 3 meses.
          </p>
        )}

        {onEnterDemo && !hasInvite && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => onEnterDemo('dashboard', 'dueno')}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800 underline"
            >
              ¿Quieres probar primero? Entrar al sistema de demostración sin cuenta
            </button>
          </div>
        )}

        <p className="text-center text-[10px] text-slate-400 mt-6">
          <span className="font-semibold text-slate-500">Copyright</span> · Desarrollado por{' '}
          <span className="font-semibold text-slate-600">Richard J. Lobo S.</span>
        </p>
        <p className="text-center text-[10px] text-slate-400 mt-2">
          <a href="/terminos" className="underline hover:text-slate-600">
            Términos y condiciones
          </a>
          {' · '}
          <a href="/privacidad" className="underline hover:text-slate-600">
            Política de privacidad
          </a>
        </p>
      </div>
    </div>
  )
}
