import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, isCompanyManager, canViewAccounting, canManageInventory } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { useWarehouse } from '../lib/warehouseContext'
import { downloadCsv } from '../lib/csv'
import { buildDocHtml, buildShareText, printHtml, type DocData } from '../lib/documents'
import ExpenseReceiptScannerModal from '../components/ExpenseReceiptScannerModal'
import type { Expense, ExpenseCategory, CompanyConfig } from '../types'
import {
  Plus, X, Search, Download, Settings2, Ban, Share2, Printer,
  MessageCircle, Mail, Lock, Wallet, Building2, TrendingDown, Tag, Check, ScanLine,
} from 'lucide-react'

interface AccOption {
  id: string
  code: string
  name: string
  type: string
  is_postable: boolean
  active: boolean
}

type Period = 'hoy' | '7d' | 'mes' | 'todo' | 'custom'

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo (Caja)',
  transferencia: 'Transferencia (Bancos)',
  tarjeta: 'Tarjeta (Bancos)',
}

const METHOD_SHORT: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
}

const todayIso = () => new Date().toLocaleDateString('sv-SE')

const monthStartIso = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE')
}

function buildExpenseDoc(e: Expense): DocData {
  return {
    title: 'COMPROBANTE DE GASTO',
    number: 'GAS-' + e.id.slice(0, 8).toUpperCase(),
    date: new Date(e.created_at).toLocaleString([], {
      dateStyle: 'short',
      timeStyle: 'short',
    }),
    badge: e.status === 'anulado' ? 'ANULADO' : undefined,
    partyRoleLabel: 'Beneficiario',
    partyName: e.beneficiary || 'Gasto operativo general',
    partyLines: [
      `Categoría: ${e.category_name}`,
      `Fecha del comprobante: ${e.expense_date}`,
      e.reference ? `Ref. / Factura: ${e.reference}` : null,
      e.created_by_name ? `Registrado por: ${e.created_by_name}` : null,
    ],
    paymentLabel: `Pagado con: ${METHOD_LABEL[e.method] ?? e.method}`,
    unitColLabel: 'Valor',
    lines: [
      {
        name: e.description,
        quantity: 1,
        price: Number(e.amount),
        subtotal: Number(e.amount),
      },
    ],
    total: Number(e.amount),
    footer: 'Soporte interno de egreso operativo.',
  }
}

export default function Expenses() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()

  const { branches } = useWarehouse()
  const readOnly = isReadOnly(user)
  const isManager = isCompanyManager(user?.role) || canViewAccounting(user?.role) || canManageInventory(user?.role)

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [accounts, setAccounts] = useState<AccOption[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [missingSql, setMissingSql] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [period, setPeriod] = useState<Period>('mes')
  const [fromDate, setFromDate] = useState(monthStartIso())
  const [toDate, setToDate] = useState(todayIso())
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [showReceiptScanner, setShowReceiptScanner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  const [form, setForm] = useState({
    category_id: '',
    branch_id: '',
    amount: '',
    method: 'efectivo' as 'efectivo' | 'transferencia' | 'tarjeta',
    expense_date: todayIso(),
    description: '',
    beneficiary: '',
    reference: '',
  })

  const [showCats, setShowCats] = useState(false)

  const [catForm, setCatForm] = useState<{
    id: string | null
    name: string
    account_id: string
    active: boolean
  }>({
    id: null,
    name: '',
    account_id: '',
    active: true,
  })

  const [catBusy, setCatBusy] = useState(false)

  const [viewTarget, setViewTarget] = useState<Expense | null>(null)
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null)
  const [voiding, setVoiding] = useState(false)

  // SEGURIDAD: un usuario que no sea administrador o dueño
  // no debe inicializar ni consultar información de gastos.
  useEffect(() => {
    if (!isManager) {
      setLoading(false)
      return
    }

    void init()
  }, [isManager])

  async function init() {
    if (!isManager) {
      setLoading(false)
      return
    }

    setLoading(true)

    const seedRes = await supabase.rpc('asegurar_categorias_gasto')

    if (
      seedRes.error &&
      /asegurar_categorias_gasto|expense_categories|does not exist|schema cache/i.test(
        seedRes.error.message || ''
      )
    ) {
      setMissingSql(true)
      setLoading(false)
      return
    }

    setMissingSql(false)
    await load()
  }

  async function load() {
    // SEGURIDAD: detener cualquier consulta si el rol no está autorizado.
    if (!isManager) {
      setLoading(false)
      return
    }

    setLoading(true)

    const [exRes, catRes, cfgRes, accRes] = await Promise.all([
      supabase
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false }),

      supabase
        .from('expense_categories')
        .select('*')
        .order('name'),

      supabase
        .from('company_config')
        .select('*')
        .limit(1)
        .maybeSingle(),

      isManager
        ? supabase
            .from('acc_accounts')
            .select('id, code, name, type, is_postable, active')
            .order('code')
        : Promise.resolve({ data: [], error: null }),
    ])

    if (
      exRes.error &&
      /expenses|does not exist|schema cache/i.test(exRes.error.message || '')
    ) {
      setMissingSql(true)
      setLoading(false)
      return
    }

    const catList = (catRes.data || []) as ExpenseCategory[]

    setExpenses((exRes.data || []) as Expense[])
    setCategories(catList)

    if (cfgRes.data) {
      setConfig(cfgRes.data as CompanyConfig)
    }

    setAccounts(
      ((accRes.data || []) as AccOption[]).filter(
        a => a.is_postable && a.active
      )
    )

    setForm(f => ({
      ...f,
      category_id: f.category_id || catList.find(c => c.active)?.id || '',
    }))

    setLoading(false)
  }

  const activeCategories = useMemo(
    () => categories.filter(c => c.active),
    [categories]
  )

  const filtered = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    )

    let pFrom: string | null = null
    let pTo: string | null = null

    if (period === 'hoy') {
      pFrom = todayIso()
      pTo = todayIso()
    } else if (period === '7d') {
      const d = new Date(todayStart)
      d.setDate(d.getDate() - 6)
      pFrom = d.toLocaleDateString('sv-SE')
      pTo = todayIso()
    } else if (period === 'mes') {
      pFrom = monthStartIso()
      pTo = todayIso()
    } else if (period === 'custom') {
      pFrom = fromDate || null
      pTo = toDate || null
    }

    const q = search.trim().toLowerCase()

    return expenses.filter(e => {
      const eDate = e.expense_date || e.created_at.slice(0, 10)

      if (pFrom && eDate < pFrom) return false
      if (pTo && eDate > pTo) return false

      if (
        catFilter &&
        e.category_id !== catFilter &&
        e.category_name !== catFilter
      ) {
        return false
      }

      if (methodFilter && e.method !== methodFilter) return false

      if (q) {
        const hay = [
          e.description,
          e.category_name,
          e.beneficiary,
          e.reference,
          'GAS-' + e.id.slice(0, 8),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        if (!hay.includes(q)) return false
      }

      return true
    })
  }, [
    expenses,
    period,
    fromDate,
    toDate,
    catFilter,
    methodFilter,
    search,
  ])

  const activeInPeriod = useMemo(
    () => filtered.filter(e => e.status === 'activo'),
    [filtered]
  )

  const stats = useMemo(() => {
    let total = 0
    let cash = 0
    let bank = 0

    const byCat = new Map<string, number>()

    for (const e of activeInPeriod) {
      const amt = Number(e.amount) || 0

      total += amt

      if (e.method === 'efectivo') {
        cash += amt
      } else {
        bank += amt
      }

      byCat.set(
        e.category_name,
        (byCat.get(e.category_name) || 0) + amt
      )
    }

    const breakdown = Array.from(byCat.entries())
      .map(([name, amount]) => ({
        name,
        amount,
        pct: total > 0 ? (amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)

    return {
      total,
      cash,
      bank,
      topCategory: breakdown[0] || null,
      breakdown,
    }
  }, [activeInPeriod])

  async function handleCreateExpense(ev: React.FormEvent) {
    ev.preventDefault()

    // SEGURIDAD: solo dueño/admin pueden registrar gastos.
    if (!isManager || readOnly || saving) return

    setFormErr('')

    const amt = parseFloat(form.amount)

    if (!(amt > 0)) {
      setFormErr('Ingresa un monto mayor a cero.')
      return
    }

    if (!form.category_id) {
      setFormErr('Selecciona una categoría de gasto.')
      return
    }

    if (!form.description.trim()) {
      setFormErr('Escribe el concepto o descripción del gasto.')
      return
    }

    setSaving(true)

    const { data: createdId, error } = await supabase.rpc('registrar_gasto', {
      p_category_id: form.category_id,
      p_amount: amt,
      p_method: form.method,
      p_description: form.description.trim(),
      p_beneficiary: form.beneficiary.trim() || null,
      p_reference: form.reference.trim() || null,
      p_expense_date: form.expense_date || todayIso(),
    })

    if (!error && form.branch_id) {
      try {
        let targetId = typeof createdId === 'string' ? createdId : null
        if (!targetId) {
          const { data: recent } = await supabase
            .from('expenses')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1)
          targetId = (recent as { id: string }[] | null)?.[0]?.id || null
        }
        if (targetId) {
          await supabase.rpc('asignar_centro_costo_operacion', {
            p_table: 'expenses',
            p_id: targetId,
            p_branch_id: form.branch_id,
          })
        }
      } catch {
        /* migración 000013 opcional si aún no se aplica */
      }
    }

    setSaving(false)

    if (error) {
      setFormErr(error.message)
      return
    }

    setShowForm(false)

    setForm(f => ({
      ...f,
      amount: '',
      description: '',
      beneficiary: '',
      reference: '',
      expense_date: todayIso(),
    }))

    setMsg({
      ok: true,
      text: 'Gasto registrado correctamente.',
    })

    await load()
  }

  async function handleConfirmVoid() {
    if (!isManager || !voidTarget || voiding || readOnly) return

    setVoiding(true)

    const { error } = await supabase.rpc('anular_gasto', {
      p_expense_id: voidTarget.id,
    })

    setVoiding(false)

    if (error) {
      setMsg({
        ok: false,
        text: 'No se pudo anular el gasto: ' + error.message,
      })

      setVoidTarget(null)
      return
    }

    setVoidTarget(null)

    setMsg({
      ok: true,
      text: 'Gasto anulado y revertido correctamente.',
    })

    await load()
  }

  async function handleSaveCategory(ev: React.FormEvent) {
    ev.preventDefault()

    if (!isManager || catBusy || !catForm.name.trim()) return

    setCatBusy(true)

    const { error } = await supabase.rpc('guardar_categoria_gasto', {
      p_id: catForm.id,
      p_name: catForm.name.trim(),
      p_account_id: catForm.account_id || null,
      p_active: catForm.active,
    })

    setCatBusy(false)

    if (error) {
      setMsg({
        ok: false,
        text: error.message,
      })
      return
    }

    setCatForm({
      id: null,
      name: '',
      account_id: '',
      active: true,
    })

    await load()
  }

  async function toggleCategoryActive(cat: ExpenseCategory) {
    if (!isManager || catBusy) return

    setCatBusy(true)

    const { error } = await supabase.rpc('guardar_categoria_gasto', {
      p_id: cat.id,
      p_name: cat.name,
      p_account_id: cat.account_id,
      p_active: !cat.active,
    })

    setCatBusy(false)

    if (error) {
      setMsg({
        ok: false,
        text: error.message,
      })
    } else {
      await load()
    }
  }

  function exportExcel() {
    if (!isManager) return

    downloadCsv(
      `gastos_operativos_${todayIso()}.csv`,
      [
        'Código',
        'Fecha comprobante',
        'Categoría',
        'Descripción',
        'Beneficiario',
        'Referencia',
        'Forma de pago',
        'Monto',
        'Estado',
      ],
      filtered.map(e => [
        'GAS-' + e.id.slice(0, 8).toUpperCase(),
        e.expense_date,
        e.category_name,
        e.description,
        e.beneficiary || '',
        e.reference || '',
        METHOD_SHORT[e.method] || e.method,
        Number(e.amount),
        e.status,
      ])
    )
  }

  const doc = viewTarget ? buildExpenseDoc(viewTarget) : null

  const canShare =
    typeof navigator !== 'undefined' && 'share' in navigator

  const expenseAccounts = useMemo(() => {
    const gastosOnly = accounts.filter(a => a.type === 'gasto')

    return gastosOnly.length > 0 ? gastosOnly : accounts
  }, [accounts])

  // BLOQUEO PRINCIPAL:
  // evita mostrar cualquier información de gastos a vendedores
  // u otros roles sin autorización.
  if (!isManager) {
    return (
      <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-5">
        <h1 className="font-bold text-red-800">
          Acceso restringido
        </h1>

        <p className="mt-2 text-sm text-red-700">
          Solo el dueño o el administrador de la empresa pueden
          consultar los gastos operativos.
        </p>
      </div>
    )
  }

  if (missingSql) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-xl font-bold text-slate-800">
          Gastos operativos
        </h1>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1.5">
          <p className="font-semibold">
            Falta activar las tablas de Gastos en Supabase
          </p>

          <p className="text-xs text-amber-800">
            Ejecuta el script SQL{' '}
            <strong>
              20261101_gastos_y_devoluciones_completas.sql
            </strong>{' '}
            en el SQL Editor de Supabase y luego pulsa «Reintentar».
          </p>

          <button
            onClick={() => void init()}
            className="mt-2 bg-slate-800 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            Gastos operativos
          </h1>

          <p className="text-sm text-slate-500 mt-0.5">
            Arriendo, servicios, nómina, fletes y demás egresos por
            Caja o Bancos conectados al Estado de resultados.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {filtered.length > 0 && (
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Download className="w-4 h-4" /> Excel
            </button>
          )}

          {isManager && (
            <button
              onClick={() => setShowCats(true)}
              disabled={readOnly}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              <Settings2 className="w-4 h-4" /> Categorías
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (readOnly || !isManager) return
              setShowReceiptScanner(true)
            }}
            disabled={readOnly || !isManager}
            title="Fotografiar o subir recibos de Agua, Luz, Internet, Arriendo o gastos operativos"
            className="flex items-center gap-1.5 bg-sky-50 border border-sky-300 text-sky-900 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-sky-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ScanLine className="w-4 h-4 text-sky-700" />
            <span>Escanear recibo (Agua, Luz...)</span>
          </button>

          <button
            onClick={() => {
              if (readOnly || !isManager) return

              setFormErr('')

              setForm(f => ({
                ...f,
                category_id:
                  f.category_id || activeCategories[0]?.id || '',
                expense_date: todayIso(),
              }))

              setShowForm(true)
            }}
            disabled={readOnly || !isManager}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Nuevo gasto
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Modo de solo lectura. Activa tu suscripción para registrar
          o anular gastos.
        </div>
      )}

      {msg && (
        <div
          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs border ${
            msg.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{msg.text}</span>

          <button
            onClick={() => setMsg(null)}
            className="p-0.5 hover:opacity-70"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Filtros de período */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['hoy', 'Hoy'],
            ['7d', '7 días'],
            ['mes', 'Este mes'],
            ['todo', 'Todo'],
            ['custom', 'Elegir fechas'],
          ] as [Period, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPeriod(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              period === id
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}

        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={e => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
            />

            <span className="text-xs text-slate-400">a</span>

            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={e => setToDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
            />
          </div>
        )}
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <TrendingDown className="w-4 h-4 text-red-600" />
            <span className="text-xs text-slate-500">
              Total gastos del periodo
            </span>
          </div>

          <p className="text-lg font-bold text-slate-800">
            {money(stats.total)}
          </p>

          <p className="text-[11px] text-slate-400 mt-0.5">
            {activeInPeriod.length} registro(s) activos
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Wallet className="w-4 h-4 text-amber-600" />
            <span className="text-xs text-slate-500">
              Pagado en efectivo
            </span>
          </div>

          <p className="text-lg font-bold text-slate-800">
            {money(stats.cash)}
          </p>

          <p className="text-[11px] text-slate-400 mt-0.5">
            Descontado de Caja
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Building2 className="w-4 h-4 text-blue-600" />
            <span className="text-xs text-slate-500">
              Pagado por banco
            </span>
          </div>

          <p className="text-lg font-bold text-slate-800">
            {money(stats.bank)}
          </p>

          <p className="text-[11px] text-slate-400 mt-0.5">
            Transferencia o tarjeta
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Tag className="w-4 h-4 text-slate-500" />
            <span className="text-xs text-slate-500">
              Categoría principal
            </span>
          </div>

          <p className="text-sm font-bold text-slate-800 truncate">
            {stats.topCategory ? stats.topCategory.name : '—'}
          </p>

          <p className="text-[11px] text-slate-400 mt-0.5">
            {stats.topCategory
              ? `${money(stats.topCategory.amount)} (${stats.topCategory.pct.toFixed(0)}%)`
              : 'Sin gastos en el periodo'}
          </p>
        </div>
      </div>

      {/* Desglose por categoría */}
      {stats.breakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
            Distribución por categoría
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
            {stats.breakdown.map(b => (
              <div key={b.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 truncate">
                    {b.name}
                  </span>

                  <span className="text-slate-600 shrink-0 ml-2">
                    <strong className="text-slate-800">
                      {money(b.amount)}
                    </strong>{' '}
                    · {b.pct.toFixed(1)}%
                  </span>
                </div>

                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-slate-800"
                    style={{
                      width: `${Math.min(100, b.pct)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buscador y filtros */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar concepto, beneficiario, recibo..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          />
        </div>

        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">Todas las categorías</option>

          {categories.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={methodFilter}
          onChange={e => setMethodFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="">Todas las formas de pago</option>
          <option value="efectivo">Efectivo (Caja)</option>
          <option value="transferencia">Transferencia (Bancos)</option>
          <option value="tarjeta">Tarjeta (Bancos)</option>
        </select>
      </div>

      {/* Lista móvil */}
      <div className="md:hidden space-y-2.5">
        {filtered.map(e => (
          <div
            key={e.id}
            className="bg-white rounded-xl border border-slate-200 p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  className={`font-medium truncate ${
                    e.status === 'anulado'
                      ? 'text-slate-400 line-through'
                      : 'text-slate-800'
                  }`}
                >
                  {e.description}
                </p>

                <p className="text-xs text-slate-500">
                  {e.expense_date} · {e.category_name} ·{' '}
                  {METHOD_SHORT[e.method] || e.method}
                </p>

                {(e.beneficiary || e.reference) && (
                  <p className="text-xs text-slate-400 truncate">
                    {[
                      e.beneficiary,
                      e.reference && `Ref: ${e.reference}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>

              <p
                className={`font-bold whitespace-nowrap ${
                  e.status === 'anulado'
                    ? 'text-slate-400 line-through'
                    : 'text-red-600'
                }`}
              >
                -{money(Number(e.amount))}
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded capitalize ${
                  e.status === 'anulado'
                    ? 'bg-slate-100 text-slate-500'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {e.status}
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setViewTarget(e)}
                  className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded"
                >
                  <Share2 className="w-3 h-3" /> Ver
                </button>

                {!readOnly && isManager && e.status === 'activo' && (
                  <button
                    onClick={() => setVoidTarget(e)}
                    className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                  >
                    <Ban className="w-3 h-3" /> Anular
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <p className="text-center text-sm text-slate-400 py-8">
            No hay gastos registrados en este periodo
          </p>
        )}
      </div>

      {/* Tabla escritorio */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Fecha</th>
              <th className="text-left px-4 py-3 font-medium">Categoría</th>
              <th className="text-left px-4 py-3 font-medium">
                Descripción / Beneficiario
              </th>
              <th className="text-left px-4 py-3 font-medium">Pago</th>
              <th className="text-right px-4 py-3 font-medium">Monto</th>
              <th className="text-left px-4 py-3 font-medium">Estado</th>
              <th className="text-left px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {filtered.map(e => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                  {e.expense_date}
                </td>

                <td className="px-4 py-3">
                  <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 text-slate-700">
                    {e.category_name}
                  </span>
                </td>

                <td className="px-4 py-3">
                  <p
                    className={`font-medium ${
                      e.status === 'anulado'
                        ? 'text-slate-400 line-through'
                        : 'text-slate-800'
                    }`}
                  >
                    {e.description}
                  </p>

                  {(e.beneficiary || e.reference) && (
                    <p className="text-xs text-slate-400">
                      {[
                        e.beneficiary,
                        e.reference && `Ref: ${e.reference}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                  {METHOD_SHORT[e.method] || e.method}
                </td>

                <td
                  className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${
                    e.status === 'anulado'
                      ? 'text-slate-400 line-through'
                      : 'text-red-600'
                  }`}
                >
                  -{money(Number(e.amount))}
                </td>

                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${
                      e.status === 'anulado'
                        ? 'bg-slate-100 text-slate-500'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {e.status}
                  </span>
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setViewTarget(e)}
                      className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded whitespace-nowrap"
                    >
                      <Share2 className="w-3 h-3" /> Ver / Enviar
                    </button>

                    {!readOnly &&
                      isManager &&
                      e.status === 'activo' && (
                        <button
                          onClick={() => setVoidTarget(e)}
                          className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded whitespace-nowrap"
                        >
                          <Ban className="w-3.5 h-3.5" /> Anular
                        </button>
                      )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-slate-400"
                >
                  No hay gastos registrados en este periodo
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Nuevo gasto */}
      {showForm && !readOnly && isManager && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">
                Registrar gasto operativo
              </h2>

              <button
                onClick={() => setShowForm(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formErr && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                {formErr}
              </p>
            )}

            <form onSubmit={handleCreateExpense} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Categoría
                </label>

                <select
                  required
                  value={form.category_id}
                  onChange={e =>
                    setForm({
                      ...form,
                      category_id: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Selecciona una categoría</option>

                  {activeCategories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {branches.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Sucursal / Centro de costo
                  </label>
                  <select
                    value={form.branch_id}
                    onChange={e =>
                      setForm({
                        ...form,
                        branch_id: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Corporativo / General (sin sede específica)</option>
                    {branches.filter(b => b.active).map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Monto
                  </label>

                  <input
                    required
                    type="number"
                    step="any"
                    min="0.01"
                    value={form.amount}
                    onChange={e =>
                      setForm({
                        ...form,
                        amount: e.target.value,
                      })
                    }
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Fecha del recibo
                  </label>

                  <input
                    required
                    type="date"
                    max={todayIso()}
                    value={form.expense_date}
                    onChange={e =>
                      setForm({
                        ...form,
                        expense_date: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  ¿Con qué se pagó?
                </label>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    ['efectivo', 'transferencia', 'tarjeta'] as const
                  ).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          method: m,
                        })
                      }
                      className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors ${
                        form.method === m
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {METHOD_SHORT[m]}
                    </button>
                  ))}
                </div>

                <p className="text-[11px] text-slate-400 mt-1">
                  {form.method === 'efectivo'
                    ? 'Descuenta dinero físico de Caja y contabiliza contra Caja.'
                    : 'No afecta el efectivo físico de Caja; contabiliza directo contra Bancos.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Concepto / descripción
                </label>

                <input
                  required
                  value={form.description}
                  onChange={e =>
                    setForm({
                      ...form,
                      description: e.target.value,
                    })
                  }
                  placeholder="Ej: Pago de electricidad local mes actual"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Beneficiario (opcional)
                  </label>

                  <input
                    value={form.beneficiary}
                    onChange={e =>
                      setForm({
                        ...form,
                        beneficiary: e.target.value,
                      })
                    }
                    placeholder="Ej: Arrendador / Empresa"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Nro. recibo / factura
                  </label>

                  <input
                    value={form.reference}
                    onChange={e =>
                      setForm({
                        ...form,
                        reference: e.target.value,
                      })
                    }
                    placeholder="Opcional"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'Registrando...' : 'Guardar gasto'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Categorías y vínculo contable */}
      {showCats && isManager && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowCats(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">
                Categorías de gastos
              </h2>

              <button
                onClick={() => setShowCats(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Puedes asociar cada categoría a una cuenta específica de tu
              Plan de cuentas. Si la dejas en «Cuenta general de gastos»,
              usará la configurada en Config. contable.
            </p>

            <form
              onSubmit={handleSaveCategory}
              className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-2.5 mb-4"
            >
              <p className="text-xs font-semibold text-slate-700">
                {catForm.id ? 'Editar categoría' : 'Nueva categoría'}
              </p>

              <input
                required
                value={catForm.name}
                onChange={e =>
                  setCatForm({
                    ...catForm,
                    name: e.target.value,
                  })
                }
                placeholder="Nombre (ej: Fletes de entrega)"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              />

              <select
                value={catForm.account_id}
                onChange={e =>
                  setCatForm({
                    ...catForm,
                    account_id: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="">
                  Usar cuenta general de gastos (predeterminado)
                </option>

                {expenseAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                {catForm.id && (
                  <button
                    type="button"
                    onClick={() =>
                      setCatForm({
                        id: null,
                        name: '',
                        account_id: '',
                        active: true,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 text-slate-600 bg-white"
                  >
                    Cancelar
                  </button>
                )}

                <button
                  type="submit"
                  disabled={catBusy || !catForm.name.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 text-white py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" />
                  {catForm.id
                    ? 'Actualizar categoría'
                    : 'Agregar categoría'}
                </button>
              </div>
            </form>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {categories.map(c => {
                const linked = accounts.find(
                  a => a.id === c.account_id
                )

                return (
                  <div
                    key={c.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p
                        className={`font-medium truncate ${
                          c.active
                            ? 'text-slate-800'
                            : 'text-slate-400 line-through'
                        }`}
                      >
                        {c.name}
                      </p>

                      <p className="text-[11px] text-slate-400 truncate">
                        {linked
                          ? `Cuenta: ${linked.code} · ${linked.name}`
                          : 'Cuenta general de gastos'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setCatForm({
                            id: c.id,
                            name: c.name,
                            account_id: c.account_id || '',
                            active: c.active,
                          })
                        }
                        className="text-xs font-medium text-slate-600 hover:text-slate-900"
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => void toggleCategoryActive(c)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800"
                      >
                        {c.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar anulación */}
      {voidTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !voiding && setVoidTarget(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-bold text-slate-800">
              ¿Anular este gasto?
            </h2>

            <p className="text-sm text-slate-600">
              Se anulará <strong>{voidTarget.description}</strong> por{' '}
              <strong>{money(Number(voidTarget.amount))}</strong>.
              {voidTarget.method === 'efectivo'
                ? ' El dinero regresará al saldo de Caja y se revertirá el asiento contable.'
                : ' Se revertirá el asiento contable contra Bancos.'}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setVoidTarget(null)}
                disabled={voiding}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                onClick={() => void handleConfirmVoid()}
                disabled={voiding}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {voiding ? 'Anulando...' : 'Sí, anular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Ver / Imprimir comprobante */}
      {viewTarget && doc && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setViewTarget(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">
                {doc.number}
              </h2>

              <button
                onClick={() => setViewTarget(null)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              {viewTarget.category_name} · {viewTarget.expense_date}
              {viewTarget.status === 'anulado' ? ' · ANULADO' : ''}
            </p>

            <div className="border border-slate-200 rounded-lg p-3 space-y-1.5 mb-3 text-sm">
              <p className="font-medium text-slate-800">
                {viewTarget.description}
              </p>

              {viewTarget.beneficiary && (
                <p className="text-xs text-slate-500">
                  Beneficiario: {viewTarget.beneficiary}
                </p>
              )}

              {viewTarget.reference && (
                <p className="text-xs text-slate-500">
                  Comprobante / Factura: {viewTarget.reference}
                </p>
              )}

              <p className="text-xs text-slate-500">
                {doc.paymentLabel}
              </p>
            </div>

            <div className="flex justify-between items-center pb-3 mb-4 border-b border-slate-100">
              <span className="font-bold text-slate-800">
                Total pagado:
              </span>

              <span className="font-bold text-slate-800 text-lg">
                {money(Number(viewTarget.amount))}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => printHtml(buildDocHtml(doc, config))}
                className="flex items-center justify-center gap-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700"
              >
                <Printer className="w-4 h-4" /> Imprimir / PDF
              </button>

              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  buildShareText(doc, config)
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
              >
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </a>

              <button
                onClick={() => {
                  const subject = `${doc.title} ${doc.number}${
                    config?.name ? ' - ' + config.name : ''
                  }`

                  window.location.href =
                    `mailto:?subject=${encodeURIComponent(subject)}` +
                    `&body=${encodeURIComponent(
                      buildShareText(doc, config)
                    )}`
                }}
                className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
              >
                <Mail className="w-4 h-4" /> Correo
              </button>

              {canShare && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.share({
                        title: `${doc.title} ${doc.number}`,
                        text: buildShareText(doc, config),
                      })
                    } catch {
                      // Compartir cancelado por el usuario.
                    }
                  }}
                  className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
                >
                  <Share2 className="w-4 h-4" /> Compartir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ExpenseReceiptScannerModal
        open={showReceiptScanner}
        onClose={() => setShowReceiptScanner(false)}
        onCompleted={summaryMsg => {
          setMsg({ ok: true, text: summaryMsg })
          void load()
        }}
        categories={categories}
        branches={branches}
        config={config}
      />
    </div>
  )
}
