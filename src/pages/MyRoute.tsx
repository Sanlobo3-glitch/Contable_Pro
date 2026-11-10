import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { setRouteCustomerHandoff } from '../lib/routeHandoff'
import { Navigation, Check, SkipForward, Undo2, RefreshCw, MapPin, Phone, ShoppingCart, Truck } from 'lucide-react'

interface Stop {
  stop_id: string
  seq: number
  status: 'pendiente' | 'visitado' | 'omitido'
  customer_id: string
  name: string
  address: string | null
  phone: string | null
  lat: number | null
  lng: number | null
  planned_km: number
}

const todayStr = () => new Date().toLocaleDateString('sv-SE')

export default function MyRoute({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [stops, setStops] = useState<Stop[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    const { data, error: err } = await supabase.rpc('mi_ruta_hoy', { p_date: todayStr() })
    if (err) {
      setError(
        /mi_ruta_hoy|schema cache|does not exist/i.test(err.message)
          ? 'La función de rutas aún no está instalada en el servidor.'
          : err.message
      )
    } else {
      setStops((data || []) as Stop[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  async function mark(id: string, status: Stop['status']) {
    setBusy(id)
    const { error: err } = await supabase.rpc('route_stop_set_status', { p_stop: id, p_status: status })
    setBusy(null)
    if (err) {
      setError(err.message)
      return
    }
    setStops(prev => prev.map(s => (s.stop_id === id ? { ...s, status } : s)))
  }

  function goToCustomerAction(s: Stop, action: 'sale' | 'visit') {
    setRouteCustomerHandoff({
      customerId: s.customer_id,
      customerName: s.name,
      action,
      stopId: s.stop_id,
    })
    onNavigate?.('sales')
  }

  const done = stops.filter(s => s.status !== 'pendiente').length
  const next = stops.find(s => s.status === 'pendiente')
  const km = stops.reduce((a, s) => a + (Number(s.planned_km) || 0), 0)
  const nav = (s: Stop) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <MapPin className="w-5 h-5" /> Mi ruta de hoy
          </h1>
          <p className="text-sm text-slate-500 mt-1 tabular-nums">
            {stops.length > 0
              ? `${done} de ${stops.length} paradas completadas · ${km.toFixed(1)} km planificados`
              : 'Tu ruta de clientes asignada para hoy'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('dispatch')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Truck className="w-3.5 h-3.5" />
              Mi carga de ruta
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            aria-label="Actualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {stops.length > 0 && (
        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
          <div
            className="h-full bg-emerald-600 transition-transform"
            style={{ width: `${(done / stops.length) * 100}%` }}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Cargando paradas...</p>}
      {!loading && !error && stops.length === 0 && (
        <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-4">
          Hoy no tienes paradas programadas. Tu encargado puede asignarlas desde «Planificar rutas».
        </p>
      )}

      <div className="space-y-2.5">
        {stops.map(s => {
          const isNext = next?.stop_id === s.stop_id
          return (
            <div
              key={s.stop_id}
              className={`rounded-xl border p-3.5 ${
                s.status === 'visitado'
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : s.status === 'omitido'
                    ? 'bg-slate-50 border-slate-200 opacity-70'
                    : isNext
                      ? 'bg-white border-slate-900 ring-1 ring-slate-900'
                      : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                  {s.seq}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                  {s.address && <p className="text-xs text-slate-500">{s.address}</p>}
                  {isNext && <p className="text-[11px] font-medium text-slate-700 mt-0.5">Siguiente parada sugerida</p>}
                </div>
                {s.status !== 'pendiente' && (
                  <span className="text-xs font-medium text-slate-600">
                    {s.status === 'visitado' ? 'Visitado' : 'Omitido'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {s.lat != null && s.lng != null && (
                  <a
                    href={nav(s)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs font-medium hover:bg-slate-50"
                  >
                    <Navigation className="w-3.5 h-3.5" /> Mapa
                  </a>
                )}
                {s.phone && (
                  <a
                    href={`https://wa.me/${s.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${s.name}, te saludo de Contable Pro. Estoy en ruta hacia tu negocio.`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium hover:bg-emerald-100"
                  >
                    💬 WhatsApp
                  </a>
                )}
                {s.phone && (
                  <a
                    href={`tel:${s.phone}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50"
                  >
                    <Phone className="w-3.5 h-3.5" /> Llamar
                  </a>
                )}
                {s.status === 'pendiente' ? (
                  <>
                    <button
                      type="button"
                      disabled={busy === s.stop_id}
                      onClick={() => {
                        setRouteCustomerHandoff({
                          customerId: s.customer_id,
                          customerName: s.name,
                          action: 'sale',
                          stopId: s.stop_id,
                        })
                        onNavigate?.('pos')
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-sm"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" /> Vender en POS
                    </button>
                    <button
                      type="button"
                      disabled={busy === s.stop_id}
                      onClick={() => goToCustomerAction(s, 'sale')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
                    >
                      Factura Completa
                    </button>
                    <button
                      type="button"
                      disabled={busy === s.stop_id}
                      onClick={() => void mark(s.stop_id, 'visitado')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-50"
                    >
                      <Check className="w-3.5 h-3.5" /> Visitado
                    </button>
                    <button
                      type="button"
                      disabled={busy === s.stop_id}
                      onClick={() => void mark(s.stop_id, 'omitido')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs font-medium hover:bg-slate-50"
                    >
                      <SkipForward className="w-3.5 h-3.5" /> Omitir
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy === s.stop_id}
                    onClick={() => void mark(s.stop_id, 'pendiente')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs font-medium hover:bg-slate-50"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Deshacer
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-slate-400">
        Al pulsar «Vender aquí» o «Registrar visita» se abre automáticamente el cliente de la parada seleccionada.
      </p>
    </div>
  )
}
