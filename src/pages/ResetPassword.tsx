import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { KeyRound } from 'lucide-react'
import PasswordInput from '../components/PasswordInput'

export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true)
    const { error } = await updatePassword(password)
    if (error) setError(error); else setDone(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-slate-800 mb-4">Nueva contraseña</h1>
        {done ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
            Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordInput value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="Nueva contraseña" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
              <KeyRound className="w-4 h-4" />{loading ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
