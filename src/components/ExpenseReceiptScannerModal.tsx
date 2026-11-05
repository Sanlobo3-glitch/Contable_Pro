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
  scanExpenseReceiptsDocument,
  type DraftScannedExpense,
} from '../lib/invoiceExpenseScannerClient'
import type { Branch, CompanyConfig, ExpenseCategory } from '../types'
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
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from 'lucide-react'

interface ExpenseReceiptScannerModalProps {
  open: boolean
  onClose: () => void
  onCompleted: (summaryMsg: string) => void
  categories: ExpenseCategory[]
  branches?: Branch[]
  config: CompanyConfig | null
}

const METHOD_OPTIONS: Array<{
  value: 'efectivo' | 'transferencia' | 'tarjeta'
  label: string
}> = [
  { value: 'efectivo', label: 'Efectivo (descuenta de Caja)' },
  { value: 'transferencia', label: 'Transferencia / PSE / Pago Móvil / Nequi (Bancos)' },
  { value: 'tarjeta', label: 'Tarjeta / Débito (Bancos)' },
]

export default function ExpenseReceiptScannerModal({
  open,
  onClose,
  onCompleted,
  categories,
  branches = [],
  config,
}: ExpenseReceiptScannerModalProps) {
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [attachments, setAttachments] = useState<PreparedScanAttachment[]>([])
  const [preparingFiles, setPreparingFiles] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [operatorNotes, setOperatorNotes] = useState('')
  const [pageSummary, setPageSummary] = useState('')
  const [isMerchandiseInvoice, setIsMerchandiseInvoice] = useState(false)
  const [draftExpenses, setDraftExpenses] = useState<DraftScannedExpense[]>([])
  const [showDocPreview, setShowDocPreview] = useState(true)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const currency = config?.currency || 'USD'
  const money = (n: number) => formatMoney(n, currency)
  const activeCategories = useMemo(() => categories.filter(c => c.active), [categories])
  const activeBranches = useMemo(() => branches.filter(b => b.active !== false), [branches])

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
    setPageSummary('')
    setIsMerchandiseInvoice(false)
    setDraftExpenses([])
    setErrorMsg('')
    setDoneMsg('')
    setZoomUrl(null)
  }, [open])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setErrorMsg('')
    const remaining = 4 - attachments.length
    if (remaining <= 0) {
      setErrorMsg('Puedes analizar hasta 4 recibos o páginas por lote.')
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
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo procesar el archivo.')
    } finally {
      setPreparingFiles(false)
    }
  }

  async function runScan() {
    if (attachments.length === 0 || scanning) return
    setErrorMsg('')
    setScanning(true)
    try {
      const res = await scanExpenseReceiptsDocument({
        attachments,
        categories: activeCategories,
        currency,
        defaultBranchId: '',
        operatorNotes,
      })
      if (res.draftExpenses.length === 0 && !res.isMerchandiseInvoice) {
        setErrorMsg(
          'No se detectaron montos o datos de recibo en la imagen. Enfoca de frente el total y encabezado del servicio.'
        )
        return
      }
      setPageSummary(res.pageSummary)
      setIsMerchandiseInvoice(res.isMerchandiseInvoice)
      setDraftExpenses(res.draftExpenses)
      setStep('review')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al leer el recibo.')
    } finally {
      setScanning(false)
    }
  }

  function updateRow(rowId: string, patch: Partial<DraftScannedExpense>) {
    setDraftExpenses(prev => prev.map(r => (r.rowId === rowId ? { ...r, ...patch } : r)))
  }

  function addManualExpense() {
    setDraftExpenses(prev => [
      ...prev,
      {
        rowId: `exp-${Date.now()}`,
        included: true,
        beneficiary: '',
        serviceType: 'Servicio / Gasto',
        categoryId: activeCategories[0]?.id || '',
        suggestedCategoryName: 'Servicios públicos',
        reference: '',
        expenseDate: new Date().toLocaleDateString('sv-SE'),
        dueDate: '',
        description: '',
        amount: 0,
        method: 'transferencia',
        branchId: '',
        confidence: 'alta',
      },
    ])
  }

  const includedRows = useMemo(
    () => draftExpenses.filter(r => r.included),
    [draftExpenses]
  )

  const totalBatch = useMemo(
    () => round2(includedRows.reduce((acc, r) => acc + Math.max(0, Number(r.amount) || 0), 0)),
    [includedRows]
  )

  async function handleConfirmExpenses() {
    if (committing || includedRows.length === 0) return
    setErrorMsg('')

    for (const r of includedRows) {
      if (!(r.amount > 0)) {
        setErrorMsg(`Ingresa un monto mayor a cero para "${r.beneficiary || r.serviceType}".`)
        return
      }
      if (!r.description.trim()) {
        setErrorMsg(`Escribe el concepto o descripción para "${r.beneficiary || r.serviceType}".`)
        return
      }
    }

    setCommitting(true)
    try {
      let fallbackCatId = activeCategories[0]?.id || ''

      // Si aún no existía ninguna categoría activa, asegurar las categorías base automáticamente
      if (!fallbackCatId) {
        await supabase.rpc('asegurar_categorias_gasto')
        const { data: refreshedCats } = await supabase
          .from('expense_categories')
          .select('id, name, active')
          .eq('active', true)
          .order('name')
        fallbackCatId = (refreshedCats as { id: string }[] | null)?.[0]?.id || ''
      }

      let savedCount = 0
      for (const r of includedRows) {
        const targetCategoryId = r.categoryId || fallbackCatId
        if (!targetCategoryId) {
          throw new Error('Selecciona una categoría de gasto antes de guardar.')
        }

        const { data: createdId, error } = await supabase.rpc('registrar_gasto', {
          p_category_id: targetCategoryId,
          p_amount: round2(r.amount),
          p_method: r.method,
          p_description: r.description.trim(),
          p_beneficiary: r.beneficiary.trim() || null,
          p_reference: r.reference.trim() || null,
          p_expense_date: r.expenseDate || new Date().toLocaleDateString('sv-SE'),
        })

        if (error) {
          throw new Error(`No se pudo registrar "${r.description}": ${error.message}`)
        }

        if (r.branchId && typeof createdId === 'string' && createdId) {
          try {
            await supabase.rpc('asignar_centro_costo_operacion', {
              p_table: 'expenses',
              p_id: createdId,
              p_branch_id: r.branchId,
            })
          } catch {
            /* opcional */
          }
        }
        savedCount += 1
      }

      const summary = `${savedCount} recibo(s) de servicio/gasto registrados por ${money(totalBatch)}.`
      setDoneMsg(summary)
      setStep('done')
      onCompleted(summary)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al registrar los gastos.')
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
        className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-100 border border-sky-200 text-sky-800 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Escáner de Recibos de Agua, Luz, Servicios y Gastos
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Fotografía o sube recibos de servicios públicos, internet, arriendo, fletes o gastos operativos
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
                  className="py-5 px-4 rounded-xl border-2 border-dashed border-sky-300 hover:border-sky-500 bg-sky-50/50 hover:bg-sky-50 transition-colors flex flex-col items-center justify-center gap-1.5 text-center disabled:opacity-50"
                >
                  <Camera className="w-6 h-6 text-sky-700" />
                  <span className="text-sm font-bold text-slate-900">
                    Tomar foto al recibo (Agua, Luz, Gas, Internet)
                  </span>
                  <span className="text-xs text-slate-600">
                    Detecta empresa, contrato/NIC, periodo y total a pagar
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
                    Subir recibos en foto o PDF desde tu teléfono/PC
                  </span>
                  <span className="text-xs text-slate-600">
                    Puedes subir hasta 4 recibos distintos al mismo tiempo
                  </span>
                </button>
              </div>

              {preparingFiles && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin" /> Preparando recibo...
                </div>
              )}

              {attachments.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {attachments.map((att, i) => (
                    <div key={att.id} className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                      {att.isPdf ? (
                        <div className="h-28 flex flex-col items-center justify-center p-2 text-center">
                          <FileText className="w-7 h-7 text-red-600 mb-1" />
                          <span className="text-[11px] font-medium text-slate-700 line-clamp-2">{att.name}</span>
                        </div>
                      ) : (
                        <img src={att.previewUrl} alt={att.name} className="w-full h-28 object-cover" />
                      )}
                      <div className="px-2 py-1 bg-white border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="font-medium text-slate-700">Doc. {i + 1}</span>
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
                  Nota opcional (ej. «Pagado por Nequi» o «Local principal»)
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

          {step === 'review' && (
            <div className="space-y-4">
              {isMerchandiseInvoice && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-900">
                  <strong>Aviso:</strong> Este documento parece contener mercancía para inventario. Si deseas que sume unidades al stock de productos, escanéalo desde el módulo <strong>Compras</strong>.
                </div>
              )}

              {pageSummary && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 flex-wrap text-xs text-slate-700">
                  <span>
                    <strong className="text-slate-900">Resumen detectado:</strong> {pageSummary}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDocPreview(v => !v)}
                    className="inline-flex items-center gap-1 text-slate-700 font-semibold hover:underline"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {showDocPreview ? 'Ocultar soporte' : 'Ver soporte'}
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
                        <img src={att.previewUrl} alt={`Recibo ${idx + 1}`} className="h-24 w-36 object-cover" />
                      </button>
                    ))}
                </div>
              )}

              <div className="space-y-3">
                {draftExpenses.map((row, idx) => (
                  <div
                    key={row.rowId}
                    className={`rounded-xl border p-3.5 space-y-3 ${
                      !row.included ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.included}
                          onChange={e => updateRow(row.rowId, { included: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-300 text-slate-900"
                        />
                        <span className="text-xs font-bold text-slate-900">
                          Recibo #{idx + 1} · {row.serviceType}
                        </span>
                      </label>

                      <div className="flex items-center gap-2">
                        {row.dueDate && (
                          <span className="text-[11px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-medium">
                            Vence: {row.dueDate}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setDraftExpenses(prev => prev.filter(x => x.rowId !== row.rowId))}
                          className="p-1 text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Categoría contable
                        </label>
                        <select
                          value={row.categoryId}
                          onChange={e => updateRow(row.rowId, { categoryId: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
                        >
                          {activeCategories.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Beneficiario / Empresa emisora
                        </label>
                        <input
                          type="text"
                          value={row.beneficiary}
                          onChange={e => updateRow(row.rowId, { beneficiary: e.target.value })}
                          placeholder="Ej. EPM, Enel, Acueducto, Movistar..."
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          N° Factura / Contrato / NIC
                        </label>
                        <input
                          type="text"
                          value={row.reference}
                          onChange={e => updateRow(row.rowId, { reference: e.target.value })}
                          placeholder="Referencia del recibo"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Concepto / Descripción
                        </label>
                        <input
                          type="text"
                          value={row.description}
                          onChange={e => updateRow(row.rowId, { description: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Fecha
                        </label>
                        <input
                          type="date"
                          value={row.expenseDate}
                          onChange={e => updateRow(row.rowId, { expenseDate: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Pagado con
                        </label>
                        <select
                          value={row.method}
                          onChange={e =>
                            updateRow(row.rowId, {
                              method: e.target.value as DraftScannedExpense['method'],
                            })
                          }
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                        >
                          {METHOD_OPTIONS.map(m => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Monto total
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.amount}
                          onChange={e =>
                            updateRow(row.rowId, {
                              amount: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold tabular-nums"
                        />
                      </div>
                    </div>

                    {activeBranches.length > 0 && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Sede / Centro de costo (opcional)
                        </label>
                        <select
                          value={row.branchId}
                          onChange={e => updateRow(row.rowId, { branchId: e.target.value })}
                          className="w-full sm:w-64 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                        >
                          <option value="">General de la empresa</option>
                          {activeBranches.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addManualExpense}
                className="w-full py-2 rounded-xl border border-dashed border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Agregar otro recibo manualmente
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">¡Recibos registrados en Contabilidad!</h3>
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
                    <Loader2 className="w-4 h-4 animate-spin" /> Leyendo recibo(s)...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" /> Analizar recibo(s)
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
                  Total egresos: {money(totalBatch)}
                </span>
                <button
                  type="button"
                  disabled={committing || includedRows.length === 0}
                  onClick={() => void handleConfirmExpenses()}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 inline-flex items-center gap-2"
                >
                  {committing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Registrando...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4" /> Confirmar y registrar gasto(s)
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
          <img src={zoomUrl} alt="Recibo ampliado" className="max-w-full max-h-[90vh] rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
