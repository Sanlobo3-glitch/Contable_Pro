import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, Trash2, RefreshCw, X } from 'lucide-react'

function getInitials(name?: string | null, email?: string | null): string {
  const src = (name || email || 'U').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
  }
  return src.slice(0, 2).toUpperCase()
}

export function UserAvatar({
  src,
  name,
  email,
  size = 'md',
  className = '',
}: {
  src?: string | null
  name?: string | null
  email?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const dims =
    size === 'xs'
      ? 'w-7 h-7 text-[11px]'
      : size === 'sm'
        ? 'w-9 h-9 text-xs'
        : size === 'md'
          ? 'w-11 h-11 text-sm'
          : size === 'lg'
            ? 'w-16 h-16 text-lg'
            : 'w-20 h-20 text-xl'

  const validSrc = src && src.trim().length > 0 && !failed

  if (validSrc) {
    return (
      <img
        src={src!}
        alt={name || email || 'Foto de perfil'}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${dims} rounded-full object-cover border border-slate-200 bg-slate-100 shrink-0 ${className}`}
      />
    )
  }

  return (
    <div
      aria-label={name || email || 'Perfil'}
      className={`${dims} rounded-full bg-slate-900 text-white font-semibold flex items-center justify-center shrink-0 select-none ${className}`}
    >
      {getInitials(name, email)}
    </div>
  )
}

async function compressSquareImage(source: HTMLImageElement | HTMLVideoElement, maxDim = 320): Promise<string> {
  const rawW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth || source.width
  const rawH = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight || source.height
  if (!rawW || !rawH) throw new Error('No se pudo leer la imagen seleccionada.')

  const side = Math.min(rawW, rawH)
  const sx = Math.floor((rawW - side) / 2)
  const sy = Math.floor((rawH - side) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = maxDim
  canvas.height = maxDim
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No fue posible procesar la imagen.')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, maxDim, maxDim)
  ctx.drawImage(source, sx, sy, side, side, 0, 0, maxDim, maxDim)
  return canvas.toDataURL('image/jpeg', 0.82)
}

export default function AvatarCapture({
  value,
  name,
  email,
  onChange,
  disabled = false,
}: {
  value: string | null | undefined
  name?: string | null
  email?: string | null
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const mobileCamRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [camBusy, setCamBusy] = useState(false)
  const [err, setErr] = useState('')

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  useEffect(() => {
    return () => stopStream()
  }, [])

  async function startCamera(nextFacing: 'user' | 'environment' = facing) {
    setErr('')
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mobileCamRef.current?.click()
      return
    }
    setCamBusy(true)
    stopStream()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing, width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      })
      streamRef.current = stream
      setFacing(nextFacing)
      setCameraOpen(true)
      window.setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current
          videoRef.current.play().catch(() => {})
        }
      }, 40)
    } catch {
      stopStream()
      setCameraOpen(false)
      // Si el navegador bloquea la webcam directa o está en móvil restringido, abre el selector de cámara nativo
      mobileCamRef.current?.click()
    } finally {
      setCamBusy(false)
    }
  }

  function closeCamera() {
    stopStream()
    setCameraOpen(false)
  }

  async function takeSnapshot() {
    if (!videoRef.current) return
    try {
      const dataUrl = await compressSquareImage(videoRef.current, 320)
      onChange(dataUrl)
      closeCamera()
    } catch (e: any) {
      setErr(e?.message || 'No se pudo capturar la foto.')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr('')

    if (!file.type.startsWith('image/')) {
      setErr('Selecciona un archivo de imagen válido (JPG, PNG o WebP).')
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setErr('La imagen supera los 12 MB. Elige una foto más liviana.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = async () => {
        try {
          const compressed = await compressSquareImage(img, 320)
          onChange(compressed)
        } catch (ex: any) {
          setErr(ex?.message || 'No se pudo procesar la foto.')
        }
      }
      img.onerror = () => setErr('El archivo de imagen está dañado o no es compatible.')
      img.src = String(reader.result || '')
    }
    reader.onerror = () => setErr('No se pudo leer el archivo seleccionado.')
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar src={value} name={name} email={email} size="xl" />
        <div className="space-y-2 min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-700">Foto de identificación del perfil</p>
          <p className="text-[11px] text-slate-500">
            Toma una foto con la cámara o sube una imagen clara del rostro para identificar al miembro en la nómina.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled || camBusy}
              onClick={() => startCamera('user')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Camera className="w-3.5 h-3.5" />
              {camBusy ? 'Abriendo cámara...' : 'Tomar foto'}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              Subir foto
            </button>
            {value && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Quitar
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={mobileCamRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={handleFileChange}
        className="hidden"
      />

      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

      {cameraOpen && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950/70 flex items-center justify-center p-4"
          onClick={closeCamera}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Capturar foto de perfil</p>
              <button
                type="button"
                onClick={closeCamera}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar cámara"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="aspect-square w-full rounded-xl overflow-hidden bg-slate-900 relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => startCamera(facing === 'user' ? 'environment' : 'user')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Girar cámara
                </button>
                <button
                  type="button"
                  onClick={takeSnapshot}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                >
                  <Camera className="w-4 h-4" />
                  Capturar foto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
