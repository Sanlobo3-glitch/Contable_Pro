import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

/* Lector de códigos de barras con la cámara (usa el detector del propio navegador).
   Funciona en Chrome de Android y en la mayoría de navegadores de escritorio con Chrome/Edge.
   Se queda abierto para escanear varios productos seguidos: cada lectura llama a onDetect
   y el texto que devuelva se muestra como aviso (ej. «Agregado: Jean azul»). */

export default function BarcodeScanner({ onDetect, onClose }: {
  onDetect: (code: string) => string | void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const cb = useRef(onDetect)
  cb.current = onDetect
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    const BD = (window as any).BarcodeDetector
    if (!BD) {
      setError('Este navegador no puede leer códigos con la cámara. Usa Chrome en Android, o escribe el código / usa un lector USB.')
      return
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('No se puede acceder a la cámara en este navegador.')
      return
    }
    let stopped = false
    let timer = 0
    let stream: MediaStream | null = null

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        const v = videoRef.current
        if (!v) return
        v.srcObject = stream
        await v.play()
        const detector = new BD()
        let lastCode = ''
        let lastAt = 0
        const tick = async () => {
          if (stopped) return
          try {
            const found = await detector.detect(v)
            if (found && found.length > 0) {
              const raw = String(found[0].rawValue || '').trim()
              const now = Date.now()
              if (raw && (raw !== lastCode || now - lastAt > 2500)) {
                lastCode = raw
                lastAt = now
                try { navigator.vibrate(60) } catch { /* sin vibración */ }
                const msg = cb.current(raw)
                setInfo(typeof msg === 'string' && msg ? msg : raw)
              }
            }
          } catch { /* fotograma sin lectura */ }
          timer = window.setTimeout(tick, 250)
        }
        tick()
      } catch (e: any) {
        const name = String(e?.name || '')
        setError(name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Permiso de cámara denegado. Actívalo en los permisos del sitio y vuelve a intentarlo.'
          : 'No se pudo abrir la cámara: ' + (e?.message || name || 'error desconocido'))
      }
    }
    start()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="text-sm font-medium">Escanear código de barras</p>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20" aria-label="Cerrar"><X className="w-5 h-5" /></button>
      </div>
      <div className="relative flex-1 min-h-0">
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        {!error && <div className="absolute left-[10%] right-[10%] top-1/2 -translate-y-1/2 h-32 border-2 border-emerald-400 rounded-lg pointer-events-none" />}
        {error && <div className="absolute inset-0 flex items-center justify-center p-6"><p className="text-white text-sm text-center bg-red-600/80 rounded-lg p-4">{error}</p></div>}
      </div>
      <div className="px-4 py-4 text-center">
        <p className="text-emerald-300 text-sm min-h-[1.25rem]">{info}</p>
        <button onClick={onClose} className="mt-3 w-full bg-white text-slate-800 py-2.5 rounded-lg text-sm font-medium">Listo</button>
      </div>
    </div>
  )
}
