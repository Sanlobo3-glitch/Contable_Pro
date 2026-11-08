import {
  LayoutDashboard, Package, ShoppingCart, Users, Wallet, Truck, Undo2, ClipboardList,
  FileText, Settings as SettingsIcon, FileBarChart, CreditCard, MonitorSmartphone, MapPin, Target,
  Store, QrCode, LogIn, WifiOff, BookOpen, Lock, Calculator, Sparkles, ShoppingBasket, Banknote, CalendarDays, MessageCircleQuestion, CalendarClock, TrendingUp, PieChart,
  Tag, Percent, Gauge, Route as RouteIcon, UserPlus,
  ClipboardCheck, ScanLine, Building2, TrendingDown, BadgeCheck, ArrowLeftRight, LifeBuoy, Layers, Receipt, EyeOff, ShieldCheck, FileSpreadsheet,
  Database, Gift, History, Plus,
  type LucideIcon,
} from 'lucide-react'
import type { MockKind } from '../components/ManualMocks'

export type RoleKey =
  | 'admin'
  | 'dueno'
  | 'gerente'
  | 'contador'
  | 'vendedor'
  | 'transportador'
  | 'almacen'
  | 'tecnico'

export interface Chapter {
  id: string
  title: string
  icon: LucideIcon
  roles: RoleKey[]
  page?: string // id del módulo en el menú (para el botón «Abrir módulo»)
  summary: string
  steps: string[]
  tips?: string[]
  mock: MockKind
}

const ALL_ROLES: RoleKey[] = ['admin', 'dueno', 'gerente', 'contador', 'vendedor', 'transportador', 'almacen', 'tecnico']
const ADMIN_ONLY: RoleKey[] = ['admin']
const OWNER: RoleKey[] = ['dueno', 'gerente', 'admin']
const OWNER_CPA: RoleKey[] = ['dueno', 'gerente', 'contador', 'admin']
const BOTH: RoleKey[] = ['dueno', 'gerente', 'vendedor', 'admin']
const CPA_ROLES: RoleKey[] = ['contador', 'dueno', 'gerente', 'admin']
const LOGISTICS_ROLES: RoleKey[] = ['transportador', 'dueno', 'gerente', 'admin']
const GERENTE_ROLES: RoleKey[] = ['gerente', 'dueno', 'admin']

export const CHAPTERS: Chapter[] = [
  {
    id: 'companies',
    title: 'Gestión de Empresas Clientes y Aislamiento Multi-inquilino',
    icon: Building2,
    roles: ADMIN_ONLY,
    page: 'companies',
    mock: 'companies',
    summary: 'Panel del Administrador Central para supervisar inquilinos SaaS, asignar planes, gestionar bloqueos y mantener estricto aislamiento de datos privados.',
    steps: [
      'Entra a «Empresas clientes» desde el perfil de Administrador Central.',
      'Revisa el listado de empresas con su ID único, NIT, nombre comercial, plan asignado y fecha de vencimiento de suscripción.',
      'Filtra por estado: Activas, En prueba, Vencidas o Bloqueadas.',
      'Pulsa «Gestionar empresa» para cambiar el plan, extender el período de prueba o bloquear temporalmente el acceso.',
      'Seguridad y privacidad: El Administrador Central NO puede visualizar los asientos, productos ni finanzas privadas de terceros; solo gestiona su licencia y cuenta con su propia cubeta de prueba para producción.',
    ],
    tips: [
      'El aislamiento multi-tenant se rige por Row Level Security (RLS) en Supabase: ninguna empresa puede leer datos de otra.',
      'El Administrador Central tiene su propia cubeta de prueba aislada para verificar operaciones del sistema sin contaminar a los clientes.',
    ],
  },
  {
    id: 'sqlcenter',
    title: 'Centro de Scripts SQL y Migraciones Supabase',
    icon: Database,
    roles: ADMIN_ONLY,
    page: 'sqlcenter',
    mock: 'sqlcenter',
    summary: 'Consola técnica del Administrador Central para auditar migraciones, ejecutar scripts DDL/DML, verificar triggers de partida doble y diagnosticar tablas.',
    steps: [
      'Entra a «Centro de Scripts SQL y Supabase» (módulo exclusivo de Administrador Central).',
      'Revisa el catálogo de migraciones estructuradas (incluyendo la migración 0045, partida doble y reglas de inmutabilidad).',
      'Pulsa «Copiar SQL» o utiliza el botón de ejecución para aplicar políticas RLS, funciones PL/pgSQL y triggers de auditoría.',
      'Verifica el semáforo de integridad: confirma que las tablas accounts, journal_entries, journal_lines y companies existan con sus índices correspondientes.',
    ],
    tips: [
      'Este centro está restringido exclusivamente a la cuenta maestra y Administrador Central; ningún usuario de empresa cliente tiene acceso.',
    ],
  },
  {
    id: 'adminplans',
    title: 'Activación Central de Planes y Licencias',
    icon: Gift,
    roles: ADMIN_ONLY,
    page: 'adminplans',
    mock: 'adminplans',
    summary: 'Control maestro de licencias: activa planes Básico, Pro o Enterprise, registra extensiones de cortesía y aprueba comprobantes de pago.',
    steps: [
      'Entra a «Activar planes» en la sección de Administración.',
      'Busca la empresa por NIT o nombre comercial.',
      'Selecciona el nivel de plan: Prueba (90 días), Básico, Profesional o Empresarial.',
      'Indica la vigencia (meses o anual) y confirma la activación con un solo clic.',
      'El sistema actualiza de inmediato el acceso de todos los usuarios vinculados a esa empresa sin interrumpir su sesión.',
    ],
  },
  {
    id: 'puc_niif',
    title: 'Catálogo PUC Colombiano NIIF (4 Niveles Jerárquicos)',
    icon: BookOpen,
    roles: CPA_ROLES,
    page: 'accounting',
    mock: 'accounting',
    summary: 'Catálogo de cuentas oficial estructurado según NIIF: Clases 1 a 6 (Activo, Pasivo, Patrimonio, Ingresos, Gastos, Costos) con árbol jerárquico recursivo.',
    steps: [
      'Entra a «Catálogo PUC NIIF» en el módulo Contabilidad.',
      'Visualiza las cuentas organizadas por niveles: Nivel 1 (Clase), Nivel 2 (Grupo), Nivel 3 (Cuenta) y Nivel 4 (Subcuenta).',
      'Filtra rápidamente por código o nombre mediante la barra de búsqueda en tiempo real.',
      'Cada cuenta muestra su insignia de Naturaleza: Débito (Activo, Gastos, Costos) o Crédito (Pasivo, Patrimonio, Ingresos).',
      'Las cuentas de último nivel (Subcuentas) están habilitadas para recibir movimientos contables directos.',
    ],
    tips: [
      'El algoritmo recursivo buildAccountTree arma el árbol dinámico respetando la codificación estándar colombiana.',
    ],
  },
  {
    id: 'journal_entry',
    title: 'Registro de Asientos con Partida Doble e Inmutabilidad',
    icon: Plus,
    roles: CPA_ROLES,
    page: 'journal_entry',
    mock: 'journal_entry',
    summary: 'Formulario dinámico para registrar asientos contables con validación de partida doble en tiempo real (Principio de Luca Pacioli) e inmutabilidad garantizada.',
    steps: [
      'Entra a «Registrar Asiento Diario» (o pestaña correspondiente en Contabilidad).',
      'Ingresa fecha del comprobante, número consecutivo y concepto o descripción de la transacción.',
      'Agrega renglones contables seleccionando la cuenta PUC e indicando el valor en Débito o Crédito.',
      'Verifica el semáforo de Partida Doble en vivo: el asiento solo se puede guardar cuando Suma Débitos = Suma Créditos (diferencia = $0).',
      'Pulsa «Contabilizar asiento»: una vez registrado en estado «posteado» o «cerrado», la base de datos bloquea cualquier edición o borrado para garantizar inmutabilidad contable.',
    ],
    tips: [
      'Para corregir un asiento posteado, utiliza la función de Reversión: el sistema genera un contra-asiento auditable manteniendo el histórico.',
    ],
  },
  {
    id: 'accstate',
    title: 'Centro de Estados Financieros (Balances y PyG con Excel/PDF)',
    icon: FileBarChart,
    roles: OWNER_CPA,
    page: 'accstate',
    mock: 'statements',
    summary: 'Generación instantánea de Balance de Comprobación, Balance General NIIF y Estado de Resultados (Pérdidas y Ganancias) con exportación a Excel y PDF.',
    steps: [
      'Entra a «Centro de Estados Financieros (Balances)» desde el menú de Contabilidad NIIF.',
      'Selecciona el reporte deseado: Balance de Comprobación, Balance General o Estado de Resultados.',
      'Elige el rango de fechas (Desde / Hasta) o la fecha de corte.',
      'Comprueba que el Balance General cumpla la Ecuación Patrimonial: Activo = Pasivo + Patrimonio.',
      'Pulsa «Exportar a Excel (XLSX)» para descargar la hoja de cálculo completa o «Exportar a PDF» para imprimir el informe oficial listo para firma del Contador y Representante Legal.',
    ],
  },
  {
    id: 'dispatch_history',
    title: 'Trazabilidad y Auditoría de Despachos',
    icon: History,
    roles: LOGISTICS_ROLES,
    page: 'dispatch_history',
    mock: 'dispatch_history',
    summary: 'Control logístico completo de mercancía despachada: auditoría de cantidades enviadas vs. entregadas, registro de transportador y correcciones en sitio.',
    steps: [
      'Entra a «Trazabilidad y Auditoría Despachos» desde el menú de Transporte y Despacho.',
      'Revisa cada remisión con su fecha, número de guía, bodega de salida, cliente o sede destino y chofer asignado.',
      'Verifica si hubo diferencias o novedades (mercancía rechazada, cambio de talla o avería en ruta).',
      'Consulta quién autorizó cada ajuste y visualiza la constancia digital con firma y GPS.',
    ],
  },
  {
    id: 'demo_simulation',
    title: 'Simulador de Roles y Demostración en Vivo',
    icon: LayoutDashboard,
    roles: ALL_ROLES,
    page: 'dashboard',
    mock: 'panel',
    summary: 'Herramienta de demostración para experimentar el sistema desde la perspectiva exacta de cada rol operativo y administrativo.',
    steps: [
      'En la barra superior de demostración, selecciona cualquier rol disponible: Dueño, Admin. Empresa, Gerente, Contador Público, Almacén, Vendedor, Transporte o Soporte Técnico.',
      'Observa cómo el menú lateral se reconfigura de inmediato para mostrar únicamente las opciones y accesos autorizados para ese perfil.',
      'Por ejemplo, al elegir «Contador Público» verás únicamente Catálogo PUC NIIF, Registrar Asiento Diario y Centro de Estados Financieros.',
      'Al seleccionar «Vendedor» tendrás acceso a Mostrador/POS, Inventario de Bodega y Cierre de Caja.',
      'Al seleccionar «Transporte» verás Traslados Multisede, Mapa GPS en Vivo, Despachos y Trazabilidad.',
      'El rol «Administrador Central» cuenta con acceso a Empresas Clientes, Scripts SQL y Activación de Planes, manteniendo su cubeta de prueba de producción separada de los clientes.',
    ],
  },
  {
    id: 'inicio', title: 'Crear cuenta e iniciar sesión', icon: LogIn, roles: ALL_ROLES, mock: 'login',
    summary: 'Entra al sistema desde el navegador de tu teléfono, tablet o computador. Al registrarte tienes 3 meses de prueba gratis.',
    steps: [
      'Abre la dirección del sistema y pulsa «Prueba gratis 3 meses» (dueños) o «Iniciar sesión» (si ya tienes cuenta).',
      'Para crear una cuenta escribe tu nombre, correo y una contraseña de mínimo 6 caracteres, acepta los términos y pulsa «Crear cuenta».',
      'Revisa tu correo y confirma la cuenta. Luego inicia sesión con tu correo y contraseña.',
      'Si olvidaste la contraseña, pulsa «¿Olvidaste tu contraseña?» y te llegará un enlace para crear una nueva.',
    ],
    tips: ['Los vendedores y contadores no se registran solos: el dueño los invita a su empresa.', 'Usa el ojo del campo de contraseña para verla mientras la escribes.'],
  },
  {
    id: 'instalar', title: 'Instalar la app y trabajar sin señal', icon: WifiOff, roles: ALL_ROLES, mock: 'offline',
    summary: 'Puedes instalar InventarioPro como una app en tu teléfono. Si se va la señal sigues vendiendo: todo queda guardado y se envía solo al volver internet.',
    steps: [
      'En el menú pulsa «Instalar app» (aparece cuando tu navegador lo permite) y confirma. Verás el ícono en tu pantalla de inicio.',
      'Abre la app con internet al menos una vez al día para que descargue productos, clientes y precios actualizados.',
      'Sin señal verás un aviso amarillo. Registra ventas, visitas y clientes nuevos con normalidad.',
      'Al volver la señal el sistema envía todo automáticamente. También puedes pulsar «Enviar ahora» en «Pendientes de enviar».',
      'Si el servidor rechaza algo (por ejemplo, sin stock) aparece en rojo con el motivo: pulsa «Reintentar» o «Descartar».',
    ],
    tips: ['Lo guardado sin señal vive en ese teléfono: no cierres sesión ni borres los datos del navegador hasta que se envíe.', 'El stock se descuenta en tu teléfono al instante para que no vendas de más.'],
  },
  {
    id: 'panel', title: 'Panel principal y mi meta', icon: LayoutDashboard, roles: BOTH, page: 'dashboard', mock: 'panel',
    summary: 'Es la primera pantalla: un resumen de cómo va el negocio. Si eres vendedor, aquí ves tu meta del mes.',
    steps: [
      'Revisa las tarjetas de arriba: ventas, productos y alertas de stock bajo.',
      'Vendedor: en la tarjeta «Mi meta» ves cuánto has vendido, cuánto te falta y cuánto debes vender por día para cumplirla.',
      'Debajo aparecen las ventas recientes. Toca una para ver el detalle.',
    ],
    tips: ['Si la barra de tu meta va lenta, mira cuánto necesitas vender por día para alcanzarla.'],
  },
  {
    id: 'copiloto', title: 'Copiloto: tu asistente que te avisa', icon: Sparkles, roles: BOTH, page: 'copilot', mock: 'copilot',
    summary: 'El Copiloto vigila tu negocio todo el día con tus propios datos y te avisa lo importante antes de que se vuelva un problema. Es gratis y viene incluido.',
    steps: [
      'Mira la campanita (arriba, en el teléfono) o el ítem «Copiloto» del menú: el número rojo son las alertas pendientes. También verás las 3 más importantes en el Panel.',
      'Cada alerta es una tarjeta. Roja = urgente, amarilla = por atender, verde = buena noticia o información.',
      'Dentro de la tarjeta ves el detalle (por ejemplo, qué productos y cuántos días de stock les quedan) y un botón que te lleva directo a resolverlo.',
      'Pulsa la X para ocultar una alerta por hoy. Si el problema sigue, mañana vuelve a aparecer. En «Ver alertas ocultadas» puedes recuperarla.',
      'Se actualiza sola cada 5 minutos. Pulsa «Actualizar» si quieres una lectura nueva ahora mismo.',
    ],
    tips: [
      'Dueño y administrador: el Copiloto avisa de productos por agotarse, mercancía que no se mueve hace 60 días, clientes que dejaron de comprar, descuentos muy altos, ventas por debajo del costo, vendedores que no llegan a su meta, cotizaciones por vencer, clientes con deuda vencida (fiado) y pendientes contables.',
      'Vendedor: te avisa tu avance de meta y cuánto necesitas vender por día, tus clientes sin visitar hace más de 3 semanas, productos por agotarse y cotizaciones por vencer.',
      'Cada persona ve solo lo suyo y todo se calcula con los datos de tu propia empresa.',
      'Sin señal muestra la última lectura guardada en tu teléfono.',
    ],
  },
  {
    id: 'resumen', title: 'Resumen del día', icon: CalendarDays, roles: OWNER, page: 'summary', mock: 'summary',
    summary: 'Un reporte corto de cómo te fue: cuánto vendiste, cómo te pagaron, qué se vendió más, qué pasó en caja y cómo va tu cartera e inventario.',
    steps: [
      'Entra a «Resumen del día». Por defecto muestra hoy; pulsa «Ayer» o elige cualquier fecha para ver otro día.',
      'Arriba ves lo vendido, el número de ventas y el promedio por venta, con la comparación contra el día anterior y contra el mismo día de la semana pasada.',
      'Más abajo: forma de pago, lo más vendido, lo que entró y salió de caja, devoluciones, compras recibidas, cartera (fiado) y alertas de inventario.',
      'Más abajo puedes activar el «Aviso diario en tu celular»: eliges la hora y cada día te llega una notificación con el resumen, sin abrir la app.',
      'Pulsa «WhatsApp» para enviarte el resumen (o mandárselo a tu socio) ya escrito, «Copiar» para pegarlo donde quieras o «Imprimir» para guardarlo en PDF.',
    ],
    tips: [
      'Una buena costumbre: míralo cada noche al cerrar, o cada mañana con «Ayer».',
      'Las ventas anuladas no se cuentan.',
      'El día se mide con la hora de tu teléfono, así que coincide con tu cierre de caja.',
    ],
  },
  {
    id: 'mando', title: 'Centro de Mando (el negocio en vivo)', icon: Gauge, roles: OWNER, page: 'command', mock: 'panel',
    summary: 'Una sola pantalla para ver cómo va el negocio ahora mismo: ventas del día, caja, equipo, cartera e inventario, con semáforos que te dicen qué mirar primero.',
    steps: [
      'Entra a «Centro de mando». Arriba verás «En vivo» cuando está conectado: cuando alguien vende, visita a un cliente o mueve la caja, la pantalla se actualiza sola.',
      'Mira primero los semáforos: Ventas, Cobranza, Inventario, Equipo y Control. Verde es «Bien», amarillo es «Atención», rojo es «Crítico» y gris es «Sin datos». Cada uno trae una nota corta con el porqué.',
      'Las tarjetas grandes muestran las ventas de hoy con el cierre estimado del día, las operaciones y el ticket promedio comparado con los últimos 30 días, las ventas del mes y la caja neta de hoy (lo que entra menos lo que sale).',
      'Más abajo: ventas acumuladas por hora contra lo habitual, alertas, tendencia de 14 días, cómo te pagan este mes, las horas más fuertes de las últimas 8 semanas, el avance del equipo, la cartera por cobrar y el inventario en riesgo.',
      'Si una alerta dice «visita con alerta de ubicación», pulsa «Ver en el mapa» para revisar dónde se hizo. Los botones «Metas», «Cartera» y «Sugerencias de compra» te llevan directo a cada módulo.',
      '«Actividad en vivo» lista lo último que pasó en el negocio. Pulsa el botón de pantalla completa para dejarlo proyectado en una pantalla o TV del local.',
    ],
    tips: [
      'Es solo para el dueño y el administrador. Los vendedores no lo ven.',
      'Se actualiza solo cada 5 minutos y, además, al instante cuando hay movimiento. Pulsa el botón de actualizar si quieres una lectura nueva.',
      'El cierre estimado es una proyección con tu ritmo habitual a esa hora: sirve de guía, no es una cifra definitiva.',
    ],
  },
  {
    id: 'preguntar', title: 'Pregúntale al Copiloto', icon: MessageCircleQuestion, roles: BOTH, page: 'ask', mock: 'ask',
    summary: 'Escríbele preguntas con tus propias palabras y te responde al instante con los datos de tu negocio. Es gratis.',
    steps: [
      'Entra a «Pregúntale al Copiloto» y escribe, por ejemplo: «¿cuánto vendí hoy?». También puedes tocar una de las preguntas sugeridas.',
      'Puedes preguntar por ventas (hoy, ayer, esta semana, este mes o el mes pasado), lo más vendido, tus mejores clientes y la ganancia estimada.',
      'Para el inventario: «¿cuántas camisas quedan?», «precio del arroz» o «¿qué se está agotando?».',
      'Para la cartera: «¿quién me debe?» o «¿cuánto debe Ana?». Debajo de la respuesta aparece un botón para ir directo al módulo.',
    ],
    tips: [
      'Escribe como hablas; no importan las tildes ni las mayúsculas.',
      'Si no encuentra un producto o cliente, prueba con solo una parte del nombre.',
      'El vendedor ve únicamente sus propias ventas; la ganancia y los mejores clientes son solo para el dueño y el administrador.',
      'Las respuestas salen de tus datos, sin enviarlos a ningún servicio externo.',
    ],
  },
  {
    id: 'lotes', title: 'Lotes y vencimientos', icon: CalendarClock, roles: OWNER, page: 'lots', mock: 'lots',
    summary: 'Para productos que se vencen (alimentos, medicinas, cosméticos): controla cada lote, véndelo en orden y que nada se te venza sin enterarte.',
    steps: [
      'Entra a «Lotes y vencimientos» y abre «Productos que controlan vencimiento». Pulsa «Activar» en los productos que se vencen. Los demás siguen igual que siempre.',
      'Cuando compres uno de esos productos, en «Compras» aparecerá la fecha de vencimiento (obligatoria) y el código de lote (opcional). Cada compra crea su propio lote.',
      'Al vender, el sistema descuenta solo del lote que vence primero. No tienes que elegir nada.',
      'Si ya tenías stock de ese producto, en «Stock sin lote» pulsa «Lote» y asígnale su fecha de vencimiento. No cambia el stock.',
      'En la lista, los lotes vencidos salen en rojo. Pulsa «Dar de baja» para sacarlos del inventario: el stock baja y queda en el Kardex con el motivo.',
      'El Copiloto te avisa de los lotes vencidos o que vencen en los próximos 30 días.',
    ],
    tips: [
      'El sistema no deja vender mercancía vencida: si lo único que queda está vencido, la venta se rechaza hasta que lo des de baja.',
      'Una devolución regresa las unidades al lote de donde salieron, y anular una venta también.',
      'No se puede anular una compra si ya se vendió o dio de baja parte de sus lotes.',
      'Si cambias el stock a mano con «Ajustar stock», los lotes se recortan para que nunca sumen más que el stock.',
      'Las ventas que nacen de una cotización también descuentan del lote que vence primero.',
      'Si algún día los lotes suman más que el stock (por un cambio hecho directamente en la base de datos), aparece el aviso «Cuadrar lotes» para corregirlo.',
    ],
  },
  {
    id: 'sugerencia', title: 'Sugerencia de compras', icon: ShoppingBasket, roles: OWNER, page: 'buyplan', mock: 'buyplan',
    summary: 'Te dice qué productos conviene comprar, cuántas unidades y a qué proveedor, según lo que realmente vendes.',
    steps: [
      'Entra a «Sugerencia de compras». Arriba elige para cuántos días quieres tener mercancía: 7, 15 o 30.',
      'Verás los productos agrupados por proveedor, los más urgentes primero. Cada uno muestra el stock, cuánto vendes por día y en cuántos días se te acaba.',
      'La cantidad a pedir ya viene calculada. Puedes cambiarla o quitar la marca de un producto que no quieras pedir; el total se actualiza solo.',
      'Pulsa «Copiar pedido» o «WhatsApp» en el proveedor para enviarle la lista. También puedes «Imprimir lista».',
      'Cuando llegue la mercancía, regístrala en «Compras»: ahí sube el stock. Esta pantalla solo sugiere, no registra nada.',
    ],
    tips: [
      'El cálculo usa tus ventas de los últimos 30 y 90 días, sin contar ventas anuladas, y nunca baja del stock mínimo del producto.',
      'El costo y el proveedor salen de tu última compra de ese producto. Si nunca lo compraste por el sistema, usa el costo del producto y queda «Sin proveedor asignado».',
      'Si un producto vendió poco por falta de stock, la sugerencia puede quedarse corta: revisa las cantidades antes de pedir.',
    ],
  },
  {
    id: 'predicciones', title: 'Predicciones', icon: TrendingUp, roles: OWNER, page: 'predict', mock: 'predict',
    summary: 'Te muestra qué clientes se están enfriando y qué productos se van a agotar, sobrarán o están subiendo, con las razones y qué tan confiable es cada estimación.',
    steps: [
      'Entra a «Predicciones». Arriba elige entre «Clientes» y «Productos».',
      'En Clientes verás quién está en riesgo de dejar de comprar. Cada tarjeta explica el motivo, por ejemplo «compraba cada ~10 días y lleva 45 sin comprar». Puedes filtrar por vendedor.',
      'Pulsa «WhatsApp» en un cliente que se enfrió para escribirle un mensaje de reencuentro ya redactado.',
      'En Productos verás los que se agotan pronto, los que sobran, los que suben o bajan de ventas y los que tuvieron una semana fuera de lo normal. Toca un producto para ver su gráfico semanal.',
      'Si un producto tiene pedido sugerido, el botón te lleva a «Sugerencia de compras» para armar el pedido.',
    ],
    tips: [
      'Es una estimación hecha con tu historial, no una garantía: cada tarjeta dice si la confianza es alta, media, baja o si faltan datos.',
      'Se separa lo observado (lo que está registrado) de lo estimado (la proyección).',
      'Las devoluciones se descuentan y las ventas anuladas no cuentan.',
      'Un cliente nuevo con una sola compra aparece como «aún no repite»: todavía no hay base para decir que se enfrió.',
    ],
  },
  {
    id: 'rentabilidad', title: 'Rentabilidad por producto', icon: PieChart, roles: OWNER, page: 'profit', mock: 'profit',
    summary: 'Te muestra cuánto gana de verdad cada producto, qué productos sostienen tu negocio y cuáles se venden con poco margen o por debajo del costo.',
    steps: [
      'Entra a «Rentabilidad» y elige el periodo: 7, 30 o 90 días, este mes o fechas que tú escojas. También puedes filtrar por vendedor o categoría.',
      'Arriba ves el ingreso (sin impuesto), el costo de lo vendido, la utilidad estimada y el margen, comparados con el periodo anterior de la misma duración.',
      'Cada producto muestra sus unidades, ingreso, utilidad y margen. La «Clase A» son los pocos productos que producen el 80 % de tu utilidad; la B hasta el 95 % y la C el resto.',
      'Usa los filtros «En pérdida», «Margen bajo» y «Sin costo» para encontrar lo que debes corregir: subir el precio, renegociar con el proveedor o completar el costo.',
      'Pulsa el botón de descarga para bajar el reporte en CSV y abrirlo en Excel.',
    ],
    tips: [
      'La utilidad usa el costo actual de cada producto. Si el proveedor cambió el precio, el cálculo de ventas pasadas es una estimación.',
      'Los descuentos y el impuesto ya están descontados, y las devoluciones se restan del ingreso y de las unidades.',
      'Un producto «Sin costo» no muestra una utilidad confiable: completa el costo en Productos para que cuente bien.',
      'Un producto de clase C no es malo por sí solo: puede ser un producto que completa el servicio. Mira su margen y su rotación antes de decidir.',
    ],
  },
  {
    id: 'cartera', title: 'Fiado y cartera (cuentas por cobrar)', icon: Banknote, roles: BOTH, page: 'cartera', mock: 'cartera',
    summary: 'Vende a crédito a clientes de confianza y lleva el control de quién te debe, cuánto y desde cuándo. Los abonos se reparten solos.',
    steps: [
      'Para vender a crédito, en Ventas o en el Mostrador elige un cliente registrado y, como forma de pago, «Fiado». La venta no entra a la caja: el cliente queda debiendo ese valor.',
      'Entra a «Cartera (fiado)»: arriba ves cuánto te deben en total y cuánto ya está vencido. Cada cliente con deuda aparece en una tarjeta; los vencidos llevan la etiqueta roja.',
      'Toca un cliente para ver sus ventas pendientes (con la fecha en que vencen) y su historial de abonos.',
      'Para cobrar, escribe el valor del abono y la forma de pago, y pulsa «Registrar abono». Se aplica primero a la deuda más vieja. Si pagó en efectivo, el dinero entra a la caja.',
      'Dueño y administrador: en «Cupo y plazo» fijan hasta cuánto se le puede fiar a ese cliente (0 = sin límite) y a cuántos días vence cada venta (por defecto 30).',
      'Dueño y administrador: pueden anular un abono mal registrado; la deuda vuelve a subir y, si fue en efectivo, sale de la caja.',
    ],
    tips: [
      'El fiado exige conexión a internet, porque el sistema revisa el cupo del cliente al momento de vender.',
      'Si un cliente supera su cupo, el sistema no deja registrar la venta y te dice cuánto debe y cuál es su cupo.',
      'El botón «Recordar» abre WhatsApp con un mensaje de cobro ya escrito (el cliente debe tener teléfono).',
      'Una devolución sobre una venta fiada baja la deuda del cliente; no entrega dinero. Para anular una venta fiada que ya tiene abonos, primero anula esos abonos.',
      'Contabilidad: el dueño elige una sola vez la cuenta de «Clientes por cobrar» (normalmente la 1305). Mientras no la elija, nada se pierde: queda pendiente de contabilizar.',
    ],
  },
  {
    id: 'categorias', title: 'Categorías', icon: Tag, roles: OWNER, page: 'categories', mock: 'products',
    summary: 'Agrupa tus productos (bebidas, aseo, ropa…) para encontrarlos rápido y filtrar los reportes por categoría.',
    steps: [
      'Entra a «Categorías» y pulsa «Nueva». Escribe el nombre y, si quieres, una descripción corta.',
      'Para cambiar el nombre pulsa el lápiz de la tarjeta; para borrarla, el bote de basura.',
      'Después, al crear o editar un producto en «Productos», elige su categoría.',
    ],
    tips: [
      'Crea tus categorías antes de cargar el catálogo: así cada producto nace ordenado.',
      'Usa pocas categorías y con nombres claros; luego podrás ver la rentabilidad por categoría.',
    ],
  },
  {
    id: 'productos', title: 'Productos, variantes (tallas/medidas), fotos y códigos', icon: Package, roles: OWNER, page: 'products', mock: 'products',
    summary: 'Crea tu catálogo con fotografía real, costo, precio de detal, precio mayorista, código SKU y cualidades o presentaciones (tallas, ml, L, kg, cajas).',
    steps: [
      'Pulsa «Nuevo producto» y escribe nombre, categoría, costo, precio (detal), unidad base y stock inicial.',
      'Sube una fotografía del producto y marca si deseas mostrarlo o destacarlo en tu Catálogo comercial público.',
      'Precio por mayor: escribe el valor y «Desde cuántas unidades». Ejemplo: camisa $30.000 detal, $25.000 por mayor desde 5 unidades.',
      'Cualidades o variantes (opcional): agrega tallas (S, M, L, XL) o presentaciones (Six-pack, Caja x12) indicando cuántas unidades base descuenta cada una.',
      'En «SKU / código de barras» pulsa «Leer» para escanear con la cámara o «Generar» para crear uno único, y guarda.',
    ],
    tips: ['El SKU no se puede repetir: si lo escaneas dos veces el sistema te avisa.', 'También puedes importar o actualizar productos masivamente por archivo CSV.'],
  },
  {
    id: 'catalogo', title: 'Catálogo comercial, vitrina web y enlace de WhatsApp', icon: BookOpen, roles: BOTH, page: 'catalog', mock: 'catalog',
    summary: 'Comparte tu lista de precios en PDF o publica tu propia tienda digital con enlace personalizado para que tus clientes elijan tallas/medidas y suban su comprobante.',
    steps: [
      'Entra a «Catálogo comercial». Elige qué precios mostrar (Detal, Mayorista, Detal + Mayor o Sin precios) y filtra por categoría si deseas.',
      'Dueño: pulsa «Identidad y Pagos» para subir el logo de tu empresa, elegir colores corporativos, activar entrega en sede o domicilio y configurar tus cuentas de Pago Móvil, Nequi, Zelle o Transferencia.',
      'Pulsa «Enlace y WhatsApp» para personalizar el identificador limpio de tu tienda (ej. /tienda/mi-empresa) y el mensaje de saludo del asesor.',
      'Pulsa «WhatsApp» para enviar la vitrina con tarjeta visual de tu marca, «QR» para mostrar el código en el mostrador o «Exportar PDF» para generar el catálogo ilustrado listo para imprimir.',
    ],
    tips: [
      'Cuando cambies el nombre o logo de tu empresa en Configuración o Identidad, la tarjeta pública del enlace se sincroniza automáticamente.',
      'Si WhatsApp en tu celular sigue mostrando un título viejo al pegar un enlace antiguo, es caché temporal de WhatsApp: usa el enlace limpio nuevo (/tienda/tu-slug) para refrescar la vista previa.',
    ],
  },
  {
    id: 'pedidosweb', title: 'Pedidos de catálogo, validación OCR de captures y anti-duplicados', icon: ClipboardCheck, roles: OWNER_CPA, page: 'catorders', mock: 'catorders',
    summary: 'Recibe los pedidos hechos por tus clientes desde la vitrina web, audita ópticamente los captures de pago para evitar fraudes y conviértelos en venta facturada.',
    steps: [
      'Entra a «Pedidos de catálogo» y selecciona un pedido de la bandeja (puedes filtrar «Por verificar capture»).',
      'En el recuadro «Capture / Recibo adjunto» toca la imagen para ampliarla o pulsa «Auditar capture (OCR)» para que el lector óptico extraiga banco, número de referencia, fecha, monto y estado real de la transacción.',
      'Si el cliente te mandó el pantallazo por WhatsApp o en PDF, pulsa «Subir y auditar capture»: el archivo queda archivado de forma privada en el pedido y se audita en el mismo paso.',
      'Revisa el panel de Auditoría Óptica: confirma si el monto coincide con el total del pedido y verifica la alerta verde de «Referencia única» (si alguien intenta reutilizar el mismo número de referencia en otro pedido, saldrá una alerta roja indicando en qué orden ya se usó).',
      'Pulsa «Aplicar referencia y datos leídos al pedido» si deseas guardar los datos extraídos, elige la bodega de salida y pulsa «Corroborar pago y facturar venta» para descontar stock e ingresar el cobro.',
    ],
    tips: [
      'Nunca despaches mercancía si el lector indica estado «Pendiente / Pantalla previa» antes de confirmar en tu banca en línea.',
      'Una vez corroborado, puedes marcar el pedido como «En ruta / Despachado» y «Entregado», o notificar al cliente por WhatsApp con un toque.',
    ],
  },
  {
    id: 'escanerocr', title: 'Escáner óptico (OCR): cuaderno sin luz, facturas de compra y recibos', icon: ScanLine, roles: BOTH, page: 'sales', mock: 'ocr',
    summary: 'Toma una foto o sube un PDF para convertir apuntes escritos a mano, facturas de mercancía o recibos de agua y luz en registros reales dentro del sistema.',
    steps: [
      'Ventas anotadas a mano («Cuaderno sin luz»): en «Ventas» o en «Mostrador (POS)» pulsa «Escanear cuaderno». Sube la foto de la hoja escrita a mano cuando no hubo electricidad o internet; el sistema empareja cada renglón con tu catálogo y clientes, te muestra una tabla editable para revisar cantidades y precios, y registra todas las ventas descontando stock.',
      'Facturas o tickets de compra de mercancía: en «Compras» pulsa «Escanear factura / ticket». Toma foto o sube el PDF del proveedor; el sistema lee NIT/documento, ítems, cantidades, costos unitarios, lotes y vencimientos, permitiéndote crear al vuelo productos nuevos antes de ingresar el stock.',
      'Recibos de agua, luz, gas, internet o arriendo: en «Gastos operativos» pulsa «Escanear recibo (Agua, Luz, Gastos)». Sube uno o varios recibos y el lector extrae empresa prestadora, número de referencia, fecha, monto y categoría contable sugerida.',
      'Comprobantes bancarios: en «Pedidos de catálogo» usa «Auditar capture (OCR)» para validar pantallazos de pago y detectar referencias duplicadas.',
    ],
    tips: [
      'Siempre verás una vista previa editable antes de guardar: nada afecta tu inventario, caja ni contabilidad sin tu confirmación final.',
      'Si el usuario accidentalmente sube un recibo de luz en Compras (o una factura de mercancía en Gastos), el sistema lo detecta y te avisa para registrarlo en el módulo correcto.',
    ],
  },
  {
    id: 'etiquetas', title: 'Etiquetas con código de barras o QR', icon: QrCode, roles: OWNER, page: 'labels', mock: 'labels',
    summary: 'Imprime etiquetas para pegar en tus productos y luego escanearlas en el mostrador.',
    steps: [
      'Entra a «Etiquetas» y elige los productos (puedes imprimir varias copias de cada uno).',
      'Escoge el tipo: código de barras o QR, y el tamaño: pequeña (40×25 mm), mediana (60×35) o grande (90×50).',
      'Decide si la etiqueta muestra nombre, precio, código y línea de corte.',
      'Revisa la vista previa y pulsa «Imprimir». Puedes guardar como PDF si no tienes impresora a mano.',
    ],
    tips: ['Si un SKU tiene tildes o caracteres especiales, la etiqueta sale en QR automáticamente.', 'Haz primero una prueba con 1 etiqueta de cada tamaño antes de imprimir un lote grande.'],
  },
  {
    id: 'clientes', title: 'Clientes y tipo de precio', icon: Users, roles: BOTH, page: 'customers', mock: 'clients',
    summary: 'Tu cartera de clientes. Cada uno puede ser de Detal o Por mayor; así el sistema aplica el precio correcto solo.',
    steps: [
      'Pulsa «Nuevo cliente» y completa nombre, documento, teléfono, correo y dirección.',
      'En «Tipo de precio» elige Detal o Por mayor. Los clientes mayoristas muestran la etiqueta «Mayor».',
      'Puedes crear clientes sin señal: quedan listos para venderles de inmediato y se sincronizan después.',
    ],
    tips: ['Una buena dirección ayuda a que el mapa de rutas ordene tus visitas.'],
  },
  {
    id: 'ventas', title: 'Ventas de ruta y carga de apuntes', icon: ShoppingCart, roles: BOTH, page: 'sales', mock: 'sales',
    summary: 'Para vender visitando clientes, consultar todo el historial de facturación o digitalizar hojas de ventas escritas a mano.',
    steps: [
      'Pulsa «Nueva venta» y elige el cliente (o «Cliente general»). Si anotaste ventas en papel por falta de energía, pulsa «Escanear cuaderno».',
      'Selecciona el producto, la cantidad y pulsa «+». Repite por cada producto.',
      'El precio por mayor se aplica solo: si el cliente es Por mayor desde la primera unidad, y si es de detal cuando la cantidad llega al mínimo del producto. Verás la etiqueta «Mayor».',
      'Elige la forma de pago (efectivo, tarjeta, transferencia o fiado) y revisa el total con el impuesto.',
      'Pulsa «Registrar venta». Si la empresa lo exige, el sistema te pedirá confirmar tu ubicación.',
      'Cliente que no compró: usa «Visité y no compró», elige el cliente y anota el motivo.',
      'Para enviar el comprobante pulsa «Ver / Enviar»: imprime, guarda PDF, o comparte por WhatsApp o correo.',
    ],
    tips: ['Solo el dueño o administrador puede anular una venta; al anular regresa el stock y se revierte la caja.', 'Las ventas del mostrador y de pedidos web aparecen aquí identificadas por su origen.'],
  },
  {
    id: 'mostrador', title: 'Mostrador (venta rápida en el local)', icon: Store, roles: BOTH, page: 'pos', mock: 'pos',
    summary: 'La caja rápida del local: vende buscando por nombre o código, escaneando con cámara o lector USB, con descuentos, ticket y carga desde cuaderno.',
    steps: [
      'Busca el producto por nombre o código, o pulsa el ícono de cámara y escanea la etiqueta. Con lector USB basta con escanear y se agrega solo.',
      'Ajusta la cantidad con los botones − y +. El precio por mayor se aplica al llegar a la cantidad mínima.',
      'Elige el cliente si quieres; si es mayorista el sistema usa su precio. También puedes forzar «Detal» o «Por mayor» para esa venta.',
      'Aplica un descuento en $ o en % si corresponde. Se resta antes del impuesto.',
      'Elige el pago. En efectivo escribe cuánto te dan y el sistema calcula el cambio.',
      'Pulsa cobrar. Imprime el ticket o envíalo por WhatsApp. Si hubo corte eléctrico, usa el botón «Cuaderno» arriba para digitalizar las ventas anotadas en papel.',
    ],
    tips: ['Abajo ves lo vendido hoy en el mostrador.', 'Funciona sin señal: el ticket se genera igual y la venta se envía después.'],
  },
  {
    id: 'cotizaciones', title: 'Cotizaciones', icon: FileText, roles: BOTH, page: 'quotations', mock: 'quotes',
    summary: 'Presupuestos para tus clientes que luego puedes convertir en venta con un toque.',
    steps: [
      'Pulsa «Nueva cotización», elige cliente y agrega productos.',
      'Envíala por WhatsApp, correo o imprímela en PDF.',
      'Cuando el cliente acepte, pulsa «Convertir en venta»: se descuenta el stock y entra a caja.',
      'Marca el estado: Pendiente, Aceptada, Rechazada o Vencida.',
    ],
  },
  {
    id: 'sedes', title: 'Sedes, multibodega y traslados', icon: Building2, roles: OWNER, page: 'warehouses', mock: 'warehouses',
    summary: 'Administra varias sucursales o bodegas independientes, consulta existencias por sede y traslada mercancía con trazabilidad completa.',
    steps: [
      'Entra a «Sedes y multibodega» para crear tus sucursales o almacenes (por ejemplo: Sede Principal, Bodega Mayorista, Punto Norte).',
      'En la barra superior del sistema puedes cambiar la sede activa para ver o despachar inventario desde esa bodega.',
      'Para mover mercancía de un local a otro usa «Nuevo traslado»: elige bodega origen, bodega destino, productos y cantidades.',
      'Al confirmar el traslado se descuenta de origen, suma en destino y ambos movimientos quedan auditados en el Kardex.',
    ],
    tips: ['Al facturar un pedido de catálogo o registrar una compra puedes indicar exactamente qué bodega afecta el stock.'],
  },
  {
    id: 'ordenescompra', title: 'Órdenes de compra y cuentas por pagar', icon: Receipt, roles: OWNER_CPA, page: 'purchaseorders', mock: 'purchases',
    summary: 'Emite órdenes formales a tus proveedores antes de recibir la mercancía y controla tus facturas a crédito en Cuentas por pagar.',
    steps: [
      'En «Órdenes de compra» crea el pedido al proveedor, envíalo en PDF o por WhatsApp y haz seguimiento de lo recibido frente a lo pedido (recepción parcial o total).',
      'Cuando compras a plazo en «Compras» (eligiendo pago «Crédito» y días de vencimiento), la obligación pasa automáticamente a «Cuentas por pagar».',
      'Entra a «Cuentas por pagar» para ver facturas por vencer o vencidas y registrar abonos parciales o pagos totales desde Caja o Bancos.',
    ],
    tips: ['Mantener tus cuentas por pagar al día alimenta automáticamente la proyección de liquidez en Tesorería.'],
  },
  {
    id: 'compras', title: 'Compras, escáner de facturas y proveedores', icon: Truck, roles: OWNER_CPA, page: 'purchases', mock: 'purchases',
    summary: 'Registra la mercancía que ingresa digitándola o escaneando la factura/ticket del proveedor para subir stock y actualizar costos.',
    steps: [
      'En «Proveedores» crea a quien te surte (nombre, NIT/documento, teléfono, dirección).',
      'En «Compras» pulsa «Nueva compra» para carga manual, o pulsa «Escanear factura / ticket» para subir una foto o PDF de la factura del proveedor.',
      'Si usas el escáner, revisa los productos detectados (puedes marcar «Crear nuevo» si algún artículo aún no existe en tu catálogo), confirma proveedor y método de pago (contado o crédito) y guarda.',
      'El stock aumenta de inmediato, se actualiza el costo unitario y el movimiento queda en el Kardex.',
    ],
    tips: ['Actualiza el costo en cada compra: de ahí salen tus márgenes reales y el costo de ventas contable.'],
  },
  {
    id: 'gastos', title: 'Gastos operativos (agua, luz, arriendo) y Tesorería', icon: TrendingDown, roles: OWNER_CPA, page: 'expenses', mock: 'expenses',
    summary: 'Registra servicios públicos, nómina, fletes y alquileres (con escáner óptico de recibos) y proyecta tu flujo de caja a 30, 60 y 90 días.',
    steps: [
      'Entra a «Gastos operativos». Pulsa «Nuevo gasto» o usa «Escanear recibo (Agua, Luz, Gastos)» para tomar foto a tus facturas de energía, acueducto, gas, internet o compras menores.',
      'Verifica la categoría asignada (Servicios públicos, Arriendo, Transporte, etc.), el método de pago (Efectivo descuenta de Caja; Transferencia afecta Bancos) y confirma.',
      'Entra a «Tesorería y presupuesto» para cruzar tu efectivo actual + cartera por cobrar frente a tus cuentas por pagar + gastos fijos presupuestados en los próximos 30, 60 y 90 días.',
    ],
    tips: ['Puedes subir varios recibos de servicios públicos al mismo tiempo en el escáner para contabilizar todos los gastos del mes en un minuto.'],
  },
  {
    id: 'caja', title: 'Caja', icon: Wallet, roles: BOTH, page: 'cash', mock: 'cash',
    summary: 'Control del dinero del día: las ventas en efectivo entran solas y tú registras otros ingresos y egresos.',
    steps: [
      'Revisa el saldo actual y los movimientos del día.',
      'Pulsa «Nuevo movimiento», elige Ingreso o Egreso, escribe el monto y una descripción clara (ej: retiro del dueño).',
      'Al final de la jornada compara el saldo con el dinero físico y pulsa «Cerrar caja».',
    ],
    tips: ['Anular una venta revierte su movimiento en caja automáticamente.'],
  },
  {
    id: 'devoluciones', title: 'Devoluciones', icon: Undo2, roles: BOTH, page: 'devolutions', mock: 'returns',
    summary: 'Cuando un cliente devuelve producto: regresa al stock y se ajusta el dinero.',
    steps: [
      'Pulsa «Nueva devolución» y selecciona la venta.',
      'Indica el producto, la cantidad devuelta y el motivo.',
      'Confirma. El producto vuelve al inventario y queda registrado.',
    ],
  },
  {
    id: 'kardex', title: 'Kardex e historial', icon: ClipboardList, roles: BOTH, page: 'kardex', mock: 'kardex',
    summary: 'La trazabilidad: cada entrada y salida de cada producto, y quién hizo cada acción.',
    steps: [
      'En «Kardex» busca un producto para ver sus entradas (compras, devoluciones) y salidas (ventas) con fecha.',
      'En «Historial» filtra por módulo y tipo de acción (creaciones, actualizaciones, anulaciones y eliminaciones) o busca por usuario, proveedor, producto o ID. Así sabes quién hizo cada cambio y cuándo.',
    ],
    tips: ['Si el stock no cuadra, el kardex te dice exactamente qué movimiento lo cambió.'],
  },
  {
    id: 'reportes', title: 'Reportes, estadísticas e impuestos', icon: FileBarChart, roles: OWNER, page: 'reports', mock: 'reports',
    summary: 'Resúmenes imprimibles de ventas, compras, caja, devoluciones y kardex, por día, semana, mes o año.',
    steps: [
      'Elige el módulo (pestañas de arriba) y el período; cambia la «Fecha de referencia» si quieres ver otro día o mes.',
      'En «Ventas de» filtra por canal: Todas, Ruta o Mostrador. El filtro solo afecta a las ventas.',
      'Pulsa «Imprimir» para sacar el reporte con el encabezado de tu empresa o guardarlo como PDF.',
      '«Estadísticas» muestra gráficos de ventas mensuales y tendencias.',
      '«Impuestos» resume lo vendido y el impuesto por tasa, por día o por mes, listo para tu contador.',
    ],
    tips: ['Las ventas anteriores al canal «Mostrador» cuentan como ruta.'],
  },
  {
    id: 'impuestos', title: 'Impuestos: lo que cobraste por período', icon: Percent, roles: OWNER_CPA, page: 'taxes', mock: 'reports',
    summary: 'Muestra la base, el impuesto cobrado y el total de tus ventas por período, listo para llevar a tu contador.',
    steps: [
      'Antes de usarlo, define cómo cobras el impuesto en «Configuración» (sin impuesto, incluido en el precio o adicional) y su porcentaje.',
      'Entra a «Impuestos» y elige el período (día, semana, mes, trimestre, semestre, año o todo) y la fecha de referencia.',
      'Revisa los totales y las tablas «Por tasa de impuesto», «Por día» o «Por mes» y el «Detalle de ventas».',
      'Pulsa «Imprimir» para guardarlo en PDF o el botón de descarga para bajar el detalle en CSV y abrirlo en Excel.',
    ],
    tips: [
      'Las ventas anuladas no se cuentan.',
      'Las ventas hechas sin impuesto aparecen con tasa 0 y no suman impuesto.',
      'Esto es un resumen de tus ventas, no una declaración: tu contador decide cómo usarlo según las reglas de tu país.',
    ],
  },
  {
    id: 'despachocpa', title: 'Despacho contable (Hoja de 8 columnas, NIIF y Centros de costo)', icon: Layers, roles: OWNER_CPA, page: 'cpa', mock: 'cpa',
    summary: 'Estación profesional para el Contador Público: conciliación operativa vs. libros, hoja de trabajo de 8 columnas, indicadores financieros, cédula tributaria y análisis por sede.',
    steps: [
      'Entra a «Despacho contable» para verificar de un vistazo la Ecuación Patrimonial (Activo = Pasivo + Patrimonio) y el puente de conciliación entre Ventas/Compras/Gastos y el Mayor General.',
      'Revisa la Hoja de Trabajo de 8 columnas (Saldos iniciales, Movimientos del período, Ajustes/Cierre, Estado de Resultados y Estado de Situación Financiera).',
      'Completa la lista de auditoría y los datos de firma profesional del Contador Público para emitir papeles de trabajo formales en PDF o Excel.',
      'En «Centros de costo» consulta el Estado de Resultados analítico separado por cada sucursal o unidad de negocio.',
    ],
    tips: ['Desde la barra superior de Despacho contable tienes acceso directo a Libros, Estados financieros, Cierre mensual y Migración Siigo / Loggro.'],
  },
  {
    id: 'contabilidad', title: 'Contabilidad: cuentas PUC, diario, mayor y balance', icon: Calculator, roles: OWNER_CPA, page: 'accounting', mock: 'accounting',
    summary: 'Tu plan de cuentas codificado, tus asientos de partida doble y los libros oficiales: libro diario, libro mayor y balance de comprobación.',
    steps: [
      'Entra a «Contabilidad». En «Plan de cuentas», si aún no tienes uno, pulsa «Usar plantilla genérica» o importa tu PUC oficial desde «Migración Siigo / Loggro».',
      'Al crear una cuenta escribe código y nombre, elige el tipo (activo, pasivo, patrimonio, ingreso, costo o gasto) y su naturaleza (débito o crédito). Desmarca «Admite movimientos» si la cuenta solo agrupa a otras.',
      'En «Libro diario» pulsa «Nuevo asiento manual»: fecha, descripción y las líneas con su cuenta y su débito o crédito. Debe quedar «Cuadrado» (débitos = créditos). Guárdalo como borrador o pulsa «Contabilizar».',
      'Para corregir un asiento contabilizado usa el botón de revertir y escribe el motivo: se crea un asiento inverso y el original se conserva.',
      'En «Libro mayor» elige una cuenta y un rango de fechas para ver sus movimientos con el saldo corrido. En «Balance de comprobación» verifica la igualdad de sumas.',
    ],
    tips: ['Todos los libros tienen botón de exportación directa a CSV compatible con Excel.', 'Las ventas, compras y gastos pueden generar sus asientos solos si activas «Config. contable».'],
  },
  {
    id: 'siigologgro', title: 'Migración e intercambio bidireccional SIIGO ↔ Contable Pro ↔ LOGGRO', icon: ArrowLeftRight, roles: OWNER_CPA, page: 'erpbridge', mock: 'erpbridge',
    summary: 'Transfiere copias completas de terceros, catálogo de productos, plan de cuentas PUC y comprobantes contables entre Siigo, Loggro y Contable Pro en ambos sentidos.',
    steps: [
      'Entra a «Migración Siigo / Loggro» (en la sección Contabilidad). Elige arriba si vas a «1. Exportar de Contable Pro → SIIGO / LOGGRO» o «2. Migrar copia de SIIGO / LOGGRO → Contable Pro».',
      'Para exportar hacia Siigo o Loggro: selecciona el sistema destino («SIIGO Nube / Pyme» o «LOGGRO Pymes»), ajusta el rango de fechas y descarga con un clic Terceros (con cálculo automático del Dígito de Verificación DIAN Módulo 11), Productos o Comprobantes Contables.',
      'Si eliges Siigo Nube, deja marcada la opción «Dividir cada 500 filas» para que el sistema parta automáticamente archivos grandes respetando el límite oficial de importación de Siigo.',
      'Para traer datos desde Siigo o Loggro hacia Contable Pro: elige qué deseas migrar (Terceros, Productos/Ítems, Plan de Cuentas PUC o Comprobantes/Saldos iniciales) y sube el reporte guardado desde Excel como CSV UTF-8.',
      'Revisa la tabla de pre-validación en pantalla (verifica duplicados y que cada comprobante cumpla partida doble Débito = Crédito) y pulsa «Confirmar migración a Contable Pro».',
    ],
    tips: [
      'Puedes pulsar «Plantilla guía CSV» en cada categoría para descargar un archivo modelo con las columnas exactas aceptadas.',
      'Al importar comprobantes contables puedes dejar activa la creación automática de cuentas auxiliares PUC faltantes para no detener la migración.',
    ],
  },
  {
    id: 'contable', title: 'Configuración contable', icon: BookOpen, roles: OWNER_CPA, page: 'accsetup', mock: 'accsetup',
    summary: 'Conecta tus ventas, compras y caja con tu plan de cuentas para que la contabilidad se genere sola, sin digitar asientos.',
    steps: [
      'Primero crea tu plan de cuentas en el módulo «Contabilidad».',
      'Entra a «Config. contable». En «1. Cuentas por operación» elige la cuenta de Caja, Bancos, Ingresos por ventas, Impuestos por pagar, Costo de ventas e Inventario. Son obligatorias.',
      'Opcional: elige cuentas para devoluciones, gastos y faltantes de caja, otros ingresos y sobrantes, y ajustes de inventario. Si las dejas vacías esos movimientos quedan pendientes, no se bloquean.',
      'Pulsa «Guardar cuentas». Lee «2. Reglas que se aplicarán» para saber cómo se contabiliza cada operación.',
      'En «3. Activación» elige la fecha de inicio contable y pulsa «Activar». Desde esa fecha cada venta y compra nueva genera su asiento automáticamente.',
      'En «4. Conciliación» pulsa «Conciliar» para comparar tus cifras operativas con las contables. Si hay diferencias, pulsa «Contabilizar pendientes» para generar los asientos de lo anterior que falte.',
    ],
    tips: ['Los documentos anteriores a la fecha de inicio no se contabilizan solos.', 'Al anular una venta se crea un asiento de reversión: el original se conserva, así queda rastro de todo.', 'El costo de ventas usa el costo actual del producto.'],
  },
  {
    id: 'cierre', title: 'Cierre de libros (mes contable)', icon: Lock, roles: OWNER_CPA, page: 'accclose', mock: 'accclose',
    summary: 'Revisa, cierra y bloquea un mes contable para que nadie modifique sus cifras. No es el cierre de caja diario.',
    steps: [
      'Entra a «Cierre de libros», elige el año y el mes y pulsa «Revisar».',
      'El sistema muestra una lista de verificaciones: ✔ está bien, ⚠ es un aviso y ✖ es un error que debes resolver antes de cerrar.',
      'Si hay avisos, marca la casilla de conformidad. Puedes escribir observaciones.',
      'Pulsa «Cerrar periodo». El mes queda bloqueado.',
      'En «2. Historial de cierres» abre el «Informe» de cualquier mes (balance de comprobación) e imprímelo o guárdalo en PDF para tu contador.',
      'Solo el dueño puede «Reabrir» un mes cerrado, y debe escribir el motivo: queda registrado.',
    ],
    tips: ['Cierra cada mes cuando hayas conciliado y contabilizado los pendientes.', 'Cerrar un mes no es lo mismo que cerrar la caja del día: son procesos distintos.'],
  },
  {
    id: 'estados', title: 'Estados financieros (resultados y balance)', icon: FileBarChart, roles: OWNER_CPA, page: 'accstate', mock: 'statements',
    summary: 'El estado de resultados (¿gané o perdí?) y el balance general (¿qué tengo y qué debo?), calculados de tus asientos contabilizados.',
    steps: [
      'Entra a «Estados financieros». Arriba elige «Estado de resultados» o «Balance general».',
      'Estado de resultados: elige «Desde» y «Hasta». Verás ingresos, costos, utilidad bruta, gastos y el resultado del periodo, con su porcentaje sobre ventas.',
      'Balance general: elige la fecha de corte. Verás activos, pasivos, patrimonio y el resultado aún no cerrado. Debe decir que el balance cuadra.',
      'Si ves el aviso amarillo «Borrador», hay meses sin cerrar o movimientos sin contabilizar: léelo, resuélvelo (Config. contable y Cierre de libros) y vuelve a consultar.',
      'Pulsa «Imprimir» para sacar el estado en papel o guardarlo en PDF para tu contador.',
    ],
    tips: ['Un estado solo es definitivo cuando todos los meses del rango están cerrados y todo está contabilizado.', 'Si el balance no cuadra, revisa los asientos manuales en «Contabilidad».'],
  },
  {
    id: 'metas', title: 'Metas de ventas', icon: Target, roles: BOTH, page: 'goals', mock: 'goals',
    summary: 'El dueño fija metas por vendedor y mes; cada vendedor ve su avance en su panel.',
    steps: [
      'Dueño: en «Metas» elige el mes, selecciona al vendedor y escribe su meta de ventas y de clientes.',
      'Revisa el avance de todo el equipo con barras y estado.',
      'Vendedor: tu meta aparece en el Panel con lo que te falta y lo que necesitas vender por día.',
    ],
  },
  {
    id: 'mapa', title: 'Mapa y rutas', icon: MapPin, roles: OWNER, page: 'map', mock: 'map',
    summary: 'Ve dónde se vendió y qué clientes llevan tiempo sin ser atendidos para planear la ruta.',
    steps: [
      'Abre «Mapa y rutas» para ver los puntos de ventas y visitas.',
      'Filtra los clientes sin atender hace 7, 15, 30, 60 o 90 días, o por frecuencia o monto vendido.',
      'Elige cuántas paradas quieres (5, 8, 10 o 15) y pulsa «Abrir en Google Maps» para seguir la ruta.',
    ],
  },
  {
    id: 'rutas', title: 'Planificar rutas y Mi ruta', icon: RouteIcon, roles: BOTH, page: 'routeplan', mock: 'map',
    summary: 'El dueño reparte los clientes sin atender entre sus vendedores, por zonas y con el menor recorrido. Cada vendedor ve su ruta del día.',
    steps: [
      'Dueño: entra a «Planificar rutas» y marca los vendedores que salen a la calle.',
      'Ajusta los datos: sin atender desde (días), paradas por día, días a planificar, velocidad promedio y minutos por parada. Elige el primer día.',
      'Si quieres, pulsa «Usar mi ubicación como salida» para que la ruta parta desde donde estás. Luego pulsa «Generar plan».',
      'Revisa el mapa y las paradas de cada vendedor, con kilómetros y tiempo estimado. Puedes abrir la ruta en Google Maps o enviarla por WhatsApp.',
      'Los planes quedan en «Planes guardados» con su avance (paradas hechas / total). Puedes eliminar uno que ya no sirva.',
      'Vendedor: en «Mi ruta» ves las paradas de hoy en orden. Pulsa «Vender / visitar» para atender al cliente; la parada se marca sola al registrar la venta o la visita. También puedes marcarla «Visitado» u «Omitido».',
    ],
    tips: [
      'Un cliente entra al plan solo si tiene ubicación guardada. Se guarda en su primera venta o visita con GPS, o con «Corregir ubicación» en «Mapa y rutas».',
      'Si un vendedor dice que no tiene ruta, es que aún no se le planificó ese día.',
      'Los clientes que no caben en los días planificados quedan en «Quedan para después».',
    ],
  },
  {
    id: 'invitar', title: 'Invitar vendedores a tu equipo', icon: UserPlus, roles: OWNER, page: 'routeplan', mock: 'team',
    summary: 'Así entra un vendedor a tu empresa: le mandas un enlace de invitación y se registra solo, con tu mismo plan.',
    steps: [
      'Entra a «Planificar rutas» y abre «Invitar vendedores a tu equipo» (se abre solo si todavía no tienes vendedores).',
      'Pulsa «Crear enlace de invitación». Cada enlace vale 7 días y puede usarlo hasta 5 personas.',
      'Pulsa «Copiar» o «WhatsApp» y envíaselo al vendedor.',
      'El vendedor abre el enlace, pulsa «Regístrate», crea su cuenta, confirma su correo e inicia sesión. Entra como vendedor de tu empresa.',
      'Si el enlace se filtró o ya no lo necesitas, pulsa el bote de basura para revocarlo.',
      'Luego autoriza su teléfono en «Equipo y dispositivos».',
    ],
    tips: ['Trata el enlace como una llave: solo mándalo a personas de confianza.', 'El vendedor ve únicamente lo necesario para vender; tú sigues viendo todo.'],
  },
  {
    id: 'despachoynomina', title: 'Despacho de ruta, comisiones y nómina comercial', icon: BadgeCheck, roles: OWNER_CPA, page: 'sellers', mock: 'team',
    summary: 'Controla la mercancía cargada en cada camión o vendedor de ruta, liquida el retorno del día y calcula comisiones, sueldos base y vales.',
    steps: [
      'En «Despacho de ruta» registra la carga entregada al vendedor al salir y liquida al regreso lo vendido contra las unidades devueltas.',
      'En «Equipo y nómina» define el porcentaje de comisión o sueldo base de cada vendedor, registra adelantos/vales y genera el comprobante de liquidación del período.',
    ],
  },
  {
    id: 'equipo', title: 'Equipo y dispositivos', icon: MonitorSmartphone, roles: OWNER, page: 'team', mock: 'team',
    summary: 'Controla desde qué teléfonos pueden vender tus vendedores.',
    steps: [
      'Entra a «Equipo y dispositivos» y sigue «Conecta un dispositivo en 3 pasos».',
      'Cuando un vendedor entre desde un teléfono nuevo aparecerá como pendiente: autorízalo o bloquéalo.',
      'El vendedor con dispositivo pendiente ve una pantalla de espera hasta que lo autorices; uno bloqueado no puede entrar.',
    ],
    tips: ['Si un vendedor pierde su teléfono, bloquéalo aquí de inmediato.'],
  },
  {
    id: 'soporte', title: 'Soporte técnico y autorización de asistencia', icon: LifeBuoy, roles: ALL_ROLES, page: 'support', mock: 'support',
    summary: 'Reporta consultas o incidencias técnicas desde el módulo donde te encuentres y controla con llave temporal cualquier revisión asistida.',
    steps: [
      'Entra a «Soporte y autorización», describe tu consulta y adjunta el módulo de origen para que soporte tenga contexto inmediato.',
      'Si un especialista técnico necesita revisar tu sesión para ayudarte, tú decides cuándo generar y revocar el código temporal de autorización.',
    ],
    tips: ['Ningún técnico puede acceder sin que tú habilites expresamente la autorización temporal.'],
  },
  {
    id: 'config', title: 'Configuración de la empresa', icon: SettingsIcon, roles: OWNER, page: 'settings', mock: 'settings',
    summary: 'Datos fiscales de tu negocio, moneda base, impuestos y verificación de ubicación.',
    steps: [
      'En «Información de la empresa» completa nombre comercial, ID fiscal (NIT, RIF, RFC, RUT…), teléfono, correo y dirección: salen en facturas, catálogo web, enlaces de WhatsApp y reportes.',
      'Elige la «Moneda» base de tu empresa (ej. COP, USD, VES). Todos los precios, tickets y libros se expresan en esa moneda.',
      'Si quieres, escribe un «Prefijo Factura» para tus comprobantes.',
      'Impuestos: en «Cómo se aplica el impuesto» elige «Sin impuesto», «Precios con impuesto incluido» o «Impuesto adicional» y escribe la tasa en «Impuesto (%)».',
      'Ubicación en ventas: Desactivada, Solo vendedores o Todos los que registran ventas. Guarda los cambios.',
    ],
    tips: ['Define los impuestos y la moneda antes de vender: el cálculo se hace con la regla vigente al momento de la operación.'],
  },
  {
    id: 'plansepare', title: 'Plan Separe y sistema de apartados', icon: CalendarClock, roles: BOTH, page: 'layaways', mock: 'layaways',
    summary: 'Permite que tus clientes aparten prendas o mercancía con un abono inicial, paguen por cuotas y retiren su pedido al completar el saldo.',
    steps: [
      'Entra a «Plan Separe y apartados» y pulsa «Nuevo Plan Separe»: elige el cliente, los productos (con su talla o cualidad), el plazo en días y el abono inicial.',
      'El sistema reserva las unidades para no venderlas por error e ingresa automáticamente a Caja los abonos recibidos en efectivo.',
      'Usa el botón «WhatsApp» para enviar recordatorios de saldo y vencimiento con un toque, o «Abonar» cada vez que el cliente pague una cuota.',
      'Cuando el saldo llegue a cero, pulsa «Entregar y facturar»: se emite la venta oficial y se descuenta el inventario físico.',
    ],
    tips: ['Si un apartado vence y el cliente desiste, pulsa «Liberar» para que la mercancía vuelva a estar disponible en vitrina.'],
  },
  {
    id: 'cambiosgarantias', title: 'Cambios «mano a mano» y garantías posventa', icon: ArrowLeftRight, roles: BOTH, page: 'exchanges', mock: 'exchanges',
    summary: 'Resuelve cambios rápidos de talla o referencia sin tener que anular toda la factura original, y controla las garantías con clientes y proveedores.',
    steps: [
      'En «Cambios y garantías» pulsa «Nuevo cambio rápido»: selecciona la prenda que devuelve el cliente (entra a inventario) y la que se lleva (sale de inventario).',
      'Si cuestan igual (por ejemplo cambio de Talla M a Talla L), el cambio queda en $0 sin descuadrar la caja; si lleva algo de mayor valor, el sistema cobra únicamente el excedente.',
      'En la pestaña «Control de garantías» registra productos con defecto de fábrica, indica si entregaste reemplazo inmediato y actualiza el estado hasta cerrar el caso con el proveedor.',
    ],
  },
  {
    id: 'tomaciega', title: 'Toma física ciega de inventario (auditoría anti-pérdidas)', icon: EyeOff, roles: ALL_ROLES, page: 'blindcount', mock: 'blindcount',
    summary: 'Audita tu mercancía sin cerrar el local: quien cuenta desde el celular o lector de barras NO ve cuántas unidades dice el sistema.',
    steps: [
      'El dueño o encargado entra a «Toma física ciega» y crea una jornada sobre todo el catálogo o sobre una categoría específica.',
      'En «Modo conteo ciego», el operador escanea con la cámara (+1 por lectura) o digita cantidades físicas sin ver el stock teórico.',
      'En «Conciliación gerencial», el dueño o contador revisa faltantes y sobrantes valorizados al costo y pulsa «Aprobar y ajustar Kardex» para cuadrar el inventario en un clic e imprimir el acta.',
    ],
  },
  {
    id: 'escudoprecios', title: 'Escudo de márgenes y actualizador masivo de precios', icon: ShieldCheck, roles: OWNER, page: 'priceshield', mock: 'priceshield',
    summary: 'Protege tu ganancia frente a subidas de proveedores o inflación con redondeo comercial limpio y reimpresión inmediata de etiquetas.',
    steps: [
      'Entra a «Escudo de precios» para ver al instante qué referencias cayeron por debajo de tu margen bruto mínimo o quedaron en pérdida.',
      'Elige la regla (proteger margen mínimo, incremento porcentual o subida de costo de reposición) y el redondeo comercial (múltiplos de 50, 100, 500, 1.000 o terminación .900).',
      'Revisa el comparativo Antes vs. Después, pulsa «Aplicar» y enseguida «Imprimir etiquetas actualizadas» para enviar solo esos productos listos al módulo de Etiquetas.',
    ],
  },
  {
    id: 'conciliacionbancaria', title: 'Conciliación bancaria automática y 4×1000', icon: FileSpreadsheet, roles: OWNER_CPA, page: 'bankrecon', mock: 'bankrecon',
    summary: 'Cruza tu extracto CSV, PDF o pantallazo de Bancolombia, Nequi, Daviplata, Banesco o Zelle contra tus ventas, compras y gastos en segundos.',
    steps: [
      'Entra a «Conciliación bancaria» y sube el archivo CSV del banco o escanea una foto/PDF de tus movimientos.',
      'El sistema empareja automáticamente cada abono con tus ventas o pedidos web y marca en rojo los movimientos huérfanos (ingresos no facturados o pagos sin soporte).',
      'Detecta cobros bancarios (GMF 4×1000, comisiones de datáfono, cuota de manejo, IVA comisión, IGTF) y te permite llevarlos a Gastos Operativos con un solo clic.',
    ],
  },
  {
    id: 'omnichannel', title: 'Centro universal de pedidos omnicanal y picking', icon: Layers, roles: OWNER_CPA, page: 'omnichannel', mock: 'omnichannel',
    summary: 'Bandeja unificada que recibe pedidos de WhatsApp, Catálogo Web, Ruta, POS y API externa, con pipeline de alistamiento de bodega.',
    steps: [
      'Entra a «Pedidos omnicanal» para ver en una sola pantalla los pedidos que entran por todos tus canales.',
      'Avanza el pedido por el flujo: Recibido → Alistamiento (Picking) → Empaque (Packing) → Listo para Despacho → En Reparto → Entregado.',
      'Pulsa «Imprimir ticket de bodega» para generar la lista de picking física con casillas de verificación para el bodeguero.',
      'Envía actualizaciones automáticas por WhatsApp al cliente en 1 clic y conecta con el despacho de ruta.',
    ],
    tips: ['Incluye detector anti-fraude que alerta si el comprobante bancario ya fue usado antes.'],
  },
  {
    id: 'ai_actions', title: 'Agente de IA con ejecución bajo aprobación (Human-in-the-Loop)', icon: Sparkles, roles: OWNER, page: 'ai_actions', mock: 'ai_actions',
    summary: 'La IA analiza tu negocio y formula propuestas de compra, ajustes de precios por inflación o cobro de cartera, pero NUNCA ejecuta sin tu autorización.',
    steps: [
      'Entra a «Acciones de IA» para revisar las propuestas operativas preparadas por el agente.',
      'Cada tarjeta muestra el motivo, la urgencia, el impacto financiero y el rol mínimo necesario para autorizar.',
      'Pulsa «Aprobar y ejecutar transacción» para que el sistema cree la orden o ajuste de inmediato, emitiendo un ID de transacción inmutable con tu firma de usuario.',
      'Si no estás de acuerdo, pulsa «Descartar» e indica el motivo para que la IA refine sus futuros análisis.',
    ],
    tips: ['Toda acción ejecutada queda registrada con fecha, hora y usuario responsable para auditoría total.'],
  },
  {
    id: 'branch_balance', title: 'Inventario predictivo y balanceo entre sucursales', icon: ArrowLeftRight, roles: OWNER, page: 'branch_balance', mock: 'branch_balance',
    summary: 'Cruza la velocidad de venta y días de cobertura para trasladar mercancía inmovilizada hacia las sedes con riesgo de quiebre inminente.',
    steps: [
      'Entra a «Balanceo de sedes» para ver la comparativa de inventario en tiempo real entre tus bodegas.',
      'El sistema detecta automáticamente cuando una sede entrará en agotamiento en menos de 3 días mientras otra tiene sobrestock para 60 días.',
      'Pulsa «Generar traslado sugerido» para crear el borrador precargado y enviarlo directo al módulo de Sedes y Multibodega.',
    ],
  },
  {
    id: 'supplier_intel', title: 'Inteligencia y evaluación de proveedores (Scoring OTIF)', icon: BadgeCheck, roles: OWNER_CPA, page: 'supplier_intel', mock: 'supplier_intel',
    summary: 'Mide la puntualidad, cumplimiento de cantidades completas (OTIF), promedio de días de retraso y alertas por aumento de costos unitarios.',
    steps: [
      'Entra a «Evaluación proveedores» para ver el ranking comercial clasificado de A+ a D.',
      'Supervisa la tasa de entregas a tiempo y completas (OTIF) calculada con base en las órdenes de compra reales.',
      'Revisa el semáforo de inflación de costos: el sistema te avisa si un proveedor te subió el precio unitario frente a la última compra.',
    ],
  },
  {
    id: 'anomaly_detector', title: 'Detección de anomalías y prevención de pérdidas', icon: ShieldCheck, roles: OWNER, page: 'anomaly_detector', mock: 'anomaly_detector',
    summary: 'Motor de reglas preventivas que supervisa descuentos atípicos en caja, mermas en toma física ciega y devoluciones sospechosas post-cierre.',
    steps: [
      'Entra a «Detección de anomalías» para revisar las alertas de riesgo operacional detectadas.',
      'Examina el impacto financiero en riesgo y el personal involucrado en la transacción.',
      'Pulsa «Emitir dictamen de auditoría» para clasificar el incidente como Justificado o Sancionado con medidas correctivas.',
    ],
  },
  {
    id: 'epod', title: 'Prueba digital de entrega y recepción (e-POD con firma y GPS)', icon: ClipboardCheck, roles: BOTH, page: 'omnichannel', mock: 'epod',
    summary: 'Certifica la entrega de pedidos en calle capturando firma táctil en pantalla, foto del paquete y coordenadas GPS con sello temporal.',
    steps: [
      'Al entregar un pedido en ruta o despacho, pulsa «Capturar firma e-POD».',
      'El cliente firma directamente con su dedo o lápiz táctil en la pantalla de tu celular.',
      'Toma o adjunta la foto del paquete recibido y el sistema captura las coordenadas GPS exactas.',
      'Guarda y genera la constancia digital con botón directo para compartir el comprobante por WhatsApp al cliente.',
    ],
  },
  {
    id: 'equipment_assets', title: 'Gestión de maquinaria, activos fijos y mantenimiento preventivo', icon: Gauge, roles: OWNER_CPA, page: 'equipment_assets', mock: 'equipment_assets',
    summary: 'Fichas operativas para vehículos de reparto, balanzas, congeladores e impresoras térmicas con semáforo de mantenimiento preventivo.',
    steps: [
      'Entra a «Activos y maquinaria» para ver el estado de tus equipos de trabajo.',
      'Supervisa el semáforo preventivo: Al día (verde), Próximo a vencer (amarillo) o Vencido (rojo) por días o kilometraje/horas.',
      'Pulsa «Registrar mantenimiento» para imputar el costo del servicio a Gastos Operativos y a su respectivo centro de costos.',
    ],
  },
  {
    id: 'employee_portal', title: 'Portal de autoservicio para vendedores en calle', icon: Target, roles: BOTH, page: 'employee_portal', mock: 'employee_portal',
    summary: 'Vista móvil para asesores y cobradores con su meta del mes, comisiones ganadas/pendientes y cartera de clientes asignada.',
    steps: [
      'Los asesores comerciales pueden abrir «Portal de vendedores» en su propio teléfono.',
      'Consultar en vivo el porcentaje de cumplimiento de su meta y el cálculo exacto de comisiones ganadas y por liquidar.',
      'Ver su listado de clientes asignados con saldos pendientes y botón directo de contacto por WhatsApp.',
    ],
    tips: ['Aislamiento estricto: el vendedor no ve costos, márgenes de ganancia ni contabilidad general de la empresa.'],
  },
  {
    id: 'compliance', title: 'Cumplimiento, vencimientos empresariales y calendario legal', icon: CalendarClock, roles: OWNER_CPA, page: 'compliance', mock: 'compliance',
    summary: 'Monitor unificado para SOAT, Tecnomecánica, Cámara de Comercio, Bomberos, DIAN y vencimiento crítico de lotes.',
    steps: [
      'Entra a «Vencimientos legales» para supervisar todas las obligaciones con fecha límite de la empresa.',
      'Recibe alertas automáticas escalonadas a 30, 15 y 3 días antes de que venza un documento o póliza.',
      'Sincroniza con los lotes de inventario perecedero para aplicar rebajas o promociones antes de que se conviertan en merma.',
    ],
  },
  {
    id: 'api_ecosystem', title: 'API REST v1 y Ecosistema de integraciones (Webhooks)', icon: FileSpreadsheet, roles: OWNER, page: 'api_ecosystem', mock: 'api_ecosystem',
    summary: 'Conecta Inventario Pro con tu tienda en WooCommerce, Shopify, facturación local o sistemas externos mediante endpoints autenticados.',
    steps: [
      'Entra a «API y Webhooks» para generar tus claves de API Key con permisos específicos (leer stock, crear pedidos).',
      'Consulta endpoints activos como GET /api/v1/products, POST /api/v1/orders y GET /api/v1/stock/:branchId.',
      'Revisa la documentación interactiva con ejemplos listos para copiar en cURL y JavaScript Fetch.',
    ],
  },
  {
    id: 'suscripcion', title: 'Suscripción y plan', icon: CreditCard, roles: BOTH, page: 'subscription', mock: 'plan',
    summary: 'Tu prueba gratis dura 3 meses. Después activa un plan para seguir registrando operaciones.',
    steps: [
      'Mira los días restantes en el aviso amarillo de arriba.',
      'Entra a «Suscripción», elige el plan y la forma de pago.',
      'Si la prueba termina, el sistema pasa a solo lectura: ves tu información pero no registras nada hasta activar.',
    ],
    tips: ['Tus datos no se borran si se vence la suscripción.'],
  },
]

export const QUICK_START = [
  { t: 'Configura tu empresa', d: 'Nombre fiscal, NIT/RIF, moneda base e IVA en Configuración.' },
  { t: 'Carga productos o migra tu ERP', d: 'Crea productos con foto/variantes o impórtalos de Siigo/Loggro.' },
  { t: 'Activa tu Catálogo y WhatsApp', d: 'Personaliza logo, medios de pago y comparte tu vitrina web.' },
  { t: 'Imprime etiquetas o códigos QR', d: 'Pégalas en la mercancía para escanear en el mostrador.' },
  { t: 'Invita y autoriza a tu equipo', d: 'Agrega vendedores o tu contador y aprueba sus dispositivos.' },
  { t: 'Vende y usa el escáner OCR', d: 'Mostrador, ruta, pedidos web o foto de cuaderno/facturas.' },
]

export const FAQ = [
  { q: '¿Cómo hago un cambio de talla o referencia sin anular la factura original?', a: 'Entra a «Ventas y cobros → Cambios y garantías» y pulsa «Nuevo cambio rápido». Eliges la prenda que entra y la que sale: si valen igual, el cambio queda en $0 y ajusta el Kardex; si el cliente lleva una de mayor valor, solo cobras la diferencia.' },
  { q: '¿Cómo funciona el Plan Separe para apartar mercancía por abonos?', a: 'En «Plan Separe y apartados» registras el cliente, las prendas apartadas y el abono inicial. Cada cuota en efectivo entra a Caja, puedes enviar recordatorios por WhatsApp y al completar el saldo pulsas «Entregar y facturar» para generar la venta oficial.' },
  { q: '¿Cómo evito que los empleados copien el stock del sistema al contar inventario?', a: 'Usa «Inventario → Toma física ciega». El operador cuenta con celular o cámara de códigos de barras sin ver cuántas unidades dice el sistema; solo el dueño o contador ve la hoja de diferencias y aprueba el ajuste en Kardex.' },
  { q: '¿Cómo concilio mi extracto de Nequi o Bancolombia y registro el 4×1000?', a: 'En «Caja y gastos → Conciliación bancaria» sube el CSV o foto/PDF de tu extracto. El sistema cruza ventas y pagos automáticamente y detecta comisiones y 4×1000 para registrarlos en Gastos Operativos con un clic.' },
  { q: '¿Qué pasa si se va la electricidad o el internet y anotamos ventas en un cuaderno?', a: 'Tienes dos respaldos: si tenías celular con batería, puedes vender sin internet y se sincroniza solo al volver la señal. Y si anotaron las ventas a mano en un cuaderno físico, al regresar la energía entra a «Ventas» o «Mostrador» y pulsa «Escanear cuaderno»: tomas una foto a la hoja, revisas las filas detectadas y el sistema carga todas las ventas descontando stock.' },
  { q: '¿También puedo escanear facturas de compra de mercancía y recibos de agua o luz?', a: 'Sí. Para mercancía entra a «Compras» → «Escanear factura / ticket» (lee proveedor, ítems, cantidades, costos y lotes). Para recibos de agua, energía, gas, internet o arriendo entra a «Gastos operativos» → «Escanear recibo (Agua, Luz, Gastos)».' },
  { q: '¿Cómo valida el sistema los captures de Nequi, Pago Móvil o transferencias en los pedidos web?', a: 'En «Pedidos de catálogo» abre el pedido y pulsa «Auditar capture (OCR)» (o sube el pantallazo recibido por WhatsApp). El sistema extrae banco, referencia, fecha, monto y estado, compara el valor contra el total del pedido y verifica automáticamente que ese número de referencia no haya sido usado en otro pedido.' },
  { q: '¿El sistema es compatible con SIIGO y LOGGRO para pasar información en ambos sentidos?', a: 'Sí. En «Contabilidad → Migración Siigo / Loggro» puedes exportar desde Contable Pro hacia Siigo Nube/Pyme (con Dígito de Verificación DIAN automático y división cada 500 filas) o hacia Loggro Pymes, y también importar copias en CSV desde Siigo o Loggro hacia Contable Pro (Terceros, Productos, Plan de Cuentas PUC y Comprobantes de partida doble).' },
  { q: 'Actualicé el nombre de mi empresa pero en WhatsApp salió el nombre anterior al pegar el enlace, ¿por qué?', a: 'WhatsApp guarda en la memoria del teléfono la vista previa de enlaces compartidos anteriormente durante horas o días. Entra a «Catálogo comercial → Enlace y WhatsApp», verifica tu enlace limpio (/tienda/nombre-empresa) y compártelo de nuevo para mostrar la tarjeta actualizada.' },
  { q: '¿Por qué no veo un módulo que otra persona sí ve?', a: 'El menú depende del rol: el vendedor ve ventas, catálogo, clientes y rutas; el contador ve libros, despacho contable, impuestos y migración Siigo/Loggro; el dueño y administrador controlan toda la empresa.' },
  { q: 'Me equivoqué en una venta, ¿qué hago?', a: 'Pídele al dueño o administrador que la anule desde Ventas. Al anular regresa el stock y se revierte la caja. Para devolver solo parte, usa Devoluciones.' },
  { q: 'El escáner de cámara no lee el código de barras', a: 'Mejora la luz, acerca o aleja el teléfono y mantén la etiqueta plana. Como alternativa, escribe el código en el buscador o imprime etiquetas QR.' },
  { q: '¿Cómo envío el comprobante o el catálogo a un cliente?', a: 'En Ventas pulsa «Ver / Enviar» para compartir el recibo en PDF o WhatsApp. Para enviar toda tu vitrina interactiva con fotos y precios, entra a «Catálogo comercial» y pulsa «WhatsApp» o «Exportar PDF».' },
  { q: '¿El precio por mayor se aplica solo?', a: 'Sí. Si el cliente es Por mayor, desde la primera unidad. Si es de detal, cuando la cantidad del producto llega al mínimo que definió el dueño.' },
  { q: '¿Qué es el Copiloto y por qué me avisa esto?', a: 'Es el asistente interno de InventarioPro: revisa tus ventas, stock, clientes, metas y contabilidad, y te avisa lo que conviene atender usando únicamente los datos reales de tu empresa.' },
  { q: '¿Por qué la utilidad de un producto no coincide con mi cálculo?', a: 'El reporte resta descuentos, impuesto y devoluciones, y usa el costo actual del producto. Revisa que cada artículo tenga su costo actualizado en Productos o al registrar Compras.' },
  { q: '¿Cómo vendo fiado y controlo el cupo de crédito?', a: 'Elige un cliente registrado y la forma de pago «Fiado». La deuda queda en «Cartera (fiado)», donde defines el cupo máximo y registras abonos parciales o totales.' },
  { q: '¿Qué productos deben llevar lotes y vencimientos?', a: 'Alimentos, medicinas o cosméticos perecederos. Se activan en «Lotes y vencimientos»; al vender, el sistema descuenta automáticamente del lote próximo a vencer (FEFO) y bloquea lotes vencidos.' },
  { q: '¿Cada cuánto debo cerrar los libros contables?', a: 'Una vez al mes: concilia en «Despacho contable» o «Config. contable», contabiliza pendientes y bloquea el período en «Cierre de libros».' },
  { q: '¿Cómo agrego a un vendedor y autorizo su celular?', a: 'En «Planificar rutas» crea un enlace de invitación y envíaselo por WhatsApp. Cuando inicie sesión, aprueba su teléfono en «Equipo y dispositivos».' },
  { q: '¿Cómo cambio la moneda o el IVA de mi empresa?', a: 'En «Configuración» defines la moneda base (COP, USD, VES, etc.), el porcentaje de impuesto y si está incluido o se suma al precio.' },
  { q: '¿Cómo funciona el aislamiento de datos para el Administrador Central?', a: 'El Administrador Central tiene una cubeta de prueba aislada para producción y pruebas. Por estrictas políticas de seguridad y Row Level Security (RLS) en Supabase, el Administrador Central NO puede observar las transacciones ni los datos privados de las empresas de terceros, únicamente sus datos de membresía, plan y estado administrativo.' },
  { q: '¿Cómo se estructura el Catálogo PUC NIIF y cómo se asegura la Partida Doble?', a: 'El catálogo de cuentas sigue la estructura estándar NIIF colombiana organizada en 4 niveles jerárquicos (Clase, Grupo, Cuenta, Subcuenta). Todo asiento contable exige que la sumatoria de débitos sea estrictamente igual a la sumatoria de créditos (diferencia = $0) y que tenga al menos dos líneas válidas. Una vez posteado o cerrado, los registros son inmutables por base de datos.' },
  { q: '¿Cómo funciona el modo simulación y la demostración en vivo?', a: 'En la parte superior de la aplicación (o en el menú de demostración) puedes alternar entre cualquier rol: Dueño, Administrador de Empresa, Gerente, Contador Público, Almacén, Vendedor, Transporte y Soporte Técnico. La interfaz y la barra lateral se adaptan en tiempo real según los permisos exactos de cada perfil.' },
]

export function norm(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
