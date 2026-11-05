import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { currentEndpoint, disablePush, enablePush, hourLabel, pushSupported } from '../lib/push'

export default function PushSettings() {
  const [state, setState] = useState<'cargando' | 'no_soportado' | 'off' | 'on'>('cargando')
  const [hour, setHour] = useState(20)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [denied, setDenied] = useState(false)

  async function refresh() {
    if (!pushSupported()) { setState('no_soportado'); return }
    setDenied(Notification.permission === 'denied')
    const ep = await currentEndpoint()
    if (!ep) { setState('off'); return }
    const { data } = await supabase.rpc('push_my_status', { p_endpoint: ep })
    const s = data as { subscribed?: boolean; hour?: number } | null
    if (s?.subscribed) { setHour(Number(s.hour ?? 20)); setState('on') } else setState('off')
  }
  useEffect(() => { void refresh() }, [])

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(''), 6000) }

  async function turnOn() {
    setBusy(true)
    const r = await enablePush(hour)
    setBusy(false)
    if (!r.ok) { flash(r.message || 'No se pudo activar.'); await refresh(); return }
    flash(`Listo. Recibirás el resumen todos los días a las ${hourLabel(hour)}.`)
    await refresh()
  }
  async function turnOff() {
    setBusy(true); await disablePush(); setBusy(false); flash('Aviso desactivado en este teléfono.'); await refresh()
  }
  async function changeHour(h: number) {
    setHour(h)
    const ep = await currentEndpoint()
    if (!ep) return
    const { error } = await supabase.rpc('push_set_hour', { p_endpoint: ep, p_hour: h })
    flash(error ? 'No se pudo cambiar la hora: ' + error.message : `Hora cambiada: ${hourLabel(h)}.`)
  }

  if (state === 'cargando') return null
  return (
    <div className="no-print bg-white rounded-xl border border-slate-200 p-4 space-y-2">
      <div className="flex items-center gap-2"><BellRing className="w-4 h-4 text-slate-500" /><h3 className="text-sm font-bold text-slate-700">Aviso diario en tu celular</h3></div>
      {state === 'no_soportado' && <p className="text-xs text-slate-500">Este navegador no permite notificaciones. En Android usa Chrome.</p>}
      {state !== 'no_soportado' && (
        <>
          <p className="text-xs text-slate-500">Cada día te llega una notificación con lo vendido, la cartera vencida, lo que hay que reponer y los lotes por vencer.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-slate-500">Hora</label>
            <select value={hour} onChange={e => state === 'on' ? void changeHour(Number(e.target.value)) : setHour(Number(e.target.value))} className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            {state === 'off'
              ? <button onClick={turnOn} disabled={busy} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">{busy ? 'Activando…' : 'Activar aviso'}</button>
              : <button onClick={turnOff} disabled={busy} className="bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Desactivar</button>}
          </div>
          {state === 'on' && <p className="text-xs text-emerald-700">Activo en este teléfono.</p>}
          {denied && state === 'off' && <p className="text-xs text-amber-700">Las notificaciones están bloqueadas para este sitio. Actívalas en los ajustes del navegador y vuelve a intentar.</p>}
        </>
      )}
      {msg && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{msg}</p>}
    </div>
  )
}
