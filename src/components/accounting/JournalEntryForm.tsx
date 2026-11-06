import React, { useState, useMemo } from 'react'
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Scale,
  Sparkles,
  ArrowRightLeft,
  Calendar,
  FileText,
  Save,
  Send,
  Loader2,
} from 'lucide-react'
import type { Account, CreateJournalEntryPayload } from '../../types'

export interface JournalFormLine {
  id: string
  accountId: string
  description: string
  debit: string
  credit: string
}

interface JournalEntryFormProps {
  companyId: string
  accounts: Account[]
  onSubmit: (payload: CreateJournalEntryPayload) => Promise<void>
  onCancel?: () => void
  isSubmitting?: boolean
  initialConcept?: string
  initialDate?: string
}

function parseMoney(val: string): number {
  if (!val) return 0
  const clean = val.replace(/,/g, '').trim()
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : Math.round(n * 10000) / 10000
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export default function JournalEntryForm({
  companyId,
  accounts,
  onSubmit,
  onCancel,
  isSubmitting = false,
  initialConcept = '',
  initialDate,
}: JournalEntryFormProps) {
  const today = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [entryDate, setEntryDate] = useState<string>(initialDate || today)
  const [concept, setConcept] = useState<string>(initialConcept)
  const [status, setStatus] = useState<'borrador' | 'posteado'>('posteado')
  const [formError, setFormError] = useState<string | null>(null)

  // Solo cuentas imputables / de último nivel
  const postableAccounts = useMemo(() => {
    return accounts.filter(a => a.is_postable && a.active)
  }, [accounts])

  // Cuentas por ID para acceso rápido
  const accountsById = useMemo(() => {
    return new Map(accounts.map(a => [a.id, a]))
  }, [accounts])

  // Líneas iniciales (por defecto 2 filas para partida doble)
  const [lines, setLines] = useState<JournalFormLine[]>([
    { id: 'row-1', accountId: '', description: '', debit: '', credit: '' },
    { id: 'row-2', accountId: '', description: '', debit: '', credit: '' },
  ])

  // Totales en tiempo real
  const { totalDebit, totalCredit, difference, isBalanced } = useMemo(() => {
    let deb = 0
    let cred = 0
    for (const l of lines) {
      deb += parseMoney(l.debit)
      cred += parseMoney(l.credit)
    }
    const diff = Math.round(Math.abs(deb - cred) * 10000) / 10000
    const balanced = deb > 0 && cred > 0 && diff < 0.0001
    return {
      totalDebit: deb,
      totalCredit: cred,
      difference: diff,
      isBalanced: balanced,
    }
  }, [lines])

  const handleAddLine = () => {
    setLines(prev => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        accountId: '',
        description: concept.trim(),
        debit: '',
        credit: '',
      },
    ])
  }

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 2) {
      setFormError('Un asiento contable debe contener un mínimo de dos líneas para cumplir con la Partida Doble.')
      return
    }
    setFormError(null)
    setLines(prev => prev.filter((_, idx) => idx !== index))
  }

  const handleLineChange = (index: number, field: keyof JournalFormLine, value: string) => {
    setFormError(null)
    setLines(prev => {
      const updated = [...prev]
      const current = { ...updated[index], [field]: value }

      // Exclusión mutua: si ingresa débito, credit pasa a 0; si ingresa crédito, debit pasa a 0
      if (field === 'debit' && parseMoney(value) > 0) {
        current.credit = ''
      } else if (field === 'credit' && parseMoney(value) > 0) {
        current.debit = ''
      }

      updated[index] = current
      return updated
    })
  }

  // Asistente de cuadre automático: agrega o ajusta una línea con la diferencia restante
  const handleAutoBalance = () => {
    if (difference <= 0.0001) return

    if (totalDebit > totalCredit) {
      // Falta crédito: agregamos línea de crédito
      setLines(prev => [
        ...prev,
        {
          id: `row-${Date.now()}`,
          accountId: '',
          description: `Cuadre de contrapartida: ${concept || 'Ajuste'}`,
          debit: '',
          credit: difference.toFixed(2),
        },
      ])
    } else {
      // Falta débito: agregamos línea de débito
      setLines(prev => [
        ...prev,
        {
          id: `row-${Date.now()}`,
          accountId: '',
          description: `Cuadre de contrapartida: ${concept || 'Ajuste'}`,
          debit: difference.toFixed(2),
          credit: '',
        },
      ])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!concept.trim()) {
      setFormError('Ingrese el concepto o glosa general del asiento contable.')
      return
    }

    if (lines.length < 2) {
      setFormError('El asiento debe tener al menos dos líneas contables.')
      return
    }

    // Validar cuentas seleccionadas
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l.accountId) {
        setFormError(`La línea #${i + 1} requiere una cuenta contable válida.`)
        return
      }
      const d = parseMoney(l.debit)
      const c = parseMoney(l.credit)
      if (d === 0 && c === 0) {
        setFormError(`La línea #${i + 1} debe registrar un valor en débito o en crédito mayor a 0.`)
        return
      }
    }

    // Si se desea postear de inmediato, la partida doble debe ser matemáticamente exacta
    if (status === 'posteado') {
      if (!isBalanced) {
        setFormError(
          `Partida Doble Descuadrada: No se puede postear el comprobante. Débitos ($${formatMoney(
            totalDebit
          )}) vs Créditos ($${formatMoney(totalCredit)}). Diferencia: $${formatMoney(difference)}.`
        )
        return
      }
    }

    const payload: CreateJournalEntryPayload = {
      company_id: companyId,
      entry_date: entryDate,
      concept: concept.trim(),
      status: status,
      source_module: 'manual',
      lines: lines.map(l => ({
        account_id: l.accountId,
        description: l.description.trim() || concept.trim(),
        debit: parseMoney(l.debit),
        credit: parseMoney(l.credit),
      })),
    }

    try {
      await onSubmit(payload)
    } catch (err: any) {
      setFormError(err?.message || 'Error al procesar el asiento contable.')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Cabecera del formulario */}
      <div className="px-6 py-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-blue-500/20 rounded-lg text-blue-400">
              <Scale className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Nuevo Asiento Contable (Partida Doble)
            </h2>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            Registro de póliza en libro diario con validación estricta de partida doble y RLS multiempresa.
          </p>
        </div>

        {/* Indicador de Estado de Partida Doble en el Header */}
        <div className="flex items-center gap-2">
          {isBalanced ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Partida Doble Cuadrada ($0.00)</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>Descuadre: ${formatMoney(difference)}</span>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {formError && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Atención al registrar comprobante:</p>
              <p className="text-xs text-rose-700 mt-0.5">{formError}</p>
            </div>
          </div>
        )}

        {/* Datos generales de cabecera */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Fecha de Asiento
            </label>
            <div className="relative">
              <input
                type="date"
                required
                value={entryDate}
                onChange={e => setEntryDate(e.target.value)}
                className="w-full px-3 py-2 pl-9 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          <div className="md:col-span-6">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Concepto / Glosa Principal
            </label>
            <div className="relative">
              <input
                type="text"
                required
                placeholder="Ej. Registro de ventas de contado y costo de ventas correspondiente"
                value={concept}
                onChange={e => setConcept(e.target.value)}
                className="w-full px-3 py-2 pl-9 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Modo de Registro
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as 'borrador' | 'posteado')}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="posteado">Posteado (Inmutable y Asentado)</option>
              <option value="borrador">Borrador (Editable temporalmente)</option>
            </select>
          </div>
        </div>

        {/* Tabla dinámica de líneas contables */}
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[240px]">Cuenta Contable</th>
                  <th className="py-2.5 px-3 min-w-[180px]">Descripción / Referencia</th>
                  <th className="py-2.5 px-3 w-40 text-right">Débito ($)</th>
                  <th className="py-2.5 px-3 w-40 text-right">Crédito ($)</th>
                  <th className="py-2.5 px-3 w-12 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {lines.map((line, idx) => {
                  const selectedAcc = accountsById.get(line.accountId)
                  return (
                    <tr key={line.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2 px-3 text-center text-xs font-medium text-slate-400">
                        {idx + 1}
                      </td>

                      {/* Selector de cuenta imputable */}
                      <td className="py-2 px-3">
                        <select
                          required
                          value={line.accountId}
                          onChange={e => handleLineChange(idx, 'accountId', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-800"
                        >
                          <option value="">-- Seleccione Cuenta Imputable --</option>
                          {postableAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {acc.code} · {acc.name} ({acc.account_type.toUpperCase()} - {acc.nature.toUpperCase()})
                            </option>
                          ))}
                        </select>
                        {selectedAcc && (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="capitalize font-medium text-slate-700">{selectedAcc.account_type}</span>
                            <span>•</span>
                            <span>Naturaleza {selectedAcc.nature}</span>
                          </div>
                        )}
                      </td>

                      {/* Descripción de la línea */}
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          placeholder={concept || 'Detalle de línea'}
                          value={line.description}
                          onChange={e => handleLineChange(idx, 'description', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>

                      {/* Débito */}
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={line.debit}
                          onChange={e => handleLineChange(idx, 'debit', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs text-right font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 font-semibold"
                        />
                      </td>

                      {/* Crédito */}
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={line.credit}
                          onChange={e => handleLineChange(idx, 'credit', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs text-right font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 font-semibold"
                        />
                      </td>

                      {/* Eliminar línea */}
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          disabled={lines.length <= 2}
                          className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400 rounded-md transition-colors"
                          title="Eliminar línea"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Fila de Totales y Resumen de Cuadre */}
              <tfoot>
                <tr className="bg-slate-100 font-semibold text-slate-800 border-t-2 border-slate-300 text-sm">
                  <td colSpan={3} className="py-3 px-4 text-right">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAddLine}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
                        >
                          <Plus className="w-3.5 h-3.5 text-blue-600" />
                          <span>Agregar Línea</span>
                        </button>

                        {!isBalanced && difference > 0.0001 && (
                          <button
                            type="button"
                            onClick={handleAutoBalance}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                            title="Genera automáticamente la contrapartida por la diferencia restante"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                            <span>Completar Cuadre (${formatMoney(difference)})</span>
                          </button>
                        )}
                      </div>
                      <span className="text-xs uppercase text-slate-600 tracking-wider">
                        Totales de Control:
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                    ${formatMoney(totalDebit)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                    ${formatMoney(totalCredit)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {isBalanced ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 inline" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-rose-500 inline" />
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Panel visual de Validación de Partida Doble */}
        <div
          className={`p-4 rounded-xl border transition-all ${
            isBalanced
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              : 'bg-amber-50/80 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              {isBalanced ? (
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                  <Scale className="w-6 h-6" />
                </div>
              )}
              <div>
                <p className="font-bold text-sm">
                  {isBalanced
                    ? 'Partida Doble Estrictamente Verificada'
                    : 'Asiento Contable Descuadrado (Diferencia Pendiente)'}
                </p>
                <p className="text-xs opacity-80 mt-0.5">
                  {isBalanced
                    ? `Los débitos y créditos son idénticos ($${formatMoney(totalDebit)}). Cumple con el principio fundamental de Luca Pacioli.`
                    : `Existe una disparidad de $${formatMoney(
                        difference
                      )} entre la suma de débitos ($${formatMoney(totalDebit)}) y créditos ($${formatMoney(
                        totalCredit
                      )}).`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Diferencia:
              </span>
              <span
                className={`font-mono text-base font-extrabold px-3 py-1 rounded-lg ${
                  isBalanced
                    ? 'bg-emerald-200/60 text-emerald-800'
                    : 'bg-rose-100 text-rose-700 border border-rose-300'
                }`}
              >
                ${formatMoney(difference)}
              </span>
            </div>
          </div>
        </div>

        {/* Botones de acción del formulario */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all ${
                status === 'posteado'
                  ? isBalanced
                    ? 'bg-blue-600 hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
                    : 'bg-slate-400 cursor-not-allowed opacity-75'
                  : 'bg-slate-800 hover:bg-slate-900'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : status === 'posteado' ? (
                <>
                  <Send className="w-4 h-4" />
                  <span>Asentar y Postear Asiento</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Guardar como Borrador</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
