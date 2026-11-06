import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting } from '../lib/auth'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Undo2,
  Download,
  X,
  Search,
  Calculator,
  ArrowLeftRight,
  ArrowUpRight,
} from 'lucide-react'
import { fmtDate, fmtNum } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import JournalEntryForm from '../components/JournalEntryForm'

interface Account {
  id: string; code: string; name: string; type: string; nature: string
  parent_id: string | null; is_postable: boolean; active: boolean
}
interface Entry {
  id: string; number: string; entry_date: string; description: string
  status: 'borrador' | 'contabilizado' | 'reversado'; source_type: string
}
interface Line { id: string; debit: number; credit: number; memo: string | null; acc_accounts: { code: string; name: string } | null }
interface FormLine { account_id: string; debit: string; credit: string; memo: string }
type Tab = 'accounts' | 'journal' | 'ledger' | 'trial'
interface LedgerRow { seq: number; entry_date: string; number: string; description: string; debit: number; credit: number; balance: number; is_opening: boolean }
interface TrialRow {
  account_id: string; code: string; name: string; opening_debit: number; opening_credit: number
  period_debit: number; period_credit: number; closing_debit: number; closing_credit: number
}

const TYPES = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto']
const DEFAULT_NATURE: Record<string, string> = {
  activo: 'debito', costo: 'debito', gasto: 'debito', pasivo: 'credito', patrimonio: 'credito', ingreso: 'credito',
}
const STATUS_META: Record<Entry['status'], { label: string; tone: string }> = {
  borrador: { label: 'Borrador', tone: 'text-amber-700' },
  contabilizado: { label: 'Contabilizado', tone: 'text-emerald-700' },
  reversado: { label: 'Reversado', tone: 'text-slate-500' },
}
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Asiento manual',
  venta: 'Venta comercial',
  compra: 'Compra a proveedor',
  gasto: 'Gasto operativo',
  apertura: 'Apertura / saldo inicial',
  reversion: 'Reversión contable',
}
const INDENT_CLASSES = ['pl-4', 'pl-8', 'pl-12', 'pl-16']
const accountIndentClass = (code: string) => {
  const depth = Math.min(Math.max(code.split('.').length - 1, 0), 3)
  return INDENT_CLASSES[depth]
}
const money = (n: number) => fmtNum(n, 2, 2)
const today = () => new Date().toLocaleDateString('sv-SE')
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE') }
const emptyLine = (): FormLine => ({ account_id: '', debit: '', credit: '', memo: '' })

export default function Accounting({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const isManager = canViewAccounting(user?.role)
  const [tab, setTab] = useState<Tab>('accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showAcc, setShowAcc] = useState(false)
  const [accSearch, setAccSearch] = useState('')
  const [journalSearch, setJournalSearch] = useState('')
  const [journalStatus, setJournalStatus] = useState<'todos' | Entry['status']>('todos')
  const [acc, setAcc] = useState({ code: '', name: '', type: 'activo', nature: 'debito', parent: '', postable: true })
  const [showEntry, setShowEntry] = useState(false)
  const [showNiifForm, setShowNiifForm] = useState(false)
  const [date, setDate] = useState(today())
  const [desc, setDesc] = useState('')
  const [form, setForm] = useState<FormLine[]>([emptyLine(), emptyLine()])
  const [rangeFrom, setRangeFrom] = useState(monthStart())
  const [rangeTo, setRangeTo] = useState(today())
  const [ledgerAcc, setLedgerAcc] = useState('')
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([])
  const [ledgerLoaded, setLedgerLoaded] = useState(false)
  const [trialRows, setTrialRows] = useState<TrialRow[]>([])
  const [trialLoaded, setTrialLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revTarget, setRevTarget] = useState<Entry | null>(null)
  const [revReason, setRevReason] = useState('')

  async function load() {
    const [a, e] = await Promise.all([
      supabase.from('acc_accounts').select('*').order('code'),
      supabase.from('acc_entries').select('*').order('entry_date', { ascending: false }).order('number', { ascending: false }).limit(60),
    ])
    setAccounts((a.data as Account[]) || [])
    setEntries((e.data as Entry[]) || [])
    setLoaded(true)
  }

  useEffect(() => { if (isManager) load() }, [isManager])

  if (!isManager) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>

  const fail = (text: string) => setMsg({ ok: false, text })
  const done = (text: string) => { setMsg({ ok: true, text }); load() }

  async function seed() {
    const { error } = await supabase.rpc('acc_seed_template', { p_template: 'generico' })
    if (error) fail(error.message); else done('Plantilla aplicada. Revísala con tu contador antes de usarla.')
  }

  async function saveAccount() {
    const { error } = await supabase.rpc('acc_upsert_account', {
      p_id: null, p_code: acc.code, p_name: acc.name, p_description: null, p_type: acc.type, p_nature: acc.nature,
      p_parent: acc.parent || null, p_postable: acc.postable, p_active: true,
    })
    if (error) { fail(error.message); return }
    setShowAcc(false); setAcc({ code: '', name: '', type: 'activo', nature: 'debito', parent: '', postable: true }); done('Cuenta creada')
  }

  async function toggleActive(a: Account) {
    const { error } = await supabase.rpc('acc_upsert_account', {
      p_id: a.id, p_code: a.code, p_name: a.name, p_description: null, p_type: a.type, p_nature: a.nature,
      p_parent: a.parent_id, p_postable: a.is_postable, p_active: !a.active,
    })
    if (error) fail(error.message); else load()
  }

  async function toggleEntry(id: string) {
    if (open === id) { setOpen(null); return }
    const { data } = await supabase.from('acc_lines').select('id, debit, credit, memo, acc_accounts(code, name)').eq('entry_id', id)
    setLines((data as unknown as Line[]) || []); setOpen(id)
  }

  const totalD = form.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalC = form.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const validLines = form.filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
  const balanced = validLines.length >= 2 && Math.abs(totalD - totalC) < 0.005 && totalD > 0

  async function saveEntry(post: boolean) {
    const payload = validLines.map(l => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo }))
    const { error } = await supabase.rpc('acc_create_entry', { p_date: date, p_description: desc, p_lines: payload, p_post: post })
    if (error) { fail(error.message); return }
    setShowEntry(false); setDesc(''); setForm([emptyLine(), emptyLine()]); done(post ? 'Asiento contabilizado' : 'Borrador guardado')
  }

  async function post(id: string) {
    const { error } = await supabase.rpc('acc_post_entry', { p_entry_id: id })
    if (error) fail(error.message); else done('Asiento contabilizado')
  }

  function openReverse(e: Entry) {
    setRevTarget(e)
    setRevReason('')
  }

  async function confirmReverse(ev: React.FormEvent) {
    ev.preventDefault()
    if (!revTarget || !revReason.trim() || busy) return
    setBusy(true)
    const { error } = await supabase.rpc('acc_reverse_entry', { p_entry_id: revTarget.id, p_reason: revReason.trim(), p_date: today() })
    setBusy(false)
    if (error) { fail(error.message); return }
    setRevTarget(null); setRevReason('')
    done('Reversión registrada; el asiento original se conserva')
  }

  function exportAccountsExcel() {
    downloadCsv(
      `plan_de_cuentas_${today()}.csv`,
      ['Código', 'Nombre', 'Tipo', 'Naturaleza', 'Admite movimientos', 'Activa'],
      accounts.map(a => [a.code, a.name, a.type, a.nature, a.is_postable ? 'Sí' : 'No', a.active ? 'Sí' : 'No'])
    )
  }

  function exportLedgerExcel() {
    const sel = accounts.find(a => a.id === ledgerAcc)
    downloadCsv(
      `libro_mayor_${sel?.code || 'cuenta'}_${rangeFrom}_${rangeTo}.csv`,
      ['Fecha', 'Comprobante', 'Descripción', 'Débito', 'Crédito', 'Saldo'],
      ledgerRows.map(r => [
        r.entry_date,
        r.number,
        r.description,
        r.is_opening ? 0 : Number(r.debit),
        r.is_opening ? 0 : Number(r.credit),
        Number(r.balance),
      ])
    )
  }

  function exportTrialExcel() {
    downloadCsv(
      `balance_comprobacion_${rangeFrom}_${rangeTo}.csv`,
      ['Código', 'Cuenta', 'Inicial Deudor', 'Inicial Acreedor', 'Débitos Periodo', 'Créditos Periodo', 'Final Deudor', 'Final Acreedor'],
      trialRows.map(r => [
        r.code,
        r.name,
        Number(r.opening_debit),
        Number(r.opening_credit),
        Number(r.period_debit),
        Number(r.period_credit),
        Number(r.closing_debit),
        Number(r.closing_credit),
      ])
    )
  }

  function exportJournalExcel() {
    downloadCsv(
      `libro_diario_${today()}.csv`,
      ['Comprobante', 'Fecha', 'Origen', 'Estado', 'Descripción'],
      filteredEntries.map(e => [
        e.number,
        e.entry_date,
        SOURCE_LABELS[e.source_type] || e.source_type,
        STATUS_META[e.status]?.label || e.status,
        e.description,
      ])
    )
  }

  async function loadLedgerForAccount(accountId: string) {
    if (!accountId) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('acc_ledger', { p_account: accountId, p_from: rangeFrom, p_to: rangeTo })
    setBusy(false)
    if (error) { fail(error.message); return }
    setLedgerRows((data as LedgerRow[]) || []); setLedgerLoaded(true)
  }

  async function loadLedger() {
    await loadLedgerForAccount(ledgerAcc)
  }

  function openAccountInLedger(accountId: string) {
    setLedgerAcc(accountId)
    setTab('ledger')
    void loadLedgerForAccount(accountId)
  }

  async function loadTrial() {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('acc_trial_balance', { p_from: rangeFrom, p_to: rangeTo })
    setBusy(false)
    if (error) { fail(error.message); return }
    setTrialRows((data as TrialRow[]) || []); setTrialLoaded(true)
  }

  const filteredAccounts = useMemo(() => {
    const q = accSearch.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(
      a =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q)
    )
  }, [accounts, accSearch])

  const filteredEntries = useMemo(() => {
    const q = journalSearch.trim().toLowerCase()
    return entries.filter(e => {
      if (journalStatus !== 'todos' && e.status !== journalStatus) return false
      if (!q) return true
      return (
        e.number.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.source_type.toLowerCase().includes(q) ||
        e.entry_date.includes(q)
      )
    })
  }, [entries, journalSearch, journalStatus])

  const tot = (k: keyof TrialRow) => trialRows.reduce((sum, r) => sum + Number(r[k]), 0)
  const trialEq = Math.abs(tot('opening_debit') - tot('opening_credit')) < 0.005
    && Math.abs(tot('period_debit') - tot('period_credit')) < 0.005
    && Math.abs(tot('closing_debit') - tot('closing_credit')) < 0.005
  const ledgerD = ledgerRows.reduce((sum, r) => sum + (r.is_opening ? 0 : Number(r.debit)), 0)
  const ledgerC = ledgerRows.reduce((sum, r) => sum + (r.is_opening ? 0 : Number(r.credit)), 0)

  const postable = accounts.filter(a => a.is_postable && a.active)
  const input = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700'
  const tabBtn = (id: Tab, label: string) => (
    <button onClick={() => setTab(id)} className={`flex-1 px-3 py-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors ${tab === id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
  )

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Libros contables</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Plan de cuentas codificado, libro diario por partida doble, mayor analítico y balance de comprobación.
          </p>
        </div>
        {onNavigate && (
          <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => onNavigate('erpbridge')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 whitespace-nowrap"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Migración Siigo / Loggro
            </button>
            <button
              type="button"
              onClick={() => onNavigate('cpa')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-white whitespace-nowrap"
            >
              <Calculator className="w-3.5 h-3.5" />
              Despacho del Contador (Hoja 8 col. · NIIF)
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-1 p-1 bg-white rounded-xl border border-slate-200 overflow-x-auto">{tabBtn('accounts', 'Plan de cuentas')}{tabBtn('journal', 'Libro diario')}{tabBtn('ledger', 'Libro mayor')}{tabBtn('trial', 'Balance de comprobación')}</div>
      {msg && <p className={`text-sm px-3 py-2 rounded-lg ${msg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>{msg.text}</p>}

      {tab === 'accounts' && (
        <div className="space-y-3">
          {loaded && accounts.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center space-y-3">
              <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">Aún no tienes un plan de cuentas</p>
              <p className="text-sm text-slate-500">Puedes empezar con una plantilla genérica y editable, o crear tus cuentas una por una. No es un plan fiscal oficial: debe revisarlo tu contador.</p>
              <button onClick={seed} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium">Usar plantilla genérica</button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowAcc(!showAcc)} className="flex items-center gap-1 text-sm font-medium text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"><Plus className="w-4 h-4" /> Nueva cuenta</button>
              {accounts.length > 0 && (
                <button onClick={exportAccountsExcel} className="flex items-center gap-1 text-sm font-medium text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"><Download className="w-4 h-4" /> Exportar CSV</button>
              )}
            </div>
            {accounts.length > 0 && (
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={accSearch}
                  onChange={e => setAccSearch(e.target.value)}
                  placeholder="Buscar por código, nombre o tipo..."
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-slate-500"
                />
              </div>
            )}
          </div>
          {showAcc && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-2 gap-3">
              <input value={acc.code} onChange={e => setAcc({ ...acc, code: e.target.value })} placeholder="Código (ej. 1.1.06)" className={input} />
              <input value={acc.name} onChange={e => setAcc({ ...acc, name: e.target.value })} placeholder="Nombre" className={input} />
              <select value={acc.type} onChange={e => setAcc({ ...acc, type: e.target.value, nature: DEFAULT_NATURE[e.target.value] })} className={input}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={acc.nature} onChange={e => setAcc({ ...acc, nature: e.target.value })} className={input}>
                <option value="debito">Naturaleza débito</option><option value="credito">Naturaleza crédito</option>
              </select>
              <select value={acc.parent} onChange={e => setAcc({ ...acc, parent: e.target.value })} className={`${input} col-span-2`}>
                <option value="">Sin cuenta padre</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
              <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={acc.postable} onChange={e => setAcc({ ...acc, postable: e.target.checked })} /> Admite movimientos (desmárcala si solo agrupa otras cuentas)
              </label>
              <button onClick={saveAccount} className="col-span-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium">Guardar cuenta</button>
            </div>
          )}
          {filteredAccounts.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {filteredAccounts.map(a => (
                <div key={a.id} className={`flex items-center gap-3 pr-4 py-2.5 ${accountIndentClass(a.code)}`}>
                  <span className="text-xs font-mono tabular-nums text-slate-500 w-16 shrink-0">{a.code}</span>
                  <span className={`text-sm flex-1 min-w-0 truncate ${a.is_postable ? 'text-slate-800' : 'font-semibold text-slate-900'} ${a.active ? '' : 'line-through text-slate-400'}`}>{a.name}</span>
                  <span className="text-xs text-slate-500 hidden sm:block capitalize">{a.type} · {a.nature}</span>
                  {a.is_postable && (
                    <button
                      type="button"
                      onClick={() => openAccountInLedger(a.id)}
                      className="text-xs text-slate-500 hover:text-slate-900 underline shrink-0 hidden md:inline"
                    >
                      Mayor
                    </button>
                  )}
                  <button onClick={() => toggleActive(a)} className="text-xs text-slate-500 hover:text-slate-800 shrink-0 whitespace-nowrap">{a.active ? 'Desactivar' : 'Activar'}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'journal' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowNiifForm(!showNiifForm)
                  if (!showNiifForm) setShowEntry(false)
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 px-3.5 py-2 rounded-xl hover:bg-indigo-500 shadow-xs whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Asiento Partida Doble (NIIF)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEntry(!showEntry)
                  if (!showEntry) setShowNiifForm(false)
                }}
                className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Asiento rápido
              </button>
              {entries.length > 0 && (
                <button onClick={exportJournalExcel} className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"><Download className="w-3.5 h-3.5" /> Exportar CSV</button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={journalStatus}
                onChange={e => setJournalStatus(e.target.value as 'todos' | Entry['status'])}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-slate-500"
              >
                <option value="todos">Todos los estados</option>
                <option value="contabilizado">Contabilizados</option>
                <option value="borrador">Borradores</option>
                <option value="reversado">Reversados</option>
              </select>
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={journalSearch}
                  onChange={e => setJournalSearch(e.target.value)}
                  placeholder="Buscar comprobante o glosa..."
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>
          </div>
          {showNiifForm && (
            <div className="mb-4">
              <JournalEntryForm
                onSuccess={() => {
                  setShowNiifForm(false)
                  void load()
                }}
                onCancel={() => setShowNiifForm(false)}
              />
            </div>
          )}
          {showEntry && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={input} />
                <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Descripción del asiento" className={`${input} col-span-2`} />
              </div>
              {form.map((l, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <select value={l.account_id} onChange={e => setForm(form.map((x, j) => j === i ? { ...x, account_id: e.target.value } : x))} className={`${input} col-span-2`}>
                    <option value="">Cuenta…</option>
                    {postable.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                  <input inputMode="decimal" value={l.debit} placeholder="Débito" onChange={e => setForm(form.map((x, j) => j === i ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x))} className={`${input} col-span-1`} />
                  <input inputMode="decimal" value={l.credit} placeholder="Crédito" onChange={e => setForm(form.map((x, j) => j === i ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x))} className={`${input} col-span-1`} />
                </div>
              ))}
              <button onClick={() => setForm([...form, emptyLine()])} className="text-xs text-slate-600 underline">+ Agregar línea</button>
              <div className={`flex justify-between text-sm px-3 py-2 rounded-lg tabular-nums ${balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                <span>Débitos {money(totalD)} · Créditos {money(totalC)}</span>
                <span>{balanced ? 'Partida doble cuadrada' : `Diferencia ${money(Math.abs(totalD - totalC))}`}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => saveEntry(false)} disabled={!desc || validLines.length < 1} className="px-4 py-2 rounded-lg text-sm text-slate-700 border border-slate-200 disabled:opacity-40 whitespace-nowrap shrink-0">Guardar borrador</button>
                <button onClick={() => saveEntry(true)} disabled={!balanced || !desc} className="flex-1 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">Contabilizar asiento</button>
              </div>
            </div>
          )}
          {loaded && filteredEntries.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No hay asientos para este filtro.</p>}
          <div className="space-y-2">
            {filteredEntries.map(e => {
              const statusInfo = STATUS_META[e.status] || { label: e.status, tone: 'text-slate-600' }
              return (
                <div key={e.id} className="bg-white rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button onClick={() => toggleEntry(e.id)} className="text-slate-400">{open === e.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => void toggleEntry(e.id)}>
                      <p className="text-sm font-medium text-slate-800 truncate"><span className="font-mono text-xs text-slate-500 mr-1.5">{e.number}</span>{e.description}</p>
                      <p className="text-xs text-slate-500 tabular-nums">{fmtDate(e.entry_date + 'T00:00:00')} · {SOURCE_LABELS[e.source_type] || e.source_type}</p>
                    </div>
                    <span className={`text-xs font-semibold whitespace-nowrap ${statusInfo.tone}`}>{statusInfo.label}</span>
                    {e.status === 'borrador' && <button onClick={() => post(e.id)} className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap">Contabilizar</button>}
                    {e.status === 'contabilizado' && <button onClick={() => openReverse(e)} title="Revertir comprobante" className="text-slate-500 hover:text-red-600"><Undo2 className="w-4 h-4" /></button>}
                  </div>
                  {open === e.id && (
                    <div className="border-t border-slate-100 px-4 py-2.5 text-xs bg-slate-50/50 space-y-1">
                      {lines.map(l => (
                        <div key={l.id} className="flex justify-between py-1 text-slate-700">
                          <span className="truncate"><span className="font-mono text-slate-500 mr-1.5">{l.acc_accounts?.code}</span>{l.acc_accounts?.name}</span>
                          <span className="font-mono tabular-nums shrink-0 ml-3">{l.debit > 0 ? 'Débito ' + money(l.debit) : 'Crédito ' + money(l.credit)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-2 gap-3">
            <select value={ledgerAcc} onChange={e => setLedgerAcc(e.target.value)} className={`${input} col-span-2`}>
              <option value="">Elige una cuenta…</option>
              {accounts.filter(a => a.is_postable).map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
            <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} className={input} />
            <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)} className={input} />
            <button onClick={loadLedger} disabled={!ledgerAcc || busy} className="col-span-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">{busy ? 'Calculando…' : 'Ver libro mayor'}</button>
          </div>
          {ledgerLoaded && ledgerRows.length <= 1 && <p className="text-sm text-slate-400 text-center py-4">No hay movimientos contabilizados de esta cuenta en el periodo.</p>}
          {ledgerRows.length > 1 && (
            <>
              <div className="flex justify-end">
                <button onClick={exportLedgerExcel} className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Descargar Excel</button>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-3 py-2">Fecha</th><th className="pr-3">Comprobante</th><th className="pr-3">Descripción</th>
                    <th className="pr-3 text-right">Débito</th><th className="pr-3 text-right">Crédito</th><th className="pr-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                    { ledgerRows.map(r => (
                    <tr key={r.seq} className={`border-b border-slate-100 ${r.is_opening ? 'bg-slate-50 font-medium' : ''}`}>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDate(r.entry_date + 'T00:00:00')}</td>
                      <td className="pr-3 whitespace-nowrap font-mono text-xs">{r.number}</td>
                      <td className="pr-3 max-w-[18rem] truncate">{r.description}</td>
                      <td className="pr-3 text-right font-mono tabular-nums">{r.is_opening ? '' : money(Number(r.debit))}</td>
                      <td className="pr-3 text-right font-mono tabular-nums">{r.is_opening ? '' : money(Number(r.credit))}</td>
                      <td className="pr-3 text-right font-mono tabular-nums">{money(Number(r.balance))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-slate-800 bg-slate-50">
                    <td className="px-3 py-2" colSpan={3}>Totales del periodo</td>
                    <td className="pr-3 text-right font-mono tabular-nums">{money(ledgerD)}</td>
                    <td className="pr-3 text-right font-mono tabular-nums">{money(ledgerC)}</td>
                    <td className="pr-3 text-right font-mono tabular-nums">{money(Number(ledgerRows[ledgerRows.length - 1].balance))}</td>
                  </tr>
                </tfoot>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'trial' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-2 gap-3">
            <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} className={input} />
            <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)} className={input} />
            <button onClick={loadTrial} disabled={busy} className="col-span-2 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">{busy ? 'Calculando…' : 'Ver balance de comprobación'}</button>
          </div>
          {trialLoaded && trialRows.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No hay movimientos contabilizados hasta esa fecha.</p>}
          {trialRows.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className={`text-sm px-3 py-2 rounded-lg flex-1 tabular-nums ${trialEq ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {trialEq ? 'Balance equilibrado: débitos y créditos coinciden. Haz clic en cualquier cuenta para auditar su Mayor Analítico.' : `Diferencia detectada: ${money(Math.abs(tot('closing_debit') - tot('closing_credit')))}. Revisa los asientos del periodo.`}
                </p>
                <button onClick={exportTrialExcel} className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 shrink-0 whitespace-nowrap"><Download className="w-3.5 h-3.5" /> Exportar CSV</button>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="px-3 py-2 text-left" rowSpan={2}>Cuenta (clic para Mayor)</th>
                      <th className="pr-3 text-center" colSpan={2}>Saldo inicial</th>
                      <th className="pr-3 text-center" colSpan={2}>Movimientos</th>
                      <th className="pr-3 text-center" colSpan={2}>Saldo final</th>
                    </tr>
                    <tr className="text-slate-400 border-b border-slate-200">
                      {['Deudor', 'Acreedor', 'Débitos', 'Créditos', 'Deudor', 'Acreedor'].map((h, i) => <th key={i} className="pr-3 text-right font-normal">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {trialRows.map(r => (
                      <tr
                        key={r.account_id}
                        onClick={() => openAccountInLedger(r.account_id)}
                        title="Abrir auxiliar de Libro Mayor de esta cuenta"
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 whitespace-nowrap"><span className="font-mono text-slate-500 mr-1.5">{r.code}</span><span className="font-medium text-slate-800">{r.name}</span></td>
                        {([r.opening_debit, r.opening_credit, r.period_debit, r.period_credit, r.closing_debit, r.closing_credit]).map((v, i) => (
                          <td key={i} className="pr-3 text-right font-mono tabular-nums">{Number(v) ? money(Number(v)) : '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold text-slate-800 bg-slate-50">
                      <td className="px-3 py-2">Totales</td>
                      {(['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'] as (keyof TrialRow)[]).map(k => (
                        <td key={k} className="pr-3 text-right font-mono tabular-nums">{money(tot(k))}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {revTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!busy) setRevTarget(null) }}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-slate-800">Revertir {revTarget.number}</h2>
              <button onClick={() => setRevTarget(null)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">Se creará un asiento inverso con fecha de hoy; el comprobante original se conserva.</p>
            <form onSubmit={confirmReverse} className="space-y-3">
              <input
                required
                autoFocus
                value={revReason}
                onChange={e => setRevReason(e.target.value)}
                placeholder="Motivo de la reversión (obligatorio)"
                className={input}
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setRevTarget(null)} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-700">Cancelar</button>
                <button type="submit" disabled={busy || !revReason.trim()} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40">{busy ? 'Revirtiendo…' : 'Revertir'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
