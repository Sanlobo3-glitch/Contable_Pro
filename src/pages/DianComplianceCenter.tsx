import { useState, useEffect, useMemo } from 'react'
import {
  FileText,
  Calculator,
  Download,
  Printer,
  Calendar,
  Building2,
  CheckCircle2,
  AlertCircle,
  Copy,
  ChevronRight,
  Sparkles,
  Send,
  Layers,
  Search,
  BookOpen,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting } from '../lib/auth'
import { useCurrency, formatMoney, fmtDate } from '../lib/currency'
import {
  getFormulario300,
  getFormulario350,
  getExogenaRows,
  exportExogenaToCsv,
  type Form300Data,
  type Form350Data,
  type ExogenaRow,
} from '../services/dianTaxService'

type DianTab = 'muisca' | 'exogena' | 'certificates' | 'mapping'
type FormType = '300' | '350'

const EMPTY_F300: Form300Data = {
  casilla_30_ingresos_gravados_19: 0,
  casilla_31_ingresos_gravados_5: 0,
  casilla_28_ingresos_excluidos: 0,
  casilla_41_total_ingresos_brutos: 0,
  casilla_43_devoluciones_ventas: 0,
  casilla_42_total_ingresos_netos: 0,
  casilla_59_iva_generado_19: 0,
  casilla_60_iva_generado_5: 0,
  casilla_65_total_iva_generado: 0,
  casilla_66_compras_gravadas: 0,
  casilla_74_iva_descontable_compras: 0,
  casilla_83_total_iva_descontable: 0,
  casilla_84_saldo_a_pagar: 0,
  casilla_85_saldo_a_favor: 0,
}

const EMPTY_F350: Form350Data = {
  casilla_27_laborales_base: 0,
  casilla_39_laborales_ret: 0,
  casilla_46_honorarios_base: 0,
  casilla_47_honorarios_ret: 0,
  casilla_50_servicios_base: 0,
  casilla_51_servicios_ret: 0,
  casilla_54_arrendamientos_base: 0,
  casilla_55_arrendamientos_ret: 0,
  casilla_56_compras_base: 0,
  casilla_57_compras_ret: 0,
  casilla_74_reteiva_base: 0,
  casilla_75_reteiva_ret: 0,
  casilla_83_autorenta_base: 0,
  casilla_84_autorenta_ret: 0,
  casilla_90_total_retenciones: 0,
}

interface Props {
  onNavigate?: (page: string) => void
}

export default function DianComplianceCenter({ onNavigate }: Props = {}) {
  const { user } = useAuth()
  const { fmt: money, currency } = useCurrency()
  const isCpa = canViewAccounting(user?.role)

  const [activeTab, setActiveTab] = useState<DianTab>('muisca')
  const [formType, setFormType] = useState<FormType>('300')
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [selectedPeriod, setSelectedPeriod] = useState<number>(1) // Bimestre 1 o Mes 1
  const [loading, setLoading] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')

  // Datos Formulario 300 y 350
  const [f300, setF300] = useState<Form300Data>(EMPTY_F300)
  const [f350, setF350] = useState<Form350Data>(EMPTY_F350)

  // Datos Exógena
  const [exogenaForm, setExogenaForm] = useState<string>('1001')
  const [exogenaRows, setExogenaRows] = useState<ExogenaRow[]>([])

  // Certificados
  const [certType, setCertType] = useState<'retefuente' | 'reteiva' | 'reteica'>('retefuente')
  const [certSearch, setCertSearch] = useState('')
  const [certSupplier, setCertSupplier] = useState<any>(null)
  const [companyConfig, setCompanyConfig] = useState<any>(null)

  useEffect(() => {
    supabase.from('company_config').select('*').limit(1).maybeSingle().then(({ data }) => {
      if (data) setCompanyConfig(data)
    })
  }, [])

  // Calcular fechas según período seleccionado
  const dateRange = useMemo(() => {
    if (formType === '300') {
      // Bimestral: período 1 = Ene-Feb, 2 = Mar-Abr, etc.
      const startMonth = (selectedPeriod - 1) * 2
      const start = new Date(selectedYear, startMonth, 1)
      const end = new Date(selectedYear, startMonth + 2, 1)
      return { start, end, label: `Bimestre ${selectedPeriod} (${start.toLocaleDateString('es-CO', { month: 'short' })} - ${new Date(selectedYear, startMonth + 1, 1).toLocaleDateString('es-CO', { month: 'short' })})` }
    } else {
      // Mensual: período 1 a 12
      const start = new Date(selectedYear, selectedPeriod - 1, 1)
      const end = new Date(selectedYear, selectedPeriod, 1)
      return { start, end, label: start.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }) }
    }
  }, [formType, selectedYear, selectedPeriod])

  // Cargar datos del formulario activo
  useEffect(() => {
    let alive = true
    async function loadForm() {
      setLoading(true)
      const coId = user?.company_id || null
      if (formType === '300') {
        const data = await getFormulario300(coId, dateRange.start, dateRange.end)
        if (alive) setF300(data)
      } else {
        const data = await getFormulario350(coId, dateRange.start, dateRange.end)
        if (alive) setF350(data)
      }
      setLoading(false)
    }
    void loadForm()
    return () => { alive = false }
  }, [formType, dateRange, user?.company_id])

  // Cargar datos de exógena cuando se active la pestaña
  useEffect(() => {
    if (activeTab !== 'exogena') return
    let alive = true
    async function loadExogena() {
      setLoading(true)
      const rows = await getExogenaRows(user?.company_id || null, selectedYear, exogenaForm)
      if (alive) setExogenaRows(rows)
      setLoading(false)
    }
    void loadExogena()
    return () => { alive = false }
  }, [activeTab, selectedYear, exogenaForm, user?.company_id])

  function handleCopyBoxes() {
    let text = ''
    if (formType === '300') {
      text = `=== BORRADOR FORMULARIO 300 DIAN (IVA) ===\n` +
        `Casilla 30 (Gravado 19%): ${f300.casilla_30_ingresos_gravados_19}\n` +
        `Casilla 31 (Gravado 5%): ${f300.casilla_31_ingresos_gravados_5}\n` +
        `Casilla 28 (Excluidos): ${f300.casilla_28_ingresos_excluidos}\n` +
        `Casilla 41 (Total Brutos): ${f300.casilla_41_total_ingresos_brutos}\n` +
        `Casilla 43 (Devoluciones ventas): ${f300.casilla_43_devoluciones_ventas}\n` +
        `Casilla 42 (Total Ingresos Netos): ${f300.casilla_42_total_ingresos_netos}\n` +
        `Casilla 59 (IVA Generado 19%): ${f300.casilla_59_iva_generado_19}\n` +
        `Casilla 60 (IVA Generado 5%): ${f300.casilla_60_iva_generado_5}\n` +
        `Casilla 65 (Total IVA Generado): ${f300.casilla_65_total_iva_generado}\n` +
        `Casilla 66 (Compras Gravadas): ${f300.casilla_66_compras_gravadas}\n` +
        `Casilla 74 (IVA Descontable Compras): ${f300.casilla_74_iva_descontable_compras}\n` +
        `Casilla 83 (Total IVA Descontable): ${f300.casilla_83_total_iva_descontable}\n` +
        `Casilla 84 (Saldo a Pagar): ${f300.casilla_84_saldo_a_pagar}\n` +
        `Casilla 85 (Saldo a Favor): ${f300.casilla_85_saldo_a_favor}`
    } else {
      text = `=== BORRADOR FORMULARIO 350 DIAN (RETENCIÓN) ===\n` +
        `Casilla 46 (Honorarios Base): ${f350.casilla_46_honorarios_base} | Casilla 47 (Retención): ${f350.casilla_47_honorarios_ret}\n` +
        `Casilla 50 (Servicios Base): ${f350.casilla_50_servicios_base} | Casilla 51 (Retención): ${f350.casilla_51_servicios_ret}\n` +
        `Casilla 54 (Arrendamientos Base): ${f350.casilla_54_arrendamientos_base} | Casilla 55 (Retención): ${f350.casilla_55_arrendamientos_ret}\n` +
        `Casilla 56 (Compras Base): ${f350.casilla_56_compras_base} | Casilla 57 (Retención): ${f350.casilla_57_compras_ret}\n` +
        `Casilla 74 (ReteIVA Base): ${f350.casilla_74_reteiva_base} | Casilla 75 (ReteIVA Ret.): ${f350.casilla_75_reteiva_ret}\n` +
        `Casilla 83 (AutoRenta Base): ${f350.casilla_83_autorenta_base} | Casilla 84 (AutoRenta Ret.): ${f350.casilla_84_autorenta_ret}\n` +
        `Casilla 90 (TOTAL RETENCIONES): ${f350.casilla_90_total_retenciones}`
    }
    navigator.clipboard.writeText(text)
    setCopyNotice('¡Casillas copiadas al portapapeles! Listas para pegar en Muisca.')
    setTimeout(() => setCopyNotice(''), 3000)
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
              Cumplimiento Tributario Colombia · NIIF
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-600" />
            Centro Tributario DIAN
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Borradores Muisca de Formularios 300 y 350, Medios Magnéticos Exógena y Certificados Tributarios con partida doble acc_*.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Tabs Principales */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('muisca')}
          className={`px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'muisca'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Formularios Muisca (300 / 350)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('exogena')}
          className={`px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'exogena'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Información Exógena (Prevalidador)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('certificates')}
          className={`px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'certificates'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Certificados a Terceros</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mapping')}
          className={`px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'mapping'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Mapeo Cuentas PUC acc_*</span>
        </button>
      </div>

      {/* Contenido Pestaña 1: Formularios Muisca */}
      {activeTab === 'muisca' && (
        <div className="space-y-5">
          {/* Barra de Filtros del Formulario */}
          <div className="p-4 bg-white rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setFormType('300')
                    setSelectedPeriod(1)
                  }}
                  className={`px-3 py-1.5 rounded-lg transition-colors ${
                    formType === '300' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Formulario 300 (IVA)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormType('350')
                    setSelectedPeriod(new Date().getMonth() + 1)
                  }}
                  className={`px-3 py-1.5 rounded-lg transition-colors ${
                    formType === '350' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Formulario 350 (ReteFuente)
                </button>
              </div>

              {/* Selector de Período */}
              <div className="flex items-center gap-2">
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
                >
                  {[2024, 2025, 2026, 2027].map(y => (
                    <option key={y} value={y}>
                      Año {y}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedPeriod}
                  onChange={e => setSelectedPeriod(Number(e.target.value))}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
                >
                  {formType === '300' ? (
                    <>
                      <option value={1}>Bimestre 1 (Ene - Feb)</option>
                      <option value={2}>Bimestre 2 (Mar - Abr)</option>
                      <option value={3}>Bimestre 3 (May - Jun)</option>
                      <option value={4}>Bimestre 4 (Jul - Ago)</option>
                      <option value={5}>Bimestre 5 (Sep - Oct)</option>
                      <option value={6}>Bimestre 6 (Nov - Dic)</option>
                    </>
                  ) : (
                    <>
                      <option value={1}>Enero</option>
                      <option value={2}>Febrero</option>
                      <option value={3}>Marzo</option>
                      <option value={4}>Abril</option>
                      <option value={5}>Mayo</option>
                      <option value={6}>Junio</option>
                      <option value={7}>Julio</option>
                      <option value={8}>Agosto</option>
                      <option value={9}>Septiembre</option>
                      <option value={10}>Octubre</option>
                      <option value={11}>Noviembre</option>
                      <option value={12}>Diciembre</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyBoxes}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copiar Casillas para Muisca</span>
            </button>
          </div>

          {copyNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{copyNotice}</span>
            </div>
          )}

          {/* Plantilla Muisca Formulario 300 */}
          {formType === '300' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm tracking-wide">
                    FORMULARIO 300 · DECLARACIÓN DEL IMPUESTO SOBRE LAS VENTAS (IVA)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Período: {dateRange.label} {selectedYear}</p>
                </div>
                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/20 px-2.5 py-1 rounded-md border border-amber-400/30">
                  DIAN MUISCA
                </span>
              </div>

              <div className="p-6 space-y-6">
                {/* Sección Ingresos */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                    Sección Ingresos (Bases Gravables)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono">CASILLA 30</span>
                      <span className="text-xs font-medium text-slate-700">Gravados a tarifa general (19%)</span>
                      <p className="text-base font-bold text-slate-900 mt-1 tabular-nums">
                        {money(f300.casilla_30_ingresos_gravados_19)}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono">CASILLA 31</span>
                      <span className="text-xs font-medium text-slate-700">Gravados a tarifa del 5%</span>
                      <p className="text-base font-bold text-slate-900 mt-1 tabular-nums">
                        {money(f300.casilla_31_ingresos_gravados_5)}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono">CASILLA 28</span>
                      <span className="text-xs font-medium text-slate-700">Operaciones no gravadas / Excluidas</span>
                      <p className="text-base font-bold text-slate-900 mt-1 tabular-nums">
                        {money(f300.casilla_28_ingresos_excluidos)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mt-3">
                    <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold text-indigo-600 font-mono">CASILLA 41</span>
                        <p className="font-semibold text-slate-800">Total ingresos brutos</p>
                      </div>
                      <span className="text-base font-black text-indigo-900 tabular-nums">
                        {money(f300.casilla_41_total_ingresos_brutos)}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 font-mono">CASILLA 42</span>
                        <p className="font-semibold text-slate-800">Total ingresos netos</p>
                      </div>
                      <span className="text-base font-black text-slate-900 tabular-nums">
                        {money(f300.casilla_42_total_ingresos_netos)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sección Impuesto Generado y Descontable */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                    Liquidación del Impuesto (Generado vs Descontable)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono">CASILLA 59</span>
                      <span className="text-xs font-medium text-slate-700">A la tarifa general (19%)</span>
                      <p className="text-base font-bold text-slate-900 mt-1 tabular-nums">
                        {money(f300.casilla_59_iva_generado_19)}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono">CASILLA 65</span>
                      <span className="text-xs font-medium text-slate-700">Total IVA generado</span>
                      <p className="text-base font-bold text-emerald-700 mt-1 tabular-nums">
                        {money(f300.casilla_65_total_iva_generado)}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono">CASILLA 83</span>
                      <span className="text-xs font-medium text-slate-700">Total IVA descontable (compras)</span>
                      <p className="text-base font-bold text-indigo-700 mt-1 tabular-nums">
                        {money(f300.casilla_83_total_iva_descontable)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Resultado a Pagar / a Favor */}
                <div className="p-4 bg-slate-900 text-white rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-bold">
                      {f300.casilla_84_saldo_a_pagar > 0 ? 'CASILLA 84 · SALDO A PAGAR POR EL PERÍODO' : 'CASILLA 85 · SALDO A FAVOR DEL PERÍODO'}
                    </span>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {f300.casilla_84_saldo_a_pagar > 0
                        ? 'Valor neto a cancelar ante entidades bancarias autorizadas o portal Muisca.'
                        : 'Excedente de IVA descontable acreditable para el siguiente bimestre.'}
                    </p>
                  </div>
                  <span className={`text-2xl font-black tabular-nums ${f300.casilla_84_saldo_a_pagar > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {f300.casilla_84_saldo_a_pagar > 0 ? money(f300.casilla_84_saldo_a_pagar) : money(f300.casilla_85_saldo_a_favor)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Plantilla Muisca Formulario 350 */}
          {formType === '350' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm tracking-wide">
                    FORMULARIO 350 · DECLARACIÓN MENSUAL DE RETENCIÓN EN LA FUENTE
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Mes: {dateRange.label} {selectedYear}</p>
                </div>
                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/20 px-2.5 py-1 rounded-md border border-amber-400/30">
                  DIAN MUISCA
                </span>
              </div>

              <div className="p-6 space-y-4 text-xs">
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 bg-slate-50 p-2.5 font-bold text-slate-700">
                    <span className="col-span-6">Concepto de Retención</span>
                    <span className="col-span-3 text-right">Base Pago (Casilla)</span>
                    <span className="col-span-3 text-right">Retención (Casilla)</span>
                  </div>

                  <div className="grid grid-cols-12 p-3 items-center hover:bg-slate-50/60">
                    <span className="col-span-6 font-medium text-slate-800">Honorarios y consultoría (Casilla 46/47)</span>
                    <span className="col-span-3 text-right tabular-nums text-slate-600">{money(f350.casilla_46_honorarios_base)}</span>
                    <span className="col-span-3 text-right tabular-nums font-bold text-slate-900">{money(f350.casilla_47_honorarios_ret)}</span>
                  </div>

                  <div className="grid grid-cols-12 p-3 items-center hover:bg-slate-50/60">
                    <span className="col-span-6 font-medium text-slate-800">Servicios generales y técnicos (Casilla 50/51)</span>
                    <span className="col-span-3 text-right tabular-nums text-slate-600">{money(f350.casilla_50_servicios_base)}</span>
                    <span className="col-span-3 text-right tabular-nums font-bold text-slate-900">{money(f350.casilla_51_servicios_ret)}</span>
                  </div>

                  <div className="grid grid-cols-12 p-3 items-center hover:bg-slate-50/60">
                    <span className="col-span-6 font-medium text-slate-800">Arrendamientos muebles e inmuebles (Casilla 54/55)</span>
                    <span className="col-span-3 text-right tabular-nums text-slate-600">{money(f350.casilla_54_arrendamientos_base)}</span>
                    <span className="col-span-3 text-right tabular-nums font-bold text-slate-900">{money(f350.casilla_55_arrendamientos_ret)}</span>
                  </div>

                  <div className="grid grid-cols-12 p-3 items-center hover:bg-slate-50/60">
                    <span className="col-span-6 font-medium text-slate-800">Compras de mercancías e insumos (Casilla 56/57)</span>
                    <span className="col-span-3 text-right tabular-nums text-slate-600">{money(f350.casilla_56_compras_base)}</span>
                    <span className="col-span-3 text-right tabular-nums font-bold text-slate-900">{money(f350.casilla_57_compras_ret)}</span>
                  </div>

                  <div className="grid grid-cols-12 p-3 items-center hover:bg-slate-50/60">
                    <span className="col-span-6 font-medium text-slate-800">Retención en la fuente por IVA - ReteIVA (Casilla 74/75)</span>
                    <span className="col-span-3 text-right tabular-nums text-slate-600">{money(f350.casilla_74_reteiva_base)}</span>
                    <span className="col-span-3 text-right tabular-nums font-bold text-slate-900">{money(f350.casilla_75_reteiva_ret)}</span>
                  </div>

                  <div className="grid grid-cols-12 p-3 items-center hover:bg-slate-50/60">
                    <span className="col-span-6 font-medium text-slate-800">Autorretención Especial por Renta Dcto 2201 (Casilla 83/84)</span>
                    <span className="col-span-3 text-right tabular-nums text-slate-600">{money(f350.casilla_83_autorenta_base)}</span>
                    <span className="col-span-3 text-right tabular-nums font-bold text-slate-900">{money(f350.casilla_84_autorenta_ret)}</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-900 text-white rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-bold">
                      CASILLA 90 · TOTAL RETENCIONES A PAGAR
                    </span>
                    <p className="text-xs text-slate-300">Total exigible para presentar y pagar en Muisca.</p>
                  </div>
                  <span className="text-2xl font-black text-amber-400 tabular-nums">
                    {money(f350.casilla_90_total_retenciones)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contenido Pestaña 2: Información Exógena */}
      {activeTab === 'exogena' && (
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-slate-700">Formato DIAN:</label>
              <select
                value={exogenaForm}
                onChange={e => setExogenaForm(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
              >
                <option value="1001">Formato 1001 · Pagos a Terceros y Retenciones</option>
                <option value="1003">Formato 1003 · Retenciones que le practicaron</option>
                <option value="1005">Formato 1005 · IVA Descontable en Compras</option>
                <option value="1006">Formato 1006 · IVA Generado en Ventas</option>
                <option value="1007">Formato 1007 · Ingresos Propios Recibidos</option>
                <option value="1008">Formato 1008 · Cuentas por Cobrar al 31 Dic</option>
                <option value="1009">Formato 1009 · Cuentas por Pagar al 31 Dic</option>
              </select>

              <select
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
              >
                {[2024, 2025, 2026].map(y => (
                  <option key={y} value={y}>Año Gravable {y}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => exportExogenaToCsv(exogenaForm, selectedYear, exogenaRows)}
              disabled={exogenaRows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV Prevalidador DIAN ({exogenaRows.length} registros)</span>
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                  <tr>
                    <th className="p-3">Concepto</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3">NIT / C.C.</th>
                    <th className="p-3">Razón Social / Tercero</th>
                    <th className="p-3 text-right">Pago / Base</th>
                    <th className="p-3 text-right">Ret. Practicada</th>
                    <th className="p-3 text-right">Impuesto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {exogenaRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No hay registros acumulados para este formato en el año gravable {selectedYear}.
                      </td>
                    </tr>
                  ) : (
                    exogenaRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/70">
                        <td className="p-3 font-mono font-bold text-indigo-600">{r.concept}</td>
                        <td className="p-3 font-mono">{r.docType}</td>
                        <td className="p-3 font-mono font-semibold text-slate-800">{r.nit}</td>
                        <td className="p-3 font-medium text-slate-900">{r.name}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-800">{money(r.paymentAmount)}</td>
                        <td className="p-3 text-right font-mono text-emerald-700">{money(r.retentionPracticed)}</td>
                        <td className="p-3 text-right font-mono text-slate-600">{money(r.taxAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Contenido Pestaña 3: Certificados a Terceros */}
      {activeTab === 'certificates' && (
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <select
                value={certType}
                onChange={e => setCertType(e.target.value as any)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
              >
                <option value="retefuente">Certificado de Retención en la Fuente (Renta)</option>
                <option value="reteiva">Certificado de Retención de IVA (ReteIVA)</option>
                <option value="reteica">Certificado de Retención de ICA (ReteICA)</option>
              </select>

              <select
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
              >
                {[2025, 2026].map(y => (
                  <option key={y} value={y}>Año Gravable {y}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir Certificado Oficial</span>
            </button>
          </div>

          {/* Plantilla Imprimible de Certificado Oficial */}
          <div className="p-8 bg-white rounded-2xl border border-slate-200 shadow-sm max-w-3xl mx-auto space-y-6 text-slate-900">
            <div className="text-center border-b border-slate-200 pb-5">
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
                {companyConfig?.name || 'EMPRESA CONTABLE PRO S.A.S.'}
              </h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                NIT: {companyConfig?.rif || '901.234.567-8'} · Dirección: {companyConfig?.address || 'Colombia'}
              </p>
              <div className="mt-3 inline-block bg-slate-100 text-slate-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                CERTIFICADO DE RETENCIÓN EN LA FUENTE A TÍTULO DE {certType.toUpperCase()}
              </div>
              <p className="text-xs text-slate-500 mt-1">AÑO GRAVABLE {selectedYear}</p>
            </div>

            <div className="text-xs space-y-2">
              <p>
                <strong>CIUDAD DONDE SE PRACTICÓ LA RETENCIÓN:</strong> BOGOTÁ D.C.
              </p>
              <p>
                <strong>RETENCIÓN PRACTICADA A:</strong> PROVEEDOR GENERAL S.A.S.
              </p>
              <p>
                <strong>NIT / C.C.:</strong> 900.876.543-1
              </p>
            </div>

            <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 border-b border-slate-200 font-bold">
                <tr>
                  <th className="p-2.5 text-left">Concepto del Pago o Abono</th>
                  <th className="p-2.5 text-right">Monto del Pago (Base)</th>
                  <th className="p-2.5 text-right">% Tarifa</th>
                  <th className="p-2.5 text-right">Monto Retenido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="p-2.5">Compras generales y suministros</td>
                  <td className="p-2.5 text-right font-mono">{money(15000000)}</td>
                  <td className="p-2.5 text-right font-mono">2.5%</td>
                  <td className="p-2.5 text-right font-mono font-bold text-slate-900">{money(375000)}</td>
                </tr>
                <tr className="bg-slate-50 font-bold">
                  <td className="p-2.5">TOTAL RETENIDO</td>
                  <td className="p-2.5 text-right font-mono">{money(15000000)}</td>
                  <td className="p-2.5 text-right font-mono">—</td>
                  <td className="p-2.5 text-right font-mono text-indigo-700">{money(375000)}</td>
                </tr>
              </tbody>
            </table>

            <p className="text-[11px] text-slate-500 italic text-justify leading-relaxed">
              Certificamos que durante el año gravable {selectedYear} practicamos las retenciones en la fuente aquí descritas, las cuales fueron consignadas oportunamente a la Dirección de Impuestos y Aduanas Nacionales (DIAN) de Colombia en los lugares y plazos reglamentarios. Este certificado no requiere firma autógrafa según el Artículo 10 del Decreto 836 de 1991.
            </p>

            <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
              <div className="border-t border-slate-300 pt-2">
                <p className="font-bold">Representante Legal</p>
                <p className="text-[11px] text-slate-500">C.C. 19.876.543</p>
              </div>
              <div className="border-t border-slate-300 pt-2">
                <p className="font-bold">Contador Público</p>
                <p className="text-[11px] text-slate-500">T.P. 123456-T</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contenido Pestaña 4: Mapeo Cuentas PUC */}
      {activeTab === 'mapping' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs text-xs">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600" />
              Mapeo de Cuentas PUC acc_* a Formatos Exógena y Declaraciones
            </h3>
            <p className="text-slate-500 mt-1">
              El motor tributario de Contable Pro enlaza automáticamente los movimientos del libro diario acc_lines a los conceptos exigidos por la DIAN.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="font-bold text-slate-900 text-sm">Cuentas de IVA (2408)</span>
              <p className="text-slate-600 leading-relaxed">
                • <strong>240801 (IVA Generado):</strong> Alimenta automáticamente la Casilla 59 del Formulario 300 y el Formato 1006.<br />
                • <strong>240802 (IVA Descontable):</strong> Alimenta la Casilla 74 del Formulario 300 y el Formato 1005.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="font-bold text-slate-900 text-sm">Cuentas de Retención en la Fuente (2365)</span>
              <p className="text-slate-600 leading-relaxed">
                • <strong>236540 (Compras 2.5%):</strong> Casillas 56 y 57 de Formulario 350 + Concepto 5007 del Formato 1001.<br />
                • <strong>236525 (Servicios 4%):</strong> Casillas 50 y 51 de Formulario 350 + Concepto 5004 del Formato 1001.<br />
                • <strong>236515 (Honorarios 11%):</strong> Casillas 46 y 47 de Formulario 350 + Concepto 5002 del Formato 1001.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="font-bold text-slate-900 text-sm">Cuentas de Ingresos Operacionales (41)</span>
              <p className="text-slate-600 leading-relaxed">
                • <strong>4135 (Comercio al por mayor y menor):</strong> Alimenta la Casilla 30 (Ingresos gravados 19%) y el Formato 1007 de ingresos propios.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="font-bold text-slate-900 text-sm">Cuentas por Cobrar y por Pagar (13 / 22)</span>
              <p className="text-slate-600 leading-relaxed">
                • <strong>1305 (Clientes Nacionales):</strong> Formato 1008 (Saldos de cuentas por cobrar al 31 de diciembre).<br />
                • <strong>2205 (Proveedores Nacionales):</strong> Formato 1009 (Saldos de pasivos al 31 de diciembre).
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
