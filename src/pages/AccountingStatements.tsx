import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting } from '../lib/auth'
import {
  Printer,
  CheckCircle2,
  AlertTriangle,
  Download,
  Calculator,
  ArrowUpRight,
} from 'lucide-react'
import { useCurrency, fmtNum } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import { readLocalCpaProfile } from '../lib/cpaStorage'
import type { CpaProfessionalProfile } from '../types'

interface Row {
  account_id: string | null
  code: string
  name: string
  type: string
  amount: number
}

interface Reason {
  kind: 'bloqueo' | 'nota'
  reason: string
}

const money = (n: number) => fmtNum(Number(n) || 0, 2, 2)
const pctOf = (value: number, base: number) =>
  base > 0.005 ? `${((Number(value) / base) * 100).toFixed(1)}%` : '—'
const iso = (d: Date) => d.toLocaleDateString('sv-SE')

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; padding: 0 !important; }
  .no-print { display: none !important; }
}
`

export default function AccountingStatements({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const { currency } = useCurrency()
  const isManager = canViewAccounting(user?.role)
  const now = new Date()

  const [tab, setTab] = useState<'er' | 'bs'>('er')
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), 0, 1)))
  const [to, setTo] = useState(iso(now))
  const [rows, setRows] = useState<Row[]>([])
  const [reasons, setReasons] = useState<Reason[]>([])
  const [companyHeader, setCompanyHeader] = useState<{ name: string; rif: string }>({
    name: user?.company_name || 'Empresa',
    rif: '',
  })
  const [cpaProfile, setCpaProfile] = useState<CpaProfessionalProfile>(() =>
    readLocalCpaProfile(user?.company_id, user ?? undefined)
  )
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setCpaProfile(readLocalCpaProfile(user?.company_id, user ?? undefined))
  }, [user?.company_id, user?.full_name, user?.email, user?.phone])

  useEffect(() => {
    if (!isManager) return
    supabase
      .from('company_config')
      .select('name, rif')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const rec = data as { name?: string; rif?: string }
          setCompanyHeader({
            name: rec.name || user?.company_name || 'Empresa',
            rif: rec.rif || '',
          })
        }
      })
  }, [isManager, user?.company_name])

  useEffect(() => {
    if (!isManager) return
    setErr(null)
    const q =
      tab === 'er'
        ? supabase.rpc('acc_income_statement', { p_from: from, p_to: to })
        : supabase.rpc('acc_balance_sheet', { p_to: to })
    q.then(({ data, error }) => {
      if (error) setErr(error.message)
      else setRows((data as Row[]) || [])
    })
    supabase.rpc('acc_statement_status', { p_to: to }).then(({ data }) => {
      setReasons((data as Reason[]) || [])
    })
  }, [isManager, tab, from, to])

  if (!isManager) {
    return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>
  }

  const of = (t: string) => rows.filter(r => r.type === t)
  const sum = (t: string) => of(t).reduce((s, r) => s + Number(r.amount), 0)
  const blockers = reasons.filter(r => r.kind === 'bloqueo')
  const notes = reasons.filter(r => r.kind === 'nota')

  const input =
    'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700'

  const tabBtn = (id: 'er' | 'bs', label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
        tab === id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )

  const ingresos = sum('ingreso')
  const costos = sum('costo')
  const gastos = sum('gasto')
  const bruta = ingresos - costos
  const neta = bruta - gastos

  const activo = sum('activo')
  const pasivo = sum('pasivo')
  const patr = sum('patrimonio')
  const res = sum('resultado')
  const pasivoMasPatrimonio = pasivo + patr + res
  const cuadra = Math.abs(activo - pasivoMasPatrimonio) < 0.005

  const verticalBase = tab === 'er' ? ingresos : activo

  const Section = ({
    title,
    type,
    total,
    label,
  }: {
    title: string
    type: string
    total: number
    label?: string
  }) => (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        <span>{title}</span>
        <span className="text-[11px] font-normal normal-case text-slate-400">
          Monto ({currency}) · % Vertical
        </span>
      </div>
      {of(type).map(r => (
        <div
          key={r.code}
          className="flex items-center justify-between gap-3 py-1.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <span className="min-w-0 truncate">
            <span className="font-mono text-xs text-slate-400 mr-2">{r.code}</span>
            {r.name}
          </span>
          <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
            <span>{money(r.amount)}</span>
            <span className="w-14 text-right text-xs text-slate-400">
              {pctOf(Number(r.amount), verticalBase)}
            </span>
          </div>
        </div>
      ))}
      {of(type).length === 0 && (
        <p className="text-xs text-slate-400 py-1.5">Sin movimientos contabilizados</p>
      )}
      <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-200 text-sm font-semibold text-slate-800">
        <span>{label || `Total ${title.toLowerCase()}`}</span>
        <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
          <span>{money(total)}</span>
          <span className="w-14 text-right text-xs text-slate-500">
            {pctOf(total, verticalBase)}
          </span>
        </div>
      </div>
    </div>
  )

  function exportExcel() {
    if (tab === 'er') {
      const csvRows: (string | number)[][] = [
        ...of('ingreso').map(r => [
          'Ingresos',
          r.code,
          r.name,
          Number(r.amount),
          pctOf(Number(r.amount), ingresos),
        ]),
        ['Subtotal', '', 'Total ingresos', ingresos, pctOf(ingresos, ingresos)],
        ...of('costo').map(r => [
          'Costos',
          r.code,
          r.name,
          Number(r.amount),
          pctOf(Number(r.amount), ingresos),
        ]),
        ['Subtotal', '', 'Total costos', costos, pctOf(costos, ingresos)],
        ['Resultado', '', 'Utilidad bruta', bruta, pctOf(bruta, ingresos)],
        ...of('gasto').map(r => [
          'Gastos',
          r.code,
          r.name,
          Number(r.amount),
          pctOf(Number(r.amount), ingresos),
        ]),
        ['Subtotal', '', 'Total gastos', gastos, pctOf(gastos, ingresos)],
        ['Resultado', '', 'Resultado neto del periodo', neta, pctOf(neta, ingresos)],
      ]
      downloadCsv(
        `estado_resultados_${from}_${to}.csv`,
        ['Sección', 'Código', 'Cuenta', `Monto (${currency})`, '% Vertical'],
        csvRows
      )
      return
    }
    const csvRows: (string | number)[][] = [
      ...of('activo').map(r => [
        'Activos',
        r.code,
        r.name,
        Number(r.amount),
        pctOf(Number(r.amount), activo),
      ]),
      ['Subtotal', '', 'Total activos', activo, pctOf(activo, activo)],
      ...of('pasivo').map(r => [
        'Pasivos',
        r.code,
        r.name,
        Number(r.amount),
        pctOf(Number(r.amount), activo),
      ]),
      ['Subtotal', '', 'Total pasivos', pasivo, pctOf(pasivo, activo)],
      ...of('patrimonio').map(r => [
        'Patrimonio',
        r.code,
        r.name,
        Number(r.amount),
        pctOf(Number(r.amount), activo),
      ]),
      ['Subtotal', '', 'Total patrimonio', patr, pctOf(patr, activo)],
      ...of('resultado').map(r => [
        'Resultado acumulado',
        r.code,
        r.name,
        Number(r.amount),
        pctOf(Number(r.amount), activo),
      ]),
      [
        'Total',
        '',
        'Pasivo + patrimonio + resultado',
        pasivoMasPatrimonio,
        pctOf(pasivoMasPatrimonio, activo),
      ],
    ]
    downloadCsv(
      `balance_general_${to}.csv`,
      ['Sección', 'Código', 'Cuenta', `Monto (${currency})`, '% Vertical'],
      csvRows
    )
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <style>{PRINT_CSS}</style>

      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Estados financieros NIIF
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Estado de resultados y situación financiera con análisis vertical automático y bloque de firma CPC.
          </p>
        </div>

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('cpa')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-white whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Calculator className="w-3.5 h-3.5" />
            Despacho y firma CPC
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="no-print flex gap-1 p-1 bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {tabBtn('er', 'Estado de resultados integrales')}
        {tabBtn('bs', 'Estado de situación financiera (Balance general)')}
      </div>

      <div className="no-print grid grid-cols-2 gap-3">
        {tab === 'er' ? (
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className={input}
          />
        ) : (
          <p className="text-sm text-slate-500 self-center">Fecha de corte:</p>
        )}
        <input
          type="date"
          value={to}
          onChange={e => setTo(e.target.value)}
          className={input}
        />
      </div>

      {err && (
        <p className="no-print text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {err}
        </p>
      )}

      {blockers.length > 0 ? (
        <div className="no-print bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" /> Borrador preliminar: existen comprobantes o cierres pendientes
          </p>
          {blockers.map(r => (
            <p key={r.reason} className="text-xs text-amber-800">
              • {r.reason}
            </p>
          ))}
        </div>
      ) : (
        <p className="no-print flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> Periodos conciliados y asientos contabilizados
        </p>
      )}

      <div className="print-area bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap pb-4 border-b border-slate-200">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {companyHeader.name}
              {companyHeader.rif ? ` · ${companyHeader.rif}` : ''}
            </p>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              {tab === 'er'
                ? 'Estado de Resultados'
                : 'Estado de Situación Financiera (Balance General)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {tab === 'er' ? `Período del ${from} al ${to}` : `Al corte del ${to}`} · Expresado en{' '}
              {currency}
              {blockers.length > 0 ? ' · PRELIMINAR' : ''}
            </p>
          </div>
          <div className="no-print flex items-center gap-2">
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" /> Exportar CSV
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
            </button>
          </div>
        </div>

        {tab === 'er' ? (
          <>
            <Section title="Ingresos operacionales" type="ingreso" total={ingresos} />
            <Section title="Costo de ventas" type="costo" total={costos} />
            <div className="flex items-center justify-between gap-3 py-2.5 border-y-2 border-slate-300 text-sm font-bold text-slate-900">
              <span>Utilidad bruta en ventas</span>
              <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
                <span>{money(bruta)}</span>
                <span className="w-14 text-right text-xs font-semibold text-slate-600">
                  {pctOf(bruta, ingresos)}
                </span>
              </div>
            </div>
            <Section title="Gastos operacionales y administrativos" type="gasto" total={gastos} />
            <div
              className={`flex items-center justify-between gap-3 py-2.5 border-y-2 border-slate-300 text-sm font-bold ${
                neta >= 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              <span>Resultado neto del ejercicio</span>
              <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
                <span>{money(neta)}</span>
                <span className="w-14 text-right text-xs font-semibold">
                  {pctOf(neta, ingresos)}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <Section title="Activos" type="activo" total={activo} />
            <Section title="Pasivos" type="pasivo" total={pasivo} />
            <Section title="Patrimonio" type="patrimonio" total={patr} />
            <Section
              title="Resultado acumulado del ejercicio"
              type="resultado"
              total={res}
              label="Resultado acumulado pendiente de cierre"
            />
            <div
              className={`flex items-center justify-between gap-3 py-2.5 border-y-2 border-slate-300 text-sm font-bold ${
                cuadra ? 'text-slate-900' : 'text-red-700'
              }`}
            >
              <span>Total Pasivo + Patrimonio + Resultado</span>
              <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
                <span>{money(pasivoMasPatrimonio)}</span>
                <span className="w-14 text-right text-xs font-semibold text-slate-600">
                  {pctOf(pasivoMasPatrimonio, activo)}
                </span>
              </div>
            </div>
            <p className={`text-xs font-medium ${cuadra ? 'text-emerald-700' : 'text-red-700'}`}>
              {cuadra
                ? 'Ecuación patrimonial verificada: Activos = Pasivos + Patrimonio + Resultado.'
                : 'Descuadre detectado en la ecuación patrimonial: revisa los asientos en el Despacho Contable.'}
            </p>
          </>
        )}

        {notes.map(n => (
          <p key={n.reason} className="text-[11px] text-slate-400">
            Nota: {n.reason}.
          </p>
        ))}

        {/* Bloque formal de firmas de Contador Público y Representación Legal */}
        <div className="pt-10 mt-6 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs text-slate-700">
          <div className="pt-8 border-t border-slate-300 text-center">
            <p className="font-semibold text-slate-900">
              {cpaProfile.full_name || 'Contador Público Responsable'}
            </p>
            <p className="text-slate-600 mt-0.5">
              {cpaProfile.title_label || 'Contador Público Colegiado'}
              {cpaProfile.license_number ? ` · ${cpaProfile.license_number}` : ''}
            </p>
            {cpaProfile.firm_name && (
              <p className="text-[11px] text-slate-500 mt-0.5">{cpaProfile.firm_name}</p>
            )}
          </div>

          <div className="pt-8 border-t border-slate-300 text-center">
            <p className="font-semibold text-slate-900">{companyHeader.name}</p>
            <p className="text-slate-600 mt-0.5">Representante Legal / Gerencia General</p>
            {companyHeader.rif && (
              <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{companyHeader.rif}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
