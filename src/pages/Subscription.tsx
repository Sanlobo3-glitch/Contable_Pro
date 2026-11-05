
import {
  useAuth,
  getTrialDaysLeft,
  isTrialActive,
  isSubscriptionActive,
} from '../lib/auth'

import {
  Check,
  Mail,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Crown,
  Building2,
  Infinity,
} from 'lucide-react'

const PLANS = [
  {
    id: 'emprendedor',
    name: 'Emprendedor',
    price: 9.99,
    tag: 'Negocios pequeños',
    popular: false,
    features: [
      '1 usuario',
      'Inventario',
      'Ventas y compras',
      'Clientes y proveedores',
      'Reportes básicos',
      'Soporte por correo',
    ],
  },
  {
    id: 'profesional',
    name: 'Profesional',
    price: 19.99,
    tag: 'Empresas en crecimiento',
    popular: true,
    features: [
      'Hasta 5 usuarios',
      'Módulo contable',
      'Cuentas por cobrar y pagar',
      'Reportes avanzados',
      'Copias de seguridad automáticas',
      'Soporte prioritario',
    ],
  },
  {
    id: 'empresarial',
    name: 'Empresarial',
    price: 39.99,
    tag: 'Empresas con varios usuarios',
    popular: false,
    features: [
      'Usuarios ilimitados',
      'Sucursales',
      'Roles y permisos',
      'Dashboard ejecutivo',
      'Exportación a Excel y PDF',
      'API e integraciones',
    ],
  },
  {
    id: 'corporativo',
    name: 'Corporativo',
    price: null,
    tag: 'Empresas que requieren personalización',
    popular: false,
    features: [
      'Personalización',
      'Dominio propio',
      'Capacitación',
      'Implementación',
      'Soporte dedicado',
    ],
  },
] as const

const CONTACT_EMAIL = 'inventariopro@emerald.qzz.io'

export default function Subscription() {
  const { user } = useAuth()

  if (!user) return null

  // ADMINISTRADOR GLOBAL:
  // Su cuenta es independiente de las suscripciones empresariales.
  if (user.role === 'admin' || user.platform_admin) {
    return (
      <div className="max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-xl bg-slate-900 p-3">
            <Crown className="w-6 h-6 text-amber-400" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Administración global
            </h1>
            <p className="text-sm text-slate-500">
              Estado de acceso de la cuenta administradora.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck className="w-7 h-7 text-emerald-600" />

            <div>
              <h2 className="font-bold text-emerald-900">
                Acceso global independiente
              </h2>
              <p className="text-sm text-emerald-700">
                Tu cuenta no depende de una suscripción empresarial.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-white border border-emerald-100 p-4">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-2">
                <Infinity className="w-4 h-4" />
                Suscripción
              </div>
              <p className="font-bold text-slate-800">
                Sin vencimiento
              </p>
              <p className="text-xs text-slate-500 mt-1">
                No requiere plan ni renovación.
              </p>
            </div>

            <div className="rounded-xl bg-white border border-emerald-100 p-4">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-2">
                <Building2 className="w-4 h-4" />
                Dispositivos
              </div>
              <p className="font-bold text-slate-800">
                Ilimitados
              </p>
              <p className="text-xs text-slate-500 mt-1">
                No consume cupos empresariales.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-white border border-emerald-100 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Permisos de administrador global
            </p>

            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                Acceso independiente a la plataforma.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                Administración de empresas clientes.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                Administración de usuarios de plataforma.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                Sin restricciones por planes empresariales.
              </li>
            </ul>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-5">
          Esta cuenta está registrada como administrador global y no participa
          en la facturación de las empresas clientes.
        </p>
      </div>
    )
  }

  // SOLO EL DUEÑO PUEDE ADMINISTRAR LA SUSCRIPCIÓN EMPRESARIAL.
  if (user.role !== 'dueno') {
    return (
      <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h1 className="font-bold text-amber-900">
          Suscripción de la empresa
        </h1>

        <p className="mt-2 text-sm text-amber-800">
          Tu acceso y las funciones disponibles dependen del plan contratado
          por tu empresa. La administración de la suscripción corresponde
          exclusivamente al dueño de la empresa.
        </p>

        {user.company_name && (
          <p className="mt-3 text-sm text-amber-900 font-semibold">
            Empresa: {user.company_name}
          </p>
        )}
      </div>
    )
  }

  // DATOS DE LA SUSCRIPCIÓN CENTRAL DE LA EMPRESA.
  const trialDaysLeft = getTrialDaysLeft(user)
  const trialActive = isTrialActive(user)
  const subActive = isSubscriptionActive(user)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800 mb-1">
          Suscripción de la empresa
        </h1>

        <p className="text-sm text-slate-500">
          Administra el plan que comparten los usuarios de tu empresa.
        </p>

        {user.company_name && (
          <p className="text-sm font-semibold text-slate-700 mt-2">
            <Building2 className="w-4 h-4 inline mr-1" />
            {user.company_name}
          </p>
        )}
      </div>

      {subActive ? (
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-6">
          <ShieldCheck className="w-5 h-5 shrink-0" />

          <p className="text-sm">
            La suscripción de tu empresa está activa
            {user.plan_type ? (
              <>
                {' '}· Plan{' '}
                <span className="font-semibold capitalize">
                  {user.plan_type}
                </span>
              </>
            ) : null}

            {user.subscription_end ? (
              <>
                {' '}· vence el{' '}
                {new Date(user.subscription_end).toLocaleDateString()}
              </>
            ) : null}
          </p>
        </div>
      ) : trialActive ? (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          <Clock className="w-5 h-5 shrink-0" />

          <p className="text-sm">
            Tu empresa tiene{' '}
            <span className="font-bold">
              {trialDaysLeft} día{trialDaysLeft === 1 ? '' : 's'}
            </span>{' '}
            de prueba gratuita.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
          <AlertTriangle className="w-5 h-5 shrink-0" />

          <p className="text-sm">
            El periodo de prueba o la suscripción de tu empresa terminó.
            Solicita la renovación para recuperar el acceso completo.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-6">
        <h2 className="font-bold text-slate-800 text-sm mb-2">
          Una sola suscripción para toda la empresa
        </h2>

        <p className="text-sm text-slate-600">
          El plan y su vencimiento se administran a nivel empresarial.
          Los empleados, vendedores y demás miembros heredan automáticamente
          el acceso de la empresa. No necesitan contratar planes individuales.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {PLANS.map(plan => (
          <div
            key={plan.id}
            className={`bg-white rounded-xl border p-5 flex flex-col ${
              plan.popular
                ? 'border-slate-800 ring-1 ring-slate-800'
                : 'border-slate-200'
            }`}
          >
            {plan.popular && (
              <span className="text-[10px] font-semibold text-white bg-slate-800 rounded-full px-2 py-0.5 self-start mb-2">
                MÁS ELEGIDO
              </span>
            )}

            <h3 className="font-bold text-slate-800">
              {plan.name}
            </h3>

            <p className="text-xs text-slate-400 mb-3">
              {plan.tag}
            </p>

            <div className="mb-4">
              {plan.price ? (
                <>
                  <span className="text-2xl font-bold text-slate-800">
                    ${plan.price}
                  </span>
                  <span className="text-sm text-slate-400">
                    /mes
                  </span>
                </>
              ) : (
                <span className="text-lg font-bold text-slate-800">
                  Desde $79.99/mes
                </span>
              )}
            </div>

            <ul className="space-y-2 flex-1 mb-4">
              {plan.features.map(feature => (
                <li
                  key={feature}
                  className="flex items-start gap-2 text-xs text-slate-600"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                `Quiero activar el plan ${plan.name}`
              )}&body=${encodeURIComponent(
                `Hola, quiero activar el plan ${plan.name} para mi empresa.\n\nEmpresa: ${user.company_name || 'No especificada'}\nCorreo registrado: ${user.email}\n\nPor favor, envíenme la información para completar el pago.`
              )}`}
              className={`w-full text-center py-2 rounded-lg text-sm font-medium transition-colors ${
                plan.popular
                  ? 'bg-slate-800 text-white hover:bg-slate-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {subActive && user.plan_type === plan.id
                ? 'Plan actual'
                : `Elegir ${plan.name}`}
            </a>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-slate-400" />

          <h2 className="text-sm font-bold text-slate-700">
            ¿Cómo funciona el pago?
          </h2>
        </div>

        <p className="text-sm text-slate-600">
          Por ahora el pago se coordina de forma manual por PayPal. Elige tu
          plan y{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
              'Quiero activar una suscripción empresarial'
            )}`}
            className="text-slate-800 font-medium underline"
          >
            escríbenos a {CONTACT_EMAIL}
          </a>
          . Una vez confirmado el pago, activaremos la suscripción de tu empresa.
        </p>

        <p className="text-xs text-slate-400 mt-3">
          Descuento del 15–20% pagando anual · 20% de descuento el primer año
          para clientes fundadores · Un mes gratis por cada referido.
        </p>
      </div>

      <p className="text-center text-[10px] text-slate-400 mt-4">
        <a href="/terminos" className="underline hover:text-slate-600">
          Términos de Servicio
        </a>
        {' · '}
        <a href="/privacidad" className="underline hover:text-slate-600">
          Política de Privacidad
        </a>
      </p>

      <p className="text-center text-[10px] text-slate-400 mt-6">
        <span className="font-semibold text-slate-500">
          Copyright
        </span>
        {' · '}Desarrollado por{' '}
        <span className="font-semibold text-slate-600">
          Richard J. Lobo S.
        </span>
      </p>
    </div>
  )
}
