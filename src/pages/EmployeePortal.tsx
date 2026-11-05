import { useEffect, useState } from 'react'
import {
  Award,
  Calendar,
  CheckCircle2,
  DollarSign,
  Download,
  MapPin,
  MessageCircle,
  Phone,
  Target,
  TrendingUp,
  UserCheck,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { getEmployeeSelfServiceSummary } from '../lib/innovationsRepo'
import type { EmployeeTargetSummary } from '../types'

interface EmployeePortalProps {
  onNavigate?: (page: string) => void
}

export default function EmployeePortal({ onNavigate }: EmployeePortalProps) {
  const { user } = useAuth()
  const { fmt } = useCurrency()
  const [summary, setSummary] = useState<EmployeeTargetSummary>(getEmployeeSelfServiceSummary())

  const mockAssignedClients = [
    {
      name: 'Supermercado Central',
      contact: 'Don Fabio',
      phone: '+57 311 223 4455',
      address: 'Calle 10 #15-20',
      debt: 450000,
      days_pending: 12,
    },
    {
      name: 'Minimarket Los Pinos',
      contact: 'Sra. Teresa',
      phone: '+57 320 554 6677',
      address: 'Av. Circunvalar #8-40',
      debt: 180000,
      days_pending: 4,
    },
    {
      name: 'Panadería Trigo Limpio',
      contact: 'Carlos Gómez',
      phone: '+57 318 998 7766',
      address: 'Carrera 7 #22-10',
      debt: 0,
      days_pending: 0,
    },
  ]

  function openWhatsApp(phone: string, clientName: string) {
    const text = `Hola ${clientName}, le saluda ${user?.full_name || 'su asesor comercial'} de Inventario Pro. ¿Desea que tomemos el pedido de esta semana?`
    window.open(`https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-100 text-emerald-800 rounded-xl">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Portal de Autoservicio del Vendedor
            </h1>
            <p className="text-xs text-slate-500">
              Bienvenido, <strong className="text-slate-800">{user?.full_name || summary.employee_name}</strong> •{' '}
              {summary.current_month_label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onNavigate && (
            <button
              onClick={() => onNavigate('pos')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
            >
              Abrir Mostrador POS
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards: Ventas y Comisiones */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Meta de Ventas */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Target className="w-4 h-4 text-emerald-600" /> Meta de Ventas
            </span>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              {summary.sales_progress_pct}%
            </span>
          </div>
          <p className="text-lg font-black text-slate-900">{fmt(summary.sales_achieved)}</p>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, summary.sales_progress_pct)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400">Meta: {fmt(summary.sales_target)}</p>
        </div>

        {/* Comisiones Ganadas */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-2">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-blue-600" /> Comisiones Ganadas
          </span>
          <p className="text-lg font-black text-slate-900">{fmt(summary.earned_commission_total)}</p>
          <div className="flex justify-between text-[11px] text-slate-500 pt-1">
            <span>Pagado: {fmt(summary.paid_commission_total)}</span>
            <span className="font-bold text-blue-600">
              Saldo: {fmt(summary.pending_commission_balance)}
            </span>
          </div>
        </div>

        {/* Cobranza Cartera */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-2">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-purple-600" /> Recaudo de Cartera
          </span>
          <p className="text-lg font-black text-slate-900">{fmt(summary.collections_achieved)}</p>
          <p className="text-[11px] text-slate-400">Meta mes: {fmt(summary.collections_target)}</p>
        </div>

        {/* Clientes Asignados */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-2">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-amber-600" /> Cartera de Clientes
          </span>
          <p className="text-lg font-black text-slate-900">
            {summary.assigned_customers_count} <span className="text-xs font-normal text-slate-500">negocios</span>
          </p>
          <p className="text-[11px] text-amber-700 font-medium">
            {summary.pending_visits_count} visitas programadas hoy
          </p>
        </div>
      </div>

      {/* Clientes Asignados en Ruta Hoy */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Clientes Asignados en tu Zona</h2>
            <p className="text-xs text-slate-500">Contacta o visita con un solo toque desde tu teléfono.</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {mockAssignedClients.map((client, idx) => (
            <div key={idx} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">{client.name}</p>
                <p className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                  <span>Contacto: {client.contact}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" /> {client.address}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-800">
                    {client.debt > 0 ? (
                      <span className="text-red-700">Deuda: {fmt(client.debt)}</span>
                    ) : (
                      <span className="text-emerald-700 font-semibold">Al día</span>
                    )}
                  </p>
                  {client.days_pending > 0 && (
                    <p className="text-[10px] text-slate-400">{client.days_pending} días de crédito</p>
                  )}
                </div>

                <button
                  onClick={() => openWhatsApp(client.phone, client.contact)}
                  className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition-colors cursor-pointer"
                  title="Escribir por WhatsApp"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
