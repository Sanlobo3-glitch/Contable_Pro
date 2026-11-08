import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { useCurrency, fmtDate, formatMoney } from '../lib/currency'
import { esc, printHtml } from '../lib/documents'
import type { CompanyConfig, Product, RouteDispatch, TeamPayrollMember } from '../types'
import { UserAvatar } from '../components/AvatarCapture'
import { ProductThumb } from '../components/ProductImageCapture'
import {
  Truck,
  Plus,
  RefreshCw,
  Search,
  Printer,
  MessageCircle,
  CheckCircle2,
  X,
  Ban,
  ArrowUpRight,
  Package,
  Wallet,
  Trash2,
} from 'lucide-react'

const todayIso = () => new Date().toLocaleDateString('sv-SE')
const daysAgoIso = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toLocaleDateString('sv-SE')
}

type StatusFilter = 'all' | 'abierto' | 'liquidado'

interface DraftLoadLine {
  product_id: string
  product_name: string
  sku: string
  unit: string
  stock: number
  price: number
  image_url?: string | null
  qty_loaded: string
}

function buildDispatchHtml(d: RouteDispatch, cfg: CompanyConfig | null): string {
  const money = (n: number) => esc(formatMoney(n, cfg?.currency))
  const isClosed = d.status === 'liquidado'
  const docTitle = isClosed ? 'ACTA DE LIQUIDACIÓN DE RUTA' : 'HOJA DE CARGA Y DESPACHO DE RUTA'
  const code = 'DSP-' + d.id.slice(0, 8).toUpperCase()

  const rows = d.items
    .map(it => {
      const retText = it.qty_returned != null ? String(it.qty_returned) : String(it.qty_expected_return)
      const diffVal = it.qty_diff != null ? it.qty_diff : 0
      const diffStr = isClosed ? (diffVal > 0 ? `+${diffVal}` : String(diffVal)) : '—'
      return `<tr>
        <td><strong>${esc(it.product_name)}</strong>${it.sku ? `<div class="muted">SKU: ${esc(it.sku)}</div>` : ''}</td>
        <td class="r">${esc(it.qty_loaded)} ${esc(it.unit)}</td>
        <td class="r">${esc(it.qty_sold)}</td>
        <td class="r">${esc(it.qty_expected_return)}</td>
        <td class="r">${isClosed ? esc(retText) : '______'}</td>
        <td class="r">${esc(diffStr)}</td>
      </tr>`
    })
    .join('')

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(code)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;padding:24px;font-size:12px}
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px}
h1{margin:0 0 4px;font-size:18px}
h2{margin:0;font-size:14px;letter-spacing:.5px}
.muted{color:#64748b;font-size:11px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.box{border:1px solid #cbd5e1;border-radius:8px;padding:10px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{background:#f1f5f9;text-align:left;padding:7px;font-size:10px;text-transform:uppercase;border-bottom:1px solid #cbd5e1}
td{padding:7px;border-bottom:1px solid #e2e8f0;vertical-align:top}
.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.sum{margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.row{display:flex;justify-content:space-between;padding:3px 0;font-variant-numeric:tabular-nums}
.tot{border-top:1px solid #0f172a;margin-top:6px;padding-top:6px;font-weight:bold;font-size:13px}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:44px;text-align:center}
.sig{border-top:1px solid #475569;padding-top:6px;font-size:11px;color:#334155}
@media print{body{padding:0}}
</style></head><body>
<div class="head">
  <div>
    <h1>${esc(cfg?.name || 'Mi Empresa')}</h1>
    <div class="muted">${esc([cfg?.rif && `ID fiscal: ${cfg.rif}`, cfg?.phone && `Tel: ${cfg.phone}`, cfg?.address].filter(Boolean).join(' · '))}</div>
  </div>
  <div style="text-align:right">
    <h2>${esc(docTitle)}</h2>
    <div><strong>${esc(code)}</strong> · Fecha: ${esc(d.dispatch_date)}</div>
    <div class="muted">Estado: ${esc(d.status.toUpperCase())}</div>
  </div>
</div>

<div class="grid">
  <div class="box">
    <div><strong>Vendedor responsable:</strong> ${esc(d.seller_name)}</div>
    <div class="muted">Vehículo / Ruta: ${esc([d.vehicle_label, d.zone].filter(Boolean).join(' · ') || 'Ruta comercial')}</div>
    ${d.notes ? `<div class="muted" style="margin-top:4px">Notas: ${esc(d.notes)}</div>` : ''}
  </div>
  <div class="box">
    <div class="row"><span>Fondo inicial entregado:</span><strong>${money(d.opening_cash)}</strong></div>
    <div class="row"><span>Ventas efectivo del día:</span><span>${money(d.sales_cash)}</span></div>
    <div class="row"><span>Cobros cartera efectivo:</span><span>${money(d.collections_cash)}</span></div>
    <div class="row tot"><span>Efectivo esperado en caja:</span><span>${money(d.expected_cash)}</span></div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Producto</th>
      <th class="r">Cargado</th>
      <th class="r">Vendido</th>
      <th class="r">Esperado dev.</th>
      <th class="r">Devuelto real</th>
      <th class="r">Dif.</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="sum">
  <div class="box">
    <div><strong>Otros medios del día (informativo)</strong></div>
    <div class="row"><span>Ventas transferencia / tarjeta:</span><span>${money(d.sales_bank)}</span></div>
    <div class="row"><span>Cobros cartera banco:</span><span>${money(d.collections_bank)}</span></div>
    <div class="row"><span>Ventas a crédito (fiado):</span><span>${money(d.sales_credit)}</span></div>
  </div>
  <div class="box">
    <div><strong>Resultado de caja de la ruta</strong></div>
    <div class="row"><span>Efectivo esperado:</span><span>${money(d.expected_cash)}</span></div>
    <div class="row"><span>Efectivo entregado:</span><span>${d.delivered_cash != null ? money(d.delivered_cash) : 'Pendiente'}</span></div>
    <div class="row tot"><span>Diferencia de efectivo:</span><span>${d.cash_diff != null ? money(d.cash_diff) : '—'}</span></div>
  </div>
</div>

<div class="sigs">
  <div class="sig">Entregado / Recibido en Bodega y Caja<br>${esc(d.closed_by_name || d.created_by_name || '')}</div>
  <div class="sig">Firma del Vendedor Responsable<br>${esc(d.seller_name)}</div>
</div>
</body></html>`
}

function buildDispatchShareText(d: RouteDispatch, cfg: CompanyConfig | null): string {
  const m = (n: number) => formatMoney(n, cfg?.currency)
  const code = 'DSP-' + d.id.slice(0, 8).toUpperCase()
  const lines = [
    `*${d.status === 'liquidado' ? 'LIQUIDACIÓN DE RUTA' : 'HOJA DE CARGA'} ${code}*`,
    `${cfg?.name || 'InventarioPro'} · Fecha: ${d.dispatch_date}`,
    `Vendedor: ${d.seller_name}${d.vehicle_label ? ` (${d.vehicle_label})` : ''}`,
    '',
    '*Mercancía:*',
    ...d.items.map(
      i =>
        `• ${i.product_name}: cargó ${i.qty_loaded}, vendió ${i.qty_sold}, retorna ${
          i.qty_returned != null ? i.qty_returned : i.qty_expected_return
        }`
    ),
    '',
    `Fondo inicial: ${m(d.opening_cash)}`,
    `Ventas efectivo: ${m(d.sales_cash)}`,
    `Cobros efectivo: ${m(d.collections_cash)}`,
    `*Efectivo a entregar: ${m(d.expected_cash)}*`,
  ]
  if (d.delivered_cash != null) {
    lines.push(`Efectivo recibido: ${m(d.delivered_cash)} (Dif: ${m(d.cash_diff || 0)})`)
  }
  return lines.join('\n')
}

export default function RouteDispatchPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const readOnly = isReadOnly(user)
  const isManager = user?.role === 'dueno' || user?.role === 'admin'

  const [dispatches, setDispatches] = useState<RouteDispatch[]>([])
  const [sellers, setSellers] = useState<TeamPayrollMember[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)

  const [fromDate, setFromDate] = useState(() => daysAgoIso(14))
  const [toDate, setToDate] = useState(() => todayIso())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [missingSql, setMissingSql] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Modal nueva hoja de carga
  const [showCreate, setShowCreate] = useState(false)
  const [sellerId, setSellerId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(() => todayIso())
  const [vehicleLabel, setVehicleLabel] = useState('')
  const [openingCash, setOpeningCash] = useState('0')
  const [notes, setNotes] = useState('')
  const [prodQuery, setProdQuery] = useState('')
  const [draftLines, setDraftLines] = useState<DraftLoadLine[]>([])
  const [creating, setCreating] = useState(false)

  // Modal liquidar / ver detalle
  const [activeDispatch, setActiveDispatch] = useState<RouteDispatch | null>(null)
  const [returnInputs, setReturnInputs] = useState<Record<string, string>>({})
  const [deliveredCash, setDeliveredCash] = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [closing, setClosing] = useState(false)

  // Modal confirmar anulación
  const [voidTarget, setVoidTarget] = useState<RouteDispatch | null>(null)
  const [voiding, setVoiding] = useState(false)

  const load = useCallback(async () => {
    setSyncing(true)
    try {
      const [dispRes, cfgRes, prodRes, teamRes] = await Promise.all([
        supabase.rpc('listar_despachos_ruta', { p_from: fromDate, p_to: toDate }),
        supabase.from('company_config').select('*').limit(1).maybeSingle(),
        isManager ? supabase.from('products').select('*').order('name') : Promise.resolve({ data: [], error: null }),
        isManager ? supabase.rpc('listar_nomina_equipo') : Promise.resolve({ data: [], error: null }),
      ])

      if (cfgRes.data) setConfig(cfgRes.data as CompanyConfig)
      if (prodRes.data) setProducts(prodRes.data as Product[])

      if (isManager) {
        if (!teamRes.error && Array.isArray(teamRes.data)) {
          const list = (teamRes.data as TeamPayrollMember[]).filter(m => m.active)
          setSellers(list)
          setSellerId(prev => prev || list.find(s => s.role === 'vendedor')?.id || list[0]?.id || '')
        } else {
          const fb = await supabase.rpc('list_team')
          if (Array.isArray(fb.data)) {
            const list = (fb.data as any[]).filter(m => m.active).map(m => ({
              id: String(m.id),
              email: String(m.email || ''),
              full_name: m.full_name || null,
              role: m.role || 'vendedor',
              active: true,
              base_salary: 0,
              commission_pct: 0,
            })) as TeamPayrollMember[]
            setSellers(list)
            setSellerId(prev => prev || list.find(s => s.role === 'vendedor')?.id || list[0]?.id || '')
          }
        }
      }

      if (dispRes.error) {
        if (/listar_despachos_ruta|route_dispatches|does not exist|schema cache/i.test(dispRes.error.message || '')) {
          setMissingSql(true)
          setDispatches([])
        } else {
          setFeedback({ ok: false, text: dispRes.error.message })
        }
      } else {
        setMissingSql(false)
        const list = Array.isArray(dispRes.data) ? (dispRes.data as RouteDispatch[]) : []
        setDispatches(list)
      }
    } finally {
      setSyncing(false)
      setLoading(false)
    }
  }, [fromDate, toDate, isManager])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return dispatches.filter(d => {
      if (d.status === 'anulado') return false
      if (statusFilter !== 'all' && d.status !== statusFilter) return false
      if (!q) return true
      return (
        d.seller_name.toLowerCase().includes(q) ||
        (d.vehicle_label || '').toLowerCase().includes(q) ||
        (d.zone || '').toLowerCase().includes(q) ||
        ('dsp-' + d.id.slice(0, 8)).includes(q)
      )
    })
  }, [dispatches, statusFilter, search])

  const kpis = useMemo(() => {
    let openCount = 0
    let unitsOnTrucks = 0
    let expectedCashOpen = 0
    let totalCashDiff = 0
    for (const d of dispatches) {
      if (d.status === 'abierto') {
        openCount++
        expectedCashOpen += Number(d.expected_cash) || 0
        for (const it of d.items || []) {
          unitsOnTrucks += Number(it.qty_expected_return) || 0
        }
      } else if (d.status === 'liquidado') {
        totalCashDiff += Number(d.cash_diff) || 0
      }
    }
    return { openCount, unitsOnTrucks, expectedCashOpen, totalCashDiff }
  }, [dispatches])

  const productMatches = useMemo(() => {
    const q = prodQuery.trim().toLowerCase()
    const available = products.filter(p => Number(p.stock) > 0)
    if (!q) return available.slice(0, 12)
    return available
      .filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .slice(0, 16)
  }, [products, prodQuery])

  function addDraftProduct(p: Product) {
    setDraftLines(prev => {
      const idx = prev.findIndex(x => x.product_id === p.id)
      if (idx >= 0) {
        const cur = Number(prev[idx].qty_loaded) || 0
        const nextQty = Math.min(Number(p.stock), cur + 1)
        return prev.map((x, i) => (i === idx ? { ...x, qty_loaded: String(nextQty) } : x))
      }
      return [
        ...prev,
        {
          product_id: p.id,
          product_name: p.name,
          sku: p.sku,
          unit: p.unit || 'unidad',
          stock: Number(p.stock) || 0,
          price: Number(p.price) || 0,
          image_url: p.image_url,
          qty_loaded: '1',
        },
      ]
    })
  }

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault()
    if (!isManager || readOnly || creating) return
    if (!sellerId) {
      setFeedback({ ok: false, text: 'Selecciona el vendedor responsable de la ruta.' })
      return
    }
    const validItems = draftLines
      .map(l => ({ product_id: l.product_id, qty_loaded: Number(l.qty_loaded) || 0 }))
      .filter(l => l.qty_loaded > 0)

    if (validItems.length === 0) {
      setFeedback({ ok: false, text: 'Agrega al menos un producto con cantidad mayor a cero.' })
      return
    }

    setCreating(true)
    setFeedback(null)
    const { error } = await supabase.rpc('crear_despacho_ruta', {
      p_seller_id: sellerId,
      p_date: dispatchDate,
      p_vehicle_label: vehicleLabel.trim() || null,
      p_opening_cash: Math.max(0, Number(openingCash) || 0),
      p_notes: notes.trim() || null,
      p_items: validItems,
    })
    setCreating(false)

    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }

    setShowCreate(false)
    setDraftLines([])
    setVehicleLabel('')
    setOpeningCash('0')
    setNotes('')
    setFeedback({ ok: true, text: 'Hoja de carga creada. El vendedor ya puede consultarla en su teléfono.' })
    await load()
  }

  function openLiquidationModal(d: RouteDispatch) {
    setActiveDispatch(d)
    const initReturns: Record<string, string> = {}
    for (const it of d.items || []) {
      initReturns[it.id] = String(it.qty_returned != null ? it.qty_returned : it.qty_expected_return)
    }
    setReturnInputs(initReturns)
    setDeliveredCash(String(d.delivered_cash != null ? d.delivered_cash : d.expected_cash))
    setCloseNotes(d.notes || '')
  }

  async function handleLiquidate(e: React.FormEvent) {
    e.preventDefault()
    if (!activeDispatch || !isManager || readOnly || closing) return
    setClosing(true)
    setFeedback(null)

    const returnsPayload = (activeDispatch.items || []).map(it => ({
      item_id: it.id,
      qty_returned: Math.max(0, Number(returnInputs[it.id]) || 0),
    }))

    const { error } = await supabase.rpc('liquidar_despacho_ruta', {
      p_dispatch_id: activeDispatch.id,
      p_delivered_cash: Math.max(0, Number(deliveredCash) || 0),
      p_returns: returnsPayload,
      p_notes: closeNotes.trim() || null,
    })
    setClosing(false)

    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }

    setActiveDispatch(null)
    setFeedback({ ok: true, text: 'Ruta liquidada y cerrada correctamente.' })
    await load()
  }

  async function handleVoidDispatch() {
    if (!voidTarget || voiding) return
    setVoiding(true)
    const { error } = await supabase.rpc('anular_despacho_ruta', { p_dispatch_id: voidTarget.id })
    setVoiding(false)
    setVoidTarget(null)
    if (error) {
      setFeedback({ ok: false, text: error.message })
      return
    }
    setFeedback({ ok: true, text: 'Hoja de despacho anulada.' })
    await load()
  }

  const draftTotalValue = useMemo(
    () => draftLines.reduce((acc, l) => acc + (Number(l.qty_loaded) || 0) * l.price, 0),
    [draftLines]
  )

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {isManager ? 'Despacho y liquidación de ruta' : 'Mi carga de ruta y cierre diario'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {isManager
              ? 'Control de mercancía en vehículo por vendedor, devolución física en la tarde y cuadre exacto de efectivo.'
              : 'Consulta los productos cargados hoy en tu ruta, unidades restantes y el efectivo a entregar en caja.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isManager && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('routeplan')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              Ver mis paradas de hoy
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void load()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>

          {isManager && !readOnly && (
            <button
              type="button"
              onClick={() => {
                setFeedback(null)
                setShowCreate(true)
              }}
              disabled={missingSql}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva hoja de carga
            </button>
          )}
        </div>
      </div>

      {missingSql && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          Para activar hojas de carga y liquidación diaria de rutas, ejecuta en el Editor SQL de Supabase la migración{' '}
          <code className="font-mono">20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql</code>.
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="p-1 rounded hover:bg-black/5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 KPIs dinámicos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'abierto' ? 'all' : 'abierto')}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            statusFilter === 'abierto' ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Truck className="w-4 h-4 text-blue-600" />
              Rutas en calle
            </span>
            <span className="text-[11px] text-slate-400">Abiertas</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{kpis.openCount}</p>
          <p className="text-xs text-slate-500 mt-1.5">Pendientes de cierre y conteo físico</p>
        </button>

        <div className="rounded-xl border border-slate-200 p-4 bg-white">
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Package className="w-4 h-4 text-slate-700" />
              Mercancía en vehículos
            </span>
            <span className="text-[11px] text-slate-400">En tránsito</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{kpis.unitsOnTrucks}</p>
          <p className="text-xs text-slate-500 mt-1.5">Unidades cargadas aún no vendidas</p>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 bg-white">
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Wallet className="w-4 h-4 text-emerald-600" />
              Efectivo esperado hoy
            </span>
            <span className="text-[11px] text-slate-400">Rutas abiertas</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{money(kpis.expectedCashOpen)}</p>
          <p className="text-xs text-slate-500 mt-1.5">Fondo + ventas efectivo + abonos efectivo</p>
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'liquidado' ? 'all' : 'liquidado')}
          className={`text-left rounded-xl border p-4 bg-white transition-colors ${
            statusFilter === 'liquidado'
              ? 'border-slate-900 ring-1 ring-slate-900'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Diferencia acumulada
            </span>
            <span className="text-[11px] text-slate-400">Rutas liquidadas</span>
          </div>
          <p
            className={`text-2xl font-bold tabular-nums ${
              kpis.totalCashDiff < -0.01
                ? 'text-red-600'
                : kpis.totalCashDiff > 0.01
                  ? 'text-emerald-700'
                  : 'text-slate-900'
            }`}
          >
            {money(kpis.totalCashDiff)}
          </p>
          <p className="text-xs text-slate-500 mt-1.5">Balance entre esperado y entregado</p>
        </button>
      </div>

      {/* Filtros y tabla */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 tabular-nums"
            />
            <span className="text-xs text-slate-400">a</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 tabular-nums"
            />

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['all', 'Todas'],
                  ['abierto', 'Abiertas'],
                  ['liquidado', 'Liquidadas'],
                ] as [StatusFilter, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatusFilter(k)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar vendedor, placa o código..."
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 w-full sm:w-64"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">Cargando hojas de despacho...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">No hay despachos de ruta en este rango</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isManager
                ? 'Crea una «Nueva hoja de carga» en la mañana para registrar los productos que lleva el vendedor y cuadrar su efectivo al regresar.'
                : 'Tu encargado aún no te ha asignado una hoja de carga de mercancía para estas fechas.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(d => {
              const sellerObj = sellers.find(s => s.id === d.seller_id)
              const totalLoaded = (d.items || []).reduce((a, i) => a + Number(i.qty_loaded || 0), 0)
              const totalSold = (d.items || []).reduce((a, i) => a + Number(i.qty_sold || 0), 0)
              const code = 'DSP-' + d.id.slice(0, 8).toUpperCase()
              const isOpen = d.status === 'abierto'

              return (
                <div key={d.id} className="p-4 sm:px-5 hover:bg-slate-50/60 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <UserAvatar src={sellerObj?.avatar_url} name={d.seller_name} size="md" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <p className="font-semibold text-slate-900">{d.seller_name}</p>
                          <span className="text-xs font-mono text-slate-500">{code}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className={`text-xs font-medium ${isOpen ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {isOpen ? 'En ruta (abierta)' : 'Liquidada'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Fecha {fmtDate(d.dispatch_date + 'T00:00:00')}
                          {d.vehicle_label ? ` · ${d.vehicle_label}` : ''}
                          {d.zone ? ` · ${d.zone}` : ''}
                          {' · '}
                          <span className="tabular-nums">
                            Cargó {totalLoaded} und. / Vendió {totalSold} und.
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between lg:justify-end gap-4">
                      <div className="text-right tabular-nums">
                        <p className="text-xs text-slate-500">Efectivo esperado</p>
                        <p className="text-sm font-bold text-slate-900">{money(d.expected_cash)}</p>
                        {!isOpen && d.delivered_cash != null && (
                          <p
                            className={`text-[11px] font-medium ${
                              (d.cash_diff || 0) < -0.01
                                ? 'text-red-600'
                                : (d.cash_diff || 0) > 0.01
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                            }`}
                          >
                            Entregó {money(d.delivered_cash)}
                            {Math.abs(d.cash_diff || 0) > 0.009 ? ` (${(d.cash_diff || 0) > 0 ? '+' : ''}${money(d.cash_diff || 0)})` : ' · Cuadre exacto'}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openLiquidationModal(d)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                            isOpen && isManager && !readOnly
                              ? 'bg-slate-900 text-white hover:bg-slate-800'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {isOpen && isManager && !readOnly ? 'Liquidar ruta' : 'Ver detalle'}
                        </button>

                        <button
                          type="button"
                          onClick={() => printHtml(buildDispatchHtml(d, config))}
                          title="Imprimir hoja"
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>

                        <a
                          href={'https://wa.me/?text=' + encodeURIComponent(buildDispatchShareText(d, config))}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Compartir por WhatsApp"
                          className="p-1.5 rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>

                        {isOpen && isManager && !readOnly && (
                          <button
                            type="button"
                            onClick={() => setVoidTarget(d)}
                            title="Anular hoja de carga"
                            className="p-1.5 rounded-lg border border-slate-200 text-red-600 hover:bg-red-50"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Modal: Nueva Hoja de Carga */}
      {showCreate && isManager && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-3xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Nueva hoja de carga de ruta</h2>
                <p className="text-xs text-slate-500">Registra la mercancía y el sencillo entregados al vendedor al iniciar el día.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDispatch} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vendedor responsable</label>
                  <select
                    required
                    value={sellerId}
                    onChange={e => setSellerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  >
                    <option value="">Seleccionar vendedor...</option>
                    {sellers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.full_name || s.email} ({s.role === 'vendedor' ? 'Vendedor' : 'Equipo'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de ruta</label>
                  <input
                    type="date"
                    required
                    value={dispatchDate}
                    onChange={e => setDispatchDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fondo inicial (cambio)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={openingCash}
                    onChange={e => setOpeningCash(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vehículo / Placa / Ruta</label>
                  <input
                    value={vehicleLabel}
                    onChange={e => setVehicleLabel(e.target.value)}
                    placeholder="Ej. Camioneta NPR · Placa ABC-123"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Observaciones</label>
                  <input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Opcional: termos, canastillas, precinto..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <label className="block text-xs font-semibold text-slate-800">Agregar mercancía al vehículo</label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={prodQuery}
                    onChange={e => setProdQuery(e.target.value)}
                    placeholder="Buscar producto por nombre o SKU..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50/50">
                  {productMatches.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addDraftProduct(p)}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-slate-200/80 hover:border-slate-400 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ProductThumb src={p.image_url} name={p.name} size="xs" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">{p.name}</p>
                          <p className="text-[11px] text-slate-500 tabular-nums">
                            Disp: {p.stock} {p.unit} · {money(p.price)}
                          </p>
                        </div>
                      </div>
                      <Plus className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                    </button>
                  ))}
                  {productMatches.length === 0 && (
                    <p className="text-xs text-slate-400 col-span-2 py-3 text-center">No hay productos con stock que coincidan.</p>
                  )}
                </div>
              </div>

              {draftLines.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="text-left py-2 px-3 font-medium">Producto</th>
                        <th className="text-right py-2 px-3 font-medium">En bodega</th>
                        <th className="text-right py-2 px-3 font-medium">Cantidad cargada</th>
                        <th className="text-right py-2 px-3 font-medium">Valor comercial</th>
                        <th className="py-2 px-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftLines.map((l, idx) => (
                        <tr key={l.product_id}>
                          <td className="py-2 px-3 font-medium text-slate-800">{l.product_name}</td>
                          <td className="py-2 px-3 text-right text-slate-500 tabular-nums">
                            {l.stock} {l.unit}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min="0.001"
                              max={l.stock}
                              step="any"
                              value={l.qty_loaded}
                              onChange={e =>
                                setDraftLines(prev =>
                                  prev.map((x, i) => (i === idx ? { ...x, qty_loaded: e.target.value } : x))
                                )
                              }
                              className="w-24 px-2 py-1 text-right rounded border border-slate-300 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-medium text-slate-800 tabular-nums">
                            {money((Number(l.qty_loaded) || 0) * l.price)}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <button
                              type="button"
                              onClick={() => setDraftLines(prev => prev.filter((_, i) => i !== idx))}
                              className="p-1 text-red-500 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bg-slate-50 px-3 py-2 border-t border-slate-200 flex items-center justify-between text-xs">
                    <span className="text-slate-600">{draftLines.length} referencia(s) en vehículo</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      Valor mercancía despachada: {money(draftTotalValue)}
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || draftLines.length === 0}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  {creating ? 'Guardando hoja...' : 'Emitir hoja de carga'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Detalle en vivo y Liquidación de Ruta */}
      {activeDispatch && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !closing && setActiveDispatch(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-3xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {activeDispatch.status === 'abierto' && isManager
                    ? 'Liquidación y cierre de ruta'
                    : 'Detalle de despacho de ruta'}
                </h2>
                <p className="text-xs text-slate-500">
                  {activeDispatch.seller_name} · {activeDispatch.dispatch_date}
                  {activeDispatch.vehicle_label ? ` · ${activeDispatch.vehicle_label}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveDispatch(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLiquidate} className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
              {/* Resumen monetario en vivo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <p className="text-[11px] text-slate-500">Fondo inicial</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                    {money(activeDispatch.opening_cash)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <p className="text-[11px] text-slate-500">Ventas + cobros efectivo</p>
                  <p className="text-sm font-bold text-emerald-700 tabular-nums mt-0.5">
                    {money(activeDispatch.sales_cash + activeDispatch.collections_cash)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <p className="text-[11px] text-slate-500">Bancos / Transferencias</p>
                  <p className="text-sm font-bold text-slate-800 tabular-nums mt-0.5">
                    {money(activeDispatch.sales_bank + activeDispatch.collections_bank)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <p className="text-[11px] text-slate-500">Ventas a crédito (fiado)</p>
                  <p className="text-sm font-bold text-amber-700 tabular-nums mt-0.5">
                    {money(activeDispatch.sales_credit)}
                  </p>
                </div>
              </div>

              {/* Tabla de cuadre físico */}
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2.5 px-3 font-medium">Producto</th>
                      <th className="text-right py-2.5 px-3 font-medium">Cargado</th>
                      <th className="text-right py-2.5 px-3 font-medium">Vendido</th>
                      <th className="text-right py-2.5 px-3 font-medium">Debe volver</th>
                      <th className="text-right py-2.5 px-3 font-medium">Devuelto físico</th>
                      <th className="text-right py-2.5 px-3 font-medium">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(activeDispatch.items || []).map(it => {
                      const canEditClose = activeDispatch.status === 'abierto' && isManager && !readOnly
                      const currentRet = canEditClose
                        ? Number(returnInputs[it.id] ?? it.qty_expected_return) || 0
                        : Number(it.qty_returned ?? it.qty_expected_return) || 0
                      const diff = Math.round((currentRet - it.qty_expected_return) * 1000) / 1000

                      return (
                        <tr key={it.id}>
                          <td className="py-2.5 px-3 font-medium text-slate-800">
                            {it.product_name}
                            {it.sku && <span className="block text-[11px] text-slate-400 font-mono">{it.sku}</span>}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                            {it.qty_loaded} {it.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700 font-medium">
                            {it.qty_sold}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900">
                            {it.qty_expected_return}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {canEditClose ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={returnInputs[it.id] ?? String(it.qty_expected_return)}
                                onChange={e => setReturnInputs(prev => ({ ...prev, [it.id]: e.target.value }))}
                                className="w-20 px-2 py-1 text-right rounded border border-slate-300 tabular-nums"
                              />
                            ) : (
                              <span>{it.qty_returned != null ? it.qty_returned : '—'}</span>
                            )}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right tabular-nums font-medium ${
                              diff < 0 ? 'text-red-600' : diff > 0 ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            {diff === 0 ? 'Exacto' : diff > 0 ? `+${diff}` : String(diff)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cuadre de efectivo */}
              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/70 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">Efectivo total esperado en Caja</p>
                    <p className="text-[11px] text-slate-500">
                      Fondo inicial ({money(activeDispatch.opening_cash)}) + Ventas efectivo ({money(activeDispatch.sales_cash)}) + Cobros efectivo ({money(activeDispatch.collections_cash)})
                    </p>
                  </div>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">{money(activeDispatch.expected_cash)}</p>
                </div>

                {activeDispatch.status === 'abierto' && isManager && !readOnly ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Efectivo físico entregado por el vendedor
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={deliveredCash}
                        onChange={e => setDeliveredCash(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold tabular-nums"
                      />
                      {(() => {
                        const diffCash = (Number(deliveredCash) || 0) - activeDispatch.expected_cash
                        return (
                          <p
                            className={`text-xs mt-1 font-medium tabular-nums ${
                              diffCash < -0.01
                                ? 'text-red-600'
                                : diffCash > 0.01
                                  ? 'text-emerald-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {Math.abs(diffCash) <= 0.01
                              ? 'Cuadre de efectivo exacto'
                              : diffCash < 0
                                ? `Faltante de efectivo: ${money(Math.abs(diffCash))}`
                                : `Sobrante de efectivo: +${money(diffCash)}`}
                          </p>
                        )
                      })()}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Observaciones del cierre</label>
                      <input
                        value={closeNotes}
                        onChange={e => setCloseNotes(e.target.value)}
                        placeholder="Ej. Todo conforme, firma de recibido..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  activeDispatch.delivered_cash != null && (
                    <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                      <span className="text-slate-600">
                        Efectivo recibido: <strong className="tabular-nums">{money(activeDispatch.delivered_cash)}</strong>
                      </span>
                      <span className="font-semibold tabular-nums">
                        Diferencia: {money(activeDispatch.cash_diff || 0)}
                      </span>
                    </div>
                  )
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => printHtml(buildDispatchHtml(activeDispatch, config))}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Imprimir soporte
                  </button>
                  <a
                    href={'https://wa.me/?text=' + encodeURIComponent(buildDispatchShareText(activeDispatch, config))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    WhatsApp
                  </a>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveDispatch(null)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cerrar ventana
                  </button>
                  {activeDispatch.status === 'abierto' && isManager && !readOnly && (
                    <button
                      type="submit"
                      disabled={closing}
                      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                    >
                      {closing ? 'Cerrando ruta...' : 'Confirmar liquidación de ruta'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirmar anulación */}
      {voidTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => !voiding && setVoidTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-sm p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">Anular hoja de carga</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              ¿Deseas anular la hoja de carga de <strong>{voidTarget.seller_name}</strong> del {voidTarget.dispatch_date}? Las ventas realizadas por el vendedor no se borran.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={voiding}
                onClick={() => void handleVoidDispatch()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {voiding ? 'Anulando...' : 'Anular hoja'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
