import { useState } from 'react'
import { useAuth, getTrialDaysLeft, isTrialActive } from '../lib/auth'
import { Check, MessageCircle, Clock } from 'lucide-react'

const PLANS = [
  {
    id: 'emprendedor', name: 'Emprendedor', price: 9.99, tag: 'Negocios pequeños',
    features: ['1 usuario', 'Inventario', 'Ventas y compras', 'Clientes y proveedores', 'Reportes básicos', 'Soporte por correo'],
  },
  {
    id: 'profesional', name: 'Profesional', price: 19.99, tag: 'Empresas en crecimiento', popular: true,
    features: ['Hasta 5 usuarios', 'Módulo contable', 'Cuentas por cobrar y pagar', 'Reportes avanzados', 'Copias de seguridad automáticas', 'Soporte prioritario'],
  },
  {
    id: 'empresarial', name: 'Empresarial', price: 39.99, tag: 'Empresas con varios usuarios',
    features: ['Usuarios ilimitados', 'Sucursales', 'Roles y permisos', 'Dashboard ejecutivo', 'Exportación a Excel y PDF', 'API e integraciones'],
  },
  {
    id: 'corporativo', name: 'Corporativo', price: null, tag: 'Empresas que requieren personalización',
    features: ['Personalización', 'Dominio propio', 'Capacitación', 'Implementación', 'Soporte dedicado'],
  },
]

const CONTACT_EMAIL = 'emerald.red.social@gmail.com'
const CONTACT_WHATSAPP = '' // pon aquí tu número, ej: '584121234567'

export default function Pricing() {
  const { user, signOut } = useAuth()
  const [selected, setSelected] = useState<string | null>(null)
  const trialActive = isTrialActive(user)
  const daysLeft = getTrialDaysLeft(user)

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800">Elige tu plan</h1>
          {trialActive ? (
            <p className="text-sm text-slate-500 mt-2 flex items-center justify-center gap-1">
              <Clock className="w-4 h-4" /> Te quedan {daysLeft} día{daysLeft === 1 ? '' : 's'} de prueba gratuita
            </p>
          ) : (
            <p className="text-sm text-amber-600 mt-2">
              Tu periodo de prueba terminó. Estás en modo de solo lectura hasta activar un plan.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map(plan => (
            <div key={plan.id} className={`bg-white rounded-xl border p-5 flex flex-col ${plan.popular ? 'border-slate-800 ring-1 ring-slate-800' : 'border-slate-200'}`}>
              {plan.popular && <span className="text-[10px] font-semibold text-white bg-slate-800 rounded-full px-2 py-0.5 self-start mb-2">MÁS ELEGIDO</span>}
              <h3 className="font-bold text-slate-800">{plan.name}</h3>
              <p className="text-xs text-slate-400 mb-3">{plan.tag}</p>
              <div className="mb-4">
                {plan.price ? (
                  <>
                    <span className="text-2xl font-bold text-slate-800">${plan.price}</span>
                    <span className="text-sm text-slate-400">/mes</span>
                  </>
                ) : (
                  <span className="text-lg font-bold text-slate-800">Desde $79.99/mes</span>
                )}
              </div>
              <ul className="space-y-2 flex-1 mb-4">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-600">
                    <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setSelected(plan.id)}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${plan.popular ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                Elegir {plan.name}
              </button>
            </div>
          ))}
        </div>

        <div className="text-center mt-6 space-y-2">
          <p className="text-xs text-slate-400">
            Descuento del 15–20% pagando anual · 20% de descuento el primer año para clientes fundadores · Un mes gratis por cada referido
          </p>
        </div>

        {selected && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50">
            <div className="bg-white rounded-xl p-6 max-w-sm w-full">
              <h3 className="font-bold text-slate-800 mb-2">
                Activar plan {PLANS.find(p => p.id === selected)?.name}
              </h3>
              <p className="text-sm text-slate-600 mb-4">
                Por ahora el pago se coordina de forma manual. Escríbenos indicando el plan que quieres y te enviaremos los datos de PayPal para completar el pago. Una vez confirmado, activaremos tu suscripción en menos de 24 horas.
              </p>
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Quiero activar el plan ${PLANS.find(p => p.id === selected)?.name}&body=Hola, quiero activar el plan ${PLANS.find(p => p.id === selected)?.name} para mi empresa.`}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium mb-2"
              >
                <MessageCircle className="w-4 h-4" /> Escribir para activar
              </a>
              <button onClick={() => setSelected(null)} className="w-full text-center text-sm text-slate-500 py-2">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="text-center mt-8">
          <button onClick={signOut} className="text-xs text-slate-400 hover:text-slate-600">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
