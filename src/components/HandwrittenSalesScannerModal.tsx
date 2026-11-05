import { useEffect, useMemo, useRef, useState } from 'react'
import { useBackOverlay } from '../lib/navigation'
import { formatMoney } from '../lib/currency'
import { calcTax, round2, taxModeOf, taxRateOf } from '../lib/tax'
import { esc, printHtml } from '../lib/documents'
import { normalizeProductVariants } from '../lib/catalogCommerce'
import { enqueueSale, newId, sendSale, type PendingSale } from '../lib/offlineQueue'
import {
  prepareDocumentFileForScan,
  scanHandwrittenSalesNotebook,
  type DraftScannedSale,
  type DraftScannedSaleItem,
  type PreparedScanAttachment,
} from '../lib/handwrittenScannerClient'
import type { CompanyConfig, Customer, Product, Warehouse } from '../types'
import {
  AlertTriangle,
  BookOpenCheck,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Loader2,
  NotebookPen,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react'

interface HandwrittenSalesScannerModalProps {
  open: boolean
  onClose: () => void
  onCompleted: (summaryMsg: string) => void
  products: Product[]
  customers: Customer[]
  config: CompanyConfig | null
  userId: string
  sellerName?: string
  warehouses?: Warehouse[]
  defaultWarehouseId?: string | null
  defaultChannel?: 'mostrador' | 'ruta'
}

const PAYMENT_OPTIONS: Array<{
  value: 'efectivo' | 'transferencia' | 'tarjeta' | 'fiado'
  label: string
}> = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia / Pago Móvil / Nequi' },
  { value: 'tarjeta', label: 'Tarjeta / Punto' },
  { value: 'fiado', label: 'Fiado (Crédito a cliente)' },
]

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function makeEmptyItem(defaultProduct?: Product): DraftScannedSaleItem {
  const price = Number(defaultProduct?.price) || 0
  return {
    lineId: `ln-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    rawProductText: 'Agregado manualmente',
    productId: defaultProduct?.id || '',
    variantId: '',
    variantHint: '',
    quantity: 1,
    unitPrice: price,
    catalogUnitPrice: price,
    writtenUnitPrice: 0,
    confidence: 'alta',
  }
}

export default function HandwrittenSalesScannerModal({
  open,
  onClose,
  onCompleted,
  products,
  customers,
  config,
  userId,
  sellerName = 'Encargado',
  warehouses = [],
  defaultWarehouseId = null,
  defaultChannel = 'mostrador',
}: HandwrittenSalesScannerModalProps) {
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [attachments, setAttachments] = useState<PreparedScanAttachment[]>([])
  const [preparingFiles, setPreparingFiles] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitProgress, setCommitProgress] = useState<{ current: number; total: number } | null>(
    null
  )

  const [operatorNotes, setOperatorNotes] = useState('')
  const [shiftDateTime, setShiftDateTime] = useState(() => toLocalDateTimeInputValue(new Date()))
  const [warehouseId, setWarehouseId] = useState<string>(defaultWarehouseId || '')
  const [channel, setChannel] = useState<'mostrador' | 'ruta'>(defaultChannel)

  const [pageSummary, setPageSummary] = useState('')
  const [skippedNotes, setSkippedNotes] = useState<string[]>([])
  const [draftSales, setDraftSales] = useState<DraftScannedSale[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [showNotebookPreview, setShowNotebookPreview] = useState(true)
  const [zoomAttachmentUrl, setZoomAttachmentUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const [completedReport, setCompletedReport] = useState<{
    registeredCount: number
    queuedCount: number
    totalUnits: number
    totalAmount: number
    capturedAtText: string
    linesSummary: Array<{
      customer: string
      payment: string
      itemsText: string
      total: number
    }>
  } | null>(null)

  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)

  useBackOverlay(open && !scanning && !committing, () => {
    if (zoomAttachmentUrl) {
      setZoomAttachmentUrl(null)
      return
    }
    onClose()
  })

  useEffect(() => {
    if (!open) return
    setWarehouseId(defaultWarehouseId || '')
    setChannel(defaultChannel)
  }, [open, defaultWarehouseId, defaultChannel])

  const currency = config?.currency || 'USD'
  const money = (n: number) => formatMoney(n, currency)
  const taxMode = taxModeOf(config)
  const taxRate = taxRateOf(config)

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers])

  // Consumo acumulado de inventario en todo el lote incluido para detectar sobregiros de stock
  const cumulativeQtyByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const sale of draftSales) {
      if (!sale.included) continue
      for (const it of sale.items) {
        if (!it.productId) continue
        const prod = productMap.get(it.productId)
        const variants = prod ? normalizeProductVariants(prod.variants) : []
        const selVar = it.variantId ? variants.find(v => v.id === it.variantId) : null
        const mult = selVar && Number(selVar.stock_multiplier) > 0 ? Number(selVar.stock_multiplier) : 1
        const unitsNeeded = round2((Number(it.quantity) || 0) * mult)
        map.set(it.productId, round2((map.get(it.productId) || 0) + unitsNeeded))
      }
    }
    return map
  }, [draftSales, productMap])

  const batchValidation = useMemo(() => {
    let activeSales = 0
    let totalUnits = 0
    let grandTotal = 0
    let issuesCount = 0

    const perRowIssues = new Map<string, string[]>()

    for (const sale of draftSales) {
      if (!sale.included) continue
      activeSales++
      const issues: string[] = []

      if (sale.items.length === 0) {
        issues.push('Esta venta no tiene productos.')
      }

      if (sale.paymentMethod === 'fiado' && !sale.customerId) {
        issues.push('El pago fiado requiere elegir un cliente registrado.')
      }

      let rowSum = 0
      for (const it of sale.items) {
        const qty = Number(it.quantity) || 0
        const price = Number(it.unitPrice) || 0
        totalUnits += qty
        rowSum += round2(qty * price)

        if (!it.productId || !productMap.has(it.productId)) {
          issues.push(`Selecciona el producto del inventario para «${it.rawProductText}».`)
        } else {
          const prod = productMap.get(it.productId)!
          const neededTotal = cumulativeQtyByProduct.get(prod.id) || 0
          if (neededTotal > Number(prod.stock)) {
            issues.push(
              `Stock insuficiente de ${prod.name}: el lote suma ${neededTotal} y hay ${prod.stock} disponible(s).`
            )
          }
        }
        if (qty <= 0) {
          issues.push('La cantidad debe ser mayor a 0.')
        }
      }

      const tx = calcTax(round2(rowSum), taxMode, taxRate)
      grandTotal = round2(grandTotal + tx.total)

      if (issues.length > 0) {
        issuesCount++
        perRowIssues.set(sale.rowId, issues)
      }
    }

    return {
      activeSales,
      totalUnits,
      grandTotal,
      issuesCount,
      perRowIssues,
    }
  }, [draftSales, productMap, cumulativeQtyByProduct, taxMode, taxRate])

  if (!open) return null

  function resetAll() {
    setStep('upload')
    setAttachments([])
    setOperatorNotes('')
    setPageSummary('')
    setSkippedNotes([])
    setDraftSales([])
    setRowErrors({})
    setErrorMsg('')
    setCompletedReport(null)
    setShiftDateTime(toLocalDateTimeInputValue(new Date()))
  }

  async function handleAddFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setErrorMsg('')
    const remainingSlots = 4 - attachments.length
    if (remainingSlots <= 0) {
      setErrorMsg('Ya adjuntaste el máximo de 4 páginas en este lote.')
      return
    }
    const incoming = Array.from(fileList).slice(0, remainingSlots)
    setPreparingFiles(true)
    try {
      const prepared: PreparedScanAttachment[] = []
      for (const f of incoming) {
        prepared.push(await prepareDocumentFileForScan(f))
      }
      setAttachments(prev => [...prev, ...prepared])
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo cargar la imagen.')
    } finally {
      setPreparingFiles(false)
    }
  }

  function removeAttachment(id: string) {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

  async function handleRunScan() {
    if (attachments.length === 0 || scanning) return
    setScanning(true)
    setErrorMsg('')
    setRowErrors({})
    try {
      const result = await scanHandwrittenSalesNotebook({
        attachments,
        products,
        customers,
        currency,
        operatorNotes,
      })

      if (result.draftSales.length === 0) {
        setErrorMsg(
          'No se detectaron renglones de venta legibles en la imagen. Asegúrate de enfocar de frente la hoja con buena luz.'
        )
        setScanning(false)
        return
      }

      if (result.detectedDateHint && /^\d{4}-\d{2}-\d{2}$/.test(result.detectedDateHint)) {
        const currentTimePart = shiftDateTime.split('T')[1] || '12:00'
        const candidateDate = new Date(`${result.detectedDateHint}T${currentTimePart}`)
        const thirtyDaysAgo = Date.now() - 29 * 86400000
        if (
          !Number.isNaN(candidateDate.getTime()) &&
          candidateDate.getTime() <= Date.now() &&
          candidateDate.getTime() >= thirtyDaysAgo
        ) {
          setShiftDateTime(`${result.detectedDateHint}T${currentTimePart}`)
        }
      }

      setPageSummary(result.pageSummary)
      setSkippedNotes(result.skippedNotes)
      setDraftSales(result.draftSales)
      setStep('review')
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo analizar la página del cuaderno.'
      )
    } finally {
      setScanning(false)
    }
  }

  function updateSaleRow(rowId: string, patch: Partial<DraftScannedSale>) {
    setDraftSales(prev => prev.map(r => (r.rowId === rowId ? { ...r, ...patch } : r)))
    setRowErrors(prev => {
      if (!prev[rowId]) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  function updateSaleItem(
    rowId: string,
    lineId: string,
    updater: (prev: DraftScannedSaleItem) => DraftScannedSaleItem
  ) {
    setDraftSales(prev =>
      prev.map(r =>
        r.rowId === rowId
          ? {
              ...r,
              items: r.items.map(it => (it.lineId === lineId ? updater(it) : it)),
            }
          : r
      )
    )
    setRowErrors(prev => {
      if (!prev[rowId]) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  function handleSelectProductForLine(rowId: string, lineId: string, productId: string) {
    const prod = productMap.get(productId)
    updateSaleItem(rowId, lineId, prev => {
      const catPrice = Number(prod?.price) || 0
      return {
        ...prev,
        productId,
        variantId: '',
        catalogUnitPrice: catPrice,
        unitPrice: catPrice > 0 ? catPrice : prev.unitPrice,
        confidence: productId ? 'alta' : 'baja',
      }
    })
  }

  function handleSelectVariantForLine(rowId: string, lineId: string, variantId: string) {
    updateSaleItem(rowId, lineId, prev => {
      const prod = productMap.get(prev.productId)
      const variants = prod ? normalizeProductVariants(prod.variants) : []
      const found = variants.find(v => v.id === variantId)
      const nextCatPrice = found ? Number(found.price) || prev.catalogUnitPrice : Number(prod?.price) || 0
      return {
        ...prev,
        variantId,
        unitPrice: nextCatPrice,
        catalogUnitPrice: nextCatPrice,
      }
    })
  }

  function addLineToSale(rowId: string) {
    setDraftSales(prev =>
      prev.map(r =>
        r.rowId === rowId ? { ...r, items: [...r.items, makeEmptyItem()] } : r
      )
    )
  }

  function removeLineFromSale(rowId: string, lineId: string) {
    setDraftSales(prev =>
      prev.map(r => {
        if (r.rowId !== rowId) return r
        const nextItems = r.items.filter(i => i.lineId !== lineId)
        return {
          ...r,
          included: nextItems.length > 0 ? r.included : false,
          items: nextItems,
        }
      })
    )
  }

  function addManualSaleRow() {
    setDraftSales(prev => [
      ...prev,
      {
        rowId: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        included: true,
        sourceLineText: 'Renglón agregado manualmente en revisión',
        paymentMethod: 'efectivo',
        paymentDetailNote: '',
        rawCustomerName: '',
        customerId: '',
        items: [makeEmptyItem()],
      },
    ])
  }

  async function handleConfirmAndCommitSales() {
    if (committing || batchValidation.activeSales === 0 || batchValidation.issuesCount > 0) {
      return
    }

    setCommitting(true)
    setErrorMsg('')
    const nextRowErrors: Record<string, string> = {}

    let parsedDate = new Date(shiftDateTime)
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() > Date.now()) {
      parsedDate = new Date()
    }

    const toProcess = draftSales.filter(s => s.included && s.items.length > 0)
    setCommitProgress({ current: 0, total: toProcess.length })

    let registeredCount = 0
    let queuedCount = 0
    let totalUnitsDone = 0
    let totalAmountDone = 0
    const succeededRowIds = new Set<string>()
    const reportLines: Array<{
      customer: string
      payment: string
      itemsText: string
      total: number
    }> = []

    for (let idx = 0; idx < toProcess.length; idx++) {
      const row = toProcess[idx]
      setCommitProgress({ current: idx + 1, total: toProcess.length })

      const cust = row.customerId ? customerMap.get(row.customerId) : undefined
      const saleItems = row.items.map(it => {
        const prod = productMap.get(it.productId)!
        const variants = normalizeProductVariants(prod.variants)
        const selVar = it.variantId ? variants.find(v => v.id === it.variantId) : null
        const mult = selVar && Number(selVar.stock_multiplier) > 0 ? Number(selVar.stock_multiplier) : 1
        const effectiveQty = round2(it.quantity * mult)
        const effectiveUnitPrice =
          mult !== 1 ? round2((it.unitPrice * it.quantity) / effectiveQty) : round2(it.unitPrice)
        const displayName = selVar ? `${prod.name} (${selVar.label})` : prod.name

        return {
          product_id: prod.id,
          product_name: displayName,
          quantity: effectiveQty,
          price: effectiveUnitPrice,
          subtotal: round2(it.unitPrice * it.quantity),
        }
      })

      const sumSubtotals = round2(saleItems.reduce((acc, l) => acc + l.subtotal, 0))
      const tx = calcTax(sumSubtotals, taxMode, taxRate)
      // Escalonar 1 segundo entre registros del cuaderno para mantener orden cronológico exacto en el historial
      const rowTimestamp = new Date(parsedDate.getTime() + idx * 1000).toISOString()

      const pendingSale: PendingSale = {
        client_id: newId(),
        customer_id: cust?.id || null,
        customer_name: cust?.name || (row.rawCustomerName ? row.rawCustomerName : null),
        items: saleItems,
        payment_method: row.paymentMethod,
        geo: null,
        captured_at: rowTimestamp,
        total: tx.total,
        channel,
        warehouse_id: warehouseId || null,
      }

      if (!navigator.onLine) {
        if (enqueueSale(userId, pendingSale)) {
          queuedCount++
          succeededRowIds.add(row.rowId)
        } else {
          nextRowErrors[row.rowId] = 'Sin señal y almacenamiento local lleno en este dispositivo.'
        }
      } else {
        const sendRes = await sendSale(pendingSale)
        if (sendRes.ok) {
          registeredCount++
          succeededRowIds.add(row.rowId)
        } else if (sendRes.network) {
          if (enqueueSale(userId, pendingSale)) {
            queuedCount++
            succeededRowIds.add(row.rowId)
          } else {
            nextRowErrors[row.rowId] = 'Fallo de red y no se pudo guardar en cola local.'
          }
        } else {
          nextRowErrors[row.rowId] = sendRes.message
        }
      }

      if (succeededRowIds.has(row.rowId)) {
        const rowUnits = row.items.reduce((a, b) => a + (Number(b.quantity) || 0), 0)
        totalUnitsDone += rowUnits
        totalAmountDone = round2(totalAmountDone + tx.total)
        reportLines.push({
          customer: cust?.name || row.rawCustomerName || 'Cliente general',
          payment:
            PAYMENT_OPTIONS.find(p => p.value === row.paymentMethod)?.label || row.paymentMethod,
          itemsText: row.items
            .map(i => {
              const pName = productMap.get(i.productId)?.name || i.rawProductText
              return `${i.quantity}x ${pName}`
            })
            .join(', '),
          total: tx.total,
        })
      }
    }

    setCommitting(false)
    setCommitProgress(null)

    if (Object.keys(nextRowErrors).length > 0) {
      // Conservar en pantalla únicamente las filas rechazadas para que el usuario las corrija sin duplicar las ya enviadas
      setDraftSales(prev => prev.filter(r => !succeededRowIds.has(r.rowId)))
      setRowErrors(nextRowErrors)
      setErrorMsg(
        registeredCount + queuedCount > 0
          ? `Se registraron ${registeredCount + queuedCount} venta(s), pero ${
              Object.keys(nextRowErrors).length
            } fila(s) requieren corrección abajo.`
          : 'Revisa las observaciones marcadas en rojo antes de reintentar.'
      )
      if (registeredCount + queuedCount > 0) {
        onCompleted(
          `Se cargaron ${registeredCount + queuedCount} venta(s) del cuaderno al sistema.`
        )
      }
      return
    }

    setCompletedReport({
      registeredCount,
      queuedCount,
      totalUnits: totalUnitsDone,
      totalAmount: totalAmountDone,
      capturedAtText: parsedDate.toLocaleString(),
      linesSummary: reportLines,
    })
    setStep('done')
    onCompleted(
      queuedCount > 0
        ? `${queuedCount} venta(s) del cuaderno guardadas en cola para sincronizar.`
        : `${registeredCount} venta(s) manuscritas registradas en Ventas, Caja y Kardex (${money(
            totalAmountDone
          )}).`
    )
  }

  function handlePrintAuditSheet() {
    if (!completedReport) return
    const rowsHtml = completedReport.linesSummary
      .map(
        (l, idx) => `
          <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${idx + 1}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${esc(l.customer)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${esc(l.itemsText)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${esc(l.payment)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${esc(
              money(l.total)
            )}</td>
          </tr>`
      )
      .join('')

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta Digitalización Cuaderno</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;color:#0f172a;padding:24px;max-width:780px;margin:0 auto;font-size:13px}
        h1{font-size:18px;margin:0 0 4px}
        .meta{color:#475569;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th{background:#f8fafc;text-align:left;padding:8px;border-bottom:2px solid #cbd5e1;font-size:11px;text-transform:uppercase;color:#334155}
        .tot{margin-top:16px;text-align:right;font-size:15px;font-weight:700}
        .sig{margin-top:42px;display:flex;justify-content:space-between;gap:32px}
        .sig div{flex:1;border-top:1px solid #94a3b8;padding-top:6px;text-align:center;font-size:12px;color:#475569}
      </style></head><body>
      <h1>${esc(config?.name || 'Empresa')} — Acta de Digitalización de Ventas en Contingencia</h1>
      <div class="meta">
        Fecha/hora del turno registrado: <strong>${esc(completedReport.capturedAtText)}</strong> ·
        Responsable: <strong>${esc(sellerName)}</strong> ·
        Ventas procesadas: <strong>${completedReport.registeredCount + completedReport.queuedCount}</strong> (${completedReport.totalUnits} und)
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Cliente</th>
            <th>Detalle digitalizado</th>
            <th>Pago</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="tot">Total incorporado al sistema: ${esc(money(completedReport.totalAmount))}</div>
      <div class="sig">
        <div>Firma quien anotó en cuaderno</div>
        <div>Firma quien verificó y cargó (${esc(sellerName)})</div>
      </div>
      </body></html>`
    printHtml(html)
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[1px] flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Cabecera */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3 bg-slate-50/70">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 border border-amber-200 flex items-center justify-center shrink-0">
              <NotebookPen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  Digitalizador de Cuaderno Manuscrito
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200">
                  Modo Contingencia / Sin Luz
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Fotografía o sube las hojas donde anotaron las ventas a mano: el lector cruza cada renglón con tu inventario real antes de cargar a Ventas, Caja y Kardex.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={scanning || committing}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inputs ocultos de cámara y galería */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={e => {
            void handleAddFiles(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={e => {
            void handleAddFiles(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />

        {/* Cuerpo principal */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* PASO 1: SUBIR O FOTOGRAFIAR CUADERNO */}
          {step === 'upload' && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={preparingFiles || scanning || attachments.length >= 4}
                  onClick={() => cameraInputRef.current?.click()}
                  className="p-5 rounded-xl border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 transition-colors flex flex-col items-center justify-center text-center gap-2 disabled:opacity-50"
                >
                  <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      Tomar foto directa al cuaderno
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Usa la cámara trasera enfocando la hoja completa con buena iluminación
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={preparingFiles || scanning || attachments.length >= 4}
                  onClick={() => galleryInputRef.current?.click()}
                  className="p-5 rounded-xl border-2 border-dashed border-slate-300 hover:border-slate-500 bg-slate-50/70 hover:bg-slate-100/70 transition-colors flex flex-col items-center justify-center text-center gap-2 disabled:opacity-50"
                >
                  <div className="w-11 h-11 rounded-xl bg-slate-800 text-white flex items-center justify-center">
                    <ImagePlus className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      Subir fotos de galería o archivo PDF
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Hasta 4 páginas manuscritas en una misma lectura ({attachments.length}/4)
                    </p>
                  </div>
                </button>
              </div>

              {preparingFiles && (
                <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  Optimizando nitidez de la hoja para lectura de escritura a mano...
                </div>
              )}

              {attachments.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-700">
                      Páginas listas para analizar ({attachments.length}/4)
                    </p>
                    <button
                      type="button"
                      onClick={() => setAttachments([])}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Vaciar lista
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {attachments.map((att, idx) => (
                      <div
                        key={att.id}
                        className="relative group rounded-xl border border-slate-200 bg-slate-50 overflow-hidden"
                      >
                        {att.isPdf ? (
                          <div className="h-32 flex flex-col items-center justify-center gap-1 p-3 text-slate-600">
                            <FileText className="w-8 h-8 text-red-600" />
                            <span className="text-xs font-medium truncate max-w-full">
                              {att.name}
                            </span>
                          </div>
                        ) : (
                          <img
                            src={att.previewUrl}
                            alt={`Página ${idx + 1}`}
                            className="w-full h-32 object-cover cursor-pointer"
                            onClick={() => setZoomAttachmentUrl(att.previewUrl)}
                          />
                        )}
                        <div className="px-2.5 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
                          <span className="font-medium truncate">
                            Hoja {idx + 1} · {att.sizeKb} KB
                          </span>
                          <div className="flex items-center gap-1">
                            {!att.isPdf && (
                              <button
                                type="button"
                                onClick={() => setZoomAttachmentUrl(att.previewUrl)}
                                className="p-1 text-slate-500 hover:text-slate-900"
                                title="Ampliar hoja"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeAttachment(att.id)}
                              className="p-1 text-slate-400 hover:text-red-600"
                              title="Quitar hoja"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Parámetros operativos del turno sin electricidad */}
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 rounded-xl border border-slate-200 p-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Fecha y hora del turno anotado
                  </label>
                  <input
                    type="datetime-local"
                    value={shiftDateTime}
                    max={toLocalDateTimeInputValue(new Date())}
                    onChange={e => setShiftDateTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Se registrará como la hora real en que ocurrió la venta.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Canal de venta
                  </label>
                  <select
                    value={channel}
                    onChange={e => setChannel(e.target.value as 'mostrador' | 'ruta')}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                  >
                    <option value="mostrador">Mostrador / Tienda física</option>
                    <option value="ruta">Ruta / Vendedor externo</option>
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Aparecerá identificado en reportes diarios y cierre de caja.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Bodega de descuento de stock
                  </label>
                  {warehouses.length > 0 ? (
                    <div className="relative">
                      <WarehouseIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <select
                        value={warehouseId}
                        onChange={e => setWarehouseId(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                      >
                        <option value="">Inventario general de empresa</option>
                        {warehouses.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.code ? `${w.code} · ` : ''}
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-600">
                      Inventario principal ({products.length} productos activos)
                    </div>
                  )}
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Aclaración opcional sobre cómo escribieron en el cuaderno
                  </label>
                  <input
                    type="text"
                    value={operatorNotes}
                    onChange={e => setOperatorNotes(e.target.value)}
                    placeholder="Ej.: Los precios están escritos sin los tres ceros (30 = 30.000), o 'PM' significa Pago Móvil..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">
                  Consejos para una lectura exacta a la primera:
                </p>
                <p>
                  • Toma la foto de frente y evita sombras fuertes sobre los números o cantidades.
                </p>
                <p>
                  • Si hay un renglón anulado, táchalo con una línea clara: el lector lo omitirá automáticamente, igual que las sumatorias de pie de página.
                </p>
              </div>
            </div>
          )}

          {/* PASO 2: MESA DE PRE-VALIDACIÓN FILA POR FILA */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* Barra de indicadores del lote */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <p className="text-[11px] text-slate-500">Ventas seleccionadas</p>
                  <p className="text-base font-bold text-slate-900 tabular-nums">
                    {batchValidation.activeSales} de {draftSales.length}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <p className="text-[11px] text-slate-500">Unidades a descontar</p>
                  <p className="text-base font-bold text-slate-900 tabular-nums">
                    {batchValidation.totalUnits} und
                  </p>
                </div>
                <div
                  className={`rounded-xl border px-3.5 py-2.5 ${
                    batchValidation.issuesCount > 0
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-emerald-200 bg-emerald-50/70'
                  }`}
                >
                  <p className="text-[11px] text-slate-600">Estado de validación</p>
                  <p
                    className={`text-sm font-bold ${
                      batchValidation.issuesCount > 0 ? 'text-amber-900' : 'text-emerald-800'
                    }`}
                  >
                    {batchValidation.issuesCount > 0
                      ? `${batchValidation.issuesCount} venta(s) por revisar`
                      : 'Todo cuadrado con stock'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-900 text-white px-3.5 py-2.5">
                  <p className="text-[11px] text-slate-300">Total a ingresar</p>
                  <p className="text-base font-bold tabular-nums">
                    {money(batchValidation.grandTotal)}
                  </p>
                </div>
              </div>

              {(pageSummary || skippedNotes.length > 0) && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 space-y-1">
                  {pageSummary && (
                    <p>
                      <strong className="text-slate-900">Lectura de página:</strong> {pageSummary}
                    </p>
                  )}
                  {skippedNotes.length > 0 && (
                    <p className="text-slate-500">
                      <strong>Omitidos automáticamente (tachados o totales de hoja):</strong>{' '}
                      {skippedNotes.join(' · ')}
                    </p>
                  )}
                </div>
              )}

              {/* Visor plegable de las hojas fotografiadas para cotejar con el papel */}
              {attachments.some(a => !a.isPdf) && (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      Referencia visual del cuaderno (toca una imagen para ampliar)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNotebookPreview(v => !v)}
                      className="text-xs font-medium text-emerald-700 hover:underline"
                    >
                      {showNotebookPreview ? 'Ocultar fotos' : 'Mostrar fotos'}
                    </button>
                  </div>
                  {showNotebookPreview && (
                    <div className="p-3 flex gap-3 overflow-x-auto">
                      {attachments
                        .filter(a => !a.isPdf)
                        .map((att, idx) => (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => setZoomAttachmentUrl(att.previewUrl)}
                            className="shrink-0 relative group rounded-lg border border-slate-200 overflow-hidden"
                          >
                            <img
                              src={att.previewUrl}
                              alt={`Hoja ${idx + 1}`}
                              className="h-28 w-auto max-w-[220px] object-cover"
                            />
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-slate-900/75 text-white text-[10px]">
                              Ampliar #{idx + 1}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Lista editable de ventas detectadas */}
              <div className="space-y-3">
                {draftSales.map((sale, sIdx) => {
                  const rowIssues = batchValidation.perRowIssues.get(sale.rowId) || []
                  const serverErr = rowErrors[sale.rowId]
                  const rowSum = round2(
                    sale.items.reduce(
                      (acc, it) => acc + round2((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)),
                      0
                    )
                  )
                  const rowTax = calcTax(rowSum, taxMode, taxRate)

                  return (
                    <div
                      key={sale.rowId}
                      className={`rounded-xl border transition-colors ${
                        !sale.included
                          ? 'border-slate-200 bg-slate-50/60 opacity-60'
                          : serverErr
                            ? 'border-red-300 bg-red-50/30'
                            : rowIssues.length > 0
                              ? 'border-amber-300 bg-amber-50/20'
                              : 'border-slate-200 bg-white'
                      }`}
                    >
                      {/* Cabecera de la venta */}
                      <div className="px-3.5 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sale.included}
                            onChange={e =>
                              updateSaleRow(sale.rowId, { included: e.target.checked })
                            }
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-bold text-slate-800">
                            Venta #{sIdx + 1}
                          </span>
                          {sale.sourceLineText && (
                            <span className="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[260px] sm:max-w-md">
                              Manuscrito: «{sale.sourceLineText}»
                            </span>
                          )}
                        </label>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 tabular-nums">
                            {money(rowTax.total)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setDraftSales(prev => prev.filter(x => x.rowId !== sale.rowId))
                            }
                            className="p-1 text-slate-400 hover:text-red-600"
                            title="Eliminar esta venta del borrador"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {sale.included && (
                        <div className="p-3.5 space-y-3">
                          {/* Pago y Cliente */}
                          <div className="grid sm:grid-cols-2 gap-2.5">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                Forma de pago
                                {sale.paymentDetailNote ? (
                                  <span className="text-emerald-700 font-normal">
                                    {' '}
                                    · Nota: {sale.paymentDetailNote}
                                  </span>
                                ) : null}
                              </label>
                              <select
                                value={sale.paymentMethod}
                                onChange={e =>
                                  updateSaleRow(sale.rowId, {
                                    paymentMethod: e.target.value as DraftScannedSale['paymentMethod'],
                                  })
                                }
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                              >
                                {PAYMENT_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                Cliente
                                {sale.rawCustomerName && !sale.customerId ? (
                                  <span className="text-amber-700 font-normal">
                                    {' '}
                                    · Anotado: «{sale.rawCustomerName}»
                                  </span>
                                ) : null}
                              </label>
                              <select
                                value={sale.customerId}
                                onChange={e =>
                                  updateSaleRow(sale.rowId, { customerId: e.target.value })
                                }
                                className={`w-full px-2.5 py-1.5 rounded-lg border bg-white text-xs text-slate-800 ${
                                  sale.paymentMethod === 'fiado' && !sale.customerId
                                    ? 'border-amber-400 bg-amber-50'
                                    : 'border-slate-300'
                                }`}
                              >
                                <option value="">Cliente general (contado)</option>
                                {customers.map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.document ? ` (${c.document})` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Renglones de productos de la venta */}
                          <div className="space-y-2">
                            {sale.items.map(item => {
                              const selectedProd = item.productId
                                ? productMap.get(item.productId)
                                : undefined
                              const variants = selectedProd
                                ? normalizeProductVariants(selectedProd.variants)
                                : []
                              const cumulativeNeeded = item.productId
                                ? cumulativeQtyByProduct.get(item.productId) || 0
                                : 0
                              const stockExceeded =
                                selectedProd && cumulativeNeeded > Number(selectedProd.stock)

                              return (
                                <div
                                  key={item.lineId}
                                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2"
                                >
                                  <div className="grid sm:grid-cols-12 gap-2 items-end">
                                    {/* Selector de Producto */}
                                    <div className="sm:col-span-6">
                                      <div className="flex items-center justify-between gap-1 mb-1">
                                        <span className="text-[11px] font-medium text-slate-600 truncate">
                                          Leído: <strong>{item.rawProductText}</strong>
                                          {item.variantHint ? ` (${item.variantHint})` : ''}
                                        </span>
                                        {selectedProd ? (
                                          <span
                                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                                              stockExceeded
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-emerald-100 text-emerald-800'
                                            }`}
                                          >
                                            Stock: {selectedProd.stock}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                                            Elegir producto
                                          </span>
                                        )}
                                      </div>
                                      <select
                                        value={item.productId}
                                        onChange={e =>
                                          handleSelectProductForLine(
                                            sale.rowId,
                                            item.lineId,
                                            e.target.value
                                          )
                                        }
                                        className={`w-full px-2.5 py-1.5 rounded-lg border bg-white text-xs text-slate-800 ${
                                          !item.productId
                                            ? 'border-amber-400 bg-amber-50'
                                            : 'border-slate-300'
                                        }`}
                                      >
                                        <option value="">-- Seleccionar producto del inventario --</option>
                                        {products.map(p => (
                                          <option key={p.id} value={p.id}>
                                            {p.name}
                                            {p.sku ? ` [${p.sku}]` : ''} — {money(p.price)} (Disp:{' '}
                                            {p.stock})
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Cantidad */}
                                    <div className="sm:col-span-2">
                                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                        Cantidad
                                      </label>
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={item.quantity}
                                        onChange={e => {
                                          const val = Math.max(1, parseInt(e.target.value, 10) || 1)
                                          updateSaleItem(sale.rowId, item.lineId, prev => ({
                                            ...prev,
                                            quantity: val,
                                          }))
                                        }}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs tabular-nums"
                                      />
                                    </div>

                                    {/* Precio unitario */}
                                    <div className="sm:col-span-3">
                                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                        Precio unit. ({currency})
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.unitPrice}
                                        onChange={e => {
                                          const val = Math.max(0, parseFloat(e.target.value) || 0)
                                          updateSaleItem(sale.rowId, item.lineId, prev => ({
                                            ...prev,
                                            unitPrice: val,
                                          }))
                                        }}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs tabular-nums"
                                      />
                                    </div>

                                    {/* Quitar renglón */}
                                    <div className="sm:col-span-1 flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => removeLineFromSale(sale.rowId, item.lineId)}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                                        title="Quitar renglón"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Selector de Variante y comparador de precio manuscrito vs sistema */}
                                  {(variants.length > 0 ||
                                    (item.writtenUnitPrice > 0 &&
                                      item.catalogUnitPrice > 0 &&
                                      Math.abs(item.writtenUnitPrice - item.catalogUnitPrice) >
                                        0.01)) && (
                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70">
                                      {variants.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="text-[11px] text-slate-500">
                                            Presentación:
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleSelectVariantForLine(sale.rowId, item.lineId, '')
                                            }
                                            className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                                              !item.variantId
                                                ? 'bg-slate-800 text-white border-slate-800'
                                                : 'bg-white text-slate-600 border-slate-300'
                                            }`}
                                          >
                                            Base
                                          </button>
                                          {variants.map(v => (
                                            <button
                                              key={v.id}
                                              type="button"
                                              onClick={() =>
                                                handleSelectVariantForLine(
                                                  sale.rowId,
                                                  item.lineId,
                                                  v.id
                                                )
                                              }
                                              className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                                                item.variantId === v.id
                                                  ? 'bg-slate-800 text-white border-slate-800'
                                                  : 'bg-white text-slate-600 border-slate-300'
                                              }`}
                                            >
                                              {v.label} ({money(v.price)})
                                            </button>
                                          ))}
                                        </div>
                                      )}

                                      {item.writtenUnitPrice > 0 &&
                                        item.catalogUnitPrice > 0 &&
                                        Math.abs(item.writtenUnitPrice - item.catalogUnitPrice) >
                                          0.01 && (
                                          <div className="flex items-center gap-1.5 text-[11px]">
                                            <span className="text-slate-500">
                                              En papel: {money(item.writtenUnitPrice)}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateSaleItem(sale.rowId, item.lineId, prev => ({
                                                  ...prev,
                                                  unitPrice:
                                                    Math.abs(prev.unitPrice - prev.writtenUnitPrice) <
                                                    0.01
                                                      ? prev.catalogUnitPrice
                                                      : prev.writtenUnitPrice,
                                                }))
                                              }
                                              className="px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-900 font-medium hover:bg-amber-100"
                                            >
                                              {Math.abs(item.unitPrice - item.writtenUnitPrice) < 0.01
                                                ? `Usar catálogo (${money(item.catalogUnitPrice)})`
                                                : `Usar papel (${money(item.writtenUnitPrice)})`}
                                            </button>
                                          </div>
                                        )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}

                            <button
                              type="button"
                              onClick={() => addLineToSale(sale.rowId)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1"
                            >
                              <Plus className="w-3.5 h-3.5" /> Añadir otro producto a esta misma venta
                            </button>
                          </div>

                          {/* Mensajes de validación o error de servidor */}
                          {(rowIssues.length > 0 || serverErr) && (
                            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-0.5">
                              {serverErr && (
                                <p className="font-semibold text-red-700">{serverErr}</p>
                              )}
                              {rowIssues.map((iss, idx) => (
                                <p key={idx}>• {iss}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={addManualSaleRow}
                className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 hover:border-slate-500 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Agregar otra fila de venta manualmente
              </button>
            </div>
          )}

          {/* PASO 3: REPORTE FINAL DE CONTINGENCIA APLICADO */}
          {step === 'done' && completedReport && (
            <div className="py-6 space-y-5">
              <div className="text-center max-w-md mx-auto space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Cuaderno digitalizado e incorporado a Ventas
                </h3>
                <p className="text-xs text-slate-500">
                  El inventario, Kardex, Caja{completedReport.queuedCount > 0 ? ' (en cola de sincronización)' : ''} y cuentas por cobrar quedaron actualizados con la hora del turno ({completedReport.capturedAtText}).
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 max-w-xl mx-auto">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                  <p className="text-[11px] text-slate-500">Ventas creadas</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">
                    {completedReport.registeredCount + completedReport.queuedCount}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                  <p className="text-[11px] text-slate-500">Unidades salidas</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">
                    {completedReport.totalUnits}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <p className="text-[11px] text-emerald-700">Monto total</p>
                  <p className="text-base font-bold text-emerald-900 tabular-nums">
                    {money(completedReport.totalAmount)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handlePrintAuditSheet}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50"
                >
                  <Printer className="w-4 h-4" /> Imprimir Acta de Digitalización
                </button>
                <button
                  type="button"
                  onClick={resetAll}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  <RotateCcw className="w-4 h-4" /> Escanear otra hoja
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  <Check className="w-4 h-4" /> Volver a Ventas
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Pie de acciones */}
        {step !== 'done' && (
          <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
            {step === 'upload' ? (
              <>
                <span className="text-xs text-slate-500">
                  {attachments.length === 0
                    ? 'Toma o selecciona al menos 1 foto del cuaderno para continuar.'
                    : `${attachments.length} página(s) lista(s) para reconocimiento de escritura.`}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    disabled={scanning}
                    onClick={onClose}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={attachments.length === 0 || preparingFiles || scanning}
                    onClick={() => void handleRunScan()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40"
                  >
                    {scanning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Leyendo letra manuscrita...
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="w-4 h-4" />
                        Analizar hoja y armar ventas
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={committing}
                  onClick={() => setStep('upload')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Cambiar fotos
                </button>

                <div className="flex items-center gap-2 ml-auto">
                  {commitProgress && (
                    <span className="text-xs font-medium text-slate-600 tabular-nums">
                      Guardando {commitProgress.current}/{commitProgress.total}...
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={
                      committing ||
                      batchValidation.activeSales === 0 ||
                      batchValidation.issuesCount > 0
                    }
                    onClick={() => void handleConfirmAndCommitSales()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-40"
                  >
                    {committing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Registrando en Kardex y Caja...
                      </>
                    ) : (
                      <>
                        <BookOpenCheck className="w-4 h-4" />
                        Confirmar y registrar {batchValidation.activeSales} venta(s) (
                        {money(batchValidation.grandTotal)})
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Visor a pantalla completa de la foto del cuaderno */}
      {zoomAttachmentUrl && (
        <div
          className="fixed inset-0 z-[60] bg-slate-950/85 flex items-center justify-center p-4"
          onClick={() => setZoomAttachmentUrl(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoomAttachmentUrl(null)}
              className="absolute top-3 right-3 p-2 rounded-lg bg-slate-900/80 text-white hover:bg-slate-900"
              aria-label="Cerrar vista ampliada"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={zoomAttachmentUrl}
              alt="Hoja del cuaderno ampliada"
              className="max-h-[88vh] w-auto object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}
