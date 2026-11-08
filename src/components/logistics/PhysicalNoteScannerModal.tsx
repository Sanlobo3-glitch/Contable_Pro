import { useState, useRef } from 'react'
import type { InventoryTransfer } from '../../types'
import { saveTransferEnrichment } from '../../lib/fleetRepo'
import {
  X,
  Camera,
  Upload,
  FileText,
  CheckCircle2,
  Eye,
  RotateCw,
  Download,
  AlertCircle,
  Sparkles,
} from 'lucide-react'

interface PhysicalNoteScannerModalProps {
  transfer: InventoryTransfer
  onClose: () => void
  onSaved: () => void
}

export default function PhysicalNoteScannerModal({
  transfer,
  onClose,
  onSaved,
}: PhysicalNoteScannerModalProps) {
  const [docImage, setDocImage] = useState<string | null>(
    transfer.physical_dispatch_note_url || null
  )
  const [docName, setDocName] = useState(
    transfer.physical_dispatch_note_name || `Remision_Fisica_TR_${transfer.id.slice(0, 8)}.jpg`
  )
  const [physicalRef, setPhysicalRef] = useState('')
  const [notes, setNotes] = useState('')
  const [rotation, setRotation] = useState(0)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setDocName(file.name)
    const reader = new FileReader()
    reader.onload = evt => {
      const result = evt.target?.result as string
      setDocImage(result)
    }
    reader.readAsDataURL(file)
  }

  const handleSave = () => {
    if (!docImage) {
      setStatusMessage('Debes capturar o adjuntar una fotografía del documento físico firmado.')
      return
    }

    setSaving(true)
    const now = new Date().toISOString()

    saveTransferEnrichment(transfer.id, {
      physical_dispatch_note_url: docImage,
      physical_dispatch_note_name: docName,
      physical_dispatch_note_date: now,
      notes: notes.trim()
        ? `${transfer.notes || ''} [Nota física: ${notes.trim()}]`.trim()
        : transfer.notes,
    })

    setSaving(false)
    setStatusMessage('¡Documento físico digitalizado y guardado exitosamente!')
    setTimeout(() => {
      onSaved()
      onClose()
    }, 800)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Cabecera */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Digitalizar Factura / Remisión Física Sellada
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Traslado #{transfer.id.slice(0, 8).toUpperCase()} · Respaldo inmutable en base de datos
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
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Instrucciones breves */}
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p>
              Toma una foto clara de la <strong>remisión de entrega física, factura o conduce</strong> con las firmas de
              recibido y sello de bodega. Esta imagen quedará archivada para cualquier auditoría de pérdidas o fraudes.
            </p>
          </div>

          {/* Área de Visualización / Captura */}
          {docImage ? (
            <div className="space-y-3">
              <div className="relative border-2 border-slate-300 rounded-xl bg-slate-100 p-2 overflow-hidden flex items-center justify-center min-h-[300px] max-h-[420px]">
                <img
                  src={docImage}
                  alt="Documento físico escaneado"
                  style={{ transform: `rotate(${rotation}deg)` }}
                  className="max-h-[380px] max-w-full object-contain transition-transform duration-200 rounded-lg shadow-sm"
                />

                {/* Acciones flotantes sobre la imagen */}
                <div className="absolute top-3 right-3 flex items-center gap-2 bg-slate-900/80 backdrop-blur p-1 rounded-lg">
                  <button
                    type="button"
                    title="Rotar 90 grados"
                    onClick={() => setRotation(r => (r + 90) % 360)}
                    className="p-1.5 text-white hover:bg-white/20 rounded transition-colors"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <a
                    href={docImage}
                    download={docName}
                    title="Descargar imagen"
                    className="p-1.5 text-white hover:bg-white/20 rounded transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    title="Cambiar fotografía"
                    onClick={() => setDocImage(null)}
                    className="p-1.5 text-red-300 hover:bg-red-500/30 rounded transition-colors text-xs font-semibold"
                  >
                    Reemplazar
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span className="font-mono">{docName}</span>
                {transfer.physical_dispatch_note_date && (
                  <span>
                    Subido:{' '}
                    {new Date(transfer.physical_dispatch_note_date).toLocaleDateString()}{' '}
                    {new Date(transfer.physical_dispatch_note_date).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-4 hover:border-slate-400 transition-colors bg-slate-50">
              <div className="w-14 h-14 mx-auto rounded-full bg-slate-200 text-slate-600 flex items-center justify-center">
                <FileText className="w-7 h-7" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800">Capturar o Subir Nota de Entrega</p>
                <p className="text-xs text-slate-500">
                  Usa la cámara de tu teléfono móvil o selecciona un archivo desde tu equipo
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                {/* Input de Cámara directa */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow"
                >
                  <Camera className="w-4 h-4 text-emerald-400" />
                  Tomar Foto con Cámara
                </button>

                {/* Input de Archivo / Galería */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm"
                >
                  <Upload className="w-4 h-4 text-slate-500" />
                  Cargar desde Galería / PDF
                </button>
              </div>
            </div>
          )}

          {/* Formulario de Metadatos Adicionales */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                N° de Guía o Factura Física Impresa
              </label>
              <input
                type="text"
                value={physicalRef}
                onChange={e => setPhysicalRef(e.target.value)}
                placeholder="Ej. REM-2026-9041"
                className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Observaciones del Documento Físico
              </label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ej. Sello nítido de recibido en portería..."
                className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {statusMessage && (
            <p className="text-xs font-semibold text-center text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">
              {statusMessage}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            Cerrar
          </button>

          <button
            type="button"
            disabled={saving || !docImage}
            onClick={handleSave}
            className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-lg shadow-blue-600/20 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Guardando...' : 'Guardar y Vincular al Traslado'}
          </button>
        </div>
      </div>
    </div>
  )
}
