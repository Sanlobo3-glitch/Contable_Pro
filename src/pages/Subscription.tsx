import { useState } from 'react'
import {
  useAuth,
  getTrialDaysLeft,
  isTrialActive,
  isSubscriptionActive,
} from '../lib/auth'
import {
  Check,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Crown,
  Building2,
  Infinity,
  HelpCircle,
  MessageCircle,
  Store,
  Truck,
  Calculator,
  Briefcase,
  FileSpreadsheet,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

type BillingCycle = 'monthly' | 'annual'
type Currency = 'COP' | 'USD'

interface PlanTier {
  id: string
  name: string
  target: string
  popular?: boolean
  description: string
  priceCopMonth: number
  priceCopAnnualMonth: number
  priceUsdMonth: number
  priceUsdAnnualMonth: number
  limits: {
    users: string
    branches: string
    warehouses: string
    monthlySales: string
    products: string
  }
  highlightFeatures: string[]
}

const PRICING_PLANS: PlanTier[] = [
  {
    id: 'comercio',
    name: 'Comercio',
    target: 'Tiendas, droguerías y puntos de venta',
    description: 'Control de mostrador ágil, arqueos ciegos de caja y ventas rápidas con código de barras.',
    priceCopMonth: 49000,
    priceCopAnnualMonth: 39000,
    priceUsdMonth: 12.99,
    priceUsdAnnualMonth: 9.99,
    limits: {
      users: 'Hasta 2 usuarios',
      branches: '1 sucursal',
      warehouses: '1 bodega física',
      monthlySales: 'Hasta 1.000 ventas / mes',
      products: 'Hasta 500 productos',
    },
    highlightFeatures: [
      'Punto de venta Mostrador (POS) táctil y móvil',
      'Turnos de caja con arqueo ciego (Cierre X y Z)',
      'Escaneo de código de barras continuo',
      'Cartera y fiados básicos con recibos de caja',
      'Catálogo comercial en WhatsApp con código QR',
      'Control de existencias y alertas de stock mínimo',
      'Soporte técnico por correo y tickets',
    ],
  },
  {
    id: 'profesional',
    name: 'Profesional',
    target: 'Distribuidoras, mayoristas y pymes en expansión',
    popular: true,
    description: 'Multibodega, lotes con vencimiento, logística de despachos y escáner de facturas con IA.',
    priceCopMonth: 99000,
    priceCopAnnualMonth: 79000,
    priceUsdMonth: 24.99,
    priceUsdAnnualMonth: 19.99,
    limits: {
      users: 'Hasta 5 usuarios',
      branches: 'Hasta 3 sucursales',
      warehouses: 'Hasta 3 bodegas',
      monthlySales: 'Hasta 5.000 ventas / mes',
      products: 'Catálogo ilimitado',
    },
    highlightFeatures: [
      'Todo lo del plan Comercio',
      'Multibodega con traslados auditados entre sedes',
      'Lotes, fechas de vencimiento y kardex ponderado',
      'Logística de transporte y rutas con mapa GPS',
      'Despachos con confirmación y firma digital',
      'Órdenes de compra y cuentas por pagar a proveedores',
      'Escáner de hojas de cuaderno escritas a mano (IA)',
      'Auditoría antifraude y detección de anomalías',
      'Soporte prioritario por WhatsApp y soporte técnico',
    ],
  },
  {
    id: 'empresarial',
    name: 'Empresarial NIIF',
    target: 'Empresas consolidadas con cumplimiento DIAN',
    description: 'ERP integral con contabilidad de partida doble, medios magnéticos exógena y formularios Muisca.',
    priceCopMonth: 199000,
    priceCopAnnualMonth: 159000,
    priceUsdMonth: 49.99,
    priceUsdAnnualMonth: 39.99,
    limits: {
      users: 'Hasta 15 usuarios + Contador gratis',
      branches: 'Hasta 10 sucursales',
      warehouses: 'Hasta 10 bodegas',
      monthlySales: 'Ventas ilimitadas',
      products: 'Catálogo ilimitado',
    },
    highlightFeatures: [
      'Todo lo del plan Profesional',
      'Contabilidad NIIF completa (acc_*) en partida doble',
      'Catálogo PUC maestro, libro diario y balances',
      'Reportes DIAN: Muisca Formulario 300 y 350',
      'Información Exógena Prevalidador (1001 a 2276)',
      'Certificados de Retención (ReteFuente, ReteIVA, ICA)',
      'Centro de Dirección Gerencial y aprobaciones con PIN',
      'Centros de costos y presupuestos departamentales',
      'Escudo de márgenes de precios contra inflación',
    ],
  },
  {
    id: 'corporativo',
    name: 'Corporativo Multiempresa',
    target: 'Franquicias, holdings y operaciones a escala',
    description: 'Múltiples razones sociales (NITs), base de datos aislada, integración API y gerente de cuenta.',
    priceCopMonth: 399000,
    priceCopAnnualMonth: 319000,
    priceUsdMonth: 99.99,
    priceUsdAnnualMonth: 79.99,
    limits: {
      users: 'Usuarios ilimitados',
      branches: 'Sedes ilimitadas',
      warehouses: 'Bodegas ilimitadas',
      monthlySales: 'Ilimitadas sin tope',
      products: 'Ilimitados',
    },
    highlightFeatures: [
      'Todo lo del plan Empresarial NIIF',
      'Panel Multiempresa para consolidar varios NITs',
      'API REST y Webhooks para Woocommerce / Shopify / SAP',
      'Base de datos dedicada con retención extendida',
      'Capacitación presencial / virtual personalizada',
      'Migración asistida de bases de datos desde Siigo / Loggro',
      'SLA garantizado de 99.9% y atención telefónica 24/7',
      'Gerente de cuenta corporativo asignado',
    ],
  },
]

interface MatrixCategory {
  category: string
  items: {
    feature: string
    comercio: string | boolean
    profesional: string | boolean
    empresarial: string | boolean
    corporativo: string | boolean
  }[]
}

const COMPARISON_MATRIX: MatrixCategory[] = [
  {
    category: 'Punto de Venta (POS) y Comercialización',
    items: [
      { feature: 'Mostrador POS táctil y móvil', comercio: true, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Turnos de caja con arqueo ciego (Cierres X / Z)', comercio: true, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Lector de código de barras continuo', comercio: true, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Multi-moneda con pagos mixtos (COP/USD/VES)', comercio: true, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Catálogo público en WhatsApp con código QR', comercio: true, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Escáner de ventas en cuaderno a mano con IA', comercio: 'Básico', profesional: 'Ilimitado', empresarial: 'Ilimitado', corporativo: 'Ilimitado' },
      { feature: 'Plan Separe y contratos de apartados', comercio: false, profesional: true, empresarial: true, corporativo: true },
    ],
  },
  {
    category: 'Inventario, Bodegas y Logística',
    items: [
      { feature: 'Sucursales y Sedes', comercio: '1 sucursal', profesional: 'Hasta 3', empresarial: 'Hasta 10', corporativo: 'Ilimitadas' },
      { feature: 'Bodegas físicas y virtuales', comercio: '1 bodega', profesional: 'Hasta 3', empresarial: 'Hasta 10', corporativo: 'Ilimitadas' },
      { feature: 'Traslados auditados entre bodegas', comercio: false, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Toma física ciega con ajuste automático', comercio: false, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Lotes y fechas de vencimiento', comercio: false, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Kardex valorizado a costo promedio ponderado', comercio: 'Básico', profesional: true, empresarial: true, corporativo: true },
      { feature: 'Rutas de despacho y mapa de vendedores GPS', comercio: false, profesional: 'Hasta 2 rutas', empresarial: 'Ilimitadas', corporativo: 'Ilimitadas' },
      { feature: 'Confirmación de entrega con firma digital', comercio: false, profesional: true, empresarial: true, corporativo: true },
    ],
  },
  {
    category: 'Contabilidad NIIF y Cumplimiento DIAN',
    items: [
      { feature: 'Cartera y cuentas por cobrar (Fiados)', comercio: 'Hasta 50 clientes', profesional: 'Ilimitada', empresarial: 'Ilimitada', corporativo: 'Ilimitada' },
      { feature: 'Impresión de recibos oficiales de caja (RC)', comercio: true, profesional: true, empresarial: true, corporativo: true },
      { feature: 'Cuentas por pagar a proveedores y compras', comercio: 'Básico', profesional: true, empresarial: true, corporativo: true },
      { feature: 'Contabilidad de partida doble NIIF (acc_*)', comercio: false, profesional: false, empresarial: true, corporativo: true },
      { feature: 'Catálogo PUC, libro diario y balance comprobación', comercio: false, profesional: false, empresarial: true, corporativo: true },
      { feature: 'Estados Financieros NIIF (Balance y PyG)', comercio: false, profesional: false, empresarial: true, corporativo: true },
      { feature: 'Muisca DIAN: Formularios 300 (IVA) y 350 (Retención)', comercio: false, profesional: false, empresarial: true, corporativo: true },
      { feature: 'Información Exógena / Medios Magnéticos Prevalidador', comercio: false, profesional: false, empresarial: true, corporativo: true },
      { feature: 'Certificados Tributarios de Retención a Terceros', comercio: false, profesional: false, empresarial: true, corporativo: true },
    ],
  },
  {
    category: 'Control Gerencial, Integraciones y Soporte',
    items: [
      { feature: 'Centro de Dirección Gerencial y Autorizaciones', comercio: false, profesional: 'Básico', empresarial: true, corporativo: true },
      { feature: 'Centros de costos y presupuestos por sede', comercio: false, profesional: false, empresarial: true, corporativo: true },
      { feature: 'Conciliación bancaria contra extractos', comercio: false, profesional: false, empresarial: true, corporativo: true },
      { feature: 'API REST y Webhooks para e-commerce', comercio: false, profesional: false, empresarial: 'Estándar', corporativo: 'Avanzada' },
      { feature: 'Multi-empresa (Consolidación de varios NITs)', comercio: false, profesional: false, empresarial: false, corporativo: true },
      { feature: 'Soporte técnico y canal de atención', comercio: 'Correo y tickets', profesional: 'WhatsApp prioritario', empresarial: 'WhatsApp y Contador', corporativo: 'Dedicado 24/7 + SLA' },
    ],
  },
]

const CONTACT_WHATSAPP = '573138865440'
const CONTACT_EMAIL = 'emerald.red.social@gmail.com'

export default function Subscription() {
  const { user } = useAuth()
  const [cycle, setCycle] = useState<BillingCycle>('annual')
  const [cur, setCur] = useState<Currency>('COP')
  const [showMatrix, setShowMatrix] = useState(false)

  if (!user) return null

  // ADMINISTRADOR GLOBAL:
  if (user.role === 'admin' || user.platform_admin) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-900 p-3 text-amber-400">
            <Crown className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Administración Global de Plataforma</h1>
            <p className="text-sm text-slate-500">Estado de suscripción para la cuenta matriz del ERP.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-600 shrink-0" />
            <div>
              <h2 className="font-bold text-emerald-900 text-base">Licencia de Plataforma Vitalicia Activa</h2>
              <p className="text-sm text-emerald-700">Tu cuenta tiene privilegios de superadministrador sobre todas las empresas clientes.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="rounded-xl bg-white border border-emerald-100 p-4">
              <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mb-1">
                <Infinity className="w-4 h-4 text-emerald-600" /> Caducidad
              </span>
              <p className="font-bold text-slate-800 text-base">Sin vencimiento</p>
              <p className="text-xs text-slate-500">Acceso perpetuo al sistema</p>
            </div>
            <div className="rounded-xl bg-white border border-emerald-100 p-4">
              <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mb-1">
                <Building2 className="w-4 h-4 text-emerald-600" /> Inquilinos
              </span>
              <p className="font-bold text-slate-800 text-base">Empresas Ilimitadas</p>
              <p className="text-xs text-slate-500">Multi-tenant centralizado</p>
            </div>
            <div className="rounded-xl bg-white border border-emerald-100 p-4">
              <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mb-1">
                <Briefcase className="w-4 h-4 text-emerald-600" /> Privilegios
              </span>
              <p className="font-bold text-slate-800 text-base">Acceso Total</p>
              <p className="text-xs text-slate-500">Centro SQL, diagnósticos y roles</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ROLES QUE NO SEAN DUEÑO:
  if (user.role !== 'dueno') {
    return (
      <div className="max-w-xl mx-auto rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-3">
        <div className="flex items-center gap-2 text-amber-900 font-bold">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <span>Suscripción Empresarial</span>
        </div>
        <p className="text-sm text-amber-800">
          Tu cuenta está asociada a la empresa <strong className="text-amber-950">{user.company_name || 'Mi Empresa'}</strong>.
          La selección de planes y contratación es gestionada exclusivamente por el Dueño de la empresa.
        </p>
      </div>
    )
  }

  const trialDaysLeft = getTrialDaysLeft(user)
  const trialActive = isTrialActive(user)
  const subActive = isSubscriptionActive(user)

  const formatPrice = (plan: PlanTier) => {
    if (cur === 'COP') {
      const p = cycle === 'annual' ? plan.priceCopAnnualMonth : plan.priceCopMonth
      return {
        amount: `$${p.toLocaleString('es-CO')}`,
        period: 'COP / mes',
        annualNote: cycle === 'annual' ? `Facturado anualmente ($${(p * 12).toLocaleString('es-CO')} COP/año)` : null,
      }
    } else {
      const p = cycle === 'annual' ? plan.priceUsdAnnualMonth : plan.priceUsdMonth
      return {
        amount: `$${p.toFixed(2)}`,
        period: 'USD / mes',
        annualNote: cycle === 'annual' ? `Facturado anualmente ($${(p * 12).toFixed(2)} USD/año)` : null,
      }
    }
  }

  const getContactLink = (plan: PlanTier) => {
    const cycleLabel = cycle === 'annual' ? 'Anual (con descuento)' : 'Mensual'
    const priceText = formatPrice(plan).amount
    const msg = `Hola, deseo contratar el plan *${plan.name}* para mi empresa en Contable Pro.\n\n• Empresa: ${user.company_name || 'Mi Empresa'}\n• Ciclo: ${cycleLabel}\n• Tarifa: ${priceText} ${cur}\n• Correo: ${user.email}\n\nPor favor envíenme los medios de pago para activar la suscripción.`
    return `https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(msg)}`
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-16">
      {/* Encabezado Principal */}
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
          Planes y Límites Transparentes para Impulsar tu Empresa
        </h1>
        <p className="text-sm sm:text-base text-slate-600">
          Diseñado para pymes de Colombia y Latinoamérica. Todos los planes incluyen actualizaciones continuas,
          aislamiento seguro multiempresa y soporte profesional.
        </p>
      </div>

      {/* Estado Actual de la Suscripción */}
      <div className="rounded-xl border bg-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            subActive ? 'bg-emerald-100 text-emerald-700' : trialActive ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
          }`}>
            {subActive ? <ShieldCheck className="w-5 h-5" /> : trialActive ? <Clock className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-800">
                {subActive
                  ? `Suscripción Activa · Plan ${user.plan_type ? user.plan_type.toUpperCase() : 'COMERCIAL'}`
                  : trialActive
                  ? `Periodo de Prueba Gratuita (${trialDaysLeft} días restantes)`
                  : 'Suscripción o Periodo de Prueba Vencido'}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                subActive ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}>
                {subActive ? 'Al día' : 'Requiere Plan'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Empresa registrada: <strong className="text-slate-700">{user.company_name || 'Mi Empresa'}</strong> ·
              {user.subscription_end ? ` Vence el ${new Date(user.subscription_end).toLocaleDateString()}` : ' Activa tu plan para desbloquear funciones avanzadas.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(`Hola, tengo dudas sobre el plan de mi empresa ${user.company_name || ''}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-semibold transition-colors"
          >
            <MessageCircle className="w-4 h-4" /> Hablar con Asesor
          </a>
        </div>
      </div>

      {/* Controles de Moneda y Ciclo de Facturación */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
        {/* Toggle Mensual / Anual */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setCycle('monthly')}
            className={`px-4 py-2 rounded-lg transition-all ${
              cycle === 'monthly' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Facturación Mensual
          </button>
          <button
            onClick={() => setCycle('annual')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all ${
              cycle === 'annual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Facturación Anual</span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded-full">
              Ahorra 20%
            </span>
          </button>
        </div>

        {/* Selector de Moneda */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setCur('COP')}
            className={`px-3 py-2 rounded-lg transition-all ${
              cur === 'COP' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            COP ($)
          </button>
          <button
            onClick={() => setCur('USD')}
            className={`px-3 py-2 rounded-lg transition-all ${
              cur === 'USD' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            USD ($)
          </button>
        </div>
      </div>

      {/* Tarjetas de Precios y Límites */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
        {PRICING_PLANS.map(plan => {
          const pricing = formatPrice(plan)
          return (
            <div
              key={plan.id}
              className={`rounded-2xl bg-white border p-6 flex flex-col justify-between transition-all relative ${
                plan.popular
                  ? 'border-emerald-600 shadow-xl ring-2 ring-emerald-600/20'
                  : 'border-slate-200 shadow-xs hover:border-slate-300'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-xs">
                  Más Recomendado
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                  <p className="text-xs text-emerald-700 font-medium mt-0.5">{plan.target}</p>
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">{plan.description}</p>
                </div>

                {/* Precio */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black font-mono tracking-tight text-slate-900">
                      {pricing.amount}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">{pricing.period}</span>
                  </div>
                  {pricing.annualNote && (
                    <p className="text-[11px] text-emerald-700 font-medium mt-1">{pricing.annualNote}</p>
                  )}
                </div>

                {/* Cuadro de Límites Cuantitativos Concretos */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2 text-xs">
                  <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider">
                    Límites Incluidos:
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Usuarios:</span>
                    <strong className="text-slate-800">{plan.limits.users}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Sedes / Sucursales:</span>
                    <strong className="text-slate-800">{plan.limits.branches}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Bodegas físicas:</span>
                    <strong className="text-slate-800">{plan.limits.warehouses}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Ventas mensuales:</span>
                    <strong className="text-slate-800">{plan.limits.monthlySales}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Catálogo productos:</span>
                    <strong className="text-slate-800">{plan.limits.products}</strong>
                  </div>
                </div>

                {/* Lista de Características Clave */}
                <div className="space-y-2 pt-2">
                  <div className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                    Módulos y Funcionalidades:
                  </div>
                  <ul className="space-y-2">
                    {plan.highlightFeatures.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-600 leading-snug">
                        <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Botón de Contratación */}
              <div className="pt-6 mt-4 border-t border-slate-100">
                <a
                  href={getContactLink(plan)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-full py-2.5 px-4 rounded-xl text-center text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    plan.popular
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  <span>Activar Plan {plan.name}</span>
                </a>
              </div>
            </div>
          )
        })}
      </div>

      {/* Botón para alternar la Matriz Comparativa Exhaustiva */}
      <div className="text-center pt-4">
        <button
          onClick={() => setShowMatrix(prev => !prev)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold shadow-xs transition-colors"
        >
          <span>{showMatrix ? 'Ocultar comparativa completa' : 'Ver matriz comparativa completa de funciones'}</span>
          {showMatrix ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Matriz Comparativa Exhaustiva */}
      {showMatrix && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs animate-in fade-in duration-200">
          <div className="p-6 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Comparativa Detallada de Características</h2>
              <p className="text-xs text-slate-500">
                Revisa exactamente lo que incluye cada nivel de suscripción para tu negocio.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-slate-700">
                  <th className="py-3 px-4 font-bold w-1/3">Módulos & Funcionalidades</th>
                  <th className="py-3 px-4 font-bold text-center">Comercio</th>
                  <th className="py-3 px-4 font-bold text-center bg-emerald-50 text-emerald-900">
                    Profesional ★
                  </th>
                  <th className="py-3 px-4 font-bold text-center">Empresarial NIIF</th>
                  <th className="py-3 px-4 font-bold text-center">Corporativo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {COMPARISON_MATRIX.map((sec, sIdx) => (
                  <tr key={sIdx} className="contents">
                    <tr className="bg-slate-50/80 font-bold text-slate-800">
                      <td colSpan={5} className="py-2.5 px-4 text-xs tracking-wider uppercase">
                        {sec.category}
                      </td>
                    </tr>
                    {sec.items.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-4 text-slate-700 font-medium">{row.feature}</td>
                        <td className="py-2.5 px-4 text-center text-slate-600">
                          {typeof row.comercio === 'boolean' ? (
                            row.comercio ? <Check className="w-4 h-4 text-emerald-600 mx-auto" /> : <span className="text-slate-300">·</span>
                          ) : (
                            <span className="font-semibold text-slate-700">{row.comercio}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-center bg-emerald-50/30 text-emerald-900">
                          {typeof row.profesional === 'boolean' ? (
                            row.profesional ? <Check className="w-4 h-4 text-emerald-600 mx-auto" /> : <span className="text-slate-300">·</span>
                          ) : (
                            <span className="font-semibold text-emerald-900">{row.profesional}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-center text-slate-600">
                          {typeof row.empresarial === 'boolean' ? (
                            row.empresarial ? <Check className="w-4 h-4 text-emerald-600 mx-auto" /> : <span className="text-slate-300">·</span>
                          ) : (
                            <span className="font-semibold text-slate-700">{row.empresarial}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-center text-slate-600">
                          {typeof row.corporativo === 'boolean' ? (
                            row.corporativo ? <Check className="w-4 h-4 text-emerald-600 mx-auto" /> : <span className="text-slate-300">·</span>
                          ) : (
                            <span className="font-semibold text-slate-700">{row.corporativo}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Preguntas Frecuentes y Garantías */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4">
        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-2">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <HelpCircle className="w-4 h-4 text-emerald-600" />
            <span>¿Puedo cambiar de plan más adelante?</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Sí. Puedes actualizar a un plan superior en cualquier momento pagando únicamente la diferencia proporcional
            de los días restantes de tu suscripción.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-2">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <Calculator className="w-4 h-4 text-emerald-600" />
            <span>¿El Contador Público consume usuario?</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            En los planes Empresarial y Corporativo, el acceso para el Contador Público externo con tarjeta profesional
            es 100% gratuito y no consume cupos de los usuarios comerciales.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-2">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>¿Mis datos están seguros y aislados?</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Absolutamente. Cada empresa cuenta con aislamiento multiempresa por RLS a nivel de base de datos Postgres.
            Ningún otro usuario o negocio puede ver ni alterar tu inventario o facturación.
          </p>
        </div>
      </div>
    </div>
  )
}
