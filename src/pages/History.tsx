import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCurrency, currentCurrency, formatMoney, fmtNum, fmtDateTime } from '../lib/currency'
import {
  Search,
  RefreshCw,
  History as HistoryIcon,
  ShoppingCart,
  Package,
  Wallet,
  Users,
  FileText,
  ChevronDown,
  Clock,
  UserRound,
  ArrowRight,
  Activity,
  Eye,
  CircleAlert,
} from 'lucide-react'

type AuditLog = {
  id: number
  company_id: string
  user_id: string | null
  user_name: string | null
  action: string
  table_name: string
  record_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

const TABLE_LABELS: Record<string, string> = {
  products: 'Inventario',
  sales: 'Ventas',
  purchases: 'Compras',
  customers: 'Clientes',
  suppliers: 'Proveedores',
  supplier_payments: 'Pagos a proveedores',
  credit_payments: 'Abonos de clientes',
  expenses: 'Gastos operativos',
  expense_categories: 'Categorías de gasto',
  devolutions: 'Devoluciones de clientes',
  purchase_devolutions: 'Devoluciones a proveedores',
  cash_entries: 'Caja y movimientos de dinero',
  kardex: 'Movimientos de inventario',
  profiles: 'Usuarios',
  categories: 'Categorías',
  companies: 'Empresas',
  audit_log: 'Auditoría',
}

const FIELD_LABELS: Record<string, string> = {
  id: 'Identificador',
  product_id: 'Producto',
  product_name: 'Nombre del producto',
  customer_id: 'Identificador del cliente',
  customer_name: 'Cliente',
  supplier_id: 'Identificador del proveedor',
  supplier_name: 'Proveedor',
  sale_id: 'Venta relacionada',
  purchase_id: 'Compra relacionada',
  user_id: 'Identificador del usuario',
  user_name: 'Usuario responsable',
  created_by_name: 'Registrado por',
  name: 'Nombre',
  description: 'Descripción',
  type: 'Tipo de movimiento',
  amount: 'Valor',
  total: 'Total',
  cost: 'Costo unitario',
  unit_cost: 'Costo unitario',
  price: 'Precio unitario',
  subtotal: 'Subtotal',
  quantity: 'Cantidad',
  stock: 'Existencias',
  min_stock: 'Existencias mínimas',
  status: 'Estado',
  items: 'Productos',
  reference_id: 'Registro relacionado',
  reference_type: 'Tipo de referencia',
  created_at: 'Fecha de creación',
  company_id: 'Empresa',
  sku: 'Código del producto',
  category: 'Categoría',
  category_id: 'Categoría',
  category_name: 'Categoría',
  unit: 'Unidad',
  note: 'Observación',
  notes: 'Observación',
  reason: 'Motivo',
  beneficiary: 'Beneficiario',
  reference: 'Referencia / factura',
  expense_date: 'Fecha del comprobante',
  email: 'Correo electrónico',
  role: 'Rol',
  method: 'Forma de pago',
  payment_method: 'Forma de pago',
  refund_method: 'Forma de reembolso',
  due_date: 'Fecha de vencimiento',
  credit_days: 'Días de plazo',
  amount_received: 'Monto recibido',
  discount_amount: 'Descuento',
  tax_amount: 'Impuesto',
  fx_currency: 'Moneda del pago',
  fx_amount: 'Monto recibido en otra moneda',
  fx_rate: 'Tasa de cambio',
}

const ACTION_LABELS: Record<string, string> = {
  INSERT: 'Registro creado',
  UPDATE: 'Registro actualizado',
  DELETE: 'Registro eliminado',
  INSERTED: 'Registro creado',
  UPDATED: 'Registro actualizado',
  DELETED: 'Registro eliminado',
  ANULAR: 'Operación anulada',
  ANULACION: 'Operación anulada',
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function getFieldLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]

  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getTableLabel(table: string) {
  return TABLE_LABELS[table] ?? getFieldLabel(table)
}

function getActionLabel(action: string) {
  const normalized = action.trim().toUpperCase()

  if (ACTION_LABELS[normalized]) {
    return ACTION_LABELS[normalized]
  }

  if (normalized.includes('ANUL')) return 'Operación anulada'
  if (normalized.includes('INSERT')) return 'Registro creado'
  if (normalized.includes('UPDATE')) return 'Registro actualizado'
  if (normalized.includes('DELETE')) return 'Registro eliminado'

  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getEventIcon(table: string) {
  switch (table) {
    case 'sales':
    case 'purchases':
    case 'devolutions':
    case 'purchase_devolutions':
      return ShoppingCart
    case 'products':
    case 'kardex':
      return Package
    case 'cash_entries':
    case 'expenses':
    case 'supplier_payments':
    case 'credit_payments':
      return Wallet
    case 'customers':
    case 'suppliers':
    case 'profiles':
      return Users
    default:
      return FileText
  }
}

function getActionStyle(action: string) {
  const normalized = action.toUpperCase()

  if (normalized.includes('DELETE') || normalized.includes('ANUL')) {
    return 'bg-red-50 text-red-700 ring-red-100'
  }

  if (normalized.includes('INSERT')) {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-100'
  }

  if (normalized.includes('UPDATE')) {
    return 'bg-blue-50 text-blue-700 ring-blue-100'
  }

  return 'bg-gray-100 text-gray-700 ring-gray-200'
}

function formatDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return 'Fecha no disponible'

  return fmtDateTime(date)
}

function formatValue(key: string, value: unknown, ctx?: Record<string, unknown>): string {
  if (value === null || value === undefined || value === '') {
    return 'No registrado'
  }

  if (typeof value === 'boolean') {
    return value ? 'Sí' : 'No'
  }

  if (typeof value === 'number') {
    if (/^(amount|total|subtotal|cost|unit_cost|price|amount_received|discount_amount|tax_amount)$/i.test(key)) {
      return formatMoney(value, currentCurrency())
    }

    // Pago en otra moneda: el monto va en la moneda del cliente y la tasa en la de la empresa
    const fxCur = typeof ctx?.fx_currency === 'string' && /^[A-Za-z]{3}$/.test(ctx.fx_currency) ? ctx.fx_currency.toUpperCase() : null
    if (key === 'fx_amount') {
      return fxCur ? formatMoney(value, fxCur) : fmtNum(value, 2)
    }
    if (key === 'fx_rate') {
      return fxCur ? `1 ${fxCur} = ${formatMoney(value, currentCurrency())}` : formatMoney(value, currentCurrency())
    }

    return fmtNum(value, 3)
  }

  if (typeof value === 'string') {
    if (key === 'status') {
      const statuses: Record<string, string> = {
        recibida: 'Recibida',
        pendiente: 'Pendiente',
        anulada: 'Anulada',
        anulado: 'Anulado',
        completada: 'Completada',
        activa: 'Activa',
        activo: 'Activo',
        inactiva: 'Inactiva',
        ingreso: 'Ingreso',
        egreso: 'Egreso',
        entrada: 'Entrada',
        salida: 'Salida',
      }

      return statuses[value.toLowerCase()] ?? value
    }

    if (key === 'type') {
      const types: Record<string, string> = {
        ingreso: 'Ingreso',
        egreso: 'Egreso',
        entrada: 'Entrada',
        salida: 'Salida',
      }

      return types[value.toLowerCase()] ?? value
    }

    if (
      /^(created_at|updated_at|date|fecha)$/i.test(key) &&
      !Number.isNaN(Date.parse(value))
    ) {
      return formatDate(value)
    }

    return value
  }

  if (Array.isArray(value)) {
    return `${value.length} elemento${value.length === 1 ? '' : 's'}`
  }

  return 'Ver información'
}

function isChange(value: unknown): value is {
  antes: unknown
  despues: unknown
} {
  return (
    isObject(value) &&
    Object.prototype.hasOwnProperty.call(value, 'antes') &&
    Object.prototype.hasOwnProperty.call(value, 'despues')
  )
}

function getChangeEntries(detail: Record<string, unknown>) {
  return Object.entries(detail).filter(([, value]) => isChange(value))
}

function getRegistration(detail: Record<string, unknown>) {
  const registration = detail.registro

  return isObject(registration) ? registration : null
}

function getProductItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []

  return value.filter(isObject)
}

function ProductItems({ value }: { value: unknown }) {
  const items = getProductItems(value)

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No hay productos detallados en este evento.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-3 font-semibold">Producto</th>
            <th className="px-3 py-3 text-right font-semibold">Cantidad</th>
            <th className="px-3 py-3 text-right font-semibold">Costo</th>
            <th className="px-3 py-3 text-right font-semibold">Subtotal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item, index) => (
            <tr key={`${String(item.product_id ?? item.product_name ?? 'item')}-${index}`}>
              <td className="px-3 py-3 font-medium text-gray-800">
                {String(item.product_name ?? item.name ?? 'Producto sin nombre')}
              </td>
              <td className="px-3 py-3 text-right text-gray-700">
                {formatValue('quantity', item.quantity)}
              </td>
              <td className="px-3 py-3 text-right text-gray-700">
                {formatValue('cost', item.cost ?? item.price)}
              </td>
              <td className="px-3 py-3 text-right font-medium text-gray-900">
                {formatValue(
                  'subtotal',
                  item.subtotal ??
                    (typeof item.cost === 'number' &&
                    typeof item.quantity === 'number'
                      ? item.cost * item.quantity
                      : null)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DetailFields({
  data,
  excluded = [],
}: {
  data: Record<string, unknown>
  excluded?: string[]
}) {
  const hidden = new Set([
    'id',
    'company_id',
    'created_at',
    'items',
    ...excluded,
  ])

  const fields = Object.entries(data).filter(
    ([key, value]) =>
      !hidden.has(key) &&
      !isObject(value) &&
      !Array.isArray(value) &&
      value !== null &&
      value !== undefined
  )

  if (fields.length === 0) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(([key, value]) => (
        <div key={key} className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-500">
            {getFieldLabel(key)}
          </p>
          <p className="mt-1 break-words text-sm font-semibold text-gray-900">
            {formatValue(key, value, data)}
          </p>
        </div>
      ))}
    </div>
  )
}

function AuditDetails({ record }: { record: AuditLog }) {
  const detail = record.detail ?? {}
  const changes = getChangeEntries(detail)
  const registration = getRegistration(detail)
  const productChanges = changes.filter(([key]) => key === 'items')
  const regularChanges = changes.filter(([key]) => key !== 'items')

  const visibleRegistration = registration
    ? Object.fromEntries(
        Object.entries(registration).filter(
          ([key]) => !['items', 'id', 'company_id', 'created_at'].includes(key)
        )
      )
    : null

  const hasDetails =
    changes.length > 0 ||
    registration !== null ||
    Object.keys(detail).length > 0

  if (!hasDetails) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
        Este evento no guardó información adicional. El usuario, la acción y el
        registro relacionado sí quedan identificados en el historial.
      </div>
    )
  }

  return (
    <details className="group mt-4 rounded-xl border border-gray-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-gray-50">
        <span className="flex items-center gap-2 text-sm font-semibold text-blue-700">
          <Eye className="h-4 w-4" />
          Ver reporte detallado
        </span>
        <ChevronDown className="h-4 w-4 text-gray-500 transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-5 border-t border-gray-100 p-4">
        {registration && (
          <section className="space-y-3">
            <h4 className="text-sm font-bold text-gray-900">
              Información de la operación
            </h4>

            <DetailFields data={visibleRegistration ?? registration} />

            {registration.items !== undefined && (
              <div className="space-y-2">
                <h5 className="text-sm font-semibold text-gray-700">
                  Productos registrados
                </h5>
                <ProductItems value={registration.items} />
              </div>
            )}
          </section>
        )}

        {regularChanges.length > 0 && (
          <section className="space-y-3">
            <h4 className="text-sm font-bold text-gray-900">
              Cambios realizados
            </h4>

            <div className="space-y-3">
              {regularChanges.map(([key, value]) => {
                if (!isChange(value)) return null

                return (
                  <div
                    key={key}
                    className="rounded-xl border border-gray-200 p-3"
                  >
                    <p className="mb-3 text-sm font-semibold text-gray-800">
                      {getFieldLabel(key)}
                    </p>

                    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <div className="rounded-lg bg-red-50 p-3">
                        <p className="text-xs font-medium text-red-600">
                          Valor anterior
                        </p>
                        <p className="mt-1 break-words text-sm font-semibold text-red-800">
                          {formatValue(key, value.antes)}
                        </p>
                      </div>

                      <ArrowRight className="hidden h-4 w-4 text-gray-400 sm:block" />

                      <div className="rounded-lg bg-emerald-50 p-3">
                        <p className="text-xs font-medium text-emerald-700">
                          Valor nuevo
                        </p>
                        <p className="mt-1 break-words text-sm font-semibold text-emerald-800">
                          {formatValue(key, value.despues)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {productChanges.map(([key, value]) => {
          if (!isChange(value)) return null

          return (
            <section key={key} className="space-y-3">
              <h4 className="text-sm font-bold text-gray-900">
                Productos: antes y después
              </h4>

              <div className="space-y-3">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
                    Productos anteriores
                  </p>
                  <ProductItems value={value.antes} />
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
                    Productos nuevos
                  </p>
                  <ProductItems value={value.despues} />
                </div>
              </div>
            </section>
          )
        })}

        {record.record_id && (
          <section className="space-y-2">
            <h4 className="text-sm font-bold text-gray-900">
              Trazabilidad del registro
            </h4>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">ID completo</p>
              <p className="mt-1 break-all font-mono text-xs text-gray-700">
                {record.record_id}
              </p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(record.record_id ?? '')
                }}
                className="mt-2 text-xs font-semibold text-blue-700 hover:text-blue-900"
              >
                Copiar identificador
              </button>
            </div>
          </section>
        )}

        <details className="rounded-lg border border-gray-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-500">
            Información técnica del evento
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
            {JSON.stringify(detail, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  )
}

export default function History() {
  const { user } = useAuth()
  useCurrency() // carga la moneda de la empresa para mostrar los importes del historial
  const [records, setRecords] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [tableFilter, setTableFilter] = useState('todos')
  const [actionFilter, setActionFilter] = useState('todos')

  const loadHistory = async () => {
    setLoading(true)
    setError('')

    try {
      const { data, error: queryError } = await supabase
        .from('audit_log')
        .select(
          'id, company_id, user_id, user_name, action, table_name, record_id, detail, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(200)

      if (queryError) throw queryError

      setRecords((data ?? []) as AuditLog[])
    } catch (err) {
      console.error('Error cargando historial:', err)
      setError(
        'No se pudo cargar el historial. Verifica tus permisos de acceso e inténtalo de nuevo.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) {
      void loadHistory()
    } else {
      setRecords([])
      setLoading(false)
    }
  }, [user])

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase()

    return records.filter((record) => {
      const matchesTable =
        tableFilter === 'todos' || record.table_name === tableFilter

      const normalizedAction = record.action.toUpperCase()
      const matchesAction =
        actionFilter === 'todos' ||
        (actionFilter === 'creaciones' &&
          normalizedAction.includes('INSERT')) ||
        (actionFilter === 'actualizaciones' &&
          normalizedAction.includes('UPDATE')) ||
        (actionFilter === 'anulaciones' &&
          (normalizedAction.includes('ANUL') ||
            normalizedAction.includes('DELETE')))

      const searchableText = [
        record.user_name,
        record.action,
        record.table_name,
        record.record_id,
        JSON.stringify(record.detail ?? {}),
      ]
        .join(' ')
        .toLowerCase()

      return (
        matchesTable &&
        matchesAction &&
        (!term || searchableText.includes(term))
      )
    })
  }, [records, search, tableFilter, actionFilter])

  const tableOptions = useMemo(
    () => [...new Set(records.map((record) => record.table_name))].sort(),
    [records]
  )

  const todayCount = useMemo(() => {
    const today = new Date()

    return records.filter((record) => {
      const date = new Date(record.created_at)

      return (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
      )
    }).length
  }, [records])

  const creationCount = records.filter((record) =>
    record.action.toUpperCase().includes('INSERT')
  ).length

  const updateCount = records.filter((record) =>
    record.action.toUpperCase().includes('UPDATE')
  ).length

  return (
    <div className="min-h-full space-y-6 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-3 text-white shadow-sm">
              <HistoryIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                Auditoría del sistema
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Registro de operaciones, cambios y responsables de tu empresa.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadHistory()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
          />
          Actualizar
        </button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">
              Eventos cargados
            </p>
            <Activity className="h-5 w-5 text-blue-600" />
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {records.length}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Últimos 200 eventos registrados
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">
              Actividad de hoy
            </p>
            <Clock className="h-5 w-5 text-violet-600" />
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {todayCount}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Eventos en la fecha actual
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Creaciones</p>
            <FileText className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {creationCount}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Registros nuevos identificados
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">
              Actualizaciones
            </p>
            <RefreshCw className="h-5 w-5 text-amber-600" />
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {updateCount}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Cambios identificados
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-gray-900">
            Buscar y filtrar actividad
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Encuentra operaciones por responsable, identificador o información registrada.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar usuario, proveedor, producto o ID..."
              className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <select
            value={tableFilter}
            onChange={(event) => setTableFilter(event.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="todos">Todos los módulos</option>
            {tableOptions.map((table) => (
              <option key={table} value={table}>
                {getTableLabel(table)}
              </option>
            ))}
          </select>

          <select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="todos">Todas las acciones</option>
            <option value="creaciones">Creaciones</option>
            <option value="actualizaciones">Actualizaciones</option>
            <option value="anulaciones">Anulaciones y eliminaciones</option>
          </select>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4 text-sm">
          <span className="text-gray-500">Resultados de la búsqueda</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700">
            {filteredRecords.length} eventos
          </span>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">No se pudo cargar la auditoría</p>
            <p className="mt-1">{error}</p>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="mt-2 font-semibold underline"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-3 font-medium text-gray-700">
            Cargando registros de auditoría...
          </p>
        </div>
      ) : !error && filteredRecords.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
          <HistoryIcon className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 font-semibold text-gray-900">
            {search || tableFilter !== 'todos' || actionFilter !== 'todos'
              ? 'No encontramos resultados'
              : 'Todavía no hay actividad registrada'}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Prueba con otros términos o filtros, o registra una operación para ver su actividad.
          </p>
          {(search || tableFilter !== 'todos' || actionFilter !== 'todos') && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setTableFilter('todos')
                setActionFilter('todos')
              }}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : !error ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Activity className="h-4 w-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-700">
              Registro cronológico
            </h2>
            <span className="text-xs text-gray-400">
              · Del más reciente al más antiguo
            </span>
          </div>

          <div className="space-y-3">
            {filteredRecords.map((record) => {
              const EventIcon = getEventIcon(record.table_name)

              return (
                <article
                  key={record.id}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-gray-300 hover:shadow-md"
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="shrink-0 rounded-xl bg-gray-100 p-3 text-gray-600">
                        <EventIcon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-gray-900">
                            {getActionLabel(record.action)}
                          </h3>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${getActionStyle(record.action)}`}
                          >
                            {getTableLabel(record.table_name)}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="flex items-start gap-2">
                            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                            <div className="min-w-0">
                              <p className="text-xs text-gray-500">
                                Responsable de la acción
                              </p>
                              <p className="break-words text-sm font-medium text-gray-800">
                                {record.user_name || 'Usuario no identificado'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                            <div>
                              <p className="text-xs text-gray-500">
                                Fecha y hora
                              </p>
                              <time
                                dateTime={record.created_at}
                                className="text-sm font-medium text-gray-800"
                              >
                                {formatDate(record.created_at)}
                              </time>
                            </div>
                          </div>
                        </div>

                        {record.record_id && (
                          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2">
                            <p className="text-xs text-gray-500">
                              ID de la operación
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-gray-700">
                              {record.record_id}
                            </p>
                          </div>
                        )}

                        <AuditDetails record={record} />
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      <footer className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          La auditoría muestra los datos capturados por cada evento. Si un evento
          no guardó el nombre de un cliente o proveedor, esa información no se
          puede reconstruir a partir de ese evento solamente. Se muestran los
          últimos 200 registros permitidos por los permisos de acceso.
        </p>
      </footer>
    </div>
  )
}
