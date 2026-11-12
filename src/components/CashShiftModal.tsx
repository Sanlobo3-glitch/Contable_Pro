import { useState, useEffect, useMemo } from 'react'
import {
  X,
  Lock,
  Wallet,
  Receipt,
  Printer,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Coins,
  Banknote,
  Clock,
  Sparkles,
} from 'lucide-react'
import { useCurrency } from '../lib/currency'
import { esc, printHtml } from '../lib/documents'
import {
  COLOMBIAN_DENOMINATIONS,
  type DenominationItem,
  type ActiveShift,
  openCashShift,
  submitBlindArqueo,
} from '../services/cashShiftService'

interface Props {
  isOpen: boolean
  onClose: () => void
  activeShift: ActiveShift
  onShiftChange: () => void
}

type Mode = 'apertura' | 'arqueo_ciego' | 'resultado'

export default function CashShiftModal({ isOpen, onClose, activeShift, onShiftChange }: Props) {
  const { fmt: money } = useCurrency()

  const [mode, setMode] = useState<Mode>(activeShift.active ? 'arqueo_ciego' : 'apertura')
  const [openingAmount, setOpeningAmount] = useState('100000')
  const [notes, setNotes] = useState('')
  const [isFinalClosing, setIsFinalClosing] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Matriz de denominaciones físicas
  const [counts, setCounts] = useState<Record<number, number>>({})

  // Resultado tras guardar arqueo
  const [result, setResult] = useState<{
    stage: string
    expected: number
    counted: number
    diff: number
    salesCash: number
    salesCard: number
    salesTransfer: number
    salesCredit: number
    salesCount: number
  } | null>(null)

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('')
      setResult(null)
      setNotes('')
      setCounts({})
      setMode(activeShift.active ? 'arqueo_ciego' : 'apertura')
    }
  }, [isOpen])

  const totalDenominations = useMemo(() => {
    return COLOMBIAN_DENOMINATIONS.reduce((sum, d) => {
      const q = counts[d.denomination] || 0
      return sum + q * d.denomination
    }, 0)
  }, [counts])

  if (!isOpen) return null

  const handleDenomChange = (denomination: number, val: string) => {
    const q = parseInt(val, 10)
    setCounts(prev => ({
      ...prev,
      [denomination]: isNaN(q) || q < 0 ? 0 : q,
    }))
  }

  const handleOpenShift = async () => {
    setErrorMsg('')
    const amount = parseFloat(openingAmount)
    if (isNaN(amount) || amount < 0) {
      setErrorMsg('Ingresa un monto base válido (mayor o igual a 0)')
      return
    }

    setSaving(true)
    const denomsList: DenominationItem[] = COLOMBIAN_DENOMINATIONS.map(d => ({
      ...d,
      quantity: counts[d.denomination] || 0,
      subtotal: (counts[d.denomination] || 0) * d.denomination,
    })).filter(x => x.quantity > 0)

    const res = await openCashShift(amount, null, notes, denomsList)
    setSaving(false)

    if (res.ok) {
      onShiftChange()
      onClose()
    } else {
      setErrorMsg(res.message || 'No se pudo abrir el turno de caja')
    }
  }

  const handleArqueoCiego = async () => {
    setErrorMsg('')
    if (totalDenominations <= 0) {
      setErrorMsg('Debes registrar el conteo físico de billetes o monedas en el cajón.')
      return
    }

    setSaving(true)
    const denomsList: DenominationItem[] = COLOMBIAN_DENOMINATIONS.map(d => ({
      ...d,
      quantity: counts[d.denomination] || 0,
      subtotal: (counts[d.denomination] || 0) * d.denomination,
    }))

    const shiftId = activeShift.shift_id || 'active'
    const res = await submitBlindArqueo(shiftId, totalDenominations, notes, denomsList, isFinalClosing)
    setSaving(false)

    if (res.ok) {
      setResult({
        stage: res.stage,
        expected: res.expected_cash,
        counted: res.counted_cash,
        diff: res.difference,
        salesCash: activeShift.sales_cash || 0,
        salesCard: activeShift.sales_card || 0,
        salesTransfer: activeShift.sales_transfer || 0,
        salesCredit: activeShift.sales_credit || 0,
        salesCount: activeShift.sales_count || 0,
      })
      setMode('resultado')
      onShiftChange()
    } else {
      setErrorMsg(res.message || 'Error al procesar el arqueo de caja')
    }
  }

  const printClosingTicket = () => {
    if (!result) return
    const now = new Date()
    const isZ = result.stage === 'cierre_z'
    const diffStatus =
      result.diff === 0
        ? 'CUADRE EXACTO'
        : result.diff > 0
        ? `SOBRANTE: ${money(result.diff)}`
        : `FALTANTE: ${money(Math.abs(result.diff))}`

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${isZ ? 'Cierre Z de Turno' : 'Arqueo Parcial X'}</title>
        <style>
          body {
            font-family: 'Courier New', monospace;
            font-size: 13px;
            color: #000;
            width: 280px;
            margin: 0 auto;
            padding: 10px;
            line-height: 1.4;
          }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line { border-bottom: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; }
          .big { font-size: 15px; }
        </style>
      </head>
      <body>
        <div class="center bold big">COMPROBANTE DE ${isZ ? 'CIERRE FINAL (Z)' : 'CORTE PARCIAL (X)'}</div>
        <div class="center">CONTABLE PRO ERP</div>
        <div class="line"></div>
        <div class="row"><span>Fecha:</span><span>${now.toLocaleDateString()} ${now.toLocaleTimeString()}</span></div>
        <div class="row"><span>Cajero:</span><span>${esc(activeShift.cashier_name || 'Cajero')}</span></div>
        <div class="row"><span>Turno ID:</span><span>${esc((activeShift.shift_id || '').slice(0, 8))}</span></div>
        <div class="line"></div>
        <div class="bold">RESUMEN DE VENTAS DEL TURNO:</div>
        <div class="row"><span>Total Facturas:</span><span class="bold">${result.salesCount}</span></div>
        <div class="row"><span>Ventas Efectivo:</span><span>${money(result.salesCash)}</span></div>
        <div class="row"><span>Ventas Tarjeta:</span><span>${money(result.salesCard)}</span></div>
        <div class="row"><span>Ventas Transferencia:</span><span>${money(result.salesTransfer)}</span></div>
        <div class="row"><span>Ventas a Crédito/Fiado:</span><span>${money(result.salesCredit)}</span></div>
        <div class="line"></div>
        <div class="bold">ARQUEO DE CAJA FÍSICA:</div>
        <div class="row"><span>Base Inicial:</span><span>${money(activeShift.opening_amount)}</span></div>
        <div class="row"><span>Efectivo Esperado:</span><span>${money(result.expected)}</span></div>
        <div class="row bold"><span>Efectivo Contado:</span><span>${money(result.counted)}</span></div>
        <div class="line"></div>
        <div class="center bold big">${diffStatus}</div>
        ${notes ? `<div class="line"></div><div><strong>Notas:</strong> ${esc(notes)}</div>` : ''}
        <div class="line"></div>
        <br/><br/>
        <div class="center">__________________________<br/>Firma Cajero Responsable</div>
        <br/><br/>
        <div class="center">__________________________<br/>Firma Supervisor / Administrador</div>
        <div class="line"></div>
        <div class="center" style="font-size: 10px;">Sistema Contable Pro · Auditoría Digital</div>
      </body>
      </html>
    `
    printHtml(html)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                {mode === 'apertura'
                  ? 'Apertura de Turno de Caja'
                  : mode === 'arqueo_ciego'
                  ? 'Arqueo Ciego de Caja'
                  : 'Resultado del Cierre de Caja'}
              </h2>
              <p className="text-xs text-slate-500">
                {activeShift.active
                  ? `Turno activo de ${activeShift.cashier_name || 'Cajero'}`
                  : 'Asigna fondo fijo para iniciar operaciones'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-rose-700 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* MODO 1: APERTURA DE TURNO */}
          {mode === 'apertura' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl space-y-2">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Monto Base Inicial (Efectivo en Caja)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono font-bold">$</span>
                  <input
                    type="number"
                    value={openingAmount}
                    onChange={e => setOpeningAmount(e.target.value)}
                    placeholder="0"
                    className="w-full pl-8 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-lg font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Fondo fijo entregado al cajero para dar cambio / vueltas al inicio de la jornada.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notas u observaciones de apertura</label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Ej: Billetes de baja denominación entregados por tesorería"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {/* MODO 2: ARQUEO CIEGO */}
          {mode === 'arqueo_ciego' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-800">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold">Protocolo de Arqueo Ciego Antifraude:</strong> Cuenta el dinero en
                  el cajón y anota la cantidad de cada billete o moneda. El sistema calculará el total físico y lo
                  comparará contra las ventas registradas.
                </div>
              </div>

              {/* Selector Cierre X vs Z */}
              <div className="flex gap-2 p-1 bg-slate-100 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setIsFinalClosing(true)}
                  className={`flex-1 py-1.5 rounded-md transition-colors ${
                    isFinalClosing ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cierre Final (Cierre Z)
                </button>
                <button
                  type="button"
                  onClick={() => setIsFinalClosing(false)}
                  className={`flex-1 py-1.5 rounded-md transition-colors ${
                    !isFinalClosing ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Arqueo Parcial (Cierre X)
                </button>
              </div>

              {/* Matriz de denominaciones COP */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-600 flex justify-between">
                  <span>Denominación COP</span>
                  <span>Cantidad Física</span>
                  <span className="text-right">Subtotal</span>
                </div>
                <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                  {COLOMBIAN_DENOMINATIONS.map(d => {
                    const q = counts[d.denomination] || 0
                    const sub = q * d.denomination
                    return (
                      <div key={d.denomination} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <div className="flex items-center gap-1.5 w-32 font-medium text-slate-700">
                          {d.kind === 'billete' ? (
                            <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Coins className="w-3.5 h-3.5 text-amber-600" />
                          )}
                          <span>{money(d.denomination)}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          value={q === 0 ? '' : q}
                          onChange={e => handleDenomChange(d.denomination, e.target.value)}
                          placeholder="0"
                          className="w-20 px-2 py-1 text-center font-mono font-semibold bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <span className="w-28 text-right font-mono font-medium text-slate-800">
                          {money(sub)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="bg-slate-50 px-3 py-2.5 border-t border-slate-200 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-700">TOTAL FÍSICO CONTADO:</span>
                  <span className="text-base font-mono font-bold text-emerald-700">
                    {money(totalDenominations)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Explicación o notas del cajero (obligatorio si hay diferencia)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Ej: Cambio entregado en billetes grandes, pago de mensajería menor"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {/* MODO 3: RESULTADO TRAS CIERRE */}
          {mode === 'resultado' && result && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border text-center ${
                  result.diff === 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : result.diff > 0
                    ? 'bg-sky-50 border-sky-200 text-sky-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <div className="text-sm font-semibold uppercase tracking-wider mb-1">
                  {result.stage === 'cierre_z' ? 'Cierre Z Definitivo Guardado' : 'Arqueo Parcial X Registrado'}
                </div>
                <div className="text-2xl font-mono font-black mb-1">
                  {result.diff === 0
                    ? 'Cuadre Exacto'
                    : result.diff > 0
                    ? `Sobrante de ${money(result.diff)}`
                    : `Faltante de ${money(Math.abs(result.diff))}`}
                </div>
                <p className="text-xs opacity-80">
                  {result.diff === 0
                    ? 'El conteo físico coincide perfectamente con el saldo contable del sistema.'
                    : 'La discrepancia ha quedado auditada y registrada en el historial de arqueos.'}
                </p>
              </div>

              {/* Comparativa Cifras */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                  <span className="text-slate-500 font-medium">Efectivo Teórico Esperado</span>
                  <div className="text-base font-mono font-bold text-slate-800">{money(result.expected)}</div>
                  <div className="text-[11px] text-slate-400">Base + Ventas Efectivo - Retiros</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                  <span className="text-slate-500 font-medium">Efectivo Físico Contado</span>
                  <div className="text-base font-mono font-bold text-slate-800">{money(result.counted)}</div>
                  <div className="text-[11px] text-slate-400">Suma total de billetes y monedas</div>
                </div>
              </div>

              {/* Desglose Medios de Pago */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
                <div className="font-semibold text-slate-700">Desglose de Facturación del Turno:</div>
                <div className="flex justify-between text-slate-600">
                  <span>Efectivo:</span>
                  <span className="font-mono font-medium">{money(result.salesCash)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tarjetas (Débito/Crédito):</span>
                  <span className="font-mono font-medium">{money(result.salesCard)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Transferencias (Nequi/Bancos):</span>
                  <span className="font-mono font-medium">{money(result.salesTransfer)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Crédito / Fiados:</span>
                  <span className="font-mono font-medium">{money(result.salesCredit)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pie de Acciones */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          {mode === 'resultado' ? (
            <>
              <button
                type="button"
                onClick={printClosingTicket}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Printer className="w-4 h-4" /> Imprimir Comprobante
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700"
              >
                Aceptar y Finalizar
              </button>
            </>
          ) : mode === 'apertura' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleOpenShift}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" /> {saving ? 'Abriendo...' : 'Abrir Turno de Caja'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleArqueoCiego}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />{' '}
                {saving ? 'Validando...' : isFinalClosing ? 'Ejecutar Cierre Z' : 'Guardar Corte X'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
