import { useEffect, useRef, useState } from 'react'
import type { InventoryTransfer, InventoryTransferItem, Product } from '../../types'
import {
  X,
  Scan,
  Camera,
  Barcode,
  CheckCircle2,
  AlertTriangle,
  Package,
  Plus,
  Minus,
  Sparkles,
  Search,
  Check,
} from 'lucide-react'

interface ArrivalBarcodeScannerModalProps {
  transfer: InventoryTransfer
  items: InventoryTransferItem[]
  products: Product[]
  onClose: () => void
  onConfirmVerification: (verifiedResults: {
    product_id: string
    received_quantity: number
    damaged_quantity: number
    missing_quantity: number
    notes: string
  }[]) => void
}

interface ItemScanState {
  product_id: string
  name: string
  sku: string
  expected: number
  scanned: number
  damaged: number
  notes: string
}

export default function ArrivalBarcodeScannerModal({
  transfer,
  items,
  products,
  onClose,
  onConfirmVerification,
}: ArrivalBarcodeScannerModalProps) {
  const [scanState, setScanState] = useState<ItemScanState[]>(() => {
    const productMap = new Map(products.map(p => [p.id, p]))
    return items.map(it => {
      const prod = productMap.get(it.product_id)
      return {
        product_id: it.product_id,
        name: prod?.name || 'Producto Desconocido',
        sku: prod?.sku || it.product_id.slice(0, 8),
        expected: Number(it.quantity) || 0,
        scanned: 0,
        damaged: 0,
        notes: '',
      }
    })
  })

  const [activeBarcodeMode, setActiveBarcodeMode] = useState<'camera' | 'manual'>('manual')
  const [manualInput, setManualInput] = useState('')
  const [lastScannedMessage, setLastScannedMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const manualInputRef = useRef<HTMLInputElement>(null)

  // Enfocar entrada manual al abrir
  useEffect(() => {
    manualInputRef.current?.focus()
  }, [])

  // Proceso de escaneo / coincidencia por código de barras o SKU
  const handleProcessBarcode = (code: string) => {
    const clean = code.trim().toLowerCase()
    if (!clean) return

    // Buscar si coincide con el SKU de algún producto o con el nombre o código
    const foundIdx = scanState.findIndex(
      item =>
        item.sku.toLowerCase() === clean ||
        item.product_id.toLowerCase() === clean ||
        item.name.toLowerCase().includes(clean)
    )

    if (foundIdx >= 0) {
      setScanState(prev => {
        const next = [...prev]
        const target = { ...next[foundIdx] }
        if (target.scanned < target.expected) {
          target.scanned += 1
          setLastScannedMessage({
            ok: true,
            text: `✅ +1 verificado: ${target.name} (${target.scanned}/${target.expected})`,
          })
          try {
            navigator.vibrate?.(80)
          } catch {
            /* ignore */
          }
        } else {
          setLastScannedMessage({
            ok: false,
            text: `⚠️ ${target.name} ya alcanzó la cantidad total esperada (${target.expected})`,
          })
        }
        next[foundIdx] = target
        return next
      })
    } else {
      setLastScannedMessage({
        ok: false,
        text: `❌ Código «${code}» no coincide con los productos de este traslado`,
      })
    }
  }

  // Cámara para escáner si el usuario lo activa
  useEffect(() => {
    if (activeBarcodeMode !== 'camera') return

    const BarcodeDetectorClass = (window as any).BarcodeDetector
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false

    async function initCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError('Este navegador no tiene acceso a la cámara')
          return
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })

        if (stopped) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        if (BarcodeDetectorClass) {
          const detector = new BarcodeDetectorClass({
            formats: ['code_128', 'ean_13', 'ean_8', 'qr_code', 'upc_a'],
          })
          let lastCode = ''
          let lastTime = 0

          const scanFrame = async () => {
            if (stopped) return
            try {
              if (videoRef.current) {
                const barcodes = await detector.detect(videoRef.current)
                if (barcodes && barcodes.length > 0) {
                  const raw = String(barcodes[0].rawValue || '').trim()
                  const now = Date.now()
                  if (raw && (raw !== lastCode || now - lastTime > 2000)) {
                    lastCode = raw
                    lastTime = now
                    handleProcessBarcode(raw)
                  }
                }
              }
            } catch {
              /* ignore error frame */
            }
            timer = window.setTimeout(scanFrame, 250)
          }
          scanFrame()
        } else {
          setCameraError('El detector de código de barras por hardware no está disponible en este navegador. Usa la entrada manual o pistola lectora USB.')
        }
      } catch (err: any) {
        setCameraError('No se pudo iniciar la cámara: ' + (err.message || 'Error'))
      }
    }

    initCamera()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
  }, [activeBarcodeMode])

  const totalExpected = scanState.reduce((sum, item) => sum + item.expected, 0)
  const totalScanned = scanState.reduce((sum, item) => sum + item.scanned, 0)
  const progressPct = totalExpected > 0 ? Math.round((totalScanned / totalExpected) * 100) : 0
  const isAllVerified = scanState.every(it => it.scanned + it.damaged >= it.expected)

  // Pasar a la confirmación de recepción
  const handleComplete = () => {
    const results = scanState.map(it => {
      const received = it.scanned
      const damaged = it.damaged
      const missing = Math.max(0, it.expected - (received + damaged))
      return {
        product_id: it.product_id,
        received_quantity: received,
        damaged_quantity: damaged,
        missing_quantity: missing,
        notes: it.notes.trim(),
      }
    })
    onConfirmVerification(results)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Cabecera */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Scan className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Escáner de Llegada al Sitio · #{transfer.id.slice(0, 8).toUpperCase()}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Verificación física ítem por ítem de la mercancía descargada del vehículo en destino
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

        {/* Barra de progreso global */}
        <div className="bg-slate-100 px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black text-slate-900 tabular-nums">{totalScanned}</span>
              <span className="text-xs text-slate-500">/ {totalExpected} unidades verificadas</span>
            </div>
            <span
              className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                progressPct === 100
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {progressPct}% Completado
            </span>
          </div>

          {/* Selector de modo: Pistola / Manual vs Cámara */}
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setActiveBarcodeMode('manual')}
              className={`px-3 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-colors ${
                activeBarcodeMode === 'manual'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Barcode className="w-3.5 h-3.5" />
              Lector USB / Manual
            </button>
            <button
              type="button"
              onClick={() => setActiveBarcodeMode('camera')}
              className={`px-3 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-colors ${
                activeBarcodeMode === 'camera'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              Cámara Móvil
            </button>
          </div>
        </div>

        {/* Zona de captura / escaneo */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeBarcodeMode === 'camera' ? (
            <div className="bg-slate-900 rounded-xl overflow-hidden relative min-h-[220px] max-h-[260px] flex items-center justify-center">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover max-h-[260px]" />
              <div className="absolute inset-0 border-2 border-emerald-400/70 pointer-events-none rounded-xl m-6 flex items-center justify-center">
                <span className="text-[11px] font-semibold text-white bg-slate-900/80 px-2.5 py-1 rounded">
                  Apunta al código de barras o QR del producto
                </span>
              </div>
              {cameraError && (
                <div className="absolute inset-0 bg-slate-900/90 flex items-center justify-center p-4 text-center">
                  <p className="text-xs text-amber-400">{cameraError}</p>
                </div>
              )}
            </div>
          ) : (
            <form
              onSubmit={e => {
                e.preventDefault()
                handleProcessBarcode(manualInput)
                setManualInput('')
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  placeholder="Escanea con pistola lectora o digita SKU / Nombre y presiona Enter..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors shrink-0"
              >
                Verificar
              </button>
            </form>
          )}

          {/* Mensaje de feedback de último escaneo */}
          {lastScannedMessage && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between transition-all ${
                lastScannedMessage.ok
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              <span>{lastScannedMessage.text}</span>
              <button
                type="button"
                onClick={() => setLastScannedMessage(null)}
                className="text-slate-400 hover:text-slate-700 ml-2"
              >
                &times;
              </button>
            </div>
          )}

          {/* Lista de productos para verificación */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Package className="w-4 h-4 text-slate-500" />
              Productos en el Documento de Traslado
            </h4>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
              {scanState.map((item, idx) => {
                const complete = item.scanned >= item.expected
                const hasDamaged = item.damaged > 0
                return (
                  <div
                    key={item.product_id}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      complete ? 'bg-emerald-50/40' : ''
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm">{item.name}</span>
                        <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                          SKU: {item.sku}
                        </span>
                        {complete && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" /> Verificado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Cantidad despachada por origen:{' '}
                        <strong className="text-slate-800">{item.expected}</strong> unidades
                      </p>
                    </div>

                    {/* Controles de conteo rápido y averías */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Control de unidades recibidas */}
                      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => {
                            setScanState(prev => {
                              const next = [...prev]
                              next[idx] = { ...next[idx], scanned: Math.max(0, next[idx].scanned - 1) }
                              return next
                            })
                          }}
                          className="w-7 h-7 bg-white text-slate-700 hover:bg-slate-200 rounded flex items-center justify-center font-bold text-xs"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>

                        <span className="w-12 text-center font-mono font-bold text-sm text-slate-900">
                          {item.scanned}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            setScanState(prev => {
                              const next = [...prev]
                              next[idx] = { ...next[idx], scanned: next[idx].scanned + 1 }
                              return next
                            })
                          }}
                          className="w-7 h-7 bg-white text-slate-700 hover:bg-slate-200 rounded flex items-center justify-center font-bold text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Botón rápido: Validar todo */}
                      <button
                        type="button"
                        onClick={() => {
                          setScanState(prev => {
                            const next = [...prev]
                            next[idx] = { ...next[idx], scanned: next[idx].expected }
                            return next
                          })
                        }}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                      >
                        Todo OK
                      </button>

                      {/* Registro de avería */}
                      <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                        <label className="text-[11px] text-amber-700 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          Averías:
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={item.expected}
                          value={item.damaged || ''}
                          placeholder="0"
                          onChange={e => {
                            const val = Math.max(0, parseInt(e.target.value) || 0)
                            setScanState(prev => {
                              const next = [...prev]
                              next[idx] = { ...next[idx], damaged: val }
                              return next
                            })
                          }}
                          className="w-12 p-1 text-center font-mono text-xs border border-amber-300 rounded bg-amber-50/50"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer de Acciones */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setScanState(prev =>
                  prev.map(it => ({
                    ...it,
                    scanned: it.expected,
                  }))
                )
              }}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50"
            >
              Verificar Todos Automáticamente
            </button>

            <button
              type="button"
              onClick={handleComplete}
              className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Confirmar Verificación y Pasar a Recepción
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
