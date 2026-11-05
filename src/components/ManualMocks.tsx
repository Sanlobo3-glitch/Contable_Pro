import type { ReactNode } from 'react'

export type MockKind =
  | 'login' | 'offline' | 'panel' | 'products' | 'labels' | 'clients' | 'sales' | 'pos' | 'quotes' | 'purchases'
  | 'cash' | 'returns' | 'kardex' | 'reports' | 'goals' | 'map' | 'team' | 'settings' | 'plan' | 'accsetup' | 'accclose' | 'statements' | 'buyplan' | 'copilot' | 'accounting' | 'cartera' | 'summary' | 'ask' | 'lots' | 'predict' | 'profit'
  | 'catalog' | 'catorders' | 'ocr' | 'warehouses' | 'expenses' | 'cpa' | 'erpbridge' | 'support'
  | 'blindcount' | 'layaways' | 'exchanges' | 'bankrecon' | 'priceshield'
  | 'omnichannel' | 'ai_actions' | 'branch_balance' | 'supplier_intel' | 'anomaly_detector' | 'epod' | 'equipment_assets' | 'employee_portal' | 'compliance' | 'api_ecosystem'

/* ───────── Ilustraciones (pantallas de ejemplo) ───────── */

const Pin = ({ n }: { n: number }) => (
  <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500 text-white text-[7px] font-bold ml-1 align-middle">{n}</span>
)
const Top = ({ t }: { t: string }) => <div className="bg-slate-800 text-white px-2 py-1.5 font-semibold text-[9px]">{t}</div>
const Body = ({ children }: { children: ReactNode }) => <div className="p-1.5 space-y-1">{children}</div>
const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`bg-white border border-slate-200 rounded px-1.5 py-1 ${className}`}>{children}</div>
)
const Field = ({ label, value, pin }: { label: string; value?: string; pin?: number }) => (
  <div>
    <p className="text-slate-500 mb-0.5">{label}{pin ? <Pin n={pin} /> : null}</p>
    <div className="bg-white border border-slate-300 rounded px-1.5 py-1 text-slate-700 min-h-[14px]">{value}</div>
  </div>
)
const Btn = ({ children, tone = 'dark', pin }: { children: ReactNode; tone?: 'dark' | 'green' | 'light' | 'red' | 'amber'; pin?: number }) => {
  const c = { dark: 'bg-slate-800 text-white', green: 'bg-emerald-600 text-white', light: 'bg-slate-200 text-slate-700', red: 'bg-red-50 text-red-600', amber: 'bg-amber-100 text-amber-800' }[tone]
  return <div className={`rounded px-1.5 py-1 text-center font-medium ${c}`}>{children}{pin ? <Pin n={pin} /> : null}</div>
}
export const Chip = ({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'indigo' | 'amber' | 'slate' | 'red' }) => {
  const c = { green: 'bg-emerald-50 text-emerald-700', indigo: 'bg-indigo-100 text-indigo-700', amber: 'bg-amber-100 text-amber-800', slate: 'bg-slate-100 text-slate-600', red: 'bg-red-50 text-red-600' }[tone]
  return <span className={`inline-block rounded px-1 py-px font-medium ${c}`}>{children}</span>
}
const Between = ({ a, b, bold }: { a: ReactNode; b: ReactNode; bold?: boolean }) => (
  <div className={`flex items-center justify-between gap-1 ${bold ? 'font-bold text-slate-800' : 'text-slate-600'}`}><span>{a}</span><span>{b}</span></div>
)
const Bar = ({ pct, color = 'bg-emerald-500' }: { pct: number; color?: string }) => (
  <div className="h-1.5 rounded bg-slate-200 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
)

function Barcode() {
  const w = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 2, 2, 1, 1, 3, 1, 2, 1]
  let x = 0
  const bars = w.map((v, i) => { const el = i % 2 === 0 ? <rect key={i} x={x} y={0} width={v} height={26} fill="#0f172a" /> : null; x += v; return el })
  return <svg viewBox={`0 0 ${x} 26`} className="w-full h-8">{bars}</svg>
}
function QrArt() {
  const n = 11
  const cells: ReactNode[] = []
  const finder = (r: number, c: number) => (r < 4 && c < 4) || (r < 4 && c > n - 5) || (r > n - 5 && c < 4)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let on: boolean
    if (finder(r, c)) {
      const rr = r > n - 5 ? r - (n - 4) : r
      const cc = c > n - 5 ? c - (n - 4) : c
      on = rr === 0 || rr === 3 || cc === 0 || cc === 3 || (rr >= 1 && rr <= 2 && cc >= 1 && cc <= 2)
    } else {
      on = (r * 7 + c * 13 + r * c) % 3 === 0
    }
    if (on) cells.push(<rect key={r * n + c} x={c} y={r} width={1} height={1} fill="#0f172a" />)
  }
  return <svg viewBox={`0 0 ${n} ${n}`} className="w-9 h-9">{cells}</svg>
}

export function Mock({ kind }: { kind: MockKind }) {
  let screen: ReactNode = null
  switch (kind) {
    case 'login':
      screen = (<><Top t="InventarioPro" /><Body>
        <Field label="Email" value="tu@empresa.com" pin={1} />
        <Field label="Contraseña" value="••••••••" pin={2} />
        <Btn pin={3}>Iniciar sesión</Btn>
        <p className="text-center text-slate-500 pt-1">¿No tienes cuenta? <b className="text-slate-800">Regístrate</b></p>
        <p className="text-center text-slate-400">¿Olvidaste tu contraseña?</p>
      </Body></>)
      break
    case 'offline':
      screen = (<><Top t="Ventas" /><Body>
        <div className="rounded bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-1">Sin conexión. Sigue vendiendo: se envía al volver la señal.<Pin n={3} /></div>
        <Card className="border-amber-300">
          <div className="flex items-center justify-between font-bold text-amber-800 uppercase"><span>Pendientes (2)</span><Chip tone="amber">Enviar ahora</Chip></div>
          <Between a="Cliente general" b="$54.000" /><Between a="Tienda La 80" b="$120.000" />
        </Card>
        <Card><Between a="Camisa reebok x2" b={<Chip>Mayor</Chip>} /></Card>
        <Btn tone="green">Registrar venta</Btn>
      </Body></>)
      break
    case 'panel':
      screen = (<><Top t="Panel de Control" /><Body>
        <div className="grid grid-cols-2 gap-1"><Card><p className="text-slate-400">Ventas hoy</p><p className="font-bold text-emerald-600 text-[10px]">$480.000</p></Card><Card><p className="text-slate-400">Stock bajo</p><p className="font-bold text-amber-600 text-[10px]">3</p></Card></div>
        <Card><Between a={<b>Mi meta del mes</b>} b={<Chip>Vas bien</Chip>} /><div className="my-1"><Bar pct={62} /></div><Between a="$3.100.000" b="de $5.000.000" /><p className="text-slate-400 mt-0.5">Te faltan $1.900.000 · $95.000 por día</p></Card>
        <p className="font-semibold text-slate-600 pt-0.5">Ventas recientes</p>
        <Card><Between a="Tienda La 80" b="$120.000" /></Card>
      </Body></>)
      break
    case 'products':
      screen = (<><Top t="Productos" /><Body>
        <Card><b className="text-slate-800">Camisa reebok</b><Between a="Detal $30.000" b={<Chip tone="indigo">mayor $25.000 desde 5</Chip>} /></Card>
        <Field label="Precio por mayor" value="25000" pin={2} />
        <Field label="SKU / código de barras" value="48210937" />
        <div className="grid grid-cols-2 gap-1"><Btn tone="light" pin={3}>Leer</Btn><Btn tone="light">Generar</Btn></div>
        <Btn pin={4}>Guardar</Btn>
      </Body></>)
      break
    case 'labels':
      screen = (<><Top t="Etiquetas" /><Body>
        <div className="grid grid-cols-3 gap-1"><Btn tone="dark">Barras</Btn><Btn tone="light">QR</Btn><Btn tone="light">60×35</Btn></div>
        <Card className="text-center"><p className="font-bold text-slate-800">Camisa reebok</p><Barcode /><p className="text-slate-500 tracking-widest">48210937</p><p className="font-bold">$30.000</p></Card>
        <Card className="flex items-center gap-1.5"><QrArt /><div><p className="font-bold text-slate-800">Camisa reebok</p><p className="text-slate-500">48210937</p></div></Card>
        <Btn pin={4}>Imprimir</Btn>
      </Body></>)
      break
    case 'clients':
      screen = (<><Top t="Clientes" /><Body>
        <Card><Between a={<b className="text-slate-800">Tienda La 80</b>} b={<Chip tone="indigo">Mayor</Chip>} /><p className="text-slate-400">Cra 80 #45-12 · 300 123 4567</p></Card>
        <Card><Between a={<b className="text-slate-800">Ana Gómez</b>} b={<Chip tone="slate">Detal</Chip>} /></Card>
        <Field label="Tipo de precio" value="Por mayor" pin={2} />
        <Btn>Guardar cliente</Btn>
      </Body></>)
      break
    case 'sales':
      screen = (<><Top t="Nueva venta" /><Body>
        <Field label="Cliente" value="Tienda La 80 (Por mayor)" pin={1} />
        <div className="flex gap-1"><div className="flex-1 bg-white border border-slate-300 rounded px-1.5 py-1 text-slate-500">Camisa reebok</div><div className="w-6 bg-white border border-slate-300 rounded text-center py-1">3</div><div className="w-5 bg-slate-200 rounded text-center py-1">+<Pin n={2} /></div></div>
        <Card><Between a={<span>Camisa reebok x3 <Chip tone="indigo">Mayor</Chip></span>} b="$75.000" /></Card>
        <Between a="Impuesto (19%)" b="$11.975" />
        <Between a="Total" b="$75.000" bold />
        <Btn tone="green" pin={5}>Registrar venta</Btn>
      </Body></>)
      break
    case 'pos':
      screen = (<><Top t="Mostrador" /><Body>
        <div className="flex gap-1"><div className="flex-1 bg-white border border-slate-300 rounded px-1.5 py-1 text-slate-400">Buscar nombre o código<Pin n={1} /></div><div className="w-6 bg-slate-800 text-white rounded text-center py-1">▣</div></div>
        <Card><Between a="Camisa reebok" b="$30.000" /><Between a="− 1 +" b={<Chip tone="slate">Detal</Chip>} /></Card>
        <div className="grid grid-cols-2 gap-1"><Field label="Descuento" value="10 %" pin={4} /><Field label="Recibido" value="$50.000" /></div>
        <Between a="Cambio" b="$23.000" />
        <Between a="Total" b="$27.000" bold />
        <Btn tone="green" pin={6}>Cobrar</Btn>
      </Body></>)
      break
    case 'quotes':
      screen = (<><Top t="Cotizaciones" /><Body>
        <Card><Between a={<b className="text-slate-800">Tienda La 80</b>} b="$450.000" /><Between a="COT-1A2B3C" b={<Chip tone="amber">Pendiente</Chip>} /></Card>
        <Card><Between a={<b className="text-slate-800">Ana Gómez</b>} b="$90.000" /><Between a="COT-9F8E7D" b={<Chip>Aceptada</Chip>} /></Card>
        <Btn tone="green" pin={3}>Convertir en venta</Btn>
      </Body></>)
      break
    case 'purchases':
      screen = (<><Top t="Nueva compra" /><Body>
        <Field label="Proveedor" value="Textiles del Valle" pin={2} />
        <Field label="Producto" value="Camisa reebok" />
        <div className="grid grid-cols-2 gap-1"><Field label="Cant." value="40" /><Field label="Costo" value="$18.000" pin={3} /></div>
        <Btn pin={4}>Registrar compra</Btn>
      </Body></>)
      break
    case 'cash':
      screen = (<><Top t="Caja" /><Body>
        <Card><p className="text-slate-400">Saldo actual</p><p className="font-bold text-emerald-600 text-[11px]">$1.250.000</p></Card>
        <Card><Between a="Venta efectivo" b={<span className="text-emerald-600">+ $54.000</span>} /></Card>
        <Card><Between a="Retiro del dueño" b={<span className="text-red-600">− $200.000</span>} /></Card>
        <Btn tone="light" pin={2}>Nuevo movimiento</Btn>
        <Btn tone="dark" pin={3}>Cerrar caja</Btn>
      </Body></>)
      break
    case 'returns':
      screen = (<><Top t="Nueva devolución" /><Body>
        <Field label="Venta" value="Tienda La 80 · $75.000" pin={1} />
        <div className="grid grid-cols-2 gap-1"><Field label="Producto" value="Camisa" /><Field label="Cantidad" value="1" pin={2} /></div>
        <Field label="Motivo" value="Talla incorrecta" />
        <Btn pin={3}>Registrar devolución</Btn>
      </Body></>)
      break
    case 'kardex':
      screen = (<><Top t="Kardex" /><Body>
        <div className="bg-white border border-slate-300 rounded px-1.5 py-1 text-slate-500">Camisa reebok<Pin n={1} /></div>
        <Card><Between a="Compra" b={<span className="text-emerald-600">+ 40</span>} /><p className="text-slate-400">12 oct · Saldo 40</p></Card>
        <Card><Between a="Venta" b={<span className="text-red-600">− 3</span>} /><p className="text-slate-400">14 oct · Saldo 37</p></Card>
        <Card><Between a="Devolución" b={<span className="text-emerald-600">+ 1</span>} /><p className="text-slate-400">15 oct · Saldo 38</p></Card>
      </Body></>)
      break
    case 'reports':
      screen = (<><Top t="Reportes" /><Body>
        <div className="flex gap-1 overflow-hidden"><Chip tone="slate">Resumen</Chip><Chip tone="slate">Ventas</Chip><Chip tone="slate">Caja</Chip></div>
        <div className="flex gap-1"><Chip tone="slate">Día</Chip><Chip tone="slate">Semana</Chip><Chip tone="slate">Mes</Chip></div>
        <p className="text-slate-500">Ventas de<Pin n={2} /></p>
        <div className="flex gap-1"><span className="bg-slate-800 text-white rounded px-1.5 py-1">Todas</span><span className="bg-white border border-slate-200 rounded px-1.5 py-1">Ruta</span><span className="bg-white border border-slate-200 rounded px-1.5 py-1">Mostrador</span></div>
        <Card><Between a="Total ventas" b="$4.820.000" bold /><Between a="Compras" b="$2.100.000" /></Card>
        <Btn pin={3}>Imprimir</Btn>
      </Body></>)
      break
    case 'goals':
      screen = (<><Top t="Metas" /><Body>
        <Card><Between a={<b className="text-slate-800">Carlos</b>} b="62 %" /><Bar pct={62} /></Card>
        <Card><Between a={<b className="text-slate-800">María</b>} b="95 %" /><Bar pct={95} /></Card>
        <Card><Between a={<b className="text-slate-800">Luis</b>} b="28 %" /><Bar pct={28} color="bg-red-400" /></Card>
        <Field label="Meta de Carlos" value="$5.000.000" pin={1} />
      </Body></>)
      break
    case 'map':
      screen = (<><Top t="Mapa y rutas" /><Body>
        <div className="relative h-20 rounded bg-emerald-50 border border-slate-200 overflow-hidden">
          {[[14, 18], [40, 44], [62, 22], [78, 58], [30, 66]].map(([l, t], i) => (
            <span key={i} className="absolute w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" style={{ left: `${l}%`, top: `${t}%` }} />
          ))}
        </div>
        <Field label="Sin atender hace" value="30+ días" pin={2} />
        <Field label="Paradas" value="8 paradas" />
        <Btn tone="green" pin={3}>Abrir en Google Maps</Btn>
      </Body></>)
      break
    case 'team':
      screen = (<><Top t="Equipo y dispositivos" /><Body>
        <Card><Between a={<b className="text-slate-800">Redmi Note 13</b>} b={<Chip>Autorizado</Chip>} /></Card>
        <Card><Between a={<b className="text-slate-800">Galaxy A15</b>} b={<Chip tone="amber">Pendiente</Chip>} /><div className="grid grid-cols-2 gap-1 mt-1"><Btn tone="green" pin={2}>Autorizar</Btn><Btn tone="red">Bloquear</Btn></div></Card>
      </Body></>)
      break
    case 'settings':
      screen = (<><Top t="Configuración" /><Body>
        <Field label="Nombre de la empresa" value="Mi Tienda S.A.S." pin={1} />
        <Field label="Impuestos" value="Precios con impuesto incluido" pin={2} />
        <Field label="Tasa (%)" value="19" />
        <Field label="Ubicación en ventas" value="Solo vendedores" pin={3} />
        <Btn pin={4}>Guardar</Btn>
      </Body></>)
      break
    case 'accsetup':
      screen = (<><Top t="Configuración contable" /><Body>
        <Field label="Caja" value="1105 · Caja general" pin={1} />
        <Field label="Ingresos por ventas" value="4135 · Comercio" />
        <Btn tone="light" pin={2}>Guardar cuentas</Btn>
        <Card><Between a={<b className="text-slate-800">3. Activación</b>} b={<Chip>Activa</Chip>} /><p className="text-slate-400">Desde 2026-10-01</p></Card>
        <div className="grid grid-cols-2 gap-1"><Btn tone="green" pin={3}>Activar</Btn><Btn tone="dark" pin={4}>Conciliar</Btn></div>
      </Body></>)
      break
    case 'accclose':
      screen = (<><Top t="Cierre de libros" /><Body>
        <div className="grid grid-cols-3 gap-1"><Field label="Año" value="2026" /><div className="col-span-2"><Field label="Mes" value="septiembre" pin={1} /></div></div>
        <Btn pin={2}>Revisar</Btn>
        <Card><p><b className="text-emerald-600">✔</b> Asientos cuadrados</p><p><b className="text-amber-600">⚠</b> 2 ventas sin contabilizar</p></Card>
        <Btn tone="green" pin={4}>Cerrar periodo</Btn>
        <p className="text-slate-400 text-center">Historial · Informe · Reabrir</p>
      </Body></>)
      break
    case 'statements':
      screen = (<><Top t="Estados financieros" /><Body>
        <div className="flex gap-1"><span className="flex-1 text-center bg-slate-800 text-white rounded px-1.5 py-1">Estado de resultados<Pin n={1} /></span><span className="flex-1 text-center bg-white border border-slate-200 rounded px-1.5 py-1">Balance general</span></div>
        <div className="grid grid-cols-2 gap-1"><Field label="Desde" value="01/01/2026" pin={2} /><Field label="Hasta" value="30/09/2026" /></div>
        <Card><p className="text-amber-700">Borrador: hay un mes sin cerrar<Pin n={3} /></p></Card>
        <Card><Between a="Ingresos" b="12.400.000" /><Between a="Costos" b="7.100.000" /><Between a="Utilidad bruta" b="5.300.000" /></Card>
        <Btn tone="dark" pin={4}>Imprimir</Btn>
      </Body></>)
      break
    case 'buyplan':
      screen = (<><Top t="Sugerencia de compras" /><Body>
        <div className="flex gap-1"><span className="flex-1 text-center bg-white border border-slate-200 rounded px-1.5 py-1">7 días</span><span className="flex-1 text-center bg-slate-800 text-white rounded px-1.5 py-1">15 días<Pin n={1} /></span><span className="flex-1 text-center bg-white border border-slate-200 rounded px-1.5 py-1">30 días</span></div>
        <Card><Between a={<b className="text-slate-800">Textiles del Valle</b>} b="$156.000" /><Between a={<span>Camisa reebok <Chip tone="amber">Por reponer</Chip></span>} b={<span>Pedir 8<Pin n={2} /></span>} /><p className="text-slate-400">Stock 4 · te alcanza 5 d</p></Card>
        <div className="grid grid-cols-2 gap-1"><Btn tone="dark" pin={3}>Copiar pedido</Btn><Btn tone="green" pin={4}>WhatsApp</Btn></div>
        <Between a="Inversión estimada" b="$180.000" bold />
      </Body></>)
      break
    case 'lots':
      screen = (<><Top t="Lotes y vencimientos" /><Body>
        <div className="grid grid-cols-3 gap-1"><Card><p className="text-slate-500">Vencidos</p><p className="font-bold text-red-600">2<Pin n={1} /></p></Card><Card><p className="text-slate-500">En 30 d</p><p className="font-bold text-amber-600">5</p></Card><Card><p className="text-slate-500">Lotes</p><p className="font-bold text-slate-800">18</p></Card></div>
        <Card><Between a={<span>Leche entera <Chip tone="red">Vence en 3 d</Chip></span>} b="12 uds" /><p className="text-slate-400">Lote L-2410 · 30/10/2026</p></Card>
        <Btn tone="red" pin={2}>Dar de baja</Btn>
        <Field label="Fecha de vencimiento (en Compras)" value="30/12/2026" pin={3} />
      </Body></>)
      break
    case 'profit':
      screen = (<><Top t="Rentabilidad" /><Body>
        <div className="flex gap-1 overflow-hidden"><Chip tone="slate">7 días</Chip><span className="bg-slate-800 text-white rounded px-1.5 py-0.5">30 días<Pin n={1} /></span><Chip tone="slate">Este mes</Chip></div>
        <div className="grid grid-cols-2 gap-1"><Card><p className="text-slate-500">Utilidad</p><p className="font-bold text-emerald-700">$850.000<Pin n={2} /></p></Card><Card><p className="text-slate-500">Margen</p><p className="font-bold text-slate-800">32 %</p></Card></div>
        <Card><Between a="Camisa reebok" b={<b className="text-emerald-700">$320.000</b>} /><p className="text-slate-500"><Chip tone="green">Clase A</Chip> 38 % de la utilidad<Pin n={3} /></p></Card>
        <Card><Between a="Gorra azul" b={<b className="text-red-600">-$12.000</b>} /><p className="text-slate-500"><Chip tone="red">Bajo el costo</Chip><Pin n={4} /></p></Card>
      </Body></>)
      break
    case 'predict':
      screen = (<><Top t="Predicciones" /><Body>
        <div className="flex gap-1"><span className="flex-1 text-center bg-slate-800 text-white rounded px-1.5 py-1">Clientes<Pin n={1} /></span><span className="flex-1 text-center bg-white border border-slate-200 rounded px-1.5 py-1">Productos</span></div>
        <Card><Between a={<span>Ana Pérez <Chip tone="red">Riesgo alto</Chip></span>} b="" /><p className="text-slate-500">Compraba cada ~10 días y lleva 45 sin comprar<Pin n={2} /></p></Card>
        <Card><Between a="Camisa reebok" b={<Chip tone="red">Se agota pronto</Chip>} /><p className="text-slate-500">Alcanza ~5 días · confianza alta<Pin n={3} /></p></Card>
        <Btn tone="green" pin={4}>WhatsApp</Btn>
      </Body></>)
      break
    case 'ask':
      screen = (<><Top t="Pregúntale al Copiloto" /><Body>
        <div className="flex justify-end"><span className="bg-slate-800 text-white rounded px-1.5 py-1">¿Cuánto vendí hoy?<Pin n={1} /></span></div>
        <Card><p className="font-bold text-slate-800">Vendiste $2.350.000 hoy</p><p className="text-slate-500">12 ventas · promedio $195.000<Pin n={2} /></p></Card>
        <div className="flex gap-1 overflow-hidden"><Chip tone="slate">¿Quién me debe?</Chip><Chip tone="slate">¿Qué se agota?</Chip></div>
        <Field label="Escribe tu pregunta" value="" pin={3} />
      </Body></>)
      break
    case 'summary':
      screen = (<><Top t="Resumen del día" /><Body>
        <div className="flex gap-1"><span className="flex-1 text-center bg-white border border-slate-200 rounded px-1.5 py-1">Hoy</span><span className="flex-1 text-center bg-slate-800 text-white rounded px-1.5 py-1">Ayer<Pin n={1} /></span></div>
        <Card><p className="text-slate-500">Vendiste</p><p className="font-bold text-slate-800 text-[11px]">$2.350.000<Pin n={2} /></p><p className="text-emerald-700">+12 % vs. día anterior</p></Card>
        <Card><Between a="Efectivo" b="$1.200.000" /><Between a="Fiado" b="$400.000" /></Card>
        <Card><Between a="Entró a caja" b="$1.350.000" /><Between a="Te deben" b="$980.000" /></Card>
        <Btn tone="green" pin={3}>WhatsApp</Btn>
      </Body></>)
      break
    case 'cartera':
      screen = (<><Top t="Cartera (fiado)" /><Body>
        <div className="grid grid-cols-2 gap-1"><Card><p className="text-slate-500">Por cobrar</p><p className="font-bold text-slate-800">$1.250.000<Pin n={1} /></p></Card><Card><p className="text-slate-500">Vencido</p><p className="font-bold text-red-600">$300.000</p></Card></div>
        <Card><Between a={<span>Ana Pérez <Chip tone="red">Vencido</Chip></span>} b={<b className="text-slate-800">$500.000<Pin n={2} /></b>} /><p className="text-slate-400">2 ventas · cupo $800.000</p></Card>
        <Field label="Valor del abono" value="200.000" pin={3} />
        <Btn tone="green" pin={4}>Registrar abono</Btn>
      </Body></>)
      break
    case 'copilot':
      screen = (<><Top t="Copiloto" /><Body>
        <p className="text-slate-600">Buenos días, Carlos. Esto es lo que conviene mirar hoy.<Pin n={1} /></p>
        <div className="rounded border border-red-200 bg-red-50 px-1.5 py-1"><p className="font-bold text-slate-800">1 producto por agotarse</p><p className="text-slate-500">Camisa reebok · se agota en ~4 d</p><div className="mt-1 w-16"><Btn tone="dark" pin={2}>Ver productos</Btn></div></div>
        <div className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1"><p className="font-bold text-slate-800">2 cotizaciones por vencer<Pin n={3} /></p><p className="text-slate-500">En juego $540.000</p></div>
        <div className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1"><p className="font-bold text-slate-800">¡Meta del mes cumplida!</p></div>
      </Body></>)
      break
    case 'accounting':
      screen = (<><Top t="Contabilidad" /><Body>
        <div className="flex gap-1 overflow-hidden"><span className="bg-slate-800 text-white rounded px-1.5 py-1">Plan de cuentas</span><span className="bg-white border border-slate-200 rounded px-1.5 py-1">Diario</span><span className="bg-white border border-slate-200 rounded px-1.5 py-1">Mayor</span></div>
        <Btn tone="light" pin={2}>+ Nueva cuenta</Btn>
        <Card><Between a="1105 · Caja general" b="activo" /><Between a="4135 · Ventas" b="ingreso" /></Card>
        <Card><Between a="Asiento AS-0012" b={<Chip>contabilizado</Chip>} /><Between a="Débitos = Créditos" b={<Chip>Cuadrado</Chip>} /></Card>
        <Btn pin={4}>Contabilizar</Btn>
      </Body></>)
      break
    case 'catalog':
      screen = (<><Top t="Catálogo Comercial" /><Body>
        <Card><Between a={<b className="text-slate-800">Vitrina pública</b>} b={<Chip>Activa</Chip>} /><p className="text-slate-400">/tienda/mi-empresa<Pin n={1} /></p></Card>
        <Card><Between a="Camisa Oxford" b="$30.000" /><p className="text-slate-500">Tallas: S · M · L · XL<Pin n={2} /></p></Card>
        <div className="grid grid-cols-2 gap-1"><Btn tone="green" pin={3}>WhatsApp</Btn><Btn tone="dark" pin={4}>Exportar PDF</Btn></div>
        <Btn tone="light">Identidad y Pagos</Btn>
      </Body></>)
      break
    case 'catorders':
      screen = (<><Top t="Pedidos de Catálogo" /><Body>
        <Card><Between a={<b className="text-slate-800">WEB-1042</b>} b={<Chip tone="amber">Por verificar</Chip>} /><Between a="Nequi · #849201" b="$90.000" /></Card>
        <Btn tone="dark" pin={2}>Auditar capture (OCR)</Btn>
        <div className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1"><Between a={<b className="text-emerald-800">APROBADA</b>} b={<Chip>Monto exacto</Chip>} /><p className="text-emerald-700 mt-0.5">Ref. #849201 única<Pin n={3} /></p></div>
        <Btn tone="green" pin={4}>Corroborar y facturar</Btn>
      </Body></>)
      break
    case 'ocr':
      screen = (<><Top t="Escáner Documental OCR" /><Body>
        <Card><Between a={<b className="text-slate-800">1. Cuaderno sin luz</b>} b={<Chip tone="indigo">Ventas</Chip>} /><p className="text-slate-400">Foto de apuntes a mano<Pin n={1} /></p></Card>
        <Card><Between a={<b className="text-slate-800">2. Factura proveedor</b>} b={<Chip>Compras</Chip>} /><p className="text-slate-400">Ítems, costos y lotes<Pin n={2} /></p></Card>
        <Card><Between a={<b className="text-slate-800">3. Agua / Luz / Gas</b>} b={<Chip tone="amber">Gastos</Chip>} /><p className="text-slate-400">Servicio, ref. y monto<Pin n={3} /></p></Card>
        <Btn tone="green" pin={4}>Confirmar e ingresar</Btn>
      </Body></>)
      break
    case 'warehouses':
      screen = (<><Top t="Sedes y Multibodega" /><Body>
        <div className="grid grid-cols-2 gap-1"><Card><p className="text-slate-500">Principal</p><p className="font-bold text-slate-800">420 uds<Pin n={1} /></p></Card><Card><p className="text-slate-500">Sucursal Norte</p><p className="font-bold text-emerald-700">185 uds</p></Card></div>
        <Field label="Traslado entre bodegas" value="Principal → Norte (20 uds)" pin={2} />
        <Btn tone="dark" pin={3}>Ejecutar traslado</Btn>
      </Body></>)
      break
    case 'expenses':
      screen = (<><Top t="Gastos y Tesorería" /><Body>
        <Btn tone="dark" pin={1}>Escanear recibo (Agua/Luz)</Btn>
        <Card><Between a={<b className="text-slate-800">Energía Eléctrica</b>} b="$185.000" /><Between a="Servicios públicos" b={<Chip>Pagado</Chip>} /></Card>
        <Card><Between a="Liquidez proyectada 30d" b={<b className="text-emerald-700">+$3.400.000<Pin n={3} /></b>} /></Card>
        <Btn tone="green" pin={2}>Registrar egreso</Btn>
      </Body></>)
      break
    case 'cpa':
      screen = (<><Top t="Despacho Contable" /><Body>
        <Card><Between a="Ecuación patrimonial" b={<Chip>Cuadrada</Chip>} /><p className="text-slate-500">Activo = Pasivo + Patrimonio<Pin n={1} /></p></Card>
        <div className="flex gap-1"><Chip tone="slate">Hoja 8 col.</Chip><Chip tone="slate">NIIF</Chip><Chip tone="slate">Centros costo</Chip></div>
        <Card><Between a="Conciliación operativa" b="Dif. 0,00" /><p className="text-emerald-700">Libros al día<Pin n={2} /></p></Card>
        <Btn tone="dark" pin={3}>Imprimir papeles CPA</Btn>
      </Body></>)
      break
    case 'erpbridge':
      screen = (<><Top t="Siigo ↔ Contable Pro ↔ Loggro" /><Body>
        <div className="grid grid-cols-2 gap-1"><Btn tone="dark" pin={1}>SIIGO Nube</Btn><Btn tone="light">LOGGRO</Btn></div>
        <Card><Between a="Terceros (DV DIAN)" b={<Chip>Listo</Chip>} /><Between a="Productos + PUC" b="Bloques 500" /></Card>
        <Card><Between a="Comprobantes CC" b={<Chip>Cuadrado</Chip>} /><p className="text-slate-400">Exportar o migrar CSV<Pin n={2} /></p></Card>
        <Btn tone="green" pin={3}>Transferir datos</Btn>
      </Body></>)
      break
    case 'support':
      screen = (<><Top t="Soporte y Autorización" /><Body>
        <Field label="Asunto del ticket" value="Duda en cierre mensual" pin={1} />
        <Card><Between a="Código temporal técnico" b={<b className="text-slate-800">AUT-4829<Pin n={2} /></b>} /><p className="text-slate-400">Solo bajo tu autorización</p></Card>
        <Btn tone="green" pin={3}>Enviar solicitud</Btn>
      </Body></>)
      break
    case 'blindcount':
      screen = (<><Top t="Toma Física Ciega" /><Body>
        <Card><Between a={<b className="text-slate-800">Modo Ciego</b>} b={<Chip tone="slate">Stock oculto</Chip>} /><p className="text-slate-500">Camisa Reebok · Contado: 18<Pin n={1} /></p></Card>
        <Card><Between a="Auditoría gerencial" b={<b className="text-red-600">-2 uds<Pin n={2} /></b>} /></Card>
        <Btn tone="green" pin={3}>Aprobar y ajustar Kardex</Btn>
      </Body></>)
      break
    case 'layaways':
      screen = (<><Top t="Plan Separe y Apartados" /><Body>
        <Card><Between a={<b className="text-slate-800">SEP-2611-4012</b>} b={<Chip>Activo</Chip>} /><Between a="Abonado: $40.000" b="Saldo: $50.000" /></Card>
        <Btn tone="dark" pin={1}>Registrar cuota / abono</Btn>
        <Btn tone="light" pin={2}>Recordatorio WhatsApp</Btn>
        <Btn tone="green" pin={3}>Entregar y facturar</Btn>
      </Body></>)
      break
    case 'exchanges':
      screen = (<><Top t="Cambios y Garantías" /><Body>
        <Card><Between a="Entra: Talla M" b="$30.000" /><Between a="Sale: Talla L" b="$30.000" /><p className="text-emerald-700 mt-0.5">Diferencia: $0 (Mano a mano)<Pin n={1} /></p></Card>
        <Card><Between a="Garantía #GAR-108" b={<Chip tone="amber">En revisión</Chip>} /></Card>
        <Btn tone="green" pin={2}>Confirmar e imprimir</Btn>
      </Body></>)
      break
    case 'bankrecon':
      screen = (<><Top t="Conciliación Bancaria" /><Body>
        <Btn tone="dark" pin={1}>Subir CSV o Escanear PDF</Btn>
        <Card><Between a="Nequi #849201" b={<Chip>Conciliado</Chip>} /><Between a="Impuesto 4×1000" b={<Chip tone="amber">-$960<Pin n={2} /></Chip>} /></Card>
        <Btn tone="green" pin={3}>Contabilizar 4×1000</Btn>
      </Body></>)
      break
    case 'priceshield':
      screen = (<><Top t="Escudo de Precios" /><Body>
        <Field label="Proteger margen + Redondeo" value="Mín. 35% · Múltiplo 100" pin={1} />
        <Card><Between a="Jean Industrial" b="$58.000 → $62.900" /><p className="text-emerald-700">Margen 28% → 35%<Pin n={2} /></p></Card>
        <Btn tone="green" pin={3}>Aplicar e imprimir etiquetas</Btn>
      </Body></>)
      break
    case 'omnichannel':
      screen = (<><Top t="Pedidos Omnicanal" /><Body>
        <Card><Between a={<b className="text-slate-800">PED-8941</b>} b={<Chip tone="indigo">WhatsApp</Chip>} /><p className="text-slate-500">Alistamiento (Picking)<Pin n={1} /></p></Card>
        <Btn tone="dark" pin={2}>Imprimir ticket de bodega</Btn>
        <Btn tone="green" pin={3}>Avanzar a Despacho / e-POD</Btn>
      </Body></>)
      break
    case 'ai_actions':
      screen = (<><Top t="Acciones IA (Human-in-the-Loop)" /><Body>
        <Card><Between a={<b className="text-slate-800">Orden Sugerida</b>} b={<Chip tone="amber">Pendiente</Chip>} /><p className="text-slate-500">Café 500g: Reponer 80 uds<Pin n={1} /></p></Card>
        <Btn tone="green" pin={2}>Aprobar y ejecutar con 1 clic</Btn>
        <Btn tone="light" pin={3}>Descartar con motivo</Btn>
      </Body></>)
      break
    case 'branch_balance':
      screen = (<><Top t="Balanceo de Sedes" /><Body>
        <Card><Between a="Centro" b={<Chip tone="red">Quiebre en 2 días</Chip>} /><Between a="Norte" b={<Chip tone="slate">Sobrestock 60d</Chip>} /><p className="text-slate-500">Harina Maíz 1kg<Pin n={1} /></p></Card>
        <Btn tone="green" pin={2}>Generar traslado sugerido</Btn>
      </Body></>)
      break
    case 'supplier_intel':
      screen = (<><Top t="Evaluación de Proveedores" /><Body>
        <Card><Between a={<b className="text-slate-800">Distribuidora Andina</b>} b={<Chip tone="green">Ranking A+</Chip>} /><Between a="Cumplimiento OTIF" b="96.4%<Pin n={1} />" /><Between a="Alerta variación costo" b={<span className="text-red-600">+4.2%<Pin n={2} /></span>} /></Card>
        <Btn tone="dark" pin={3}>Historial de compras</Btn>
      </Body></>)
      break
    case 'anomaly_detector':
      screen = (<><Top t="Detección de Anomalías" /><Body>
        <Card><Between a={<b className="text-red-700">Alerta de Caja</b>} b={<Chip tone="red">Crítica</Chip>} /><p className="text-slate-600">Descuento atípico 35% en POS<Pin n={1} /></p></Card>
        <Btn tone="dark" pin={2}>Emitir dictamen de auditoría</Btn>
      </Body></>)
      break
    case 'epod':
      screen = (<><Top t="Prueba de Entrega (e-POD)" /><Body>
        <Card><Between a={<b className="text-slate-800">Firma del receptor</b>} b={<Chip tone="green">Capturada</Chip>} /><p className="text-slate-400">GPS: 4.6097° N, -74.0817° W<Pin n={1} /></p></Card>
        <Btn tone="green" pin={2}>Constancia WhatsApp</Btn>
      </Body></>)
      break
    case 'equipment_assets':
      screen = (<><Top t="Activos y Maquinaria" /><Body>
        <Card><Between a={<b className="text-slate-800">Furgón NHR #01</b>} b={<Chip tone="green">Al día</Chip>} /><p className="text-slate-500">Mantenimiento: en 1.200 km<Pin n={1} /></p></Card>
        <Card><Between a="Balanza Mostrador" b={<Chip tone="amber">Calibrar en 5d</Chip>} /></Card>
        <Btn tone="dark" pin={2}>Registrar mantenimiento</Btn>
      </Body></>)
      break
    case 'employee_portal':
      screen = (<><Top t="Portal de Vendedores" /><Body>
        <Card><Between a="Mi meta del mes" b={<b className="text-emerald-700">82%</b>} /><Bar pct={82} color="bg-emerald-600" /><p className="text-slate-500">Comisiones ganadas: $420.000<Pin n={1} /></p></Card>
        <Btn tone="green" pin={2}>Ver mi cartera y WhatsApp</Btn>
      </Body></>)
      break
    case 'compliance':
      screen = (<><Top t="Cumplimiento y Vencimientos" /><Body>
        <Card><Between a="SOAT Camión Reparto" b={<Chip tone="red">Vence en 6 días<Pin n={1} /></Chip>} /><Between a="Cámara de Comercio" b={<Chip tone="green">Vigente</Chip>} /></Card>
        <Btn tone="dark" pin={2}>Programar renovación</Btn>
      </Body></>)
      break
    case 'api_ecosystem':
      screen = (<><Top t="API y Webhooks" /><Body>
        <Field label="API Key Activa" value="ip_live_84b9f2...<Pin n={1} />" />
        <Card><Between a="GET /api/v1/products" b={<Chip tone="slate">200 OK</Chip>} /><Between a="POST /api/v1/orders" b={<Chip tone="slate">201 Creado</Chip>} /></Card>
        <Btn tone="dark" pin={2}>Copiar cURL / Ver docs</Btn>
      </Body></>)
      break
    case 'plan':
      screen = (<><Top t="Suscripción" /><Body>
        <div className="rounded bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-1">Periodo de prueba: <b>74 días</b> restantes<Pin n={1} /></div>
        <Card><Between a={<b className="text-slate-800">Emprendedor</b>} b="$9.99/mes" /></Card>
        <Card><Between a={<b className="text-slate-800">Profesional</b>} b="$19.99/mes" /></Card>
        <Btn tone="green" pin={2}>Activar suscripción</Btn>
      </Body></>)
      break
  }
  return (
    <div className="mx-auto w-44 shrink-0 rounded-[1.4rem] bg-slate-900 p-1.5 shadow-md" aria-hidden="true">
      <div className="rounded-[1.1rem] bg-slate-50 overflow-hidden text-[8px] leading-tight min-h-[210px]">{screen}</div>
    </div>
  )
}
