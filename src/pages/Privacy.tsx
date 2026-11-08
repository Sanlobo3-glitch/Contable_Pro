import LegalLayout, { type LegalSection } from '../components/LegalLayout'

// Cambia estos valores antes de publicar
const CONTACT_EMAIL = 'emerald.red.social@gmail.com'
const UPDATED = '22 de octubre de 2026'

const sections: LegalSection[] = [
  {
    title: 'Quién es el responsable',
    paragraphs: [
      `InventarioPro es desarrollado y operado por Richard J. Lobo S. Para cualquier consulta sobre tus datos escribe a ${CONTACT_EMAIL}.`,
    ],
  },
  {
    title: 'Qué datos recopilamos',
    paragraphs: [
      'Cuenta: nombre completo, correo electrónico y contraseña. La contraseña se almacena cifrada (hash) por el proveedor de autenticación.',
      'Datos de tu negocio que tú registras: nombre de la empresa, RIF, dirección y teléfono; productos, categorías, inventario y kardex; ventas, compras, cotizaciones, devoluciones y movimientos de caja; clientes y proveedores.',
      'Suscripción: plan, estado, fecha de fin de la prueba y de vencimiento.',
      'Datos técnicos: dirección IP, tipo de navegador y registros de acceso o de errores generados por la infraestructura.',
      'Datos del equipo de tu empresa: el dueño o los administradores pueden registrar datos de sus vendedores y administradores (teléfono, cargo, cédula o documento de identidad, dirección y notas). Solo el dueño y los administradores de esa empresa pueden verlos y editarlos.',
      'Ubicación (opcional): si la empresa activa el registro de ubicación en las ventas, al registrar una venta se solicita la ubicación del dispositivo (con tu permiso) y se guardan latitud, longitud, precisión, si el vendedor indicó estar en el establecimiento del cliente y una nota. Solo el dueño y los administradores de la empresa pueden verla. La empresa debe informar a su equipo de que se registra su ubicación.',
      'Dispositivos: al iniciar sesión registramos un identificador generado por la aplicación, el tipo de dispositivo (móvil, tablet, PC o Mac), el sistema operativo, el navegador y la fecha del último acceso, para que el dueño o los administradores de tu empresa puedan autorizar o bloquear dispositivos.',
    ],
  },
  {
    title: 'Para qué los usamos',
    paragraphs: [
      'Para prestarte el Servicio: crear tu cuenta, autenticarte, aplicar los permisos de cada rol y las condiciones de tu plan, generar tus reportes, enviarte correos del sistema (confirmación de cuenta, recuperación de contraseña, avisos de suscripción), dar soporte y proteger la plataforma contra abusos.',
      'No vendemos tus datos ni los usamos para publicidad de terceros.',
    ],
  },
  {
    title: 'Datos de tus clientes, proveedores y personal',
    paragraphs: [
      'Los datos de las personas y empresas con las que tú trabajas, y los de tu propio personal, son responsabilidad tuya frente a ellas. Debes contar con su autorización para registrarlos. Nosotros solo los procesamos por encargo tuyo para que el Servicio funcione; no los usamos para otros fines ni contactamos a esas personas.',
    ],
  },
  {
    title: 'Con quién compartimos datos',
    paragraphs: [
      'Usamos proveedores de servicios que procesan datos por nuestra cuenta: Supabase (base de datos y autenticación), Vercel (alojamiento de la aplicación), Cloudflare (DNS y enrutamiento de correo), Brevo (envío de correos del sistema) y PayPal (pagos).',
      'Estos proveedores pueden almacenar o procesar datos en servidores ubicados fuera de Venezuela, incluidos Estados Unidos y otros países. Compartimos solo lo necesario. Si usas la función de compartir ventas o cotizaciones por WhatsApp, el contenido se envía a ese servicio por decisión tuya y se rige por sus propias condiciones. También podremos divulgar información si una autoridad competente lo exige conforme a la ley.',
    ],
  },
  {
    title: 'Pagos',
    paragraphs: [
      'Los pagos los procesa PayPal. InventarioPro no almacena números de tarjeta; solo recibe la confirmación y el estado del pago.',
    ],
  },
  {
    title: 'Almacenamiento local y cookies',
    paragraphs: [
      'Usamos almacenamiento local del navegador y cookies técnicas para mantener tu sesión iniciada y recordar preferencias. También guardamos en tu navegador un identificador anónimo del dispositivo, que sirve para el control de dispositivos autorizados de tu empresa. No usamos cookies de publicidad.',
    ],
  },
  {
    title: 'Conservación',
    paragraphs: [
      'Conservamos tus datos mientras tu cuenta exista y el tiempo necesario para cumplir obligaciones legales o resolver disputas. Si solicitas la eliminación de tu cuenta, borramos o anonimizamos tus datos en un plazo razonable, salvo que la ley nos obligue a conservarlos.',
    ],
  },
  {
    title: 'Seguridad',
    paragraphs: [
      'Aplicamos medidas técnicas y organizativas razonables: conexiones cifradas (HTTPS), autenticación y permisos por rol. Ningún sistema es completamente seguro, por lo que te pedimos proteger tu contraseña y revisar los usuarios que tienen acceso a tu cuenta.',
    ],
  },
  {
    title: 'Tus derechos',
    paragraphs: [
      `Puedes pedir acceso, corrección, actualización o eliminación de tus datos, y oponerte a ciertos usos, escribiendo a ${CONTACT_EMAIL}. Responderemos en un plazo razonable.`,
    ],
  },
  {
    title: 'Menores de edad',
    paragraphs: [
      'El Servicio está dirigido a negocios y personas mayores de 18 años. No recopilamos datos de menores de forma intencional.',
    ],
  },
  {
    title: 'Cambios a esta política',
    paragraphs: [
      'Podemos actualizar esta política; la versión vigente se publica aquí con su fecha. Si el cambio es importante, te avisaremos dentro de la aplicación o por correo.',
    ],
  },
]

export default function Privacy() {
  return (
    <LegalLayout
      title="Política de privacidad"
      updated={UPDATED}
      intro="Esta política explica qué datos recopila InventarioPro, para qué los usa y con quién los comparte."
      sections={sections}
    />
  )
}
