import { useCallback, useEffect, useState } from 'react'
import { MapPin, X, Loader2, RefreshCw } from 'lucide-react'
import { getPosition, type GeoResult, type VisitCheckResult } from '../lib/geo'

const QUICK = ['Venta por llamada telefónica', 'Venta en sede o sucursal', 'Entrega a domicilio', 'Otro motivo']

const VISIT_QUICK = ['Aún tiene inventario', 'Encargado ausente', 'Local cerrado', 'Precio alto', 'Prefiere otro proveedor', 'Otro motivo']

export { VISIT_QUICK }

export default function VisitCheck({ open, title = 'Confirmar ubicación', requireNote = false, quick = QUICK, noteLabel = 'Observación (obligatoria)', placeholder = 'Ej: venta por llamada telefónica', confirmLabel = 'Confirmar y registrar', onCancel, onDone }: {
  open: boolean
  title?: string
  requireNote?: boolean
  quick?: string[]
  noteLabel?: string
  placeholder?: string
  confirmLabel?: string
  onCancel: () => void
  onDone: (r: VisitCheckResult) => void
}) {
  const [geo, setGeo] = useState<GeoResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [atSite, setAtSite] = useState<boolean | null>(null)
  const [note, setNote] = useState('')

  const locate = useCallback(async () => {
    setLoading(true); setGeo(null)
    const g = await getPosition()
    setGeo(g); setLoading(false)
  }, [])

  useEffect(() => {
    if (open) { setAtSite(null); setNote(''); locate() }
  }, [open, locate])

  if (!open) return null

  const gpsOk = geo?.status === 'ok'
  const lowAccuracy = gpsOk && (geo?.accuracy ?? 0) > 100
  const noteRequired = requireNote || atSite === false || (!!geo && !gpsOk)
  const canConfirm = !loading && !!geo && (gpsOk ? atSite !== null : true) && (!noteRequired || note.trim().length >= 3)

  function confirm() {
    if (!geo || !canConfirm) return
    onDone({
      gps_status: geo.status,
      lat: gpsOk ? geo.lat ?? null : null,
      lng: gpsOk ? geo.lng ?? null : null,
      accuracy: gpsOk ? geo.accuracy ?? null : null,
      at_establishment: gpsOk ? atSite : null,
      note: note.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-800 flex items-center gap-2"><MapPin className="w-4 h-4" /> {title}</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-3 mb-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Obteniendo ubicación…
          </div>
        )}

        {!loading && geo && gpsOk && (
          <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${lowAccuracy ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            Ubicación obtenida (precisión ±{Math.round(geo.accuracy ?? 0)} m).
            {lowAccuracy && ' La precisión es baja; sal a un lugar abierto y reintenta si puedes.'}
          </div>
        )}

        {!loading && geo && !gpsOk && (
          <div className="text-xs rounded-lg px-3 py-2 mb-3 bg-red-50 text-red-700">
            {geo.status === 'denied'
              ? 'No diste permiso de ubicación. Actívalo en el navegador (icono del candado) y reintenta.'
              : 'No se pudo obtener la ubicación. Revisa que el GPS esté encendido.'}
            {' '}Si continúas sin ubicación, debes escribir una observación.
          </div>
        )}

        {!loading && geo && (
          <button onClick={locate} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 mb-3">
            <RefreshCw className="w-3 h-3" /> Reintentar ubicación
          </button>
        )}

        {gpsOk && (
          <div className="mb-3">
            <p className="text-sm font-medium text-slate-800 mb-2">¿Estás en el establecimiento del cliente?</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setAtSite(true)} className={`py-2 rounded-lg text-sm font-medium border ${atSite === true ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>Sí</button>
              <button onClick={() => setAtSite(false)} className={`py-2 rounded-lg text-sm font-medium border ${atSite === false ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>No</button>
            </div>
          </div>
        )}

        {noteRequired && (
          <div className="mb-3">
            <p className="text-xs font-medium text-slate-600 mb-1">{noteLabel}</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {quick.map(q => (
                <button key={q} onClick={() => setNote(q)} className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">{q}</button>
              ))}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={placeholder} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
        )}

        <button onClick={confirm} disabled={!canConfirm} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">
          {confirmLabel}
        </button>
        <p className="text-[11px] text-slate-400 mt-2">La ubicación se registra solo en este momento. Solo el dueño o el administrador pueden verla.</p>
      </div>
    </div>
  )
}
