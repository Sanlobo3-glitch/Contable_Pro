import { useState, useRef, useEffect } from 'react'
import type { InventoryTransfer, Warehouse } from '../../types'
import { saveTransferEnrichment } from '../../lib/fleetRepo'
import {
  X,
  PenTool,
  CheckCircle2,
  Mail,
  MessageSquare,
  Printer,
  Download,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  UserCheck,
} from 'lucide-react'

interface DeliveryProofSignatureModalProps {
  transfer: InventoryTransfer
  sourceWarehouse?: Warehouse
  destWarehouse?: Warehouse
  onClose: () => void
  onSaved: () => void
}

export default function DeliveryProofSignatureModal({
  transfer,
  sourceWarehouse,
  destWarehouse,
  onClose,
  onSaved,
}: DeliveryProofSignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(Boolean(transfer.delivery_proof_signature))
  const [signatureData, setSignatureData] = useState<string | null>(
    transfer.delivery_proof_signature || null
  )

  const [receiverName, setReceiverName] = useState(transfer.receiver_name || '')
  const [receiverDoc, setReceiverDoc] = useState(transfer.receiver_document || '')
  const [condition, setCondition] = useState<'conforme' | 'con_observaciones' | 'averia_parcial'>(
    transfer.received_condition || 'conforme'
  )
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(true)
  const [notifyEmail, setNotifyEmail] = useState(true)
  const [whatsappNumber, setWhatsappNumber] = useState(
    transfer.delivery_confirmation_whatsapp || '+57 310 882 1940'
  )
  const [emailAddress, setEmailAddress] = useState(
    transfer.delivery_confirmation_email || 'despacho.central@contablepro.com'
  )

  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Configuración del canvas para firma
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (transfer.delivery_proof_signature) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      }
      img.src = transfer.delivery_proof_signature
    }
  }, [transfer.delivery_proof_signature])

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    ctx.beginPath()
    ctx.moveTo(clientX - rect.left, clientY - rect.top)
    setIsDrawing(true)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
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

  const stopDrawing = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    const canvas = canvasRef.current
    if (canvas) {
      setSignatureData(canvas.toDataURL('image/png'))
    }
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    setSignatureData(null)
  }

  const handleSaveProof = () => {
    if (!receiverName.trim() || !receiverDoc.trim()) {
      setFeedback('Ingresa el nombre completo y número de cédula/documento de quien recibe.')
      return
    }

    if (!hasSignature && !signatureData) {
      setFeedback('Es obligatoria la firma digital en pantalla para validar la entrega.')
      return
    }

    setSaving(true)
    const finalSig = signatureData || canvasRef.current?.toDataURL('image/png') || null

    saveTransferEnrichment(transfer.id, {
      delivery_proof_signature: finalSig,
      receiver_name: receiverName.trim(),
      receiver_document: receiverDoc.trim(),
      received_condition: condition,
      delivery_confirmation_sent: true,
      delivery_confirmation_whatsapp: notifyWhatsapp ? whatsappNumber : null,
      delivery_confirmation_email: notifyEmail ? emailAddress : null,
    })

    setSaving(false)
    setFeedback('¡Acta de entrega y firma registradas! Notificaciones enviadas correctamente.')
    setTimeout(() => {
      onSaved()
      onClose()
    }, 1000)
  }

  const handlePrintActa = () => {
    window.print()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Cabecera */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <PenTool className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Acta Digital de Entrega (ePOD) & Firma del Receptor
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Traslado #{transfer.id.slice(0, 8).toUpperCase()} · {sourceWarehouse?.name || 'Origen'} → {destWarehouse?.name || 'Destino'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {/* Datos del Receptor */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <h4 className="font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              Datos de Quien Recibe en Destino
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nombre Completo del Receptor <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={receiverName}
                  onChange={e => setReceiverName(e.target.value)}
                  placeholder="Ej. Marta Cecilia Domínguez"
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Documento de Identidad (C.C. / DNI) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={receiverDoc}
                  onChange={e => setReceiverDoc(e.target.value)}
                  placeholder="Ej. CC 52.894.102"
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 font-mono text-slate-900 font-medium"
                />
              </div>
            </div>

            {/* Condición de Entrega */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Estado y Conformidad de la Mercancía
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setCondition('conforme')}
                  className={`p-2.5 rounded-xl border text-center font-semibold transition-all ${
                    condition === 'conforme'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  ✅ Conforme 100%
                </button>
                <button
                  type="button"
                  onClick={() => setCondition('con_observaciones')}
                  className={`p-2.5 rounded-xl border text-center font-semibold transition-all ${
                    condition === 'con_observaciones'
                      ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-500/20'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  ⚠️ Observación Menor
                </button>
                <button
                  type="button"
                  onClick={() => setCondition('averia_parcial')}
                  className={`p-2.5 rounded-xl border text-center font-semibold transition-all ${
                    condition === 'averia_parcial'
                      ? 'border-red-500 bg-red-50 text-red-800 ring-2 ring-red-500/20'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  ❌ Avería / Faltante
                </button>
              </div>
            </div>
          </div>

          {/* Lienzo de Firma Digital */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-800 flex items-center gap-1.5">
                <PenTool className="w-4 h-4 text-slate-600" />
                Firma Digital en Pantalla del Receptor
              </label>
              <button
                type="button"
                onClick={clearSignature}
                className="text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1 text-[11px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Limpiar Firma
              </button>
            </div>

            <div className="border-2 border-slate-300 rounded-2xl overflow-hidden bg-white shadow-inner relative">
              <canvas
                ref={canvasRef}
                width={650}
                height={160}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full h-40 touch-none cursor-crosshair bg-slate-50/50"
              />
              {!hasSignature && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-slate-400">
                  <span className="text-xs font-medium border-b border-dashed border-slate-300 pb-1">
                    Firma aquí con el dedo o puntero táctil
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Opciones de Envío de Confirmación Inmediata */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <h4 className="font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-blue-600" />
              Notificación Inmediata de Entrega
            </h4>

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyWhatsapp}
                  onChange={e => setNotifyWhatsapp(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  Enviar confirmación por WhatsApp a supervisor / receptor:
                </span>
              </label>
              {notifyWhatsapp && (
                <input
                  type="text"
                  value={whatsappNumber}
                  onChange={e => setWhatsappNumber(e.target.value)}
                  placeholder="+57 310..."
                  className="w-full p-2 bg-white border border-slate-300 rounded-lg font-mono text-xs"
                />
              )}

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={e => setNotifyEmail(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  Enviar copia del acta por Correo Electrónico:
                </span>
              </label>
              {notifyEmail && (
                <input
                  type="email"
                  value={emailAddress}
                  onChange={e => setEmailAddress(e.target.value)}
                  placeholder="correo@empresa.com"
                  className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              )}
            </div>
          </div>

          {feedback && (
            <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-semibold text-center">
              {feedback}
            </div>
          )}
        </div>

        {/* Footer de Acciones */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handlePrintActa}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Imprimir Acta Oficial
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleSaveProof}
              className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {saving ? 'Guardando Acta...' : 'Firmar y Validar Entrega ePOD'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
