import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Upload,
  Trash2,
  RefreshCw,
  X,
  Package,
  ZoomIn,
  ZoomOut,
  Plus,
  Maximize2,
  Crop,
  AlertTriangle,
  Database,
} from 'lucide-react'
import {
  getProductMonogram,
  processProductImageSource,
  uploadOrInlineProductImage,
  ProductImagePersistenceError,
  type ImageFramingMode,
} from '../lib/productImages'
import SqlActivationModal from './SqlActivationModal'
import { useBackOverlay } from '../lib/navigation'

export function ProductThumb({
  src,
  name,
  size = 'sm',
  fit = 'cover',
  className = '',
}: {
  src?: string | null
  name?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'card'
  fit?: 'cover' | 'contain'
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const dims =
    size === 'xs'
      ? 'w-8 h-8 rounded-md text-[10px]'
      : size === 'sm'
        ? 'w-10 h-10 rounded-lg text-xs'
        : size === 'md'
          ? 'w-14 h-14 rounded-lg text-sm'
          : size === 'lg'
            ? 'w-20 h-20 rounded-xl text-base'
            : 'w-full aspect-[4/3] rounded-t-xl text-lg'

  const valid = src && src.trim().length > 0 && !failed
  const fitCls = fit === 'contain' ? 'object-contain p-1 bg-white' : 'object-cover bg-slate-100'

  if (valid) {
    return (
      <img
        src={src!}
        alt={name || 'Producto'}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${dims} ${fitCls} border border-slate-200/80 shrink-0 ${className}`}
      />
    )
  }

  return (
    <div
      aria-label={name || 'Producto'}
      className={`${dims} bg-slate-100 text-slate-500 border border-slate-200/80 flex flex-col items-center justify-center shrink-0 select-none ${className}`}
    >
      {size === 'card' ? (
        <div className="flex flex-col items-center gap-1.5 text-slate-400">
          <Package className="w-7 h-7 stroke-[1.5]" />
          <span className="text-xs font-semibold tracking-wide text-slate-500">
            {getProductMonogram(name)}
          </span>
        </div>
      ) : (
        <span className="font-semibold tracking-tight text-slate-600">
          {getProductMonogram(name)}
        </span>
      )}
    </div>
  )
}

export interface LightboxProductInfo {
  id: string
  name: string
  sku?: string | null
  categoryName?: string | null
  description?: string | null
  unit?: string | null
  priceLabel?: string | null
  wholesaleLabel?: string | null
  fxLabel?: string | null
  stockLabel?: string | null
  outOfStock?: boolean
  image_url?: string | null
}

/**
 * Visor modal de fotografía real de producto reutilizable en Mostrador (POS),
 * Ventas, Productos y Catálogo Comercial / Público.
 */
export function ProductPhotoLightbox({
  product,
  onClose,
  onAddToSale,
  addLabel = 'Agregar a la venta',
  canEditPhoto = false,
  companyId,
  onPhotoUpdated,
}: {
  product: LightboxProductInfo | null
  onClose: () => void
  onAddToSale?: () => void
  addLabel?: string
  canEditPhoto?: boolean
  companyId?: string | null
  onPhotoUpdated?: (newImageUrl: string | null) => Promise<void> | void
}) {
  const [zoomed, setZoomed] = useState(false)
  const [editingPhoto, setEditingPhoto] = useState(false)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [needsSqlModal, setNeedsSqlModal] = useState(false)
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setZoomed(false)
    setEditingPhoto(false)
    setSaveError(null)
    setNeedsSqlModal(false)
    setFailed(false)
  }, [product?.id, product?.image_url])

  useEffect(() => {
    if (!product) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sqlModalOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [product, onClose, sqlModalOpen])

  useBackOverlay(Boolean(product) && !savingPhoto, () => {
    setSqlModalOpen(false)
    onClose()
  })

  if (!product) return null

  const hasPhoto = Boolean(product.image_url && product.image_url.trim().length > 0 && !failed)

  async function handleQuickSavePhoto(nextUrl: string | null) {
    if (!onPhotoUpdated) return
    setSavingPhoto(true)
    setSaveError(null)
    setNeedsSqlModal(false)
    try {
      await onPhotoUpdated(nextUrl)
      setEditingPhoto(false)
    } catch (err: unknown) {
      if (err instanceof ProductImagePersistenceError) {
        setSaveError(err.message)
        setNeedsSqlModal(err.needsSqlActivation)
      } else if (err instanceof Error) {
        setSaveError(err.message || 'No se pudo guardar la fotografía en Supabase.')
      } else {
        setSaveError('No se pudo guardar la fotografía en Supabase.')
      }
    } finally {
      setSavingPhoto(false)
    }
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 truncate">
              {product.categoryName || 'Catálogo de productos'}
              {product.sku ? ` · SKU ${product.sku}` : ''}
            </p>
            <h3 className="text-base font-bold text-slate-900 truncate">{product.name}</h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasPhoto && !editingPhoto && (
              <button
                type="button"
                onClick={() => setZoomed(z => !z)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                {zoomed ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
                {zoomed ? 'Vista completa' : 'Acercar'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              aria-label="Cerrar imagen"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {editingPhoto && canEditPhoto && onPhotoUpdated ? (
            <div className="space-y-3">
              <ProductImageCapture
                value={product.image_url}
                name={product.name}
                companyId={companyId}
                skuOrName={product.sku || product.name}
                disabled={savingPhoto}
                deferUpload
                onChange={url => void handleQuickSavePhoto(url)}
              />
              {savingPhoto && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  Guardando y verificando fotografía en Supabase...
                </p>
              )}
              {saveError && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 space-y-2.5">
                  <div className="flex items-start gap-2 text-xs text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{saveError}</p>
                  </div>
                  {needsSqlModal && (
                    <button
                      type="button"
                      onClick={() => setSqlModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Database className="w-3.5 h-3.5" />
                      Activar SQL de Imágenes en Supabase
                    </button>
                  )}
                </div>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={savingPhoto}
                  onClick={() => {
                    setSaveError(null)
                    setEditingPhoto(false)
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Volver a la vista
                </button>
              </div>
            </div>
          ) : (
            <div className="relative rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
              {hasPhoto ? (
                <div
                  onClick={() => setZoomed(z => !z)}
                  className={`w-full aspect-[4/3] flex items-center justify-center bg-white cursor-zoom-in overflow-hidden`}
                >
                  <img
                    src={product.image_url!}
                    alt={product.name}
                    referrerPolicy="no-referrer"
                    onError={() => setFailed(true)}
                    className={`w-full h-full transition-transform duration-200 ${
                      zoomed ? 'object-cover scale-125 cursor-zoom-out' : 'object-contain'
                    }`}
                  />
                </div>
              ) : (
                <div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-2 text-slate-400 bg-slate-100/80 p-6 text-center">
                  <Package className="w-10 h-10 stroke-[1.4]" />
                  <p className="text-sm font-semibold text-slate-600">
                    Este producto aún no tiene fotografía cargada
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs">
                    {canEditPhoto
                      ? 'Sube una imagen o tómala con la cámara para mostrarla aquí, en el Mostrador y en el Catálogo PDF.'
                      : 'Solicita al encargado de inventario cargar la fotografía real en el módulo de Productos.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {product.description && (
            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 rounded-lg px-3.5 py-2.5 border border-slate-100">
              {product.description}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
            <div className="space-y-0.5 tabular-nums">
              {product.priceLabel && (
                <p className="text-lg font-bold text-slate-900">
                  {product.priceLabel}
                  {product.unit ? (
                    <span className="text-xs font-normal text-slate-500"> / {product.unit}</span>
                  ) : null}
                </p>
              )}
              {product.wholesaleLabel && (
                <p className="text-xs font-medium text-emerald-700">{product.wholesaleLabel}</p>
              )}
              {product.fxLabel && (
                <p className="text-xs text-slate-500">{product.fxLabel}</p>
              )}
            </div>

            {product.stockLabel && (
              <span
                className={`text-xs font-semibold tabular-nums px-2.5 py-1 rounded-md border ${
                  product.outOfStock
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {product.stockLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {canEditPhoto && onPhotoUpdated && !editingPhoto && (
              <button
                type="button"
                onClick={() => setEditingPhoto(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5" />
                {hasPhoto ? 'Cambiar foto real' : 'Cargar foto real'}
              </button>
            )}
            {onAddToSale && (
              <button
                type="button"
                disabled={product.outOfStock}
                onClick={() => {
                  onAddToSale()
                  onClose()
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                {product.outOfStock ? 'Agotado' : addLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    <SqlActivationModal
      open={sqlModalOpen}
      onClose={() => setSqlModalOpen(false)}
      initialBundle="images"
    />
    </>
  )
}

export default function ProductImageCapture({
  value,
  name,
  companyId,
  skuOrName,
  onChange,
  disabled = false,
  deferUpload = false,
}: {
  value?: string | null
  name?: string | null
  companyId?: string | null
  skuOrName?: string | null
  onChange: (imageUrl: string | null) => void
  disabled?: boolean
  deferUpload?: boolean
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [framing, setFraming] = useState<ImageFramingMode>('contain')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  useEffect(() => {
    return () => stopStream()
  }, [])

  async function finalizeImage(source: HTMLImageElement | HTMLVideoElement) {
    const compressed = await processProductImageSource(source, framing, 680)
    if (deferUpload) {
      onChange(compressed)
      return
    }
    const storedUrl = await uploadOrInlineProductImage(compressed, {
      companyId,
      skuOrName: skuOrName || name,
    })
    onChange(storedUrl)
  }

  async function startCamera(mode: 'environment' | 'user') {
    setError(null)
    stopStream()
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Tu navegador no permite abrir la cámara directa. Usa «Subir imagen».')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().catch(() => {})
        }
      })
    } catch {
      setError('No se pudo acceder a la cámara. Revisa el permiso o sube una foto desde tu galería.')
      setCameraOpen(false)
    }
  }

  async function captureFrame() {
    if (!videoRef.current) return
    setBusy(true)
    setError(null)
    try {
      await finalizeImage(videoRef.current)
      stopStream()
      setCameraOpen(false)
    } catch (e: any) {
      setError(e?.message || 'Error al capturar la fotografía.')
    } finally {
      setBusy(false)
    }
  }

  function processFile(file: File | undefined | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Selecciona un archivo de imagen válido (JPG, PNG o WebP).')
      return
    }
    setBusy(true)
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = async () => {
        try {
          await finalizeImage(img)
        } catch (err: any) {
          setError(err?.message || 'No se pudo procesar la foto.')
        } finally {
          setBusy(false)
        }
      }
      img.onerror = () => {
        setBusy(false)
        setError('El archivo seleccionado está dañado.')
      }
      img.src = String(reader.result || '')
    }
    reader.onerror = () => {
      setBusy(false)
      setError('No se pudo leer la imagen.')
    }
    reader.readAsDataURL(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    processFile(file)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (disabled || busy) return
    const file = e.dataTransfer.files?.[0]
    processFile(file)
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (disabled || busy) return
    const items = Array.from(e.clipboardData?.items || [])
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (imgItem) {
      e.preventDefault()
      processFile(imgItem.getAsFile())
    }
  }

  return (
    <div className="space-y-2.5" onPaste={handlePaste}>
      <div
        onDragOver={e => {
          e.preventDefault()
          if (!disabled && !busy) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col sm:flex-row sm:items-center gap-3.5 p-3 rounded-xl border transition-colors ${
          dragOver
            ? 'border-emerald-500 bg-emerald-50/50'
            : 'border-slate-200 bg-slate-50/70'
        }`}
      >
        <ProductThumb
          src={value}
          name={name}
          size="lg"
          fit={framing === 'contain' ? 'contain' : 'cover'}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-slate-800">Fotografía real del producto</p>
              <p className="text-[11px] text-slate-500">
                Visible en Mostrador (POS), Ventas y Catálogo PDF / WhatsApp. También puedes arrastrar o pegar (Ctrl+V).
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setFraming('contain')}
                title="Muestra el envase o caja completa sobre fondo blanco sin recortar"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                  framing === 'contain' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Maximize2 className="w-3 h-3" /> Completo
              </button>
              <button
                type="button"
                onClick={() => setFraming('cover')}
                title="Llena todo el recuadro 4:3"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                  framing === 'cover' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Crop className="w-3 h-3" /> Llenar
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              {busy ? 'Procesando...' : 'Subir imagen'}
            </button>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void startCamera(facing)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5" />
              Tomar foto
            </button>
            {value && (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => onChange(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
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

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {cameraOpen && (
        <div className="rounded-xl border border-slate-300 bg-slate-950 p-3 space-y-2.5">
          <div className="flex items-center justify-between text-white text-xs">
            <span className="font-medium">Encuadra el producto</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const next = facing === 'environment' ? 'user' : 'environment'
                  setFacing(next)
                  void startCamera(next)
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20"
              >
                <RefreshCw className="w-3 h-3" />
                Girar cámara
              </button>
              <button
                type="button"
                onClick={() => {
                  stopStream()
                  setCameraOpen(false)
                }}
                className="p-1 rounded bg-white/10 hover:bg-white/20"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="w-full max-w-xs mx-auto aspect-[4/3] rounded-lg overflow-hidden bg-black border border-white/15">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => void captureFrame()}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? 'Procesando...' : 'Capturar fotografía'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
