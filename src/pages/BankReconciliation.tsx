import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency, fmtDate } from '../lib/currency'
import { prepareDocumentFileForScan } from '../lib/handwrittenScannerClient'
import { downloadCsv } from '../lib/csv'
import { esc, printHtml } from '../lib/documents'
import { round2 } from '../lib/tax'
import {
  listSuiteRecords,
  upsertSuiteRecord,
  makeSuiteId,
  makeDocumentCode,
  parseBankStatementCsv,
  scanBankStatementAttachment,
  reconcileBankRowsWithSystem,
  type BankFeeKind,
  type BankReconciliationSession,
  type BankStatementRow,
  type CatalogOrderLite,
} from '../lib/commercialSuiteRepo'
import type { Expense, ExpenseCategory, Purchase, Sale } from '../types'
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Landmark,
  Lock,
  Printer,
  Receipt,
  ScanLine,
  Search,
  Upload,
} from 'lucide-react'

type RowFilter = 'all' | 'matched' | 'bank_fee' | 'unmatched'

const FEE_LABELS: Record<BankFeeKind, string> = {
  none: 'Operación comercial',
  gmf_4x1000: 'GMF / Impuesto 4×1000',
  comision_bancaria: 'Comisión / Cuota bancaria',
  iva_comision: 'IVA sobre comisión bancaria',
  igtf: 'IGTF bancario',
}

export default function BankReconciliation({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user, isDemo } = useAuth()
  const { fmt: money, currency } = useCurrency()
  const readOnly = isReadOnly(user)

  const scopeKey = useMemo(
    () => (isDemo ? 'demo' : user?.company_id || user?.id || 'default'),
    [isDemo, user?.company_id, user?.id]
  )

  const csvInputRef = useRef<HTMLInputElement>(null)
  const scanInputRef = useRef<HTMLInputElement>(null)

  const [sales, setSales] = useState<Sale[]>([])
  const [catalogOrders, setCatalogOrders] = useState<CatalogOrderLite[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([])
  const [sessions, setSessions] = useState<BankReconciliationSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const [bankName, setBankName] = useState('Bancolombia / Nequi')
  const [periodLabel, setPeriodLabel] = useState(() => new Date().toISOString().slice(0, 7))
  const [rowFilter, setRowFilter] = useState<RowFilter>('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const loadSystemData = useCallback(async () => {
    const [
      { data: saleRows },
      { data: orderRows },
      { data: purRows },
      { data: expRows },
      { data: catRows },
      reconRes,
    ] = await Promise.all([
      supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(350),
      supabase
        .from('catalog_orders')
        .select('id, order_code, customer_name, total, payment_reference, status, created_at')
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('purchases')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(350),
      supabase.from('expense_categories').select('*').order('name'),
      listSuiteRecords<BankReconciliationSession>('bank_reconciliations', scopeKey),
    ])

    setSales((saleRows || []) as Sale[])
    setCatalogOrders((orderRows || []) as CatalogOrderLite[])
    setPurchases((purRows || []) as Purchase[])
    setExpenses((expRows || []) as Expense[])
    setExpenseCategories((catRows || []) as ExpenseCategory[])
    setSessions(reconRes.rows)
    if (!activeSessionId && reconRes.rows.length > 0) {
      setActiveSessionId(reconRes.rows[0].id)
    }
  }, [scopeKey, activeSessionId])

  useEffect(() => {
    void loadSystemData()
  }, [loadSystemData])

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  )

  function buildSessionFromRows(
    rawRows: BankStatementRow[],
    customBank?: string,
    customPeriod?: string
  ): BankReconciliationSession {
    const reconciled = reconcileBankRowsWithSystem(rawRows, {
      sales,
      catalogOrders,
      purchases,
      expenses,
    })

    let credits = 0
    let debits = 0
    let matchedCount = 0
    let unmatchedCount = 0
    let feeCount = 0

    for (const r of reconciled) {
      if (r.direction === 'credit') credits += r.amount
      else debits += r.amount

      if (r.match_status === 'matched' || r.match_status === 'manual_ok') matchedCount++
      else if (r.match_status === 'bank_fee') feeCount++
      else unmatchedCount++
    }

    return {
      id: makeSuiteId(),
      recon_code: makeDocumentCode('CON'),
      bank_name: customBank || bankName.trim() || 'Cuenta bancaria',
      account_hint: null,
      period_label: customPeriod || periodLabel,
      rows: reconciled,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      fee_count: feeCount,
      fees_registered_amount: 0,
      total_credits: round2(credits),
      total_debits: round2(debits),
      status: 'abierta',
      created_by_name: user?.full_name || user?.email || 'Tesorería',
      created_at: new Date().toISOString(),
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setBusy(true)
    setFeedback(null)
    try {
      const text = await file.text()
      const parsed = parseBankStatementCsv(text)
      if (parsed.length === 0) {
        setFeedback({
          ok: false,
          text: 'No se detectaron movimientos válidos en el CSV. Verifica que tenga columnas de Fecha, Descripción y Valor (o Débito/Crédito).',
        })
        setBusy(false)
        return
      }

      const session = buildSessionFromRows(parsed)
      const { saved } = await upsertSuiteRecord('bank_reconciliations', scopeKey, session)
      setSessions(prev => [saved, ...prev.filter(x => x.id !== saved.id)])
      setActiveSessionId(saved.id)
      setFeedback({
        ok: true,
        text: `Extracto procesado (${saved.rows.length} movimientos): ${saved.matched_count} cruzados automáticamente, ${saved.fee_count} cargos bancarios detectados y ${saved.unmatched_count} pendientes de revisar.`,
      })
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Error al leer el archivo CSV.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleScanStatementFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 3)
    e.target.value = ''
    if (files.length === 0) return

    setBusy(true)
    setFeedback(null)
    try {
      const prepared = await Promise.all(files.map(f => prepareDocumentFileForScan(f)))
      const scanned = await scanBankStatementAttachment({
        files: prepared,
        currency,
      })

      if (scanned.rows.length === 0) {
        setFeedback({
          ok: false,
          text: 'No se detectaron renglones de movimientos en la imagen o PDF adjunto.',
        })
        setBusy(false)
        return
      }

      const detectedBank = scanned.bankName || bankName
      const detectedPeriod = scanned.periodHint || periodLabel
      setBankName(detectedBank)
      if (scanned.periodHint) setPeriodLabel(scanned.periodHint)

      const session = buildSessionFromRows(scanned.rows, detectedBank, detectedPeriod)
      const { saved } = await upsertSuiteRecord('bank_reconciliations', scopeKey, session)
      setSessions(prev => [saved, ...prev.filter(x => x.id !== saved.id)])
      setActiveSessionId(saved.id)
      setFeedback({
        ok: true,
        text: `Lectura óptica de ${detectedBank} completada (${saved.rows.length} movimientos extraídos y conciliados contra tus libros).`,
      })
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudo escanear el extracto.',
      })
    } finally {
      setBusy(false)
    }
  }

  function downloadSampleStatementCsv() {
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(
      'plantilla_extracto_bancario.csv',
      ['Fecha', 'Descripcion', 'Referencia', 'Credito', 'Debito'],
      [
        [today, 'Transferencia recibida Nequi cliente', '849201', 90000, 0],
        [today, 'Abono ventas datáfono Redeban', '991024', 150000, 0],
        [today, 'Comisión manejo cuenta empresarial', 'COM-01', 0, 14900],
        [today, 'Impuesto Gob 4x1000 GMF', 'GMF-01', 0, 960],
      ]
    )
  }

  async function handleToggleManualOk(rowId: string) {
    if (!activeSession || readOnly) return
    const updatedRows = activeSession.rows.map(r => {
      if (r.row_id !== rowId) return r
      const nextStatus: BankStatementRow['match_status'] =
        r.match_status === 'manual_ok' ? 'unmatched' : 'manual_ok'
      return {
        ...r,
        match_status: nextStatus,
        matched_label:
          nextStatus === 'manual_ok' ? 'Verificado manualmente por tesorería' : null,
      }
    })

    const matchedCount = updatedRows.filter(
      r => r.match_status === 'matched' || r.match_status === 'manual_ok'
    ).length
    const unmatchedCount = updatedRows.filter(r => r.match_status === 'unmatched').length

    const updated: BankReconciliationSession = {
      ...activeSession,
      rows: updatedRows,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
    }
    const { saved } = await upsertSuiteRecord('bank_reconciliations', scopeKey, updated)
    setSessions(prev => prev.map(s => (s.id === saved.id ? saved : s)))
  }

  async function handleRegisterDetectedBankFees() {
    if (!activeSession || readOnly || busy) return
    const pendingFees = activeSession.rows.filter(
      r => r.match_status === 'bank_fee' && !r.fee_registered
    )
    if (pendingFees.length === 0) return

    setBusy(true)
    setFeedback(null)

    // Asegurar categorías base de gasto si están vacías
    let cats = expenseCategories
    if (cats.length === 0) {
      await supabase.rpc('asegurar_categorias_gasto')
      const { data } = await supabase.from('expense_categories').select('*').order('name')
      cats = (data || []) as ExpenseCategory[]
      setExpenseCategories(cats)
    }

    const financialCat =
      cats.find(c => /banc|financ|impuesto|comision|admin|general|otro/i.test(c.name)) ||
      cats[0] ||
      null

    let registeredTotal = 0
    const registeredIds = new Set<string>()

    for (const fee of pendingFees) {
      const { error } = await supabase.rpc('registrar_gasto', {
        p_category_id: financialCat?.id || null,
        p_amount: fee.amount,
        p_method: 'transferencia',
        p_description: `${FEE_LABELS[fee.fee_kind]} · ${fee.description}`,
        p_beneficiary: activeSession.bank_name,
        p_reference: fee.reference || activeSession.recon_code,
        p_expense_date: fee.date,
      })
      if (!error) {
        registeredTotal += fee.amount
        registeredIds.add(fee.row_id)
      }
    }

    const updatedRows = activeSession.rows.map(r =>
      registeredIds.has(r.row_id) ? { ...r, fee_registered: true } : r
    )

    const updated: BankReconciliationSession = {
      ...activeSession,
      rows: updatedRows,
      fees_registered_amount: round2(
        (activeSession.fees_registered_amount || 0) + registeredTotal
      ),
    }

    const { saved } = await upsertSuiteRecord('bank_reconciliations', scopeKey, updated)
    setSessions(prev => prev.map(s => (s.id === saved.id ? saved : s)))
    await loadSystemData()
    setBusy(false)

    setFeedback({
      ok: registeredIds.size > 0,
      text:
        registeredIds.size > 0
          ? `Se contabilizaron ${registeredIds.size} cargos bancarios (4×1000 / comisiones) por ${money(registeredTotal)} en Gastos Operativos.`
          : 'No se pudieron registrar automáticamente los gastos bancarios. Revisa Gastos Operativos.',
    })
  }

  function handlePrintReconciliation() {
    if (!activeSession) return
    const rowsHtml = activeSession.rows
      .map(
        r => `<tr>
          <td>${esc(r.date)}</td>
          <td>${esc(r.description)}${r.reference ? ` <span style="color:#64748b">(Ref: ${esc(r.reference)})</span>` : ''}</td>
          <td style="text-align:right;color:${r.direction === 'credit' ? '#047857' : '#b91c1c'}">${r.direction === 'credit' ? '+' : '-'}${esc(money(r.amount))}</td>
          <td>${esc(r.matched_label || (r.match_status === 'bank_fee' ? FEE_LABELS[r.fee_kind] : 'Sin cruzar'))}</td>
        </tr>`
      )
      .join('')

    printHtml(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Conciliación ${esc(activeSession.recon_code)}</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#0f172a;font-size:12px}
        h1{font-size:18px;margin:0 0 4px}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left}
        th{background:#f8fafc;font-size:11px;text-transform:uppercase;color:#475569}
      </style></head><body>
      <h1>Acta de Conciliación Bancaria · ${esc(activeSession.recon_code)}</h1>
      <p style="color:#475569">${esc(activeSession.bank_name)} · Período: ${esc(activeSession.period_label || 'Actual')} · Entradas: <strong>${esc(money(activeSession.total_credits))}</strong> · Salidas: <strong>${esc(money(activeSession.total_debits))}</strong></p>
      <table>
        <thead><tr><th>Fecha</th><th>Concepto extracto</th><th style="text-align:right">Monto</th><th>Cruce en libros</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body></html>`)
  }

  const filteredRows = useMemo(() => {
    if (!activeSession) return []
    const q = search.trim().toLowerCase()
    return activeSession.rows.filter(r => {
      if (
        q &&
        !r.description.toLowerCase().includes(q) &&
        !(r.reference || '').toLowerCase().includes(q) &&
        !(r.matched_label || '').toLowerCase().includes(q)
      ) {
        return false
      }
      if (rowFilter === 'matched') {
        return r.match_status === 'matched' || r.match_status === 'manual_ok'
      }
      if (rowFilter === 'bank_fee') return r.match_status === 'bank_fee'
      if (rowFilter === 'unmatched') return r.match_status === 'unmatched'
      return true
    })
  }, [activeSession, rowFilter, search])

  const pendingFeeRowsCount = useMemo(
    () =>
      activeSession
        ? activeSession.rows.filter(r => r.match_status === 'bank_fee' && !r.fee_registered)
            .length
        : 0,
    [activeSession]
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Conciliación bancaria automática
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Cruza en segundos tu extracto CSV, PDF o captura de Bancolombia, Nequi, Daviplata, Banesco o Zelle contra Ventas, Pedidos Web, Compras y Gastos, y contabiliza el 4×1000 y comisiones en un clic.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={downloadSampleStatementCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Plantilla CSV
          </button>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={e => void handleCsvUpload(e)}
            className="hidden"
          />
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => csvInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          >
            <Upload className="w-4 h-4" />
            Subir extracto CSV
          </button>

          <input
            ref={scanInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={e => void handleScanStatementFiles(e)}
            className="hidden"
          />
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => scanInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs sm:text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
          >
            <ScanLine className="w-4 h-4" />
            {busy ? 'Analizando extracto...' : 'Escanear PDF / Foto extracto'}
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Modo solo lectura: activa tu suscripción para cargar extractos y contabilizar comisiones.
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline opacity-75 hover:opacity-100"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Parámetros del banco y selector de actas previas */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Entidad bancaria / Billetera
          </label>
          <input
            value={bankName}
            onChange={e => setBankName(e.target.value)}
            placeholder="Ej. Bancolombia Ahorros / Nequi"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Mes o corte conciliado
          </label>
          <input
            value={periodLabel}
            onChange={e => setPeriodLabel(e.target.value)}
            placeholder="2026-11"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Actas de conciliación guardadas
          </label>
          <select
            value={activeSessionId || ''}
            onChange={e => setActiveSessionId(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            {sessions.length === 0 && <option value="">Sin extractos cargados aún</option>}
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.recon_code} · {s.bank_name} ({s.rows.length} movs.)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Estado vacío */}
      {!activeSession && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <Landmark className="w-10 h-10 text-slate-400 mx-auto" />
          <div className="max-w-lg mx-auto space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Sube un extracto CSV o fotografía tu pantalla de movimientos bancarios
            </h2>
            <p className="text-sm text-slate-500">
              El conciliador empareja cada ingreso con tus ventas o pedidos web y detecta cobros silenciosos del banco (4×1000, cuota de manejo, IVA comisión, IGTF) para llevarlos directo a gastos.
            </p>
          </div>
        </div>
      )}

      {/* Resultados de conciliación */}
      {activeSession && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Entradas en extracto</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                +{money(activeSession.total_credits)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {activeSession.matched_count} movimientos conciliados
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Salidas en extracto</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                -{money(activeSession.total_debits)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Pagos, compras y deducciones</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Cargos bancarios (4×1000 / Comisiones)</p>
              <p className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">
                {activeSession.fee_count}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {pendingFeeRowsCount > 0
                  ? `${pendingFeeRowsCount} pendientes de llevar a Gastos`
                  : 'Contabilizados en Gastos'}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Movimientos huérfanos (sin cruzar)</p>
              <p
                className={`text-2xl font-bold mt-1 tabular-nums ${
                  activeSession.unmatched_count > 0 ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {activeSession.unmatched_count}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={handlePrintReconciliation}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Acta PDF
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `conciliacion_${activeSession.recon_code}.csv`,
                      ['Fecha', 'Concepto', 'Referencia', 'Naturaleza', 'Monto', 'Estado', 'Cruce'],
                      activeSession.rows.map(r => [
                        r.date,
                        r.description,
                        r.reference,
                        r.direction === 'credit' ? 'Entrada' : 'Salida',
                        r.amount,
                        r.match_status,
                        r.matched_label || FEE_LABELS[r.fee_kind],
                      ])
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filtrar por concepto, referencia o venta..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: `Todos (${activeSession.rows.length})` },
                      { id: 'matched', label: `Conciliados (${activeSession.matched_count})` },
                      { id: 'bank_fee', label: `4×1000 y comisiones (${activeSession.fee_count})` },
                      { id: 'unmatched', label: `Sin cruzar (${activeSession.unmatched_count})` },
                    ] as const
                  ).map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setRowFilter(f.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                        rowFilter === f.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {pendingFeeRowsCount > 0 && (
                  <button
                    type="button"
                    disabled={readOnly || busy}
                    onClick={() => void handleRegisterDetectedBankFees()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    Contabilizar {pendingFeeRowsCount} gasto(s) bancario(s)
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Fecha</th>
                    <th className="text-left px-4 py-3 font-medium">Concepto en extracto</th>
                    <th className="text-right px-4 py-3 font-medium">Monto</th>
                    <th className="text-left px-4 py-3 font-medium">Cruce en Contable Pro</th>
                    <th className="text-right px-4 py-3 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map(row => (
                    <tr key={row.row_id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {fmtDate(row.date)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.description}</div>
                        {row.reference && (
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            Ref: {row.reference}
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ${
                          row.direction === 'credit' ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {row.direction === 'credit' ? '+' : '-'}
                        {money(row.amount)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {row.match_status === 'matched' || row.match_status === 'manual_ok' ? (
                          <span className="text-emerald-800 font-medium">
                            {row.matched_label || 'Conciliado'}
                          </span>
                        ) : row.match_status === 'bank_fee' ? (
                          <span className="text-amber-800 font-medium">
                            {FEE_LABELS[row.fee_kind]}
                            {row.fee_registered ? ' · Registrado en Gastos' : ' · Pendiente registrar'}
                          </span>
                        ) : (
                          <span className="text-red-700 font-medium">
                            Huérfano · {row.direction === 'credit' ? 'Ingreso sin factura asociada' : 'Egreso sin soporte en libros'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {row.match_status === 'unmatched' && onNavigate && (
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate(row.direction === 'credit' ? 'sales' : 'expenses')
                              }
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {row.direction === 'credit' ? 'Ir a Ventas' : 'Ir a Gastos'}
                            </button>
                          )}

                          {(row.match_status === 'unmatched' ||
                            row.match_status === 'manual_ok') && (
                            <button
                              type="button"
                              disabled={readOnly}
                              onClick={() => void handleToggleManualOk(row.row_id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {row.match_status === 'manual_ok' ? 'Desmarcar' : 'Dar por conciliado'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-sm">
                        No hay movimientos bancarios en este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
