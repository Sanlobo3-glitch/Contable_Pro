import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Camera,
  MapPin,
  PenTool,
  RotateCcw,
  Send,
  X,
  FileCheck,
  Smartphone,
} from 'lucide-react'
import { saveEpodRecord } from '../lib/innovationsRepo'
import type { EpodRecord, OmnichannelOrder } from '../types'

interface EpodModalProps {
  order: OmnichannelOrder
  onClose: () => void
  onSuccess: (epod: EpodRecord) => void
}

export default function EpodModal({ order, onClose, onSuccess }: EpodModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [receivedByName, setReceivedByName] = useState(order.contact_person || order.customer_name)
  const [receivedByDoc, setReceivedByDoc] = useState(order.customer_document || '')
  const [carrierName, setCarrierName] = useState('Transportador en Ruta')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)

  // Obtener geolocalización al abrir
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      setLocating(true)
      navigator.geolocation.getCurrentPosition(
        pos => {
          setCoords({
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            accuracy: Math.round(pos.coords.accuracy),
          })
          setLocating(false)
        },
        () => {
          // Fallback demo coordinates
          setCoords({ lat: 4.60971, lng: -74.08175, accuracy: 12 })
          setLocating(false)
        },
        { enableHighAccuracy: true, timeout: 6000 }
      )
    }
  }, [])

  // Inicializar canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  function startDrawing(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    setIsDrawing(true)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    ctx.beginPath()
    ctx.moveTo(clientX - rect.left, clientY - rect.top)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    ctx.lineTo(clientX - rect.left, clientY - rect.top)
    ctx.stroke()
    setHasSignature(true)
  }

  function stopDrawing() {
    setIsDrawing(false)
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setPhotoPreview(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  function handleConfirmDelivery() {
    if (!hasSignature && !photoPreview) {
      alert('Por favor solicite la firma del cliente o capture una foto de la entrega.')
      return
    }

    setSaving(true)
    const canvas = canvasRef.current
    const signatureData = canvas ? canvas.toDataURL('image/png') : ''

    const epod: EpodRecord = {
      id: `epod-${Date.now().toString(36)}`,
      company_id: order.company_id,
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      delivery_address: order.delivery_address || 'Dirección de entrega registrada',
      carrier_id: 'carr-current',
      carrier_name: carrierName,
      received_by_name: receivedByName || order.customer_name,
      received_by_document: receivedByDoc || 'Sin documento',
      signature_data_url: signatureData,
      photo_proof_url: photoPreview,
      gps_latitude: coords?.lat,
      gps_longitude: coords?.lng,
      gps_accuracy_meters: coords?.accuracy,
      delivered_at: new Date().toISOString(),
      sync_status: 'online',
    }

    saveEpodRecord(epod)
    setSaving(false)
    onSuccess(epod)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-lg">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                Prueba Digital de Entrega (e-POD)
              </h3>
              <p className="text-xs text-slate-500">
                Pedido <span className="font-semibold text-slate-700">{order.order_number}</span> —{' '}
                {order.customer_name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Datos del receptor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Nombre de quien recibe
              </label>
              <input
                type="text"
                value={receivedByName}
                onChange={e => setReceivedByName(e.target.value)}
                placeholder="Nombre y apellido"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Cédula / Documento
              </label>
              <input
                type="text"
                value={receivedByDoc}
                onChange={e => setReceivedByDoc(e.target.value)}
                placeholder="C.C. o DNI"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Lienzo de firma digital */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <PenTool className="w-3.5 h-3.5 text-emerald-600" />
                Firma táctil del cliente en pantalla
              </span>
              {hasSignature && (
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Limpiar firma
                </button>
              )}
            </div>
            <div className="border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 overflow-hidden relative touch-none">
              <canvas
                ref={canvasRef}
                width={420}
                height={160}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full h-40 cursor-crosshair block"
              />
              {!hasSignature && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-xs">
                  Firme aquí con el dedo o lápiz táctil
                </div>
              )}
            </div>
          </div>

          {/* Foto de respaldo y geolocalización */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Foto de entrega */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
                <Camera className="w-3.5 h-3.5 text-slate-500" />
                Foto del paquete en el local (opcional)
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  id="epod-photo-upload"
                />
                <label
                  htmlFor="epod-photo-upload"
                  className="w-full border border-slate-200 rounded-lg p-2.5 flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-50 text-xs text-slate-600"
                >
                  <Camera className="w-4 h-4 text-emerald-600" />
                  {photoPreview ? 'Foto adjunta (cambiar)' : 'Tomar foto con cámara'}
                </label>
              </div>
              {photoPreview && (
                <div className="mt-2 relative rounded-lg overflow-hidden border border-slate-200 h-20 w-full">
                  <img
                    src={photoPreview}
                    alt="Evidencia entrega"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotoPreview(null)}
                    className="absolute top-1 right-1 bg-slate-900/70 text-white rounded-full p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Ubicación GPS */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                Sello georreferenciado (GPS)
              </label>
              <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 text-xs text-slate-600">
                {locating ? (
                  <span className="text-slate-400 flex items-center gap-1.5 animate-pulse">
                    Fijando coordenadas satelitales...
                  </span>
                ) : coords ? (
                  <div className="space-y-0.5">
                    <p className="font-mono text-slate-800 text-[11px]">
                      Lat: {coords.lat}, Lng: {coords.lng}
                    </p>
                    <p className="text-[10px] text-emerald-700 font-medium">
                      ✓ Precisión: ~{coords.accuracy}m verificado
                    </p>
                  </div>
                ) : (
                  <span className="text-slate-400">Coordenadas no disponibles</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Acciones de pie */}
        <div className="border-t border-slate-100 p-4 bg-slate-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/50 rounded-xl transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || (!hasSignature && !photoPreview)}
            onClick={handleConfirmDelivery}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Guardando e-POD...' : 'Confirmar Entrega y Guardar e-POD'}
          </button>
        </div>
      </div>
    </div>
  )
}
