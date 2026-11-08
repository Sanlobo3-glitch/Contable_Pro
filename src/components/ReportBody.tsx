import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import {
  formatDate,
  formatMoney,
  isAnulled,
  movementLabel,
  normalizeItems,
  num,
  signedAmount,
  sum,
  type Tab,
} from '../lib/reportUtils'

/* -------------------------------------------------------------------------- */
/*                                   Tipos                                    */
/* -------------------------------------------------------------------------- */

export type ReportBodyProps = {
  tab: Tab
  loading: boolean
  sales: any[]
  purchases: any[]
  expenses?: any[]
  cash: any[]
  devolutions: any[]
  purchaseDevolutions?: any[]
  kardex: any[]
}

/* -------------------------------------------------------------------------- */
/*                                 Estilos                                    */
/* -------------------------------------------------------------------------- */

const TH =
  'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 whitespace-nowrap'
const TD = 'px-3 py-2 text-sm text-slate-700 border-b border-slate-100 align-top'
const TD_NUM = `${TD} text-right tabular-nums whitespace-nowrap`
const CARD = 'rounded-xl border border-slate-200 bg-white p-4'

/* -------------------------------------------------------------------------- */
/*                              Piezas reutilizables                          */
/* -------------------------------------------------------------------------- */

function Kpi({
  label,
  value,
  hint,
  tone = 'slate',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'slate' | 'green' | 'red' | 'blue'
}) {
  const tones: Record<'slate' | 'green' | 'red' | 'blue', string> = {
    slate: 'text-slate-800',
    green: 'text-emerald-600',
    red: 'text-rose-600',
    blue: 'text-blue-600',
  }
  return (
    <div className={CARD}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  )
}

function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0 text-right">{right}</div> : null}
      </header>
     <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-400">{text}</p>
}

function EstadoBadge({ status }: { status: unknown }) {
  const texto = String(status ?? '').trim()
  if (!texto) return <span className="text-xs text-slate-400">—</span>
  const anulado = isAnulled(texto)
  const clase = anulado
    ? 'border-rose-200 bg-rose-50 text-rose-600'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${clase}`}
    >
      {texto}
    </span>
  )
}

function Signo({ valor, positivo, negativo }: { valor: number; positivo: string; negativo: string }) {
  const clase = valor < 0 ? 'text-rose-600' : 'text-emerald-700'
  return <span className={clase}>{valor < 0 ? negativo : positivo}</span>
}

/* -------------------------------------------------------------------------- */
/*                              Componente raiz                               */
/* -------------------------------------------------------------------------- */

export default function ReportBody({
  tab,
  loading,
  sales,
  purchases,
  expenses = [],
  cash,
  devolutions,
  purchaseDevolutions = [],
  kardex,
}: ReportBodyProps) {
  const [currency, setCurrency] = useState('USD')
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    let activo = true
    try {
      supabase
        .from('company_config')
        .select('name, currency')
        .limit(1)
        .maybeSingle()
        .then(
          (res: any) => {
            if (!activo) return
            if (res?.data?.currency) setCurrency(String(res.data.currency))
            if (res?.data?.name) setCompanyName(String(res.data.name))
          },
          () => {
            /* la moneda por defecto es suficiente si falla la consulta */
          },
        )
    } catch {
      /* idem */
    }
    return () => {
      activo = false
    }
  }, [])

  const money = (valor: unknown) => formatMoney(valor, currency)

  /* ----------------------- Ventas / compras / gastos ----------------------- */

  const ventasActivas = useMemo(() => (sales || []).filter((s: any) => !isAnulled(s?.status)), [sales])
  const comprasActivas = useMemo(
    () => (purchases || []).filter((p: any) => !isAnulled(p?.status)),
    [purchases],
  )
  const gastosActivos = useMemo(
    () => (expenses || []).filter((g: any) => !isAnulled(g?.status)),
    [expenses],
  )
  const devProveedoresActivas = useMemo(
    () => (purchaseDevolutions || []).filter((d: any) => !isAnulled(d?.status)),
    [purchaseDevolutions],
  )

  const totalVentas = useMemo(() => sum(ventasActivas, (s: any) => num(s?.total)), [ventasActivas])
  const totalCompras = useMemo(() => sum(comprasActivas, (p: any) => num(p?.total)), [comprasActivas])
  const totalGastos = useMemo(() => sum(gastosActivos, (g: any) => num(g?.amount)), [gastosActivos])
  const totalGastosEfectivo = useMemo(
    () => sum(gastosActivos.filter((g: any) => g?.method === 'efectivo'), (g: any) => num(g?.amount)),
    [gastosActivos],
  )
  const totalGastosBancos = Math.max(0, totalGastos - totalGastosEfectivo)
  const totalDevoluciones = useMemo(
    () => sum(devolutions, (d: any) => num(d?.amount)),
    [devolutions],
  )
  const totalDevProveedores = useMemo(
    () => sum(devProveedoresActivas, (d: any) => num(d?.amount)),
    [devProveedoresActivas],
  )
  const utilidad = totalVentas - (totalCompras - totalDevProveedores) - totalDevoluciones - totalGastos

  const anuladasVentas = (sales || []).length - ventasActivas.length
  const anuladasCompras = (purchases || []).length - comprasActivas.length
  const anuladosGastos = (expenses || []).length - gastosActivos.length

  const gastosPorCategoria = useMemo(() => {
    const mapa = new Map<string, { name: string; count: number; total: number }>()
    for (const g of gastosActivos) {
      const cat = String(g?.category_name ?? '').trim() || 'Otros gastos'
      const cur = mapa.get(cat) ?? { name: cat, count: 0, total: 0 }
      cur.count += 1
      cur.total += num(g?.amount)
      mapa.set(cat, cur)
    }
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total)
  }, [gastosActivos])

  /* --------------------------------- Caja ---------------------------------- */

  const movimientosCaja = useMemo(
    () =>
      (cash || []).map((c: any) => ({
        fecha: c?.created_at,
        tipo: String(c?.type ?? ''),
        etiqueta: movementLabel(c?.type),
        descripcion: String(c?.description ?? ''),
        referencia: c?.reference_type
          ? `${c.reference_type}${c.reference_id ? ` #${c.reference_id}` : ''}`
          : '',
        monto: signedAmount(c?.type, c?.amount),
      })),
    [cash],
  )

  const totalEntradas = useMemo(
    () => sum(movimientosCaja.filter((m) => m.monto > 0), (m) => m.monto),
    [movimientosCaja],
  )
  const totalSalidas = useMemo(
    () => sum(movimientosCaja.filter((m) => m.monto < 0), (m) => Math.abs(m.monto)),
    [movimientosCaja],
  )
  const saldoCaja = useMemo(() => sum(movimientosCaja, (m) => m.monto), [movimientosCaja])

  const cajaConSaldo = useMemo(() => {
    let running = 0
    return movimientosCaja.map((m) => {
      running += m.monto
      return { ...m, saldo: running }
    })
  }, [movimientosCaja])

  /* ------------------------------- Productos -------------------------------- */

  const topProductos = useMemo(() => {
    const mapa = new Map<string, { name: string; quantity: number; total: number }>()
    for (const venta of ventasActivas) {
      for (const item of normalizeItems(venta?.items)) {
        const actual = mapa.get(item.name) ?? { name: item.name, quantity: 0, total: 0 }
        actual.quantity += item.quantity
        actual.total += item.total
        mapa.set(item.name, actual)
      }
    }
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total).slice(0, 8)
  }, [ventasActivas])

  const ventasPorMetodo = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const venta of ventasActivas) {
      const metodo = String(venta?.payment_method ?? '').trim() || 'Sin especificar'
      mapa.set(metodo, (mapa.get(metodo) ?? 0) + num(venta?.total))
    }
    return Array.from(mapa.entries())
      .map(([metodo, total]) => ({ metodo, total }))
      .sort((a, b) => b.total - a.total)
  }, [ventasActivas])

  const cobrosOtraMoneda = useMemo(() => {
    const mapa = new Map<string, { code: string; ventas: number; recibido: number; equivalente: number }>()
    for (const venta of ventasActivas) {
      const code = String(venta?.fx_currency ?? '').trim().toUpperCase()
      const monto = num(venta?.fx_amount)
      const tasa = num(venta?.fx_rate)
      if (!code || !(monto > 0) || !(tasa > 0)) continue
      const actual = mapa.get(code) ?? { code, ventas: 0, recibido: 0, equivalente: 0 }
      actual.ventas += 1
      actual.recibido += monto
      actual.equivalente += monto * tasa
      mapa.set(code, actual)
    }
    return Array.from(mapa.values()).sort((a, b) => b.equivalente - a.equivalente)
  }, [ventasActivas])

  const devolucionesPorProducto = useMemo(() => {
    const mapa = new Map<string, { name: string; cantidad: number; monto: number }>()
    for (const dev of devolutions || []) {
      const name = String(dev?.product_name ?? '').trim() || 'Producto'
      const actual = mapa.get(name) ?? { name, cantidad: 0, monto: 0 }
      actual.cantidad += num(dev?.quantity)
      actual.monto += num(dev?.amount)
      mapa.set(name, actual)
    }
    return Array.from(mapa.values()).sort((a, b) => b.monto - a.monto).slice(0, 8)
  }, [devolutions])

  const kardexPorProducto = useMemo(() => {
    const mapa = new Map<string, { name: string; entradas: number; salidas: number; saldo: number }>()
    for (const mov of kardex || []) {
      const name = String(mov?.product_name ?? '').trim() || 'Producto'
      const actual = mapa.get(name) ?? { name, entradas: 0, salidas: 0, saldo: 0 }
      const cantidad = signedAmount(mov?.type, mov?.quantity)
      if (cantidad >= 0) actual.entradas += cantidad
      else actual.salidas += Math.abs(cantidad)
      actual.saldo = num(mov?.balance) || actual.saldo
      mapa.set(name, actual)
    }
    return Array.from(mapa.values()).sort((a, b) => b.saldo - a.saldo)
  }, [kardex])

  /* --------------------------------- Render --------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-slate-400">Cargando datos del período…</p>
      </div>
    )
  }

  const hayDatos =
    (sales || []).length > 0 ||
    (purchases || []).length > 0 ||
    (expenses || []).length > 0 ||
    (cash || []).length > 0 ||
    (devolutions || []).length > 0 ||
    (purchaseDevolutions || []).length > 0 ||
    (kardex || []).length > 0

  if (!hayDatos) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center">
        <p className="text-sm font-medium text-slate-600">Sin registros en el periodo seleccionado</p>
        <p className="mt-1 text-xs text-slate-500">
          Cambia la fecha de referencia o el tipo de período para ver información
          {companyName ? ` de ${companyName}` : ''}.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ============================== RESUMEN ============================== */}
      {tab === 'resumen' && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Ventas" value={money(totalVentas)} hint={`${ventasActivas.length} documentos`} tone="blue" />
            <Kpi
              label="Compras"
              value={money(totalCompras)}
              hint={
                totalDevProveedores > 0
                  ? `${comprasActivas.length} doc. · Dev. prov.: ${money(totalDevProveedores)}`
                  : `${comprasActivas.length} documentos`
              }
              tone="red"
            />
            <Kpi
              label="Gastos operativos"
              value={money(totalGastos)}
              hint={`${gastosActivos.length} documentos`}
              tone="red"
            />
            <Kpi
              label="Flujo comercial neto"
              value={money(utilidad)}
              hint="Ventas − compras netas − devoluciones − gastos"
              tone={utilidad >= 0 ? 'green' : 'red'}
            />
            <Kpi label="Devoluciones clientes" value={money(totalDevoluciones)} hint={`${(devolutions || []).length} casos`} tone="red" />
            <Kpi label="Entradas de caja" value={money(totalEntradas)} tone="green" />
            <Kpi label="Salidas de caja" value={money(totalSalidas)} tone="red" />
            <Kpi
              label="Saldo neto en caja"
              value={money(saldoCaja)}
              hint="Entradas − salidas de efectivo"
              tone={saldoCaja >= 0 ? 'green' : 'red'}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Productos más vendidos" subtitle="Por monto total">
              {topProductos.length === 0 ? (
                <Empty text="Sin detalle de productos en las ventas del período" />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={TH}>Producto</th>
                      <th className={`${TH} text-right`}>Cantidad</th>
                      <th className={`${TH} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProductos.map((p) => (
                      <tr key={p.name}>
                        <td className={TD}>{p.name}</td>
                        <td className={TD_NUM}>{p.quantity}</td>
                        <td className={TD_NUM}>{money(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Ventas por método de pago">
              {ventasPorMetodo.length === 0 ? (
                <Empty text="Sin ventas en el período" />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={TH}>Método</th>
                      <th className={`${TH} text-right`}>Ventas</th>
                      <th className={`${TH} text-right`}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventasPorMetodo.map((m) => {
                      const pct = totalVentas > 0 ? (m.total / totalVentas) * 100 : 0
                      return (
                        <tr key={m.metodo}>
                          <td className={TD}>{m.metodo}</td>
                          <td className={TD_NUM}>{money(m.total)}</td>
                          <td className={TD_NUM}>{pct.toFixed(1)}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>

          {cobrosOtraMoneda.length > 0 && (
            <Panel title="Cobros en otra moneda">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Moneda</th>
                    <th className={`${TH} text-right`}>Ventas</th>
                    <th className={`${TH} text-right`}>Recibido</th>
                    <th className={`${TH} text-right`}>Equivalente</th>
                    <th className={`${TH} text-right`}>Tasa promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {cobrosOtraMoneda.map((c) => (
                    <tr key={c.code}>
                      <td className={TD}>{c.code}</td>
                      <td className={TD_NUM}>{c.ventas}</td>
                      <td className={TD_NUM}>{formatMoney(c.recibido, c.code)}</td>
                      <td className={TD_NUM}>{money(c.equivalente)}</td>
                      <td className={TD_NUM}>{money(c.recibido > 0 ? c.equivalente / c.recibido : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-400">«Equivalente» es lo recibido convertido con la tasa de cada venta; puede superar el total si hubo cambio.</p>
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Devoluciones por producto">
              {devolucionesPorProducto.length === 0 ? (
                <Empty text="Sin devoluciones registradas" />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={TH}>Producto</th>
                      <th className={`${TH} text-right`}>Cantidad</th>
                      <th className={`${TH} text-right`}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devolucionesPorProducto.map((d) => (
                      <tr key={d.name}>
                        <td className={TD}>{d.name}</td>
                        <td className={TD_NUM}>{d.cantidad}</td>
                        <td className={TD_NUM}>{money(d.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Inventario por producto (kardex)">
              {kardexPorProducto.length === 0 ? (
                <Empty text="Sin movimientos de kardex en el período" />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={TH}>Producto</th>
                      <th className={`${TH} text-right`}>Entradas</th>
                      <th className={`${TH} text-right`}>Salidas</th>
                      <th className={`${TH} text-right`}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kardexPorProducto.map((k) => (
                      <tr key={k.name}>
                        <td className={TD}>{k.name}</td>
                        <td className={TD_NUM}>{k.entradas}</td>
                        <td className={TD_NUM}>{k.salidas}</td>
                        <td className={TD_NUM}>{k.saldo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>

          {gastosPorCategoria.length > 0 && (
            <Panel title="Gastos operativos por categoría" right={<p className="text-sm font-bold text-rose-600">{money(totalGastos)}</p>}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Categoría</th>
                    <th className={`${TH} text-right`}>Registros</th>
                    <th className={`${TH} text-right`}>Monto</th>
                    <th className={`${TH} text-right`}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {gastosPorCategoria.map((g) => (
                    <tr key={g.name}>
                      <td className={TD}>{g.name}</td>
                      <td className={TD_NUM}>{g.count}</td>
                      <td className={TD_NUM}>{money(g.total)}</td>
                      <td className={TD_NUM}>{totalGastos > 0 ? ((g.total / totalGastos) * 100).toFixed(1) : '0.0'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {(anuladasVentas > 0 || anuladasCompras > 0 || anuladosGastos > 0) && (
            <p className="text-[11px] text-slate-500">
              Documentos anulados excluidos de los totales: {anuladasVentas} venta(s), {anuladasCompras} compra(s) y {anuladosGastos} gasto(s).
            </p>
          )}
        </>
      )}

      {/* =============================== VENTAS =============================== */}
      {tab === 'ventas' && (
        <Panel
          title="Detalle de ventas"
          subtitle={`${ventasActivas.length} documentos válidos`}
          right={<p className="text-sm font-bold text-slate-800">{money(totalVentas)}</p>}
        >
          {ventasActivas.length === 0 ? (
            <Empty text="Sin ventas en el período" />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Cliente</th>
                  <th className={`${TH} text-right`}>Items</th>
                  <th className={TH}>Pago</th>
                  <th className={TH}>Estado</th>
                  <th className={`${TH} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ventasActivas.map((v: any, i: number) => (
                  <tr key={v?.id ?? i}>
                    <td className={TD}>{formatDate(v?.created_at)}</td>
                    <td className={TD}>{v?.customer_name || '—'}</td>
                    <td className={TD_NUM}>{normalizeItems(v?.items).length}</td>
                    <td className={TD}>{v?.payment_method || '—'}</td>
                    <td className={TD}>
                      <EstadoBadge status={v?.status} />
                    </td>
                    <td className={TD_NUM}>{money(v?.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={`${TD} font-semibold`} colSpan={5}>
                    Total
                  </td>
                  <td className={`${TD_NUM} font-semibold`}>{money(totalVentas)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Panel>
      )}

      {/* ============================== COMPRAS ============================== */}
      {tab === 'compras' && (
        <Panel
          title="Detalle de compras"
          subtitle={`${comprasActivas.length} documentos válidos`}
          right={<p className="text-sm font-bold text-slate-800">{money(totalCompras)}</p>}
        >
          {comprasActivas.length === 0 ? (
            <Empty text="Sin compras en el período" />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Proveedor</th>
                  <th className={`${TH} text-right`}>Items</th>
                  <th className={TH}>Pago</th>
                  <th className={TH}>Estado</th>
                  <th className={`${TH} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {comprasActivas.map((p: any, i: number) => (
                  <tr key={p?.id ?? i}>
                    <td className={TD}>{formatDate(p?.created_at)}</td>
                    <td className={TD}>{p?.supplier_name || '—'}</td>
                    <td className={TD_NUM}>{normalizeItems(p?.items).length}</td>
                    <td className={`${TD} capitalize`}>{p?.payment_method || 'efectivo'}</td>
                    <td className={TD}>
                      <EstadoBadge status={p?.status} />
                    </td>
                    <td className={TD_NUM}>{money(p?.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={`${TD} font-semibold`} colSpan={5}>
                    Total
                  </td>
                  <td className={`${TD_NUM} font-semibold`}>{money(totalCompras)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Panel>
      )}

      {/* ============================== GASTOS =============================== */}
      {tab === 'gastos' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Kpi label="Total gastos operativos" value={money(totalGastos)} hint={`${gastosActivos.length} documentos activos`} tone="red" />
            <Kpi label="Pagados en efectivo (Caja)" value={money(totalGastosEfectivo)} tone="slate" />
            <Kpi label="Pagados por bancos" value={money(totalGastosBancos)} hint="Transferencia y tarjeta" tone="blue" />
          </div>

          {gastosPorCategoria.length > 0 && (
            <Panel title="Resumen por categoría">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Categoría</th>
                    <th className={`${TH} text-right`}>Comprobantes</th>
                    <th className={`${TH} text-right`}>Total</th>
                    <th className={`${TH} text-right`}>Participación</th>
                  </tr>
                </thead>
                <tbody>
                  {gastosPorCategoria.map((g) => (
                    <tr key={g.name}>
                      <td className={TD}>{g.name}</td>
                      <td className={TD_NUM}>{g.count}</td>
                      <td className={TD_NUM}>{money(g.total)}</td>
                      <td className={TD_NUM}>{totalGastos > 0 ? ((g.total / totalGastos) * 100).toFixed(1) : '0.0'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel
            title="Detalle de gastos operativos"
            subtitle={`${gastosActivos.length} documentos válidos`}
            right={<p className="text-sm font-bold text-rose-600">{money(totalGastos)}</p>}
          >
            {gastosActivos.length === 0 ? (
              <Empty text="Sin gastos operativos en el período" />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Fecha</th>
                    <th className={TH}>Categoría</th>
                    <th className={TH}>Concepto</th>
                    <th className={TH}>Beneficiario</th>
                    <th className={TH}>Pago</th>
                    <th className={`${TH} text-right`}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {gastosActivos.map((g: any, i: number) => (
                    <tr key={g?.id ?? i}>
                      <td className={TD}>{formatDate(g?.expense_date || g?.created_at)}</td>
                      <td className={TD}>{g?.category_name || '—'}</td>
                      <td className={TD}>{g?.description || '—'}</td>
                      <td className={TD}>{g?.beneficiary || '—'}</td>
                      <td className={`${TD} capitalize`}>{g?.method || '—'}</td>
                      <td className={TD_NUM}>{money(g?.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={`${TD} font-semibold`} colSpan={5}>
                      Total gastos
                    </td>
                    <td className={`${TD_NUM} font-semibold`}>{money(totalGastos)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Panel>
        </>
      )}

      {/* ================================ CAJA ================================ */}
      {tab === 'caja' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Kpi label="Entradas" value={money(totalEntradas)} tone="green" />
            <Kpi label="Salidas" value={money(totalSalidas)} tone="red" />
            <Kpi
              label="Saldo del periodo"
              value={money(saldoCaja)}
              tone={saldoCaja >= 0 ? 'green' : 'red'}
            />
          </div>

          <Panel title="Movimientos de caja" subtitle={`${cajaConSaldo.length} movimientos`}>
            {cajaConSaldo.length === 0 ? (
              <Empty text="Sin movimientos de caja en el período" />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Fecha</th>
                    <th className={TH}>Tipo</th>
                    <th className={TH}>Descripción</th>
                    <th className={TH}>Referencia</th>
                    <th className={`${TH} text-right`}>Monto</th>
                    <th className={`${TH} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {cajaConSaldo.map((m, i) => (
                    <tr key={i}>
                      <td className={TD}>{formatDate(m.fecha)}</td>
                      <td className={TD}>
                        <Signo valor={m.monto} positivo="Entrada" negativo="Salida" />
                      </td>
                      <td className={TD}>{m.descripcion || '—'}</td>
                      <td className={TD}>{m.referencia || '—'}</td>
                      <td className={TD_NUM}>
                        <Signo
                          valor={m.monto}
                          positivo={`+ ${money(m.monto)}`}
                          negativo={`- ${money(Math.abs(m.monto))}`}
                        />
                      </td>
                      <td className={TD_NUM}>{money(m.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      {/* =========================== DEVOLUCIONES ============================ */}
      {tab === 'devoluciones' && (
        <>
          <Panel
            title="Devoluciones de clientes (ventas)"
            subtitle={`${(devolutions || []).length} casos`}
            right={<p className="text-sm font-bold text-rose-600">{money(totalDevoluciones)}</p>}
          >
            {(devolutions || []).length === 0 ? (
              <Empty text="Sin devoluciones de clientes en el período" />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Fecha</th>
                    <th className={TH}>Producto</th>
                    <th className={`${TH} text-right`}>Cantidad</th>
                    <th className={TH}>Reembolso</th>
                    <th className={TH}>Motivo</th>
                    <th className={TH}>Venta</th>
                    <th className={`${TH} text-right`}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(devolutions || []).map((d: any, i: number) => (
                    <tr key={d?.id ?? i}>
                      <td className={TD}>{formatDate(d?.created_at)}</td>
                      <td className={TD}>{d?.product_name || '—'}</td>
                      <td className={TD_NUM}>{num(d?.quantity)}</td>
                      <td className={`${TD} capitalize`}>{d?.refund_method || 'efectivo'}</td>
                      <td className={TD}>{d?.reason || '—'}</td>
                      <td className={TD}>{d?.sale_id ? `VTA-${String(d.sale_id).slice(0, 8).toUpperCase()}` : '—'}</td>
                      <td className={TD_NUM}>{money(d?.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={`${TD} font-semibold`} colSpan={6}>
                      Total devuelto a clientes
                    </td>
                    <td className={`${TD_NUM} font-semibold`}>{money(totalDevoluciones)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Panel>

          <Panel
            title="Devoluciones a proveedores (compras)"
            subtitle={`${devProveedoresActivas.length} casos activos`}
            right={<p className="text-sm font-bold text-emerald-700">{money(totalDevProveedores)}</p>}
          >
            {devProveedoresActivas.length === 0 ? (
              <Empty text="Sin devoluciones a proveedores en el período" />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Fecha</th>
                    <th className={TH}>Proveedor</th>
                    <th className={TH}>Producto</th>
                    <th className={`${TH} text-right`}>Cantidad</th>
                    <th className={TH}>Reintegro</th>
                    <th className={TH}>Motivo</th>
                    <th className={`${TH} text-right`}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {devProveedoresActivas.map((d: any, i: number) => (
                    <tr key={d?.id ?? i}>
                      <td className={TD}>{formatDate(d?.created_at)}</td>
                      <td className={TD}>{d?.supplier_name || 'Proveedor general'}</td>
                      <td className={TD}>{d?.product_name || '—'}</td>
                      <td className={TD_NUM}>{num(d?.quantity)}</td>
                      <td className={`${TD} capitalize`}>{d?.refund_method === 'credito' ? 'Cuentas por pagar' : (d?.refund_method || '—')}</td>
                      <td className={TD}>{d?.reason || '—'}</td>
                      <td className={TD_NUM}>{money(d?.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={`${TD} font-semibold`} colSpan={6}>
                      Total devuelto a proveedores
                    </td>
                    <td className={`${TD_NUM} font-semibold`}>{money(totalDevProveedores)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Panel>
        </>
      )}

      {/* ============================== KARDEX =============================== */}
      {tab === 'kardex' && (
        <>
          <Panel title="Existencias por producto" subtitle={`${kardexPorProducto.length} productos`}>
            {kardexPorProducto.length === 0 ? (
              <Empty text="Sin movimientos de kardex en el período" />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Producto</th>
                    <th className={`${TH} text-right`}>Entradas</th>
                    <th className={`${TH} text-right`}>Salidas</th>
                    <th className={`${TH} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {kardexPorProducto.map((k) => (
                    <tr key={k.name}>
                      <td className={TD}>{k.name}</td>
                      <td className={TD_NUM}>{k.entradas}</td>
                      <td className={TD_NUM}>{k.salidas}</td>
                      <td className={TD_NUM}>{k.saldo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Movimientos de kardex" subtitle={`${(kardex || []).length} registros`}>
            {(kardex || []).length === 0 ? (
              <Empty text="Sin movimientos de kardex en el período" />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Fecha</th>
                    <th className={TH}>Producto</th>
                    <th className={TH}>Tipo</th>
                    <th className={`${TH} text-right`}>Cantidad</th>
                    <th className={`${TH} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {(kardex || []).map((k: any, i: number) => {
                    const cantidad = signedAmount(k?.type, k?.quantity)
                    return (
                      <tr key={k?.id ?? i}>
                        <td className={TD}>{formatDate(k?.created_at)}</td>
                        <td className={TD}>{k?.product_name || '—'}</td>
                        <td className={TD}>
                          <Signo valor={cantidad} positivo="Entrada" negativo="Salida" />
                        </td>
                        <td className={TD_NUM}>{cantidad}</td>
                        <td className={TD_NUM}>{num(k?.balance)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
