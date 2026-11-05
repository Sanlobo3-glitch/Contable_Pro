import { useMemo, useState } from 'react'
import {
  Package,
  Store,
  ShoppingCart,
  Users,
  BookOpen,
  Truck,
  ArrowRight,
  Plus,
  Minus,
  Search,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Banknote,
} from 'lucide-react'
import type { DemoRole } from '../lib/supabase'

interface LandingProps {
  onLogin: () => void
  onRegister: () => void
  onEnterDemo: (targetPage?: string, role?: DemoRole) => void
  onOpenDemoCatalog?: () => void
}

type PreviewTab = 'panel' | 'pos' | 'inventario' | 'operaciones'
type KpiView = 'ventas' | 'stock' | 'cartera' | 'cxp'

interface DemoProductRow {
  id: string
  sku: string
  name: string
  category: string
  stock: number
  minStock: number
  cost: number
  priceDetal: number
  priceMayor: number
  minMayor: number
  lot?: string
  daysLeft?: number
}

const DEMO_PRODUCTS: DemoProductRow[] = [
  {
    id: 'prod-1',
    sku: '75910001',
    name: 'Café Molido Gourmet 500g',
    category: 'Bebidas y Café',
    stock: 34,
    minStock: 10,
    cost: 4.2,
    priceDetal: 6.5,
    priceMayor: 5.8,
    minMayor: 6,
  },
  {
    id: 'prod-3',
    sku: '75910003',
    name: 'Harina de Maíz Precocida 1kg',
    category: 'Víveres y Granos',
    stock: 68,
    minStock: 20,
    cost: 0.95,
    priceDetal: 1.4,
    priceMayor: 1.25,
    minMayor: 20,
  },
  {
    id: 'prod-5',
    sku: '75910005',
    name: 'Queso Blanco Pasteurizado 1kg',
    category: 'Lácteos y Refrigerados',
    stock: 14,
    minStock: 8,
    cost: 5.4,
    priceDetal: 7.8,
    priceMayor: 7.1,
    minMayor: 5,
    lot: 'Q-2026-10B',
    daysLeft: 19,
  },
  {
    id: 'prod-7',
    sku: '75910007',
    name: 'Arroz Blanco Extra 1kg',
    category: 'Víveres y Granos',
    stock: 52,
    minStock: 18,
    cost: 1.02,
    priceDetal: 1.55,
    priceMayor: 1.38,
    minMayor: 24,
  },
  {
    id: 'prod-8',
    sku: '75910008',
    name: 'Detergente Multiuso 2kg',
    category: 'Hogar y Limpieza',
    stock: 22,
    minStock: 8,
    cost: 3.15,
    priceDetal: 4.9,
    priceMayor: 4.4,
    minMayor: 6,
  },
  {
    id: 'prod-2',
    sku: '75910002',
    name: 'Aceite Vegetal Puro 1L',
    category: 'Víveres y Granos',
    stock: 5,
    minStock: 12,
    cost: 2.1,
    priceDetal: 3.25,
    priceMayor: 2.95,
    minMayor: 12,
  },
  {
    id: 'prod-6',
    sku: '75910006',
    name: 'Leche Entera UHT 1L',
    category: 'Lácteos y Refrigerados',
    stock: 6,
    minStock: 12,
    cost: 1.35,
    priceDetal: 2.1,
    priceMayor: 1.85,
    minMayor: 12,
    lot: 'L-2026-09A',
    daysLeft: 8,
  },
  {
    id: 'prod-4',
    sku: '75910004',
    name: 'Azúcar Refinada 1kg',
    category: 'Víveres y Granos',
    stock: 0,
    minStock: 15,
    cost: 1.15,
    priceDetal: 1.65,
    priceMayor: 1.5,
    minMayor: 12,
  },
]

const TODAY_SALES = [
  { id: 'FAC-00109', client: 'Abasto El Progreso', channel: 'Ruta Norte', method: 'Efectivo', amount: 67.92, time: 'Hace 25 min' },
  { id: 'FAC-00108', client: 'Panadería San José', channel: 'Mostrador', method: 'Transferencia', amount: 73.0, time: 'Hace 1 h' },
  { id: 'FAC-00107', client: 'María Gómez', channel: 'Mostrador', method: 'Fiado (7 días)', amount: 17.9, time: 'Hace 3 h' },
]

const RECEIVABLES_PREVIEW = [
  { client: 'Abasto El Progreso', doc: 'J-40123456-1', due: 'Vencido hace 4 días', status: 'overdue', balance: 93.0 },
  { client: 'María Gómez', doc: 'V-18234567', due: 'Vence en 7 días', status: 'current', balance: 17.9 },
]

const PAYABLES_PREVIEW = [
  { supplier: 'Molinos del Sur C.A.', doc: 'J-31445566-8', due: 'Vencida hace 3 días', status: 'overdue', balance: 76.0 },
  { supplier: 'Distribuidora Nacional C.A.', doc: 'J-30987654-0', due: 'Vence en 14 días', status: 'current', balance: 177.0 },
]

function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

export default function Landing({ onLogin, onRegister, onEnterDemo, onOpenDemoCatalog }: LandingProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>('panel')
  const [kpiView, setKpiView] = useState<KpiView>('ventas')

  // Estado interactivo del simulador POS en la portada
  const [posPriceMode, setPosPriceMode] = useState<'detal' | 'mayor'>('detal')
  const [posMethod, setPosMethod] = useState<'efectivo' | 'transferencia' | 'fiado'>('efectivo')
  const [posCart, setPosCart] = useState<Record<string, number>>({
    'prod-1': 2,
    'prod-3': 5,
    'prod-5': 1,
  })
  const [posSimulatedTicket, setPosSimulatedTicket] = useState<number | null>(null)

  // Estado interactivo del buscador de inventario en la portada
  const [invSearch, setInvSearch] = useState('')
  const [invFilter, setInvFilter] = useState<'todos' | 'bajo' | 'lotes'>('todos')

  const posLines = useMemo(() => {
    return DEMO_PRODUCTS.filter(p => (posCart[p.id] || 0) > 0).map(p => {
      const qty = posCart[p.id] || 0
      const unitPrice = posPriceMode === 'mayor' ? p.priceMayor : p.priceDetal
      const subtotal = qty * unitPrice
      const profit = qty * (unitPrice - p.cost)
      return { product: p, qty, unitPrice, subtotal, profit }
    })
  }, [posCart, posPriceMode])

  const posTotal = useMemo(
    () => posLines.reduce((acc, l) => acc + l.subtotal, 0),
    [posLines]
  )

  const posProfit = useMemo(
    () => posLines.reduce((acc, l) => acc + l.profit, 0),
    [posLines]
  )

  const filteredInventory = useMemo(() => {
    const q = invSearch.trim().toLowerCase()
    return DEMO_PRODUCTS.filter(p => {
      if (invFilter === 'bajo' && p.stock > p.minStock) return false
      if (invFilter === 'lotes' && !p.lot) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    })
  }, [invSearch, invFilter])

  function adjustCart(productId: string, delta: number) {
    setPosSimulatedTicket(null)
    setPosCart(prev => {
      const current = prev[productId] || 0
      const next = Math.max(0, Math.min(99, current + delta))
      const copy = { ...prev }
      if (next === 0) delete copy[productId]
      else copy[productId] = next
      return copy
    })
  }

  function handleSimulateCheckout() {
    if (posTotal <= 0) return
    setPosSimulatedTicket(posTotal)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Barra superior: 3 zonas limpias */}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a href="#" className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-slate-900 tracking-tight whitespace-nowrap">
              InventarioPro
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#demo" className="hover:text-slate-900 transition-colors whitespace-nowrap">
              Demo interactiva
            </a>
            <a href="#modulos" className="hover:text-slate-900 transition-colors whitespace-nowrap">
              Módulos
            </a>
            <a href="/manual" className="hover:text-slate-900 transition-colors whitespace-nowrap">
              Manual de usuario
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onLogin}
              className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap shrink-0 transition-colors"
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={onRegister}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors"
            >
              Prueba gratis 3 meses
            </button>
          </div>
        </div>
      </header>

      {/* Hero principal */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-10 sm:pt-16 sm:pb-12">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Inventario · Punto de venta · Rutas · Contabilidad
          </p>
          <h1 className="mt-3 text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12]">
            Control operativo y contable para distribuidoras, abastos y comercios.
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
            Registra ventas en mostrador o en ruta, controla lotes y costos promedio, cobra cartera pendiente y mantén tus libros contables cuadrados desde cualquier dispositivo.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <button
              type="button"
              onClick={onRegister}
              className="inline-flex items-center justify-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-lg text-sm font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors"
            >
              Prueba gratis 3 meses
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onEnterDemo('dashboard', 'dueno')}
              className="inline-flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-800 px-6 py-3 rounded-lg text-sm font-semibold hover:bg-slate-100 whitespace-nowrap shrink-0 transition-colors"
            >
              Entrar al sistema demo sin cuenta
            </button>
            {onOpenDemoCatalog && (
              <button
                type="button"
                onClick={onOpenDemoCatalog}
                className="inline-flex items-center justify-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-900 px-5 py-3 rounded-lg text-sm font-semibold hover:bg-emerald-100 whitespace-nowrap shrink-0 transition-colors"
              >
                <Store className="w-4 h-4 text-emerald-700" />
                Probar Tienda de Catálogo (Vista Cliente)
              </button>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            3 meses gratis sin tarjeta · Multimoneda (USD, VES, COP y más) · Operación con o sin señal · Roles Dueño y Vendedor
          </p>
        </div>
      </section>

      {/* Entorno de demostración interactivo antes de iniciar sesión */}
      <section id="demo" className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 scroll-mt-20">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Cabecera del entorno ficticio */}
          <div className="bg-slate-900 text-slate-100 px-4 sm:px-6 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-slate-800">
            <div className="min-w-0">
              <p className="text-xs text-slate-300">
                <span className="font-semibold text-white">Vista previa en vivo</span>
                {' · '}
                <span>Distribuidora Los Andes C.A. (RIF J-41289034-7)</span>
                {' · '}
                <span className="text-slate-400">Datos ficticios de demostración</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onOpenDemoCatalog && (
                <button
                  type="button"
                  onClick={onOpenDemoCatalog}
                  className="px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/50 text-xs font-medium text-emerald-200 hover:bg-emerald-900/60 whitespace-nowrap shrink-0 transition-colors"
                >
                  Probar compra en Catálogo Web
                </button>
              )}
              <button
                type="button"
                onClick={() => onEnterDemo('catorders', 'dueno')}
                className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors"
              >
                Ver Bandeja de Captures
              </button>
              <button
                type="button"
                onClick={() => onEnterDemo('routeplan', 'vendedor')}
                className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors"
              >
                Probar como Vendedor de Ruta
              </button>
              <button
                type="button"
                onClick={() =>
                  onEnterDemo(
                    activeTab === 'pos'
                      ? 'pos'
                      : activeTab === 'inventario'
                        ? 'products'
                        : activeTab === 'operaciones'
                          ? 'dispatch'
                          : 'dashboard',
                    'dueno'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                Abrir sistema demo completo (30+ módulos)
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Pestañas de módulos para interactuar desde la portada */}
          <div className="border-b border-slate-200 bg-slate-50/70 px-4 sm:px-6 flex items-center gap-1 overflow-x-auto">
            {(
              [
                { id: 'panel', label: 'Panel ejecutivo', icon: ShoppingCart },
                { id: 'pos', label: 'Mostrador POS interactivo', icon: Store },
                { id: 'inventario', label: 'Inventario y lotes', icon: Package },
                { id: 'operaciones', label: 'Rutas, nómina y libros', icon: BookOpen },
              ] as const
            ).map(t => {
              const Icon = t.icon
              const active = activeTab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    active
                      ? 'border-slate-900 text-slate-900 bg-white'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* Contenido interactivo según pestaña */}
          <div className="p-4 sm:p-6">
            {activeTab === 'panel' && (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Resumen operativo del día
                    </h2>
                    <p className="text-xs text-slate-500">
                      Haz clic en cualquier indicador para inspeccionar el desglose o entra al panel completo para registrar operaciones.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onEnterDemo('ask', 'dueno')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      Pregúntale al Copiloto
                    </button>
                    <button
                      type="button"
                      onClick={() => onEnterDemo('dashboard', 'dueno')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                    >
                      Abrir Panel en vivo
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 4 KPIs seleccionables */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => setKpiView('ventas')}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      kpiView === 'ventas'
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Ventas de hoy</span>
                      <ShoppingCart className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                      $158.82
                    </p>
                    <p className="mt-1 text-xs text-emerald-700 font-medium tabular-nums">
                      3 operaciones · +5.0% vs ayer
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKpiView('stock')}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      kpiView === 'stock'
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Stock crítico</span>
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                    </div>
                    <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                      3 ítems
                    </p>
                    <p className="mt-1 text-xs text-amber-700 font-medium tabular-nums">
                      1 agotado · 2 bajo mínimo
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKpiView('cartera')}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      kpiView === 'cartera'
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Cartera por cobrar</span>
                      <Banknote className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                      $110.90
                    </p>
                    <p className="mt-1 text-xs text-red-700 font-medium tabular-nums">
                      $93.00 vencido · 2 clientes
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKpiView('cxp')}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      kpiView === 'cxp'
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Cuentas por pagar</span>
                      <Receipt className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                      $253.00
                    </p>
                    <p className="mt-1 text-xs text-amber-700 font-medium tabular-nums">
                      $76.00 vencido · 2 proveedores
                    </p>
                  </button>
                </div>

                {/* Tabla dinámica del KPI seleccionado */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  {kpiView === 'ventas' && (
                    <div>
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          Últimas ventas registradas hoy
                        </span>
                        <button
                          type="button"
                          onClick={() => onEnterDemo('sales', 'dueno')}
                          className="text-xs font-semibold text-slate-900 hover:underline"
                        >
                          Ir al módulo de Ventas →
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-xs text-slate-500">
                              <th className="text-left font-medium px-4 py-2.5">Comprobante</th>
                              <th className="text-left font-medium px-4 py-2.5">Cliente</th>
                              <th className="text-left font-medium px-4 py-2.5">Canal · Método</th>
                              <th className="text-left font-medium px-4 py-2.5">Hora</th>
                              <th className="text-right font-medium px-4 py-2.5">Monto</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {TODAY_SALES.map(s => (
                              <tr key={s.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{s.id}</td>
                                <td className="px-4 py-2.5 font-medium text-slate-800">{s.client}</td>
                                <td className="px-4 py-2.5 text-slate-600">{s.channel} · {s.method}</td>
                                <td className="px-4 py-2.5 text-xs text-slate-500">{s.time}</td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                                  {usd(s.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {kpiView === 'stock' && (
                    <div>
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          Productos bajo stock mínimo o agotados
                        </span>
                        <button
                          type="button"
                          onClick={() => onEnterDemo('buyplan', 'dueno')}
                          className="text-xs font-semibold text-slate-900 hover:underline"
                        >
                          Ver sugerencia de compra →
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-xs text-slate-500">
                              <th className="text-left font-medium px-4 py-2.5">SKU</th>
                              <th className="text-left font-medium px-4 py-2.5">Producto</th>
                              <th className="text-right font-medium px-4 py-2.5">Actual</th>
                              <th className="text-right font-medium px-4 py-2.5">Mínimo</th>
                              <th className="text-right font-medium px-4 py-2.5">Costo reposición</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {DEMO_PRODUCTS.filter(p => p.stock <= p.minStock).map(p => (
                              <tr key={p.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.sku}</td>
                                <td className="px-4 py-2.5 font-medium text-slate-800">{p.name}</td>
                                <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${p.stock === 0 ? 'text-red-700' : 'text-amber-700'}`}>
                                  {p.stock}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                                  {p.minStock}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                                  {usd(p.cost)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {kpiView === 'cartera' && (
                    <div>
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          Clientes con saldo pendiente (fiado)
                        </span>
                        <button
                          type="button"
                          onClick={() => onEnterDemo('cartera', 'dueno')}
                          className="text-xs font-semibold text-slate-900 hover:underline"
                        >
                          Registrar abono en Cartera →
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-xs text-slate-500">
                              <th className="text-left font-medium px-4 py-2.5">Cliente</th>
                              <th className="text-left font-medium px-4 py-2.5">Documento</th>
                              <th className="text-left font-medium px-4 py-2.5">Vencimiento</th>
                              <th className="text-right font-medium px-4 py-2.5">Saldo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {RECEIVABLES_PREVIEW.map(r => (
                              <tr key={r.doc} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 font-medium text-slate-800">{r.client}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.doc}</td>
                                <td className={`px-4 py-2.5 text-xs font-medium ${r.status === 'overdue' ? 'text-red-700' : 'text-slate-600'}`}>
                                  {r.due}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                                  {usd(r.balance)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {kpiView === 'cxp' && (
                    <div>
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          Facturas de proveedores por pagar
                        </span>
                        <button
                          type="button"
                          onClick={() => onEnterDemo('payables', 'dueno')}
                          className="text-xs font-semibold text-slate-900 hover:underline"
                        >
                          Abrir Cuentas por pagar →
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-xs text-slate-500">
                              <th className="text-left font-medium px-4 py-2.5">Proveedor</th>
                              <th className="text-left font-medium px-4 py-2.5">RIF / Doc</th>
                              <th className="text-left font-medium px-4 py-2.5">Estado</th>
                              <th className="text-right font-medium px-4 py-2.5">Por pagar</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {PAYABLES_PREVIEW.map(p => (
                              <tr key={p.doc} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 font-medium text-slate-800">{p.supplier}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.doc}</td>
                                <td className={`px-4 py-2.5 text-xs font-medium ${p.status === 'overdue' ? 'text-red-700' : 'text-slate-600'}`}>
                                  {p.due}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                                  {usd(p.balance)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'pos' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-7 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Prueba rápida de Mostrador POS
                      </h2>
                      <p className="text-xs text-slate-500">
                        Toca los productos para armar una cuenta al detal o al mayor.
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => setPosPriceMode('detal')}
                        className={`px-3 py-1 rounded-md text-xs font-medium ${
                          posPriceMode === 'detal' ? 'bg-slate-900 text-white' : 'text-slate-600'
                        }`}
                      >
                        Tarifa Detal
                      </button>
                      <button
                        type="button"
                        onClick={() => setPosPriceMode('mayor')}
                        className={`px-3 py-1 rounded-md text-xs font-medium ${
                          posPriceMode === 'mayor' ? 'bg-slate-900 text-white' : 'text-slate-600'
                        }`}
                      >
                        Tarifa Mayorista
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {DEMO_PRODUCTS.filter(p => p.stock > 0).slice(0, 6).map(p => {
                      const inCart = posCart[p.id] || 0
                      const activePrice = posPriceMode === 'mayor' ? p.priceMayor : p.priceDetal
                      return (
                        <div
                          key={p.id}
                          className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3 hover:border-slate-300 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                              <span className="font-mono font-semibold text-slate-900">{usd(activePrice)}</span>
                              {' · '}Stock {p.stock}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {inCart > 0 && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => adjustCart(p.id, -1)}
                                  aria-label={`Quitar ${p.name}`}
                                  className="w-7 h-7 rounded-md border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <span className="w-6 text-center text-xs font-mono font-semibold tabular-nums">
                                  {inCart}
                                </span>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => adjustCart(p.id, 1)}
                              aria-label={`Agregar ${p.name}`}
                              className="w-7 h-7 rounded-md bg-slate-900 text-white flex items-center justify-center hover:bg-slate-800"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="lg:col-span-5 border border-slate-200 rounded-xl p-4 flex flex-col justify-between bg-slate-50/50">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                      <span className="text-xs font-semibold text-slate-700">
                        Cuenta actual ({posPriceMode === 'mayor' ? 'Mayorista' : 'Detal'})
                      </span>
                      {posLines.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPosCart({})
                            setPosSimulatedTicket(null)
                          }}
                          className="text-xs text-slate-500 hover:text-slate-800"
                        >
                          Vaciar
                        </button>
                      )}
                    </div>

                    {posLines.length === 0 ? (
                      <p className="py-8 text-xs text-slate-400 text-center">
                        Selecciona uno o más productos a la izquierda para calcular el ticket.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-200/70 my-2 max-h-48 overflow-y-auto">
                        {posLines.map(l => (
                          <div key={l.product.id} className="py-2 flex items-center justify-between text-xs gap-2">
                            <span className="text-slate-700 truncate">
                              <span className="font-mono font-semibold tabular-nums">{l.qty}x</span> {l.product.name}
                            </span>
                            <span className="font-mono font-semibold tabular-nums text-slate-900 shrink-0">
                              {usd(l.subtotal)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="pt-3 border-t border-slate-200 space-y-2">
                      <div className="flex gap-1.5">
                        {(['efectivo', 'transferencia', 'fiado'] as const).map(m => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setPosMethod(m)}
                            className={`flex-1 py-1.5 rounded-md text-xs font-medium capitalize border ${
                              posMethod === m
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                        <span>Utilidad bruta estimada</span>
                        <span className="font-mono font-medium text-emerald-700 tabular-nums">
                          +{usd(posProfit)}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between pt-1">
                        <span className="text-sm font-semibold text-slate-800">Total a cobrar</span>
                        <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                          {usd(posTotal)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {posSimulatedTicket !== null && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        <span>
                          Venta simulada por <strong className="font-mono tabular-nums">{usd(posSimulatedTicket)}</strong> ({posMethod}).
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleSimulateCheckout}
                        disabled={posTotal <= 0}
                        className="py-2.5 px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap"
                      >
                        Simular cobro aquí
                      </button>
                      <button
                        type="button"
                        onClick={() => onEnterDemo('pos', 'dueno')}
                        className="py-2.5 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                      >
                        Abrir Mostrador completo →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'inventario' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={invSearch}
                      onChange={e => setInvSearch(e.target.value)}
                      placeholder="Buscar por nombre, código SKU o categoría..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm focus:outline-none focus:border-slate-700"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { id: 'todos', label: 'Todos (8)' },
                        { id: 'bajo', label: 'Bajo mínimo (3)' },
                        { id: 'lotes', label: 'Con vencimiento (2)' },
                      ] as const
                    ).map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setInvFilter(f.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                          invFilter === f.id
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onEnterDemo('products', 'dueno')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 whitespace-nowrap"
                    >
                      Editar en Inventario demo →
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                        <th className="text-left font-medium px-4 py-2.5">SKU</th>
                        <th className="text-left font-medium px-4 py-2.5">Producto</th>
                        <th className="text-right font-medium px-4 py-2.5">Stock</th>
                        <th className="text-right font-medium px-4 py-2.5">Costo</th>
                        <th className="text-right font-medium px-4 py-2.5">Detal</th>
                        <th className="text-right font-medium px-4 py-2.5">Mayor</th>
                        <th className="text-right font-medium px-4 py-2.5">Margen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredInventory.map(p => {
                        const margin = ((p.priceDetal - p.cost) / p.priceDetal) * 100
                        const isLow = p.stock <= p.minStock
                        return (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.sku}</td>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-800">{p.name}</p>
                              <p className="text-xs text-slate-500">
                                {p.category}
                                {p.lot ? ` · Lote ${p.lot} (vence en ${p.daysLeft} d)` : ''}
                              </p>
                            </td>
                            <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${p.stock === 0 ? 'text-red-700' : isLow ? 'text-amber-700' : 'text-slate-800'}`}>
                              {p.stock}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">{usd(p.cost)}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">{usd(p.priceDetal)}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">{usd(p.priceMayor)}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700 font-medium">
                              {margin.toFixed(1)}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'operaciones' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">Despacho y liquidación de ruta</span>
                      <Truck className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Hoja activa hoy · <strong>Carlos Méndez</strong> · Moto placa AB123CD
                    </p>
                    <div className="mt-3 space-y-1.5 text-xs border-t border-slate-100 pt-3">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Fondo inicial de caja</span>
                        <span className="font-mono tabular-nums">$30.00</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Ventas en ruta (efectivo)</span>
                        <span className="font-mono tabular-nums">$67.92</span>
                      </div>
                      <div className="flex justify-between font-semibold text-slate-900">
                        <span>Efectivo esperado al cierre</span>
                        <span className="font-mono tabular-nums">$97.92</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onEnterDemo('dispatch', 'dueno')}
                      className="text-xs font-semibold text-slate-900 hover:underline"
                    >
                      Ver Despacho de ruta →
                    </button>
                    <button
                      type="button"
                      onClick={() => onEnterDemo('routeplan', 'vendedor')}
                      className="text-xs font-medium text-emerald-700 hover:underline"
                    >
                      Vista Vendedor →
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">Nómina y comisiones</span>
                      <Users className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Cálculo automático sobre ventas cobradas, bonos y adelantos.
                    </p>
                    <div className="mt-3 space-y-1.5 text-xs border-t border-slate-100 pt-3">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Carlos Méndez (5% comisión)</span>
                        <span className="font-mono tabular-nums">$1,245.50 vendidos</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Lucía Rojas (4.5% comisión)</span>
                        <span className="font-mono tabular-nums">$980.00 vendidos</span>
                      </div>
                      <div className="flex justify-between font-semibold text-slate-900">
                        <span>Adelantos por descontar</span>
                        <span className="font-mono tabular-nums">$40.00</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => onEnterDemo('sellers', 'dueno')}
                      className="text-xs font-semibold text-slate-900 hover:underline"
                    >
                      Liquidar nómina en demo →
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">Contabilidad de partida doble</span>
                      <BookOpen className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Plan de cuentas, libro diario, mayor, estado de resultados y balance general.
                    </p>
                    <div className="mt-3 space-y-1.5 text-xs border-t border-slate-100 pt-3">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Ingresos contabilizados</span>
                        <span className="font-mono tabular-nums">$820.90</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Costo y gastos operativos</span>
                        <span className="font-mono tabular-nums">$585.00</span>
                      </div>
                      <div className="flex justify-between font-semibold text-emerald-700">
                        <span>Resultado neto cuadrado</span>
                        <span className="font-mono tabular-nums">+$235.90</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onEnterDemo('accounting', 'dueno')}
                      className="text-xs font-semibold text-slate-900 hover:underline"
                    >
                      Libro diario y mayor →
                    </button>
                    <button
                      type="button"
                      onClick={() => onEnterDemo('accstate', 'dueno')}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      Estados financieros →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Bento asimétrico de capacidades */}
      <section id="modulos" className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 scroll-mt-20">
        <div className="max-w-2xl mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Módulos conectados de punta a punta
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600">
            Cada venta descuenta inventario, registra el movimiento en Kardex, actualiza caja o cartera y alimenta tus reportes financieros sin doble carga.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between">
            <div>
              <p className="text-xs font-mono font-semibold text-slate-400">01. Ventas multicanal y POS</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">
                Mostrador por bodega, código de barras y catálogo digital público
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Opera con precios al detal y al mayor automáticos por cantidad, pagos mixtos en divisa o moneda local con cálculo de vuelto, descuento desde la bodega activa y enlace público para pedidos.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-xs font-semibold">
              <button type="button" onClick={() => onEnterDemo('pos', 'dueno')} className="text-slate-900 hover:underline whitespace-nowrap">
                Probar Mostrador POS →
              </button>
              <button type="button" onClick={() => onEnterDemo('quotations', 'dueno')} className="text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap">
                Ver Cotizaciones →
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between">
            <div>
              <p className="text-xs font-mono font-semibold text-slate-400">02. Sedes, multibodega y lotes</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">
                Sucursales, traslados auditados, Kardex y vencimientos
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Gestiona existencias físicas y reservadas por almacén, recepciones parciales entre sedes, control FEFO de lotes perecederos y etiquetas QR/código de barras.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-xs font-semibold">
              <button type="button" onClick={() => onEnterDemo('warehouses', 'dueno')} className="text-slate-900 hover:underline whitespace-nowrap">
                Sedes y multibodega →
              </button>
              <button type="button" onClick={() => onEnterDemo('lots', 'dueno')} className="text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap">
                Lotes y Kardex →
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between">
            <div>
              <p className="text-xs font-mono font-semibold text-slate-400">03. Abastecimiento y tesorería</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">
                Órdenes de compra, flujo 30/60/90d y presupuesto
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Emite órdenes de compra con recepción auditada en bodega, cruza cuentas por cobrar vs. obligaciones y proyecta tu liquidez en tres escenarios con presupuesto mensual.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-xs font-semibold">
              <button type="button" onClick={() => onEnterDemo('treasury', 'dueno')} className="text-slate-900 hover:underline whitespace-nowrap">
                Tesorería 30/60/90d →
              </button>
              <button type="button" onClick={() => onEnterDemo('purchaseorders', 'dueno')} className="text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap">
                Órdenes de compra →
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between">
            <div>
              <p className="text-xs font-mono font-semibold text-slate-400">04. Gobierno financiero y operaciones</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">
                Centro de mando CFO/COO, centros de costo por sucursal, rutas y contabilidad
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Compara el Estado de Resultados analítico de cada sucursal, audita despachos de ruta y visitas GPS, liquida nómina con comisiones y cierra libros en partida doble.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-xs font-semibold">
              <button type="button" onClick={() => onEnterDemo('command', 'dueno')} className="text-slate-900 hover:underline whitespace-nowrap">
                Centro de mando →
              </button>
              <button type="button" onClick={() => onEnterDemo('costcenters', 'dueno')} className="text-emerald-700 hover:text-emerald-800 hover:underline whitespace-nowrap">
                Centros de costo →
              </button>
              <button type="button" onClick={() => onEnterDemo('accounting', 'dueno')} className="text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap">
                Contabilidad →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Bloque de conversión final */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <div className="bg-slate-900 text-white rounded-xl p-6 sm:p-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              Empieza hoy con 3 meses de prueba gratuita
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Crea el espacio real de tu empresa en menos de un minuto o recorre primero cada módulo en el entorno interactivo de demostración.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onEnterDemo('dashboard', 'dueno')}
              className="px-5 py-2.5 rounded-lg border border-slate-700 text-sm font-semibold text-slate-100 hover:bg-slate-800 whitespace-nowrap"
            >
              Explorar demo completa
            </button>
            <button
              type="button"
              onClick={onRegister}
              className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white whitespace-nowrap"
            >
              Crear cuenta gratis
            </button>
          </div>
        </div>
      </section>

      {/* Pie de página limpio */}
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>
            <span className="font-semibold text-slate-700">InventarioPro</span> · Desarrollado por{' '}
            <span className="font-semibold text-slate-700">Richard J. Lobo S.</span>
          </p>
          <div className="flex items-center gap-4">
            <a href="/manual" className="hover:text-slate-800 underline">
              Manual
            </a>
            <a href="/terminos" className="hover:text-slate-800 underline">
              Términos y condiciones
            </a>
            <a href="/privacidad" className="hover:text-slate-800 underline">
              Política de privacidad
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
