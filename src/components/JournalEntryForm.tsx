import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FolderTree,
  Save,
  Send,
  Calculator,
  X,
  Search,
  Sparkles,
} from 'lucide-react'

export interface RealAccountItem {
  id: string
  code: string
  name: string
  nature: string
  type?: string
  is_postable?: boolean
}

export interface JournalLineItem {
  id: string
  account_id: string
  account_code: string
  account_name: string
  debit: number | ''
  credit: number | ''
  memo: string
}

interface JournalEntryFormProps {
  onSuccess?: (entry: any) => void
  onCancel?: () => void
}

export default function JournalEntryForm({ onSuccess, onCancel }: JournalEntryFormProps) {
  const { user } = useAuth()
  const [entryNumber, setEntryNumber] = useState(
    () => `AS-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`
  )
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().split('T')[0])
  const [concept, setConcept] = useState('')
  const [sourceModule, setSourceModule] = useState('manual')
  const [status, setStatus] = useState<'borrador' | 'posteado'>('posteado')
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Cuentas reales de acc_accounts para la empresa activa
  const [realAccounts, setRealAccounts] = useState<RealAccountItem[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  // Líneas dinámicas del asiento contable (inician vacías, sin cuentas ficticias)
  const [lines, setLines] = useState<JournalLineItem[]>([
    {
      id: 'line-init-1',
      account_id: '',
      account_code: '',
      account_name: '',
      debit: '',
      credit: '',
      memo: '',
    },
    {
      id: 'line-init-2',
      account_id: '',
      account_code: '',
      account_name: '',
      debit: '',
      credit: '',
      memo: '',
    },
  ])

  // Explorador del Árbol PUC modal
  const [pucModalOpen, setPucModalOpen] = useState(false)
  const [activeLineIdForPuc, setActiveLineIdForPuc] = useState<string | null>(null)
  const [pucSearch, setPucSearch] = useState('')

  // 1. Cargar catálogo oficial de cuentas reales desde acc_accounts
  useEffect(() => {
    let isMounted = true
    async function loadAccounts() {
      try {
        setLoadingAccounts(true)
        const { data, error } = await supabase
          .from('acc_accounts')
          .select('id, code, name, nature, type, is_postable')
          .eq('active', true)
          .order('code', { ascending: true })

        if (error) {
          throw error
        }

        if (isMounted) {
          setRealAccounts((data || []) as RealAccountItem[])
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMessage(
            err.message || 'No se pudieron cargar las cuentas contables de la empresa activa.'
          )
        }
      } finally {
        if (isMounted) {
          setLoadingAccounts(false)
        }
      }
    }

    void loadAccounts()
    return () => {
      isMounted = false
    }
  }, [user?.company_id])

  // Cálculos en tiempo real de partida doble
  const { totalDebit, totalCredit, difference, isBalanced } = useMemo(() => {
    let deb = 0
    let cred = 0

    for (const l of lines) {
      if (typeof l.debit === 'number') deb += l.debit
      if (typeof l.credit === 'number') cred += l.credit
    }

    deb = Math.round(deb * 100) / 100
    cred = Math.round(cred * 100) / 100
    const diff = Math.round((deb - cred) * 100) / 100

    return {
      totalDebit: deb,
      totalCredit: cred,
      difference: diff,
      isBalanced: diff === 0 && deb > 0,
    }
  }, [lines])

  // Cuentas filtradas para modal o selector rápido
  const filteredAccounts = useMemo(() => {
    if (!pucSearch.trim()) return realAccounts
    const q = pucSearch.toLowerCase().trim()
    return realAccounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    )
  }, [realAccounts, pucSearch])

  // Agregar fila
  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        account_id: '',
        account_code: '',
        account_name: '',
        debit: '',
        credit: '',
        memo: concept || '',
      },
    ])
  }

  // Eliminar fila
  function removeLine(id: string) {
    if (lines.length <= 2) {
      alert('Un asiento contable requiere al menos 2 líneas para cumplir la partida doble.')
      return
    }
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  // Actualizar campo de línea
  function updateLine(id: string, field: keyof JournalLineItem, value: any) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l

        const updated = { ...l, [field]: value }

        // Si se ingresa débito, limpiar crédito y viceversa
        if (field === 'debit' && value !== '') {
          updated.credit = ''
        } else if (field === 'credit' && value !== '') {
          updated.debit = ''
        }

        // Si se cambia la cuenta seleccionada por ID
        if (field === 'account_id') {
          const acc = realAccounts.find((a) => a.id === value)
          if (acc) {
            updated.account_id = acc.id
            updated.account_code = acc.code
            updated.account_name = acc.name
          } else {
            updated.account_id = ''
            updated.account_code = ''
            updated.account_name = ''
          }
        }

        return updated
      })
    )
  }

  // Auto-cuadrar la línea actual con el saldo restante
  function autoBalanceLine(id: string) {
    let otherDeb = 0
    let otherCred = 0

    for (const l of lines) {
      if (l.id !== id) {
        if (typeof l.debit === 'number') otherDeb += l.debit
        if (typeof l.credit === 'number') otherCred += l.credit
      }
    }

    const neededDiff = Math.round((otherDeb - otherCred) * 100) / 100

    if (neededDiff > 0) {
      updateLine(id, 'credit', neededDiff)
    } else if (neededDiff < 0) {
      updateLine(id, 'debit', Math.abs(neededDiff))
    }
  }

  // Seleccionar cuenta desde el modal PUC
  function handleSelectAccount(account: RealAccountItem) {
    if (activeLineIdForPuc) {
      setLines((prev) =>
        prev.map((l) =>
          l.id === activeLineIdForPuc
            ? {
                ...l,
                account_id: account.id,
                account_code: account.code,
                account_name: account.name,
              }
            : l
        )
      )
    }
    setPucModalOpen(false)
    setActiveLineIdForPuc(null)
  }

  // Enviar asiento contable invocando directamente la RPC oficial acc_create_entry
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (realAccounts.length === 0) {
      setErrorMessage(
        'No existen cuentas contables en acc_accounts para la empresa activa. Inicialice el catálogo PUC antes de registrar operaciones.'
      )
      return
    }

    if (!concept.trim()) {
      setErrorMessage('Por favor ingrese el concepto o detalle general del asiento contable.')
      return
    }

    // Validar líneas válidas
    for (const [idx, l] of lines.entries()) {
      if (!l.account_id) {
        setErrorMessage(`La línea #${idx + 1} no tiene asignada una cuenta contable válida.`)
        return
      }
      const deb = Number(l.debit) || 0
      const cred = Number(l.credit) || 0
      if (deb === 0 && cred === 0) {
        setErrorMessage(`La línea #${idx + 1} debe tener un valor en Débito o en Crédito mayor a 0.`)
        return
      }
      if (deb > 0 && cred > 0) {
        setErrorMessage(`La línea #${idx + 1} no puede contener débito y crédito simultáneamente.`)
        return
      }
    }

    if (status === 'posteado' && !isBalanced) {
      setErrorMessage(
        `Error de Partida Doble: No es posible postear un asiento descuadrado. Diferencia: $${Math.abs(difference).toLocaleString()}. Cuadre el asiento o guárdelo en Borrador.`
      )
      return
    }

    setSaving(true)

    try {
      // Estructuración exacta de líneas esperadas por la RPC acc_create_entry (jsonb)
      const rpcLines = lines.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        memo: l.memo || concept,
      }))

      // Parámetros reglamentarios de acc_create_entry(date,text,jsonb,boolean,text,uuid,text)
      const { data: createdEntryId, error: rpcError } = await supabase.rpc('acc_create_entry', {
        p_date: entryDate,
        p_description: concept.trim(),
        p_lines: rpcLines,
        p_post: status === 'posteado',
        p_source_type: sourceModule || 'manual',
        p_source_id: null,
        p_event: 'registro',
      })

      if (rpcError) {
        throw new Error(rpcError.message || 'Error al ejecutar registro contable NIIF en el servidor.')
      }

      // Consultar el registro real creado en acc_entries para recuperar el consecutivo oficial
      let fetchedEntry: any = null
      if (createdEntryId) {
        const { data: entryRow } = await supabase
          .from('acc_entries')
          .select('*')
          .eq('id', createdEntryId)
          .maybeSingle()
        fetchedEntry = entryRow
      }

      const officialNumber = fetchedEntry?.number || entryNumber
      setSuccessMessage(
        status === 'posteado'
          ? `✓ Asiento ${officialNumber} posteado exitosamente bajo principio de partida doble (acc_entries). Estado inmutable registrado.`
          : `✓ Asiento ${officialNumber} guardado en borrador con éxito.`
      )

      // Limpiar formulario y regenerar número tentativo
      setConcept('')
      setEntryNumber(`AS-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`)
      setLines([
        {
          id: `line-${Date.now()}-1`,
          account_id: '',
          account_code: '',
          account_name: '',
          debit: '',
          credit: '',
          memo: '',
        },
        {
          id: `line-${Date.now()}-2`,
          account_id: '',
          account_code: '',
          account_name: '',
          debit: '',
          credit: '',
          memo: '',
        },
      ])

      if (onSuccess) {
        onSuccess(fetchedEntry || { id: createdEntryId, number: officialNumber })
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al procesar el asiento contable.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 shadow-xs space-y-6"
    >
      {/* Cabecera del Formulario */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100">
              <Calculator className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Registrar Asiento Diario NIIF
              </h2>
              <p className="text-xs text-slate-500">
                Modelo Oficial acc_* con validación estricta de partida doble y trazabilidad inmutable
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Consecutivo preliminar:</span>
          <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
            {entryNumber}
          </span>
        </div>
      </div>

      {/* Alertas y Mensajes */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {loadingAccounts && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
          <span>Cargando cuentas reales de la empresa desde acc_accounts...</span>
        </div>
      )}

      {/* Metadatos del Asiento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Fecha Contable <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Módulo de Origen
          </label>
          <select
            value={sourceModule}
            onChange={(e) => setSourceModule(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="manual">Asiento Manual</option>
            <option value="apertura">Constitución / Apertura</option>
            <option value="ventas">Ventas e Ingresos</option>
            <option value="compras">Compras y Proveedores</option>
            <option value="gastos">Gastos Operativos</option>
            <option value="ajustes">Ajustes y Reclasificaciones</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Destino del Asiento
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className={`w-full px-3 py-2 text-xs font-semibold rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              status === 'posteado'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}
          >
            <option value="posteado">Postear en Libros (Inmutable)</option>
            <option value="borrador">Guardar en Borrador (Editable)</option>
          </select>
        </div>

        <div className="sm:col-span-2 lg:col-span-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Concepto / Glosa General <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Ej. Registro de ventas a crédito del fin de semana con descargo de inventario e IVA..."
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            required
          />
        </div>
      </div>

      {/* Tabla Dinámica de Líneas Contables */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Detalle de Cuentas y Movimientos ({lines.length} líneas)
          </span>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Añadir Fila
          </button>
        </div>

        <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2.5 w-12 text-center">#</th>
                  <th className="px-3 py-2.5 w-72">Cuenta Contable Real (acc_accounts)</th>
                  <th className="px-3 py-2.5">Detalle / Memo</th>
                  <th className="px-3 py-2.5 w-36 text-right">Débito ($)</th>
                  <th className="px-3 py-2.5 w-36 text-right">Crédito ($)</th>
                  <th className="px-3 py-2.5 w-20 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, idx) => (
                  <tr key={line.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-2 text-center text-slate-400 font-mono font-medium">
                      {idx + 1}
                    </td>

                    {/* Selector de Cuenta Real */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={line.account_id}
                          onChange={(e) => updateLine(line.id, 'account_id', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="">-- Seleccione Cuenta Real --</option>
                          {realAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} - {a.name} ({a.nature})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveLineIdForPuc(line.id)
                            setPucModalOpen(true)
                          }}
                          title="Explorar catálogo de cuentas"
                          className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                        >
                          <FolderTree className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Memo */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.memo}
                        onChange={(e) => updateLine(line.id, 'memo', e.target.value)}
                        placeholder="Detalle de la transacción..."
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:ring-1 focus:ring-indigo-500 bg-white"
                      />
                    </td>

                    {/* Débito */}
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.debit}
                        onChange={(e) =>
                          updateLine(
                            line.id,
                            'debit',
                            e.target.value === '' ? '' : parseFloat(e.target.value)
                          )
                        }
                        placeholder="0.00"
                        className="w-full px-2.5 py-1.5 text-xs text-right font-mono font-semibold rounded-lg border border-slate-200 focus:ring-1 focus:ring-indigo-500 bg-white"
                      />
                    </td>

                    {/* Crédito */}
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.credit}
                        onChange={(e) =>
                          updateLine(
                            line.id,
                            'credit',
                            e.target.value === '' ? '' : parseFloat(e.target.value)
                          )
                        }
                        placeholder="0.00"
                        className="w-full px-2.5 py-1.5 text-xs text-right font-mono font-semibold rounded-lg border border-slate-200 focus:ring-1 focus:ring-indigo-500 bg-white"
                      />
                    </td>

                    {/* Acciones */}
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => autoBalanceLine(line.id)}
                          title="Auto-cuadrar saldo restante en esta línea"
                          className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          title="Eliminar línea"
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Barra de Totales y Verificación de Partida Doble */}
          <div className="bg-slate-50 border-t border-slate-200 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Badge visual de balance */}
              <div>
                {isBalanced ? (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>✓ Asiento Cuadrado (Partida Doble Cumplida)</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-100 text-red-800 text-xs font-bold border border-red-300">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>
                      ⚠ Descuadrado (Diferencia: ${Math.abs(difference).toLocaleString()})
                    </span>
                  </div>
                )}
                <span className="block text-[11px] text-slate-500 mt-1">
                  Principio NIIF: Suma de Débitos debe ser exactamente igual a la Suma de Créditos.
                </span>
              </div>

              {/* Totales Numéricos */}
              <div className="flex items-center gap-6 font-mono text-xs">
                <div className="text-right">
                  <span className="block text-[10px] text-slate-400 uppercase font-bold">
                    Total Débitos
                  </span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    ${totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] text-slate-400 uppercase font-bold">
                    Total Créditos
                  </span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    ${totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Botones de Acción */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={saving || (status === 'posteado' && !isBalanced) || realAccounts.length === 0}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-xs transition-colors cursor-pointer ${
            status === 'posteado' && !isBalanced
              ? 'bg-slate-400 cursor-not-allowed opacity-60'
              : status === 'posteado'
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-indigo-600 hover:bg-indigo-500'
          }`}
        >
          {status === 'posteado' ? (
            <>
              <Send className="w-4 h-4" />
              {saving ? 'Validando Partida Doble en acc_*...' : 'Postear Asiento en Libros'}
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {saving ? 'Guardando en acc_*...' : 'Guardar Asiento en Borrador'}
            </>
          )}
        </button>
      </div>

      {/* Modal del Catálogo de Cuentas Reales */}
      {pucModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-base">
                  Catálogo de Cuentas Reales (acc_accounts)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPucModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={pucSearch}
                onChange={(e) => setPucSearch(e.target.value)}
                placeholder="Buscar por código (ej. 1105) o nombre de cuenta (ej. Caja)..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              {filteredAccounts.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs">
                  No se encontraron cuentas activas que coincidan con la búsqueda.
                </div>
              ) : (
                filteredAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    onClick={() => handleSelectAccount(acc)}
                    className="p-2.5 sm:px-3.5 hover:bg-indigo-50/60 cursor-pointer flex items-center justify-between gap-3 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900">
                        {acc.code}
                      </span>
                      <span className="text-slate-700 font-medium">
                        {acc.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {acc.type && (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                          {acc.type}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          acc.nature?.toLowerCase().includes('deb')
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-purple-50 text-purple-700'
                        }`}
                      >
                        {acc.nature}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPucModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}
