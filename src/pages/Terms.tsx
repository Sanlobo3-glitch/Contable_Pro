import LegalLayout, { type LegalSection } from '../components/LegalLayout'

// Cambia estos valores antes de publicar
const CONTACT_EMAIL = 'emerald.red.social@gmail.com'
const UPDATED = '22 de octubre de 2026'

const sections: LegalSection[] = [
  {
    title: 'Quién presta el servicio y aceptación',
    paragraphs: [
      'InventarioPro (el «Servicio») es un software web para gestionar inventario, ventas, compras, cotizaciones, devoluciones, caja, clientes, proveedores, kardex y reportes, con herramientas de contabilidad básica. Es desarrollado y operado por Richard J. Lobo S. (el «Desarrollador»).',
      'Al crear una cuenta o usar el Servicio aceptas estos términos. Si no estás de acuerdo, no lo uses.',
    ],
  },
  {
    title: 'Cuenta y usuarios',
    paragraphs: [
      'Debes ser mayor de 18 años o actuar en nombre de un negocio. La información de registro debe ser veraz y mantenerse actualizada.',
      'Eres responsable de guardar tus credenciales y de toda la actividad realizada desde tu cuenta, incluida la de los usuarios que crees. El Servicio asigna roles (dueño, administrador y vendedor) con permisos distintos. El dueño o los administradores de una empresa pueden registrar datos de su personal y autorizar o bloquear los dispositivos desde los que se accede a la cuenta; son responsables de contar con la autorización de esas personas.',
    ],
  },
  {
    title: 'Prueba gratuita y planes',
    paragraphs: [
      'Los usuarios nuevos disponen de una prueba gratuita de 3 meses, sin necesidad de tarjeta de crédito.',
      'Los planes de pago son Emprendedor, Profesional, Empresarial y Corporativo, con las características y los precios publicados en la aplicación. Algunos módulos pueden requerir un plan de pago. El Desarrollador puede conceder acceso gratuito o de por vida a instituciones educativas u otras personas, a su criterio, y retirarlo si se incumplen estos términos. El Desarrollador puede modificar planes, precios, módulos y promociones, avisando con antelación razonable; los cambios no afectan los períodos ya pagados.',
    ],
  },
  {
    title: 'Fin de la prueba o de la suscripción',
    paragraphs: [
      'Cuando termina la prueba o vence una suscripción sin renovarse, la cuenta pasa a modo de solo lectura: puedes consultar tu información y los reportes, pero no registrar ni modificar datos hasta activar un plan. Tus datos no se eliminan por el solo hecho de pasar a este modo.',
    ],
  },
  {
    title: 'Pagos',
    paragraphs: [
      'Los pagos se procesan mediante proveedores externos como PayPal; el Desarrollador no almacena números de tarjeta. Los precios se expresan en dólares estadounidenses (USD) e impuestos o comisiones aplicables corren por cuenta del usuario.',
      `Salvo que la ley disponga lo contrario, los pagos no son reembolsables. Si crees que hubo un cobro erróneo, escribe a ${CONTACT_EMAIL} y lo revisaremos.`,
    ],
  },
  {
    title: 'Uso aceptable',
    paragraphs: [
      'No puedes usar el Servicio para actividades ilegales o fraudulentas, intentar acceder a datos o cuentas de otras personas, hacer ingeniería inversa, sobrecargar la plataforma ni revender el acceso sin autorización.',
    ],
  },
  {
    title: 'Tus datos',
    paragraphs: [
      'La información que registras (productos, ventas, clientes, etc.) es tuya. Nos autorizas a almacenarla y procesarla solo para prestarte el Servicio. Eres responsable de que los datos de tus propios clientes y proveedores se traten con las autorizaciones que la ley exija. Si activas el registro de ubicación en las ventas, debes informar a tu equipo y contar con su autorización conforme a la ley. Más detalles en la Política de privacidad.',
    ],
  },
  {
    title: 'Alcance contable y fiscal',
    paragraphs: [
      'InventarioPro es una herramienta de apoyo a la gestión. No sustituye la asesoría de un contador ni constituye por sí mismo un sistema de facturación fiscal autorizado por la autoridad tributaria. Eres responsable de cumplir tus obligaciones fiscales, legales y contables, y de verificar la exactitud de los cálculos y reportes.',
    ],
  },
  {
    title: 'Disponibilidad y respaldos',
    paragraphs: [
      'Procuramos que el Servicio esté disponible, pero no garantizamos que funcione sin interrupciones ni errores. Pueden ocurrir fallas por mantenimiento o por proveedores externos (alojamiento, base de datos, correo). Te recomendamos imprimir o exportar periódicamente tus reportes importantes.',
    ],
  },
  {
    title: 'Propiedad intelectual',
    paragraphs: [
      'El software, su diseño, el nombre InventarioPro y su logotipo pertenecen al Desarrollador. Se te concede una licencia limitada, no exclusiva e intransferible para usar el Servicio mientras cumplas estos términos.',
    ],
  },
  {
    title: 'Limitación de responsabilidad',
    paragraphs: [
      'En la medida que permita la ley, el Servicio se ofrece «tal cual». El Desarrollador no responde por pérdidas indirectas, lucro cesante, pérdida de datos ni por decisiones tomadas con base en la información del sistema. Cuando exista responsabilidad, se limita a lo efectivamente pagado por el usuario en los 12 meses anteriores al hecho.',
    ],
  },
  {
    title: 'Suspensión y terminación',
    paragraphs: [
      'Podemos suspender cuentas que incumplan estos términos. Puedes dejar de usar el Servicio cuando quieras y solicitar la eliminación de tu cuenta escribiendo al correo de contacto.',
    ],
  },
  {
    title: 'Cambios, ley aplicable y contacto',
    paragraphs: [
      'Podemos actualizar estos términos; la versión vigente se publica en la aplicación con su fecha. Si el cambio es importante, te avisaremos dentro de la aplicación o por correo. Seguir usando el Servicio implica aceptar la versión actualizada.',
      `Estos términos se rigen por las leyes de la República Bolivariana de Venezuela. Para consultas: ${CONTACT_EMAIL}.`,
    ],
  },
]

export default function Terms() {
  return (
    <LegalLayout
      title="Términos y condiciones"
      updated={UPDATED}
      intro="Estas condiciones regulan el uso de InventarioPro. Léelas antes de crear tu cuenta."
      sections={sections}
    />
  )
}
