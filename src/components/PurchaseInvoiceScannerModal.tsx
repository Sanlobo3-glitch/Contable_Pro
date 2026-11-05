import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useBackOverlay } from '../lib/navigation'
import { formatMoney } from '../lib/currency'
import { round2 } from '../lib/tax'
import {
  prepareDocumentFileForScan,
  type PreparedScanAttachment,
} from '../lib/handwrittenScannerClient'
import {
  scanPurchaseInvoiceDocument,
  type DraftScannedPurchaseInvoice,
  type DraftScannedPurchaseItem,
} from '../lib/invoiceExpenseScannerClient'
import type { CompanyConfig, Product, Supplier } from '../types'
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Loader2,
  PackagePlus,
  Plus,
  RotateCcw,
  ScanLine,
  Trash2,
  Truck,
  UserPlus,
  X,
} from 'lucide-react'

interface PurchaseInvoiceScannerModalProps {
  open: boolean
  onClose: () => void
  onCompleted: (summaryMsg: string) => void
  onSwitchToExpenses?: () => void
  products: Product[]
  suppliers: Supplier[]
  supplierTerms?: Record<string, number>
  config: CompanyConfig | null
}

const PAYMENT_OPTIONS: Array<{
  value: 'efectivo' | 'transferencia' | 'tarjeta' | 'credito'
  label: string
}> = [
  { value: 'efectivo', label: 'Efectivo (descuenta de Caja)' },
  { value: 'transferencia', label: 'Transferencia / Pago Móvil / PSE (Bancos)' },
  { value: 'tarjeta', label: 'Tarjeta / Punto (Bancos)' },
  { value: 'credito', label: 'Crédito proveedor (Cuentas por pagar)' },
]

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export default function PurchaseInvoiceScannerModal({
  open,
  onClose,
  onCompleted,
  onSwitchToExpenses,
  products,
  suppliers,
  supplierTerms = {},
  config,
}: PurchaseInvoiceScannerModalProps) {
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [attachments, setAttachments] = useState<PreparedScanAttachment[]>([])
  const [preparingFiles, setPreparingFiles] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [operatorNotes, setOperatorNotes] = useState('')
  const [draft, setDraft] = useState<DraftScannedPurchaseInvoice | null>(null)
  const [showDocPreview, setShowDocPreview] = useState(true)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const currency = config?.currency || 'USD'
  const money = (n: number) => formatMoney(n, currency)
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  useBackOverlay(open, () => {
    if (scanning || committing) return
    if (zoomUrl) {
      setZoomUrl(null)
      return
    }
    onClose()
  })

  useEffect(() => {
    if (!open) return
    setStep('upload')
    setAttachments([])
    setOperatorNotes('')
    setDraft(null)
    setErrorMsg('')
    setDoneMsg('')
    setZoomUrl(null)
  }, [open])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setErrorMsg('')
    const remaining = 4 - attachments.length
    if (remaining <= 0) {
      setErrorMsg('Puedes adjuntar hasta 4 páginas por factura.')
      return
    }
    setPreparingFiles(true)
    try {
      const prepared: PreparedScanAttachment[] = []
      for (const f of Array.from(fileList).slice(0, remaining)) {
        prepared.push(await prepareDocumentFileForScan(f))
      }
      setAttachments(prev => [...prev, ...prepared])
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo procesar la imagen.')
    } finally {
      setPreparingFiles(false)
    }
  }

  async function runScan() {
    if (attachments.length === 0 || scanning) return
    setErrorMsg('')
    setScanning(true)
    try {
      const res = await scanPurchaseInvoiceDocument({
        attachments,
        products,
        suppliers,
        currency,
        operatorNotes,
      })
      if (res.supplierId && supplierTerms[res.supplierId] !== undefined && res.paymentMethod === 'credito') {
        res.creditDays = supplierTerms[res.supplierId]
      }
      setDraft(res)
      setStep('review')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo analizar la factura.')
    } finally {
      setScanning(false)
    }
  }

  function updateItem(lineId: string, patch: Partial<DraftScannedPurchaseItem>) {
    setDraft(prev => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map(it => (it.lineId === lineId ? { ...it, ...patch } : it)),
      }
    })
  }

  function selectExistingProduct(lineId: string, productId: string) {
    const prod = productById.get(productId)
    setDraft(prev => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map(it => {
          if (it.lineId !== lineId) return it
          return {
            ...it,
            productId,
            createNewProduct: !productId,
            unitCost: it.unitCost > 0 ? it.unitCost : Number(prod?.cost) || 0,
            confidence: productId ? 'alta' : it.confidence,
          }
        }),
      }
    })
  }

  function addManualItem() {
    const firstProd = products[0]
    setDraft(prev => {
      if (!prev) return prev
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            lineId: `pinv-${Date.now()}`,
            included: true,
            rawProductText: 'Agregado manualmente',
            productId: firstProd?.id || '',
            createNewProduct: !firstProd,
            newProductName: '',
            newProductSku: `ART-${String(Date.now()).slice(-4)}`,
            newProductSalePrice: 0,
            newProductUnit: 'unidad',
            quantity: 1,
            unitCost: Number(firstProd?.cost) || 0,
            lotCode: '',
            expiryDate: '',
            confidence: 'alta',
          },
        ],
      }
    })
  }

  const includedItems = useMemo(
    () => (draft?.items || []).filter(i => i.included),
    [draft]
  )

  const computedTotal = useMemo(
    () =>
      round2(
        includedItems.reduce(
          (acc, it) => acc + Math.max(0, it.quantity) * Math.max(0, it.unitCost),
          0
        )
      ),
    [includedItems]
  )

  async function handleConfirmPurchase() {
    if (!draft || committing) return
    setErrorMsg('')

    if (includedItems.length === 0) {
      setErrorMsg('Selecciona al menos un artículo para registrar la compra.')
      return
    }

    if (draft.createNewSupplier && !draft.newSupplierName.trim()) {
      setErrorMsg('Escribe el nombre del nuevo proveedor o selecciona uno existente.')
      return
    }

    if (draft.paymentMethod === 'credito' && !draft.supplierId && !draft.createNewSupplier) {
      setErrorMsg('Para compras a crédito selecciona un proveedor o activa "Crear proveedor nuevo".')
      return
    }

    for (const it of includedItems) {
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        setErrorMsg(`La cantidad de "${it.rawProductText}" debe ser un entero mayor a cero.`)
        return
      }
      if (!Number.isFinite(it.unitCost) || it.unitCost < 0) {
        setErrorMsg(`Revisa el costo unitario de "${it.rawProductText}".`)
        return
      }
      if (!it.productId && !it.createNewProduct) {
        setErrorMsg(`Vincula "${it.rawProductText}" a un producto o marca "Crear nuevo".`)
        return
      }
      if (it.createNewProduct && !it.newProductName.trim()) {
        setErrorMsg('Escribe el nombre para el producto nuevo antes de guardar.')
        return
      }
      if (!it.createNewProduct && it.productId) {
        const prod = productById.get(it.productId)
        if (prod?.tracks_expiry) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(it.expiryDate)) {
            setErrorMsg(
              `El producto "${prod.name}" maneja vencimiento: indica la fecha de vencimiento del lote.`
            )
            return
          }
          if (it.expiryDate < localToday()) {
            setErrorMsg(`La fecha de vencimiento de "${prod.name}" ya pasó.`)
            return
          }
        }
      }
    }

    setCommitting(true)
    try {
      let finalSupplierId = draft.supplierId || null
      let createdSupplierCount = 0

      if (draft.createNewSupplier && draft.newSupplierName.trim()) {
        const { data: supData, error: supErr } = await supabase
          .from('suppliers')
          .insert({
            name: draft.newSupplierName.trim(),
            document: draft.newSupplierDocument.trim() || null,
            phone: draft.newSupplierPhone.trim() || null,
          })
          .select('id')
          .single()

        if (supErr || !supData?.id) {
          throw new Error(
            'No se pudo crear el proveedor nuevo: ' + (supErr?.message || 'verifica permisos.')
          )
        }
        finalSupplierId = supData.id
        createdSupplierCount = 1
      }

      const finalItemsPayload: Array<{
        product_id: string
        product_name: string
        quantity: number
        cost: number
        subtotal: number
        lot_code?: string
        expiry_date?: string
      }> = []

      let createdProductsCount = 0

      for (const it of includedItems) {
        let targetProductId = it.productId
        let targetProductName = productById.get(it.productId)?.name || it.rawProductText

        if (it.createNewProduct) {
          const salePrice =
            it.newProductSalePrice > 0
              ? round2(it.newProductSalePrice)
              : round2(it.unitCost * 1.35)

          const { data: newProd, error: prodErr } = await supabase
            .from('products')
            .insert({
              name: it.newProductName.trim(),
              sku: it.newProductSku.trim() || `ART-${Date.now().toString().slice(-5)}`,
              category_id: null,
              price: salePrice,
              cost: round2(it.unitCost),
              stock: 0,
              min_stock: 5,
              unit: it.newProductUnit || 'unidad',
            })
            .select('id')
            .single()

          if (prodErr || !newProd?.id) {
            throw new Error(
              `No se pudo crear el producto "${it.newProductName}": ${
                prodErr?.message || 'revisa si el SKU ya existe.'
              }`
            )
          }
          targetProductId = newProd.id
          targetProductName = it.newProductName.trim()
          createdProductsCount += 1
        }

        finalItemsPayload.push({
          product_id: targetProductId,
          product_name: targetProductName,
          quantity: Math.round(it.quantity),
          cost: round2(it.unitCost),
          subtotal: round2(Math.round(it.quantity) * round2(it.unitCost)),
          ...(it.expiryDate
            ? { lot_code: it.lotCode.trim().slice(0, 40), expiry_date: it.expiryDate }
            : {}),
        })
      }

      const rpcArgs: Record<string, unknown> = {
        p_supplier_id: finalSupplierId,
        p_items: finalItemsPayload,
      }
      if (draft.paymentMethod !== 'efectivo') {
        rpcArgs.p_payment_method = draft.paymentMethod
      }
      if (draft.paymentMethod === 'credito') {
        rpcArgs.p_credit_days = Math.max(0, Math.min(365, Math.floor(Number(draft.creditDays) || 30)))
      }

      const { error: purchaseErr } = await supabase.rpc('registrar_compra', rpcArgs)
      if (purchaseErr) {
        throw new Error('No se pudo registrar la compra: ' + purchaseErr.message)
      }

      const extraParts: string[] = []
      if (createdSupplierCount > 0) extraParts.push('1 proveedor nuevo creado')
      if (createdProductsCount > 0) extraParts.push(`${createdProductsCount} producto(s) nuevos creados`)
      const suffix = extraParts.length > 0 ? ` (${extraParts.join(' · ')})` : ''
      const summary = `Factura digitalizada: ${finalItemsPayload.length} renglón(es) ingresados a inventario por ${money(computedTotal)}${suffix}.`

      setDoneMsg(summary)
      setStep('done')
      onCompleted(summary)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al guardar la compra.')
    } finally {
      setCommitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[1px] flex items-center justify-center p-2 sm:p-4"
      onClick={() => {
        if (!scanning && !committing) onClose()
      }}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-800 flex items-center justify-center shrink-0">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Escáner de Facturas y Tickets de Compra de Mercancía
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Toma foto o sube PDF de la factura del proveedor para sumar existencias y actualizar costos automáticamente
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={scanning || committing}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-xs sm:text-sm">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-4">
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => {
                  void handleFiles(e.target.files)
                  e.target.value = ''
                }}
                className="hidden"
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={e => {
                  void handleFiles(e.target.files)
                  e.target.value = ''
                }}
                className="hidden"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={preparingFiles || scanning || attachments.length >= 4}
                  onClick={() => cameraRef.current?.click()}
                  className="py-5 px-4 rounded-xl border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 transition-colors flex flex-col items-center justify-center gap-1.5 text-center disabled:opacity-50"
                >
                  <Camera className="w-6 h-6 text-emerald-700" />
                  <span className="text-sm font-bold text-slate-900">
                    Fotografiar factura o ticket de compra
                  </span>
                  <span className="text-xs text-slate-600">
                    Enfoca de frente los artículos, cantidades y costos
                  </span>
                </button>

                <button
                  type="button"
                  disabled={preparingFiles || scanning || attachments.length >= 4}
                  onClick={() => galleryRef.current?.click()}
                  className="py-5 px-4 rounded-xl border-2 border-dashed border-slate-300 hover:border-slate-500 bg-slate-50/70 hover:bg-slate-100/70 transition-colors flex flex-col items-center justify-center gap-1.5 text-center disabled:opacity-50"
                >
                  <ImagePlus className="w-6 h-6 text-slate-700" />
                  <span className="text-sm font-bold text-slate-900">
                    Subir imagen o factura electrónica PDF
                  </span>
                  <span className="text-xs text-slate-600">
                    JPG, PNG, WebP o PDF (hasta 4 páginas)
                  </span>
                </button>
              </div>

              {onSwitchToExpenses && (
                <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-sky-900">
                  <span>
                    ¿Quieres escanear un recibo de <strong>Agua, Luz, Internet o Arriendo</strong> en lugar de mercancía?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onSwitchToExpenses()
                    }}
                    className="font-semibold underline hover:text-sky-700"
                  >
                    Ir a Gastos operativos →
                  </button>
                </div>
              )}

              {preparingFiles && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin" /> Optimizando documento...
                </div>
              )}

              {attachments.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {attachments.map((att, i) => (
                    <div key={att.id} className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                      {att.isPdf ? (
                        <div className="h-28 flex flex-col items-center justify-center p-2 text-center">
                          <FileText className="w-7 h-7 text-red-600 mb-1" />
                          <span className="text-[11px] font-medium text-slate-700 line-clamp-2">{att.name}</span>
                        </div>
                      ) : (
                        <img src={att.previewUrl} alt={att.name} className="w-full h-28 object-cover" />
                      )}
                      <div className="px-2 py-1 bg-white border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="font-medium text-slate-700">Pág. {i + 1}</span>
                        <button
                          type="button"
                          onClick={() => setAttachments(prev => prev.filter(x => x.id !== att.id))}
                          className="text-red-600 hover:underline"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nota opcional (ej. «Los precios incluyen IVA» o «Cajas de 12 unidades»)
                </label>
                <input
                  type="text"
                  value={operatorNotes}
                  onChange={e => setOperatorNotes(e.target.value)}
                  placeholder="Opcional..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
            </div>
          )}

          {step === 'review' && draft && (
            <div className="space-y-4">
              {draft.isUtilityOrExpenseBill && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-amber-900">
                    <p className="font-bold">
                      Este documento parece ser un recibo de servicio público o gasto operativo (Agua, Luz, Internet, Arriendo)
                    </p>
                    <p className="mt-0.5">
                      Los servicios no suman unidades al inventario de mercancía: se registran en <strong>Gastos operativos</strong> para afectar Caja/Bancos y el Estado de Resultados.
                    </p>
                  </div>
                  {onSwitchToExpenses && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onSwitchToExpenses()
                      }}
                      className="px-3 py-2 rounded-lg bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 shrink-0"
                    >
                      Abrir Gastos operativos
                    </button>
                  )}
                </div>
              )}

              {draft.documentSummary && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 flex-wrap text-xs text-slate-700">
                  <span>
                    <strong className="text-slate-900">Lectura:</strong> {draft.documentSummary}
                    {draft.invoiceNumber ? ` · Factura ${draft.invoiceNumber}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDocPreview(v => !v)}
                    className="inline-flex items-center gap-1 text-slate-700 font-semibold hover:underline"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {showDocPreview ? 'Ocultar imagen' : 'Ver imagen'}
                  </button>
                </div>
              )}

              {showDocPreview && attachments.some(a => !a.isPdf) && (
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {attachments
                    .filter(a => !a.isPdf)
                    .map((att, idx) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => setZoomUrl(att.previewUrl)}
                        className="shrink-0 rounded-lg border border-slate-200 overflow-hidden bg-white"
                      >
                        <img src={att.previewUrl} alt={`Factura ${idx + 1}`} className="h-24 w-36 object-cover" />
                      </button>
                    ))}
                </div>
              )}

              {/* Proveedor y Condición de Pago */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50/80 border border-slate-200 rounded-xl p-3.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800">Proveedor</label>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft(d =>
                          d ? { ...d, createNewSupplier: !d.createNewSupplier } : d
                        )
                      }
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {draft.createNewSupplier ? 'Elegir proveedor existente' : 'Crear proveedor nuevo'}
                    </button>
                  </div>

                  {draft.createNewSupplier ? (
                    <div className="space-y-2 bg-white p-2.5 rounded-lg border border-emerald-200">
                      <input
                        type="text"
                        value={draft.newSupplierName}
                        onChange={e => setDraft(d => (d ? { ...d, newSupplierName: e.target.value } : d))}
                        placeholder="Razón social / Nombre del proveedor"
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs font-medium"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={draft.newSupplierDocument}
                          onChange={e =>
                            setDraft(d => (d ? { ...d, newSupplierDocument: e.target.value } : d))
                          }
                          placeholder="NIT / RIF / RUT"
                          className="px-2.5 py-1.5 rounded border border-slate-300 text-xs"
                        />
                        <input
                          type="text"
                          value={draft.newSupplierPhone}
                          onChange={e =>
                            setDraft(d => (d ? { ...d, newSupplierPhone: e.target.value } : d))
                          }
                          placeholder="Teléfono"
                          className="px-2.5 py-1.5 rounded border border-slate-300 text-xs"
                        />
                      </div>
                    </div>
                  ) : (
                    <select
                      value={draft.supplierId}
                      onChange={e =>
                        setDraft(d =>
                          d
                            ? {
                                ...d,
                                supplierId: e.target.value,
                                creditDays:
                                  e.target.value && supplierTerms[e.target.value] !== undefined
                                    ? supplierTerms[e.target.value]
                                    : d.creditDays,
                              }
                            : d
                        )
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                    >
                      <option value="">Proveedor general (sin registrar)</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.document ? `(${s.document})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-800">
                    Condición de pago
                  </label>
                  <select
                    value={draft.paymentMethod}
                    onChange={e =>
                      setDraft(d =>
                        d
                          ? {
                              ...d,
                              paymentMethod: e.target.value as DraftScannedPurchaseInvoice['paymentMethod'],
                            }
                          : d
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  >
                    {PAYMENT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {draft.paymentMethod === 'credito' && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600">Días de plazo:</span>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={draft.creditDays}
                        onChange={e =>
                          setDraft(d =>
                            d ? { ...d, creditDays: Math.max(0, Number(e.target.value) || 0) } : d
                          )
                        }
                        className="w-24 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-semibold"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Artículos de la factura */}
              <div className="space-y-2.5">
                {draft.items.map((it, idx) => {
                  const matchedProd = it.productId ? productById.get(it.productId) : undefined
                  const prevCost = Number(matchedProd?.cost) || 0
                  const lineSub = round2(Math.max(0, it.quantity) * Math.max(0, it.unitCost))

                  return (
                    <div
                      key={it.lineId}
                      className={`rounded-xl border p-3 ${
                        !it.included
                          ? 'bg-slate-50 border-slate-200 opacity-60'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={it.included}
                            onChange={e => updateItem(it.lineId, { included: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-slate-900"
                          />
                          <span className="text-xs font-bold text-slate-800">
                            Renglón #{idx + 1}: «{it.rawProductText}»
                          </span>
                        </label>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(it.lineId, { createNewProduct: !it.createNewProduct })
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded"
                          >
                            <PackagePlus className="w-3 h-3" />
                            {it.createNewProduct ? 'Vincular a existente' : 'Crear como nuevo'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft(d =>
                                d ? { ...d, items: d.items.filter(x => x.lineId !== it.lineId) } : d
                              )
                            }
                            className="p-1 rounded text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                        <div className="sm:col-span-6">
                          {it.createNewProduct ? (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 bg-emerald-50/50 border border-emerald-200 rounded-lg p-2">
                              <input
                                type="text"
                                value={it.newProductName}
                                onChange={e =>
                                  updateItem(it.lineId, { newProductName: e.target.value })
                                }
                                placeholder="Nombre nuevo producto"
                                className="sm:col-span-2 px-2 py-1 rounded border border-slate-300 bg-white text-xs font-medium"
                              />
                              <input
                                type="text"
                                value={it.newProductSku}
                                onChange={e =>
                                  updateItem(it.lineId, { newProductSku: e.target.value })
                                }
                                placeholder="SKU"
                                className="px-2 py-1 rounded border border-slate-300 bg-white text-xs"
                              />
                              <div className="sm:col-span-3 flex items-center gap-2">
                                <span className="text-[11px] text-slate-600">Precio venta público:</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={it.newProductSalePrice}
                                  onChange={e =>
                                    updateItem(it.lineId, {
                                      newProductSalePrice: Math.max(0, Number(e.target.value) || 0),
                                    })
                                  }
                                  className="w-32 px-2 py-1 rounded border border-slate-300 bg-white text-xs font-semibold"
                                />
                              </div>
                            </div>
                          ) : (
                            <select
                              value={it.productId}
                              onChange={e => selectExistingProduct(it.lineId, e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                            >
                              <option value="">— Selecciona producto existente —</option>
                              {products.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.sku || 's/c'}) · Stock: {p.stock} · Costo: {money(p.cost)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-slate-500">Cantidad</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={it.quantity}
                            onChange={e =>
                              updateItem(it.lineId, {
                                quantity: Math.max(1, Math.round(Number(e.target.value) || 1)),
                              })
                            }
                            className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-slate-500">Costo unitario</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={it.unitCost}
                            onChange={e =>
                              updateItem(it.lineId, {
                                unitCost: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold tabular-nums"
                          />
                          {!it.createNewProduct && prevCost > 0 && prevCost !== it.unitCost && (
                            <span className="block text-[10px] text-amber-700 mt-0.5">
                              Antes: {money(prevCost)}
                            </span>
                          )}
                        </div>

                        <div className="sm:col-span-2 text-right">
                          <span className="block text-[10px] text-slate-500">Subtotal</span>
                          <span className="text-xs font-bold text-slate-900 tabular-nums">
                            {money(lineSub)}
                          </span>
                        </div>
                      </div>

                      {(matchedProd?.tracks_expiry || it.expiryDate || it.lotCode) && (
                        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100">
                          <input
                            type="text"
                            value={it.lotCode}
                            onChange={e => updateItem(it.lineId, { lotCode: e.target.value })}
                            placeholder="Código de lote (opcional)"
                            className="px-2 py-1 rounded border border-slate-300 text-xs"
                          />
                          <input
                            type="date"
                            value={it.expiryDate}
                            onChange={e => updateItem(it.lineId, { expiryDate: e.target.value })}
                            className="px-2 py-1 rounded border border-slate-300 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={addManualItem}
                className="w-full py-2 rounded-xl border border-dashed border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Agregar otro artículo a esta factura
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">¡Compra e inventario actualizados!</h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto">{doneMsg}</p>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
          {step === 'upload' && (
            <>
              <button
                type="button"
                disabled={scanning}
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={attachments.length === 0 || scanning || preparingFiles}
                onClick={() => void runScan()}
                className="px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-2"
              >
                {scanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Leyendo factura...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" /> Analizar factura
                  </>
                )}
              </button>
            </>
          )}

          {step === 'review' && (
            <>
              <button
                type="button"
                disabled={committing}
                onClick={() => setStep('upload')}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs sm:text-sm font-medium inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" /> Volver
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-900 tabular-nums">
                  Total factura: {money(computedTotal)}
                </span>
                <button
                  type="button"
                  disabled={committing || includedItems.length === 0}
                  onClick={() => void handleConfirmPurchase()}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 inline-flex items-center gap-2"
                >
                  {committing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Guardando compra...
                    </>
                  ) : (
                    <>
                      <Truck className="w-4 h-4" /> Ingresar mercancía al inventario
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Cerrar
              </button>
            </div>
          )}
        </div>
      </div>

      {zoomUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomUrl(null)}
        >
          <img src={zoomUrl} alt="Factura ampliada" className="max-w-full max-h-[90vh] rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
